import React, { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { createSession, updateSessionState, updateSessionSlides, subscribeToViewerCount } from '@/lib/session'
import { motion, AnimatePresence } from 'framer-motion'
import {
  DndContext, closestCenter,
  KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, verticalListSortingStrategy, rectSortingStrategy,
  useSortable, arrayMove, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import {
  Plus, Minus, Trash2, GripVertical, FileText, Copy,
  Cloud, AlignLeft, AlignCenter, AlignRight, Star, Upload, Play,
  LayoutList, Bookmark, BookmarkCheck, Monitor, LayoutGrid,
  Video, Type, List, Quote, Users, BarChart2, PieChart,
  X, Table2, Check, Undo2, Redo2, Trophy, ImageIcon,
  ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, Clock,
} from 'lucide-react'
import { AlayaMark } from '@/components/AlayaMark'
import { PersistentHtmlIframe } from '@/components/PersistentHtmlIframe'
import { cn } from '@/lib/utils'
import {
  getStorageBackend, setStorageBackend,
  browserSaveDeck, cloudSaveDeck, getUniqueDeckTitle,
  signInWithGoogle, onAuthStateChanged, auth,
  saveResults,
  type StorageBackend, type Deck, type User, type DeckResults,
} from '@/lib/deckStorage'

/* ─────────────────────────────────────────────────────────────────────────
   PDF.js — lazy-loaded on first PDF import so the 1.2 MB worker doesn't
   hit users who never open the editor, or who open it but never import a PDF.
   Cached after first load so subsequent imports are instant.
   ───────────────────────────────────────────────────────────────────────── */
let _pdfjs: typeof import('pdfjs-dist') | null = null
async function getPdfjs() {
  if (_pdfjs) return _pdfjs
  _pdfjs = await import('pdfjs-dist')
  _pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).href
  return _pdfjs
}

/* ─────────────────────────────────────────────────────────────────────────
   Cloudinary — unsigned upload helper
   Images are uploaded when saving to cloud so Firestore only stores a URL.
   ───────────────────────────────────────────────────────────────────────── */

const CLOUDINARY_CLOUD  = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME  as string
const CLOUDINARY_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string

// Session-scoped cache: data URL → Cloudinary https:// URL.
// Prevents re-uploading the same image on subsequent saves or auto-saves.
const _cloudinaryCache = new Map<string, string>()

async function uploadToCloudinary(base64DataUrl: string, folder?: string): Promise<string> {
  const cached = _cloudinaryCache.get(base64DataUrl)
  if (cached) return cached

  // Convert base64 data URL → Blob → proper file upload (avoids filename/slash issues)
  const blob = await fetch(base64DataUrl).then(r => r.blob())
  const form = new FormData()
  form.append('file', blob, `slide-${uid()}.jpg`)
  form.append('upload_preset', CLOUDINARY_PRESET)
  if (folder) form.append('folder', folder)

  const res  = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`,
    { method: 'POST', body: form },
  )
  const data = await res.json()
  if (!res.ok) {
    const reason = data?.error?.message ?? `HTTP ${res.status}`
    throw new Error(`Cloudinary: ${reason}`)
  }
  const cloudUrl = data.secure_url as string
  _cloudinaryCache.set(base64DataUrl, cloudUrl)
  return cloudUrl
}

/** Returns true if any slide still holds a base64 data URL that needs uploading. */
function slidesHaveDataUrls(slides: Slide[]): boolean {
  for (const slide of slides) {
    if (slide.type === 'canvas') {
      const cs = slide as CanvasSlide
      if (cs.bg?.type === 'image' && cs.bg.value?.startsWith('data:')) return true
      if (cs.elements?.some(el => el.kind === 'image' && el.imgUrl?.startsWith('data:'))) return true
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((slide as any).imgUrl?.startsWith('data:')) return true
    }
  }
  return false
}

/** Replaces base64 imgUrls / video data URLs with Cloudinary URLs before cloud-saving. */
async function toCloudinarySlides(slides: Slide[], userId?: string): Promise<Slide[]> {
  const folder = userId ? `images/${userId}` : undefined
  return Promise.all(
    slides.map(async slide => {
      // PDF slides: upload base64 images to Cloudinary
      if (slide.type === 'pdf') {
        if (!slide.imgUrl || slide.imgUrl.startsWith('https://')) return slide
        const cloudUrl = await uploadToCloudinary(slide.imgUrl, folder)
        return { ...slide, imgUrl: cloudUrl }
      }
      // Image slides: upload base64 data URLs to Cloudinary
      if (slide.type === 'image') {
        if (slide.imgUrl.startsWith('https://')) return slide
        const cloudUrl = await uploadToCloudinary(slide.imgUrl, folder)
        return { ...slide, imgUrl: cloudUrl }
      }
      // Video slides: strip from cloud saves (data URLs too large)
      if (slide.type === 'video') {
        return { ...slide, videoUrl: '' }
      }
      // Canvas (custom) slides — upload background image and any image elements.
      if (slide.type === 'canvas') {
        const cs = slide as CanvasSlide
        let bg = cs.bg
        if (bg?.type === 'image' && bg.value?.startsWith('data:')) {
          bg = { ...bg, value: await uploadToCloudinary(bg.value, folder) }
        }
        const newElements = await Promise.all(
          cs.elements.map(async el => {
            if (el.kind === 'image' && el.imgUrl.startsWith('data:')) {
              const cloudUrl = await uploadToCloudinary(el.imgUrl, folder)
              return { ...el, imgUrl: cloudUrl }
            }
            return el
          }),
        )
        return { ...cs, bg, elements: newElements } as CanvasSlide
      }
      // Question slides + content slides — may have a reference/background imgUrl.
      // If it's still a base64 data URL (not yet uploaded), push it to Cloudinary now
      // so we store a short https:// URL in Firestore rather than a huge blob.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = slide as any
      if (s.imgUrl && typeof s.imgUrl === 'string' && s.imgUrl.startsWith('data:')) {
        const cloudUrl = await uploadToCloudinary(s.imgUrl, folder)
        return { ...slide, imgUrl: cloudUrl }
      }
      return slide
    }),
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Deck JSON export / import helpers
   ───────────────────────────────────────────────────────────────────────── */

/** Downloads the current deck as a shareable .apulse.json file. */
function downloadDeckJSON(title: string, slides: unknown[]) {
  const payload = JSON.stringify({ version: 1, title, exportedAt: new Date().toISOString(), slides }, null, 2)
  const blob    = new Blob([payload], { type: 'application/json' })
  const url     = URL.createObjectURL(blob)
  const a       = document.createElement('a')
  a.href        = url
  a.download    = `${title.replace(/[^a-z0-9]/gi, '_') || 'deck'}.apulse.json`
  a.click()
  URL.revokeObjectURL(url)
}

/* ─────────────────────────────────────────────────────────────────────────
   Types
   ───────────────────────────────────────────────────────────────────────── */

type QType = 'mcq' | 'wordcloud' | 'openended' | 'rating'

interface PdfSlide {
  id: string
  type: 'pdf'
  pageNum: number
  imgUrl?: string   // undefined when loaded from cloud (images are not stored there)
}
interface ImageSlide {
  id: string
  type: 'image'
  imgUrl: string
  fileName: string
}
interface VideoSlide {
  id: string
  type: 'video'
  videoUrl: string
  videoType: string
  fileName: string
}
interface HtmlSlide {
  id: string
  type: 'html'
  html: string
  fileName: string
  /** Optional — which internal slide of the HTML deck to show (0-based, hash-nav). Undefined = whole deck (first slide). */
  slideIndex?: number
  /** Optional — total slides in the source HTML deck, used for thumbnail labelling. */
  slideTotal?: number
}
interface QuestionSlide {
  id: string
  type: QType
  question: string
  /** MCQ: answer options A–F. Rating: parameter labels. Others: unused. */
  options: string[]
  /** MCQ only — how to display results on the presenter screen. Defaults to 'bar'. */
  vizType?: 'bar' | 'pie' | 'donut'
  /** MCQ only — 0-based indices of correct options (supports multiple). */
  correctAnswers?: number[]
  /** Open Ended only — max responses per person. Default 1. */
  oeMaxSubmissions?: number
  /** Rating only — max value of the 0..N scale. 5 (default) or 10. */
  ratingMax?: 5 | 10
  /** Rating only — PER-PARAMETER anchor labels (parallel to options).
   *  leftLabels[i] is shown at 0, rightLabels[i] at ratingMax for parameter i.
   *  Each parameter can have its own scale meaning (e.g. param 1: Bad → Good,
   *  param 2: Weak → Strong). */
  leftLabels?:  string[]
  rightLabels?: string[]
  /** @deprecated — slide-wide labels. Used as a fallback for older decks
   *  before per-parameter labels existed. New decks use leftLabels[]. */
  leftLabel?:  string
  rightLabel?: string
  /** Background colour theme for the slide on the big screen. */
  theme?:   string
  /** Optional header image shown above the question on the big screen. */
  imgUrl?:    string
  /** How the image is positioned relative to the slide content. */
  imgLayout?: 'top' | 'right' | 'background' | 'reference'
  /** Word Cloud only — max number of word submissions per person. Default 3. */
  wcMaxSubmissions?: number
  /** Optional countdown timer in seconds shown during the question phase. */
  timer?: number
}
type ContentTemplate = 'heading' | 'bullets' | 'quote'
interface ContentSlide {
  id: string
  type: 'content'
  template: ContentTemplate
  title: string
  body: string         // subtitle (heading) | newline-separated bullets | quote text
  attribution: string  // quote attribution only
  theme: string
  imgUrl?:    string
  imgLayout?: 'top' | 'right' | 'background' | 'reference'
}
/* ── Canvas slide types ───────────────────────────────────────────── */
type CanvasBgType = 'color' | 'gradient' | 'image'
interface CanvasBg { type: CanvasBgType; value: string }
interface CanvasBaseEl { id: string; kind: 'text' | 'table' | 'image'; x: number; y: number; w: number; h: number }
interface CanvasTextEl extends CanvasBaseEl {
  kind: 'text'; html: string; fontSize: number; align: 'left' | 'center' | 'right'; color: string
}
interface CanvasTableEl extends CanvasBaseEl {
  kind: 'table'; rows: number; cols: number
  /** Flat array — index = ri * cols + ci. Firestore doesn't support nested arrays. */
  cells: string[]
  hasHeader: boolean
  cellColors?: (string | null)[]   // flat, same indexing
  borderColor?: string
  borderStyle?: 'solid' | 'dashed' | 'none'
}
interface CanvasImageEl extends CanvasBaseEl {
  kind: 'image'; imgUrl: string; objectFit: 'cover' | 'contain'
}
type CanvasEl = CanvasTextEl | CanvasTableEl | CanvasImageEl
interface CanvasSlide { id: string; type: 'canvas'; bg: CanvasBg; elements: CanvasEl[] }
interface LeaderboardSlide { id: string; type: 'leaderboard' }
type CanvasLayout = 'blank' | 'title-only' | 'title-body' | 'two-columns'

type Slide = PdfSlide | ImageSlide | VideoSlide | HtmlSlide | QuestionSlide | ContentSlide | CanvasSlide | LeaderboardSlide

/* ─────────────────────────────────────────────────────────────────────────
   Constants
   ───────────────────────────────────────────────────────────────────────── */

const QTYPES: { type: QType; label: string; icon: ReactNode; color: string; badge: string }[] = [
  { type: 'mcq',       label: 'MCQ',             icon: <LayoutList className="size-4" />, color: 'text-sky-blue',    badge: 'MCQ' },
  { type: 'wordcloud', label: 'Word Cloud',       icon: <Cloud className="size-4" />,      color: 'text-fresh-green', badge: 'WC'  },
  { type: 'openended', label: 'Open-ended',       icon: <AlignLeft className="size-4" />,  color: 'text-golden-sun',  badge: 'OE'  },
  { type: 'rating',    label: 'Rating',           icon: <Star className="size-4" />,        color: 'text-hot-pink',    badge: 'RT'  },
]

function uid() { return Math.random().toString(36).slice(2, 10) }

function makeQuestion(type: QType, isQuizMode = false): QuestionSlide {
  return {
    id: uid(),
    type,
    question: '',
    options: type === 'mcq' ? ['', '', '', ''] : type === 'rating' ? ['', '', ''] : [],
    // Default 30s timer on MCQ slides when quiz mode is on (needed for speed points)
    ...(isQuizMode && type === 'mcq' ? { timer: 30 } : {}),
  }
}

/* ── Content slide helpers ─────────────────────────────────────────────── */

type CThemeKey = 'navy' | 'pink' | 'sky' | 'green' | 'golden' | 'white' | 'transparent'
const CONTENT_COLORS: Record<CThemeKey, {
  bg: string; text: string; textDim: string; accent: string; quoteMark: string;
  cardBg: string; cardBorder: string; isDark: boolean
}> = {
  navy:        { bg: '#000079',   text: '#ffffff', textDim: 'rgba(255,255,255,0.58)', accent: '#ff0065', quoteMark: 'rgba(255,0,101,0.18)', cardBg: 'rgba(255,255,255,0.10)', cardBorder: 'rgba(255,255,255,0.18)', isDark: true  },
  pink:        { bg: '#ff0065',   text: '#ffffff', textDim: 'rgba(255,255,255,0.72)', accent: '#ffffff', quoteMark: 'rgba(255,255,255,0.18)', cardBg: 'rgba(255,255,255,0.15)', cardBorder: 'rgba(255,255,255,0.25)', isDark: true  },
  sky:         { bg: '#00b0ff',   text: '#000079', textDim: 'rgba(0,0,121,0.62)',     accent: '#000079', quoteMark: 'rgba(0,0,121,0.14)',     cardBg: 'rgba(0,0,121,0.10)',     cardBorder: 'rgba(0,0,121,0.18)',     isDark: false },
  green:       { bg: '#42db66',   text: '#000079', textDim: 'rgba(0,0,121,0.62)',     accent: '#000079', quoteMark: 'rgba(0,0,121,0.14)',     cardBg: 'rgba(0,0,121,0.10)',     cardBorder: 'rgba(0,0,121,0.18)',     isDark: false },
  golden:      { bg: '#ffc709',   text: '#000079', textDim: 'rgba(0,0,121,0.62)',     accent: '#000079', quoteMark: 'rgba(0,0,121,0.14)',     cardBg: 'rgba(0,0,121,0.10)',     cardBorder: 'rgba(0,0,121,0.18)',     isDark: false },
  white:       { bg: '#f4f4f9',   text: '#000079', textDim: 'rgba(0,0,121,0.52)',     accent: '#ff0065', quoteMark: 'rgba(255,0,101,0.1)',    cardBg: 'rgba(0,0,121,0.06)',     cardBorder: 'rgba(0,0,121,0.14)',     isDark: false },
  transparent: { bg: 'transparent', text: '#000079', textDim: 'rgba(0,0,121,0.62)',   accent: '#ff0065', quoteMark: 'rgba(255,0,101,0.1)',    cardBg: 'rgba(0,0,121,0.06)',     cardBorder: 'rgba(0,0,121,0.14)',     isDark: false },
}
function contentColors(themeId: string) { return CONTENT_COLORS[themeId as CThemeKey] ?? CONTENT_COLORS.navy }

const CONTENT_TEMPLATES: { template: ContentTemplate; label: string; icon: ReactNode }[] = [
  { template: 'heading', label: 'Heading', icon: <Type className="size-3.5" /> },
  { template: 'bullets', label: 'Bullets', icon: <List className="size-3.5" /> },
  { template: 'quote',   label: 'Quote',   icon: <Quote className="size-3.5" /> },
]

const CONTENT_THEMES: { id: string; label: string; swatch: string }[] = [
  { id: 'navy',        label: 'Navy',        swatch: '#000079' },
  { id: 'pink',        label: 'Pink',        swatch: '#ff0065' },
  { id: 'sky',         label: 'Sky',         swatch: '#00b0ff' },
  { id: 'green',       label: 'Green',       swatch: '#42db66' },
  { id: 'golden',      label: 'Golden',      swatch: '#ffc709' },
  { id: 'white',       label: 'White',       swatch: '#f4f4f9' },
  { id: 'transparent', label: 'Transparent', swatch: 'transparent' },
]

function makeContent(template: ContentTemplate): ContentSlide {
  return { id: uid(), type: 'content', template, title: '', body: '', attribution: '', theme: 'navy' }
}

/* ── Canvas constants + factory ─────────────────────────────────── */

const CANVAS_BG_COLORS = [
  { value: '#000079', label: 'Navy'   },
  { value: '#ff0065', label: 'Pink'   },
  { value: '#00b0ff', label: 'Sky'    },
  { value: '#42db66', label: 'Green'  },
  { value: '#ffc709', label: 'Golden' },
  { value: '#f4f4f9', label: 'White'  },
  { value: '#0a0a14', label: 'Black'  },
]

const CANVAS_BG_GRADIENTS = [
  { value: 'linear-gradient(135deg,#000079 0%,#1a0035 100%)',                 label: 'Midnight' },
  { value: 'linear-gradient(135deg,#ff0065 0%,#ffc709 100%)',                 label: 'Sunset'   },
  { value: 'linear-gradient(135deg,#000079 0%,#00b0ff 100%)',                 label: 'Ocean'    },
  { value: 'linear-gradient(135deg,#000079 0%,#42db66 100%)',                 label: 'Forest'   },
  { value: 'linear-gradient(135deg,#42db66 0%,#00b0ff 50%,#000079 100%)',    label: 'Aurora'   },
  { value: 'linear-gradient(135deg,#ff0065 0%,#000079 100%)',                 label: 'Flame'    },
]

/** Migrate any legacy canvas table elements that stored cells/cellColors as
 *  nested string[][] (old format) to the flat string[] format.  Firestore
 *  doesn't support nested arrays, so all new data is already flat. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function migrateSlides(slides: Slide[]): Slide[] {
  return slides.map(s => {
    if (s.type !== 'canvas') return s
    const cs = s as CanvasSlide
    return {
      ...cs,
      elements: cs.elements.map(el => {
        if (el.kind !== 'table') return el
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const te = el as any
        const isNested = te.cells.length > 0 && Array.isArray(te.cells[0])
        if (!isNested) return el
        return {
          ...te,
          cells:      (te.cells as string[][]).flat(),
          cellColors: te.cellColors
            ? Array.isArray(te.cellColors[0])
              ? (te.cellColors as (string | null)[][]).flat()
              : te.cellColors
            : undefined,
        }
      }),
    }
  })
}

function makeCanvasWithLayout(layout: CanvasLayout): CanvasSlide {
  const base = { id: uid(), type: 'canvas' as const, bg: { type: 'color' as const, value: '#000079' } }
  switch (layout) {
    case 'title-only':
      return { ...base, elements: [
        { id: uid(), kind: 'text' as const, x: 10, y: 32, w: 80, h: 33,
          html: 'Click to add title', fontSize: 48, align: 'center' as const, color: '#ffffff' },
      ] }
    case 'title-body':
      return { ...base, elements: [
        { id: uid(), kind: 'text' as const, x: 8, y: 6, w: 84, h: 20,
          html: 'Slide Title', fontSize: 40, align: 'left' as const, color: '#ffffff' },
        { id: uid(), kind: 'text' as const, x: 8, y: 32, w: 84, h: 55,
          html: 'Body text — click to edit', fontSize: 20, align: 'left' as const, color: 'rgba(255,255,255,0.75)' },
      ] }
    case 'two-columns':
      return { ...base, elements: [
        { id: uid(), kind: 'text' as const, x: 8, y: 4, w: 84, h: 18,
          html: 'Slide Title', fontSize: 36, align: 'center' as const, color: '#ffffff' },
        { id: uid(), kind: 'text' as const, x: 5, y: 27, w: 43, h: 62,
          html: 'Left column', fontSize: 18, align: 'left' as const, color: 'rgba(255,255,255,0.85)' },
        { id: uid(), kind: 'text' as const, x: 52, y: 27, w: 43, h: 62,
          html: 'Right column', fontSize: 18, align: 'left' as const, color: 'rgba(255,255,255,0.85)' },
      ] }
    default: // blank
      return { ...base, elements: [] }
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   Main page
   ───────────────────────────────────────────────────────────────────────── */

export default function Create() {
  const navigate = useNavigate()
  const location = useLocation()
  // Restore slides + title when returning from present mode
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const returnState  = (location.state as any) ?? {}
  const resumeCode   = returnState.sessionCode as string | undefined
  const deckFromState = returnState.deck as Deck | undefined   // loaded from My Decks

  const [slides, setSlides]         = useState<Slide[]>(
    migrateSlides(deckFromState?.slides as Slide[] ?? returnState.slides ?? []),
  )
  const [selectedId, setSelectedId] = useState<string | null>(
    (returnState.selectedSlideId as string | undefined)
      ?? (deckFromState?.slides?.[0] as any)?.id
      ?? returnState.slides?.[0]?.id
      ?? null,
  )
  const [showSorter, setShowSorter] = useState(false)
  const [deckTitle, setDeckTitle]   = useState(
    deckFromState?.title ?? returnState.deckTitle ?? 'Untitled session',
  )
  const [currentDeckId, setCurrentDeckId] = useState<string | undefined>(
    deckFromState?.id ?? (returnState.deckId as string | undefined),
  )
  const [isQuiz, setIsQuiz] = useState<boolean>(
    deckFromState?.isQuiz ?? (returnState.isQuiz as boolean | undefined) ?? false,
  )
  // Last live-poll results, either passed back from Present.tsx on session
  // end OR pre-loaded from My Decks via the navigate state. Saved alongside
  // the deck so the Results page can show them later.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [lastResults, _setLastResults] = useState<DeckResults | undefined>(
    (returnState.lastResults as DeckResults | null | undefined) ?? undefined,
  )
  const [isImporting, setImporting] = useState(false)
  const [isStarting,  setStarting]  = useState(false)
  const [addMenuAfter, setAddMenu]  = useState<string | undefined>(undefined)
  const [layoutPicker, setLayoutPicker] = useState<{ afterId?: string } | null>(null)

  // Deck saving state
  const [storageBackend, setStorageBackend_] = useState<StorageBackend | null>(getStorageBackend)
  const [showSaveModal,  setShowSaveModal]   = useState(false)
  const [isSaving,       setIsSaving]        = useState(false)
  const [savedToast,     setSavedToast]      = useState(false)
  const [saveError,      setSaveError]       = useState<string | null>(null)
  const [sessionError,   setSessionError]    = useState<string | null>(null)
  // Auto-split toast — appears briefly after importing an HTML deck that
  // was detected as a multi-slide slideshow. Lets the user undo if the
  // detection was wrong (e.g. the file isn't actually a slideshow).
  const [autoSplitToast, setAutoSplitToast] = useState<{
    count: number; firstSlideId: string; splitSlideIds: string[]
  } | null>(null)
  // Large-HTML toast — warns when an imported HTML file exceeds the
  // ~1 MB Firestore document limit, which means it can't be saved to
  // the cloud (browser storage works for any size).
  const [largeHtmlToast, setLargeHtmlToast] = useState<{
    fileName: string; sizeKB: number
  } | null>(null)

  /* ── Undo / Redo history ─────────────────────────────────────────────── */
  type HistorySnap = { slides: Slide[]; selectedId: string | null }
  const undoStackRef = useRef<HistorySnap[]>([])
  const redoStackRef = useRef<HistorySnap[]>([])
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  // Refs so pushHistory (stable, [] deps) always reads the latest values.
  const slidesRef     = useRef<Slide[]>(slides)
  const selectedIdRef = useRef<string | null>(selectedId)
  useEffect(() => { slidesRef.current = slides },         [slides])
  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])

  const pushHistory = useCallback(() => {
    const MAX = 20
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(MAX - 1)),
      { slides: JSON.parse(JSON.stringify(slidesRef.current)), selectedId: selectedIdRef.current },
    ]
    // Any new action clears the redo stack
    redoStackRef.current = []
    setCanUndo(true)
    setCanRedo(false)
  }, [])

  const undoSlides = useCallback(() => {
    if (!undoStackRef.current.length) return
    // Save current state to redo stack before reverting
    redoStackRef.current = [
      ...redoStackRef.current,
      { slides: JSON.parse(JSON.stringify(slidesRef.current)), selectedId: selectedIdRef.current },
    ]
    const snap = undoStackRef.current[undoStackRef.current.length - 1]
    undoStackRef.current = undoStackRef.current.slice(0, -1)
    setCanUndo(undoStackRef.current.length > 0)
    setCanRedo(true)
    setSlides(snap.slides)
    setSelectedId(snap.selectedId)
  }, [])

  const redoSlides = useCallback(() => {
    if (!redoStackRef.current.length) return
    // Save current state to undo stack before re-applying
    undoStackRef.current = [
      ...undoStackRef.current,
      { slides: JSON.parse(JSON.stringify(slidesRef.current)), selectedId: selectedIdRef.current },
    ]
    const snap = redoStackRef.current[redoStackRef.current.length - 1]
    redoStackRef.current = redoStackRef.current.slice(0, -1)
    setCanUndo(true)
    setCanRedo(redoStackRef.current.length > 0)
    setSlides(snap.slides)
    setSelectedId(snap.selectedId)
  }, [])

  // Ctrl/Cmd+Z → undo, Ctrl/Cmd+Shift+Z (or Ctrl+Y) → redo
  // Only fires when focus is NOT inside a text field (those use native text undo).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const target = e.target as HTMLElement
      const inTextField =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      if (inTextField) return

      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undoSlides() }
      if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redoSlides() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undoSlides, redoSlides])

  /**
   * Firebase restores auth state from storage asynchronously on page load.
   * Waiting here prevents a race where auth.currentUser is still null
   * in the first second after navigating to this page.
   */
  const waitForAuth = (): Promise<User | null> => {
    if (auth.currentUser) return Promise.resolve(auth.currentUser)
    return new Promise(resolve => {
      const timer = setTimeout(() => { unsub(); resolve(null) }, 4000)
      const unsub = onAuthStateChanged(auth, user => {
        clearTimeout(timer)
        unsub()
        resolve(user)
      })
    })
  }

  // De-dupe concurrent saveDeck() calls (e.g. auto-save fires while user
  // also clicks Save). Without this guard, two calls with no currentDeckId
  // each mint their own uid() and we end up with duplicate decks.
  const pendingSaveRef = useRef<Promise<string | null> | null>(null)
  const saveDeck = async (backend?: StorageBackend): Promise<string | null> => {
    if (pendingSaveRef.current) return pendingSaveRef.current
    const promise = (async (): Promise<string | null> => {
    const b = backend ?? storageBackend
    if (!b) { setShowSaveModal(true); return null }
    setIsSaving(true)
    try {
      // Authenticate first so auth.currentUser?.uid is set before uploading images —
      // this ensures images land in the user's folder in Cloudinary.
      const needsAuthForCloud = b === 'cloud'
      if (needsAuthForCloud) {
        const existingUser = await waitForAuth()
        if (!existingUser) {
          await signInWithGoogle()
          setStorageBackend('cloud')
          setStorageBackend_('cloud')
        }
      }
      // If saving a NEW deck (no id yet), auto-disambiguate the title against existing decks.
      // Existing decks keep whatever title the user typed — no surprise renames on update.
      const finalTitle = currentDeckId
        ? deckTitle
        : await getUniqueDeckTitle(deckTitle || 'Untitled session', b, currentDeckId)
      if (!currentDeckId && finalTitle !== deckTitle) {
        // Reflect the new unique title in the input so the user can see what was saved
        setDeckTitle(finalTitle)
      }

      // Upload images after auth (user ID confirmed).
      // Track whether data URLs existed BEFORE uploading so we know whether to
      // write https:// URLs back into React state. This prevents an auto-save loop:
      // setSlides → useEffect → auto-save → setSlides → … Only fires once, when
      // there are actual data URLs to replace. After that, slides hold https:// URLs
      // and hadDataUrls is false, so setSlides is never called again.
      const userSlug = auth.currentUser?.email?.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-')
                    ?? auth.currentUser?.uid
      const hadDataUrls = b === 'cloud' && slidesHaveDataUrls(slides)
      const slidesToSave = b === 'cloud'
        ? await toCloudinarySlides(slides, userSlug)
        : slides
      if (hadDataUrls) setSlides(slidesToSave)

      const deck: Deck = {
        id:        currentDeckId ?? uid(),
        title:     finalTitle,
        slides:    slidesToSave as unknown[],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...(isQuiz ? { isQuiz: true } : {}),
      }
      if (b === 'browser') {
        await browserSaveDeck(deck)
      } else {
        await cloudSaveDeck(deck)
      }
      // Persist most-recent live poll results too (separate doc / store).
      // Results are independent of slide content so they don't bloat the
      // deck doc. New results from a future session overwrite this one.
      if (lastResults) {
        try {
          await saveResults(b, deck.id, lastResults)
        } catch (e) {
          console.error('Saving results failed (deck still saved):', e)
          const msg = e instanceof Error ? e.message : 'Unknown error'
          setSaveError(`Results not saved: ${msg}`)
          setTimeout(() => setSaveError(null), 6000)
        }
      }
      if (!currentDeckId) {
        setCurrentDeckId(deck.id)
        // Persist so remounts (browser-back from /results) reuse this deck
        if (lastResults?.sessionCode) {
          sessionStorage.setItem(`alaya-autosave-${lastResults.sessionCode}`, deck.id)
        }
      }
      setSavedToast(true)
      setTimeout(() => setSavedToast(false), 2500)
      return deck.id
    } catch (err) {
      console.error('Save failed:', err)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setSaveError(`Save failed: ${msg}`)
      setTimeout(() => setSaveError(null), 5000)
      return null
    } finally {
      setIsSaving(false)
      setShowSaveModal(false)
    }
    })()
    pendingSaveRef.current = promise
    try { return await promise } finally { pendingSaveRef.current = null }
  }

  const handleChooseBrowser = () => {
    setStorageBackend('browser')
    setStorageBackend_('browser')
    saveDeck('browser')
  }

  const handleChooseCloud = async () => {
    setStorageBackend('cloud')
    setStorageBackend_('cloud')
    await saveDeck('cloud')
  }
  // addMenuAfter = id of slide to insert after; undefined = menu closed

  const selectedSlide = slides.find(s => s.id === selectedId) ?? null

  /* ── PDF import ─────────────────────────────────────────────────────── */

  const importFile = useCallback(async (file: File) => {
    setImporting(true)
    try {
      // ── Deck JSON import (.apulse.json) ─────────────────────────────────
      if (file.name.endsWith('.json') || file.name.endsWith('.apulse')) {
        try {
          const text   = await file.text()
          const data   = JSON.parse(text)
          if (!Array.isArray(data.slides)) throw new Error('invalid')
          // Regenerate IDs so imported slides never clash with existing ones
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const imported = (data.slides as any[]).map(s => ({ ...s, id: uid() })) as Slide[]
          if (data.title && typeof data.title === 'string') setDeckTitle(data.title)
          setSlides(prev => [...prev, ...imported])
          setSelectedId(prev => prev ?? imported[0]?.id ?? null)
        } catch {
          alert('Could not import deck — the file may be invalid or corrupted.')
        }
        return
      }

      // ── PDF: rasterise each page to a JPEG ─────────────────────────────
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const buf = await file.arrayBuffer()
        const pdfjsLib = await getPdfjs()
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise
        const newSlides: PdfSlide[] = []
        for (let p = 1; p <= pdf.numPages; p++) {
          const page     = await pdf.getPage(p)
          const viewport = page.getViewport({ scale: 2.0 })   // 1920×1080 for 16:9 slides
          const canvas   = document.createElement('canvas')
          canvas.width   = viewport.width
          canvas.height  = viewport.height
          const ctx      = canvas.getContext('2d')!
          await page.render({ canvas, canvasContext: ctx, viewport }).promise
          newSlides.push({ id: uid(), type: 'pdf', pageNum: p, imgUrl: canvas.toDataURL('image/jpeg', 0.92) })
        }
        setSlides(prev => [...prev, ...newSlides])
        setSelectedId(prev => prev ?? (newSlides[0]?.id ?? null))
        return
      }

      // ── Image: inline as-is ─────────────────────────────────────────────
      if (file.type.startsWith('image/')) {
        const imgUrl = await new Promise<string>((res, rej) => {
          const reader = new FileReader()
          reader.onload  = () => res(reader.result as string)
          reader.onerror = rej
          reader.readAsDataURL(file)
        })
        const slide: ImageSlide = { id: uid(), type: 'image', imgUrl, fileName: file.name }
        setSlides(prev => [...prev, slide])
        setSelectedId(prev => prev ?? slide.id)
        return
      }

      // ── Video: store as object URL (browser-only, not cloud-saveable) ──
      if (file.type.startsWith('video/')) {
        const videoUrl = URL.createObjectURL(file)
        const slide: VideoSlide = { id: uid(), type: 'video', videoUrl, videoType: file.type, fileName: file.name }
        setSlides(prev => [...prev, slide])
        setSelectedId(prev => prev ?? slide.id)
        return
      }

      // ── HTML: read as text, auto-detect internal slides, optionally split ──
      if (
        file.type === 'text/html' ||
        file.name.endsWith('.html') ||
        file.name.endsWith('.htm')
      ) {
        const html = await file.text()
        // Warn if the file is too big for Firestore's 1 MB cap. Browser
        // storage has no such limit so we surface the trade-off here
        // instead of letting save quietly fail later.
        const sizeKB = Math.round(html.length / 1024)
        if (sizeKB > 800) {
          setLargeHtmlToast({ fileName: file.name, sizeKB })
        }
        // Run the existing slide-count detector. If we find ≥ 2 slides we
        // automatically split into N Pulse slides so the presenter can
        // interleave questions/content between them without any extra
        // clicks. For non-slideshow HTML (no detectable slide markers) we
        // import as a single slide so interactive demos / infographics
        // aren't accidentally duplicated.
        const detected = detectHtmlSlideCount(html)
        if (detected !== null && detected >= 2) {
          const firstId = uid()
          const slides: HtmlSlide[] = Array.from({ length: detected }, (_, i) => ({
            id:         i === 0 ? firstId : uid(),
            type:       'html',
            html,
            fileName:   file.name,
            slideIndex: i,
            slideTotal: detected,
          }))
          const splitSlideIds = slides.map(s => s.id)
          setSlides(prev => [...prev, ...slides])
          setSelectedId(prev => prev ?? firstId)
          setAutoSplitToast({ count: detected, firstSlideId: firstId, splitSlideIds })
          return
        }
        const slide: HtmlSlide = { id: uid(), type: 'html', html, fileName: file.name }
        setSlides(prev => [...prev, slide])
        setSelectedId(prev => prev ?? slide.id)
        return
      }
    } finally {
      setImporting(false)
    }
  }, [])

  /* ── Slide mutation ─────────────────────────────────────────────────── */

  const addQuestion = useCallback((type: QType, afterId?: string) => {
    pushHistory()
    const slide = makeQuestion(type, isQuiz)
    setSlides(prev => {
      if (afterId === undefined) return [...prev, slide]
      const idx  = prev.findIndex(s => s.id === afterId)
      const next = [...prev]
      next.splice(idx + 1, 0, slide)
      return next
    })
    setSelectedId(slide.id)
    setAddMenu(undefined)
  }, [pushHistory, isQuiz])

  const deleteSlide = useCallback((id: string) => {
    pushHistory()
    setSlides(prev => {
      const next = prev.filter(s => s.id !== id)
      if (selectedId === id) {
        const idx = prev.findIndex(s => s.id === id)
        setSelectedId(next[Math.min(idx, next.length - 1)]?.id ?? null)
      }
      return next
    })
  }, [selectedId, pushHistory])

  const duplicateSlide = useCallback((id: string) => {
    pushHistory()
    const newId = uid()
    setSlides(prev => {
      const idx = prev.findIndex(s => s.id === id)
      if (idx === -1) return prev
      // Deep-copy via JSON so nested arrays (e.g. canvas elements) are independent
      const copy = JSON.parse(JSON.stringify({ ...prev[idx], id: newId })) as Slide
      const next = [...prev]
      next.splice(idx + 1, 0, copy)
      return next
    })
    setSelectedId(newId)
  }, [pushHistory])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateSlide = useCallback((id: string, patch: any) => {
    setSlides(prev => prev.map(s => {
      if (s.id !== id || s.type === 'pdf' || s.type === 'image' || s.type === 'video') return s
      return { ...s, ...patch } as Slide
    }))
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      pushHistory()
      setSlides(prev => {
        const from = prev.findIndex(s => s.id === active.id)
        const to   = prev.findIndex(s => s.id === over.id)
        return arrayMove(prev, from, to)
      })
    }
  }, [pushHistory])

  const addContent = useCallback((template: ContentTemplate, afterId?: string) => {
    pushHistory()
    const slide = makeContent(template)
    setSlides(prev => {
      if (afterId === undefined) return [...prev, slide]
      const idx  = prev.findIndex(s => s.id === afterId)
      const next = [...prev]
      next.splice(idx + 1, 0, slide)
      return next
    })
    setSelectedId(slide.id)
    setAddMenu(undefined)
  }, [pushHistory])

  // Opens the layout picker; actual canvas insertion happens in doAddCanvas
  const requestCanvas = useCallback((afterId?: string) => {
    setLayoutPicker({ afterId })
    setAddMenu(undefined)
  }, [])

  const doAddCanvas = useCallback((layout: CanvasLayout, afterId?: string) => {
    pushHistory()
    const slide = makeCanvasWithLayout(layout)
    setSlides(prev => {
      if (afterId === undefined) return [...prev, slide]
      const idx  = prev.findIndex(s => s.id === afterId)
      const next = [...prev]
      next.splice(idx + 1, 0, slide)
      return next
    })
    setSelectedId(slide.id)
    setLayoutPicker(null)
  }, [pushHistory])

  const addLeaderboard = useCallback((afterId?: string) => {
    const slide: LeaderboardSlide = { id: uid(), type: 'leaderboard' }
    setSlides(prev => {
      if (afterId === undefined) return [...prev, slide]
      const idx  = prev.findIndex(s => s.id === afterId)
      const next = [...prev]
      next.splice(idx + 1, 0, slide)
      return next
    })
    setSelectedId(slide.id)
    setAddMenu(undefined)
  }, [])

  // Undo an auto-split that happened during import — collapse the N
  // split slides back into a single unsplit HTML slide. Used when the
  // detection was wrong (file isn't actually a slideshow).
  const undoAutoSplit = useCallback(() => {
    if (!autoSplitToast) return
    const { firstSlideId, splitSlideIds } = autoSplitToast
    const removeSet = new Set(splitSlideIds.filter(id => id !== firstSlideId))
    setSlides(prev => prev
      .filter(s => !removeSet.has(s.id))
      .map(s => {
        if (s.id !== firstSlideId) return s
        // Strip the split metadata so it behaves as an unsplit slide
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { slideIndex: _i, slideTotal: _t, ...rest } = s as HtmlSlide
        return rest as Slide
      }))
    setSelectedId(firstSlideId)
    setAutoSplitToast(null)
  }, [autoSplitToast])

  // Auto-dismiss the toast after ~10 seconds
  useEffect(() => {
    if (!autoSplitToast) return
    const id = window.setTimeout(() => setAutoSplitToast(null), 10000)
    return () => window.clearTimeout(id)
  }, [autoSplitToast])

  // Auto-dismiss the large-HTML warning after ~15 seconds (longer than
  // the split toast — this one needs a real read).
  useEffect(() => {
    if (!largeHtmlToast) return
    const id = window.setTimeout(() => setLargeHtmlToast(null), 15000)
    return () => window.clearTimeout(id)
  }, [largeHtmlToast])

  // ── Auto-save results when the user returns from a session ──────────
  // When `lastResults` arrives via router state (set by Present.tsx on
  // session end), persist it without making the user click Save. If no
  // storage backend has been picked yet, open the storage modal so the
  // user is prompted exactly once. The ref guards against repeating the
  // save when React re-renders.
  const autoSavedResultsRef = useRef<DeckResults | undefined>(undefined)
  useEffect(() => {
    if (!lastResults) return

    // When Create remounts (e.g. browser-back from /results page), the ref
    // resets to undefined but the session was already saved. Check sessionStorage
    // first so we reuse the existing deck instead of creating a duplicate.
    if (lastResults.sessionCode && !currentDeckId) {
      const cached = sessionStorage.getItem(`alaya-autosave-${lastResults.sessionCode}`)
      if (cached) {
        setCurrentDeckId(cached)
        autoSavedResultsRef.current = lastResults
        return
      }
    }

    if (autoSavedResultsRef.current === lastResults) return  // already handled
    autoSavedResultsRef.current = lastResults

    if (storageBackend) {
      saveDeck(storageBackend).catch(() => { /* shown via saveError */ })
    } else {
      setShowSaveModal(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastResults, storageBackend])

  // ── Auto-save on change (debounced 3 s) ─────────────────────────────
  // Fires 3 seconds after any slide content or title change, but only
  // when a storage backend is already chosen — we never pop the save
  // modal automatically while the user is in the middle of editing.
  // Skips on the very first render so we don't re-save decks loaded from
  // My Decks without any actual change.
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasEditedRef     = useRef(false)
  useEffect(() => {
    // Mark that we've seen at least one render so subsequent changes are real edits
    if (!hasEditedRef.current) { hasEditedRef.current = true; return }
    if (!storageBackend || slides.length === 0) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      saveDeck(storageBackend).catch(() => { /* shown via saveError state */ })
    }, 3000)
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides, deckTitle])

  // Split a single HTML slide into N slides — each pointing at a different
  // internal slide of the source HTML deck (hash navigation: #/0, #/1, …).
  // Works with reveal.js, impress.js, and any framework that listens to hashchange.
  const splitHtmlSlide = useCallback((id: string, count: number) => {
    if (count < 2) return
    setSlides(prev => {
      const idx = prev.findIndex(s => s.id === id)
      if (idx < 0) return prev
      const orig = prev[idx] as HtmlSlide
      if (orig.type !== 'html') return prev
      const split: HtmlSlide[] = Array.from({ length: count }, (_, i) => ({
        ...orig,
        id:         i === 0 ? orig.id : uid(),
        slideIndex: i,
        slideTotal: count,
      }))
      const next = [...prev]
      next.splice(idx, 1, ...split)
      return next
    })
  }, [])

  // Live audience count — only when a session is active (resumeCode exists)
  const [viewerCount, setViewerCount] = useState(0)
  useEffect(() => {
    if (!resumeCode) return
    return subscribeToViewerCount(resumeCode, setViewerCount)
  }, [resumeCode])

  // When returning from Present.tsx, scroll the previously-selected slide into view
  useEffect(() => {
    if (!selectedId) return
    // Small delay lets the sidebar render its list first
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-slide-id="${selectedId}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 120)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Run once on mount only

  // Scroll selected slide into view on every selection change (e.g. navigating from Slide Overview)
  useEffect(() => {
    if (!selectedId) return
    const el = document.querySelector(`[data-slide-id="${selectedId}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [selectedId])

  const startSession = async () => {
    if (slides.length === 0 || isStarting) return
    setStarting(true)
    setSessionError(null)
    // Start from whichever slide is currently selected in the panel
    const startSlide = Math.max(0, slides.findIndex(s => s.id === selectedId))
    try {
      // Upload any base64 images (PDF/question/content/canvas) to Cloudinary FIRST.
      // The session doc has a hard 1 MB Firestore limit, so we must store short
      // https:// URLs — never raw base64 — or large images silently break.
      const userSlug = auth.currentUser?.email?.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-')
                    ?? auth.currentUser?.uid
      const cloudSlides = await toCloudinarySlides(slides, userSlug)
      setSlides(cloudSlides) // lock cloud URLs into the editor so we don't re-upload
      const code = await createSession(deckTitle, cloudSlides, isQuiz)
      navigate(`/present/${code}`, { state: { slides: cloudSlides, deckTitle, sessionCode: code, startSlide, deckId: currentDeckId, isQuiz } })
    } catch (err) {
      console.error('Failed to start session:', err)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setSessionError(`Couldn't start session: ${msg}`)
      setTimeout(() => setSessionError(null), 8000)
      setStarting(false)
    }
  }

  // Resume an existing session — resumes from the currently selected slide.
  // Also resyncs the Firestore slides array so the audience always sees the
  // correct slide even if the deck was edited since the last session start.
  const resumeSession = async () => {
    if (!resumeCode || isStarting) return
    setStarting(true)
    setSessionError(null)
    const startSlide = Math.max(0, slides.findIndex(s => s.id === selectedId))
    try {
      // Upload base64 images to Cloudinary first (1 MB Firestore doc limit).
      const userSlug = auth.currentUser?.email?.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-')
                    ?? auth.currentUser?.uid
      const cloudSlides = await toCloudinarySlides(slides, userSlug)
      setSlides(cloudSlides)
      // Resync slides first so audience index matches presenter's deck
      await updateSessionSlides(resumeCode, cloudSlides, isQuiz)
      await updateSessionState(resumeCode, startSlide, 'question')
      navigate(`/present/${resumeCode}`, { state: { slides: cloudSlides, deckTitle, sessionCode: resumeCode, startSlide, deckId: currentDeckId, isQuiz } })
    } catch (err) {
      console.error('Failed to resume session:', err)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setSessionError(`Couldn't resume session: ${msg}`)
      setTimeout(() => setSessionError(null), 8000)
      setStarting(false)
    }
  }

  /* ── Render ─────────────────────────────────────────────────────────── */

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">

      {/* ── Slide Sorter overlay ─────────────────────────────────────── */}
      {showSorter && (
        <SlideSorter
          slides={slides}
          selectedId={selectedId}
          onDragEnd={handleDragEnd}
          onSelect={setSelectedId}
          onClose={() => setShowSorter(false)}
          onDelete={deleteSlide}
          onDuplicate={duplicateSlide}
        />
      )}

      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <header className="relative flex h-14 shrink-0 items-center justify-between gap-3 overflow-hidden border-b border-white/10 bg-midnight-sky-900 px-5">
        {/* Shimmer */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-1/2"
          style={{ background: 'linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.13) 50%, transparent 100%)' }}
          animate={{ x: ['-100%', '200%'] }}
          transition={{ duration: 1.8, ease: [0.4, 0, 0.2, 1], repeat: Infinity, repeatDelay: 7, delay: 2 }}
        />

        <div className="flex shrink-0 items-center gap-3">
          <button
            onClick={() => navigate('/decks')}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-fresh-green px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-fresh-green/85 active:scale-95"
          >
            <span className="text-sm leading-none">←</span>
            My Decks
          </button>
          <span className="h-4 w-px bg-white/15" />
          <AlayaMark className="text-white" />
          <span className="h-4 w-px bg-white/15" />
          {/* Undo / Redo buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={undoSlides}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
              className={cn(
                'rounded-lg p-1.5 transition-all duration-150',
                canUndo
                  ? 'text-white/80 hover:bg-white/10 hover:text-white'
                  : 'cursor-not-allowed text-white/40',
              )}
            >
              <Undo2 className="size-4" />
            </button>
            <button
              onClick={redoSlides}
              disabled={!canRedo}
              title="Redo (Ctrl+Shift+Z)"
              className={cn(
                'rounded-lg p-1.5 transition-all duration-150',
                canRedo
                  ? 'text-white/80 hover:bg-white/10 hover:text-white'
                  : 'cursor-not-allowed text-white/40',
              )}
            >
              <Redo2 className="size-4" />
            </button>
          </div>
          <span className="h-4 w-px bg-white/15" />
          {/* Quiz mode toggle — styled as a prominent button (matches Save / Export) */}
          <motion.button
            onClick={() => {
              // When turning quiz ON, apply 30s default to any MCQ slide without a timer
              if (!isQuiz) {
                setSlides(prev => prev.map(s =>
                  s.type === 'mcq' && !(s as QuestionSlide).timer
                    ? { ...s, timer: 30 }
                    : s
                ))
              }
              setIsQuiz(v => !v)
            }}
            whileTap={{ scale: 0.96 }}
            title={isQuiz ? 'Quiz mode on — click to disable' : 'Enable quiz mode — score answers & show a leaderboard'}
            className={cn(
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-1.5 text-sm font-medium transition-all duration-200',
              isQuiz
                ? 'border-golden-sun/50 bg-golden-sun/15 text-golden-sun shadow-[0_0_16px_-4px] shadow-golden-sun/50'
                : 'border-white/20 bg-white/5 text-white/80 hover:border-white/40 hover:text-white',
            )}
          >
            <Trophy className="size-3.5" />
            Quiz {isQuiz ? 'On' : 'Off'}
          </motion.button>
        </div>

        {/* Editable deck title — shrinks first so action buttons never wrap */}
        <input
          value={deckTitle}
          onChange={e => setDeckTitle(e.target.value)}
          className="min-w-0 flex-1 border-b border-transparent bg-transparent px-2 py-1 text-center text-sm font-semibold text-white outline-none transition-colors placeholder:text-white/30 hover:border-white/20 focus:border-hot-pink"
        />

        {/* Right-side controls — grouped so justify-between stays stable */}
        <div className="flex shrink-0 items-center gap-2">

          {/* Save / Export / Results buttons */}
          <AnimatePresence>
            {saveError && (
              <motion.span
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600"
              >
                {saveError}
              </motion.span>
            )}
          </AnimatePresence>
          <motion.button
            onClick={() => saveDeck()}
            disabled={slides.length === 0 || isSaving}
            whileTap={slides.length > 0 ? { scale: 0.96 } : {}}
            className={cn(
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-1.5 text-sm font-medium transition-all duration-200',
              savedToast
                ? 'border-fresh-green/40 bg-fresh-green/10 text-fresh-green'
                : saveError
                ? 'border-red-400/40 bg-red-500/10 text-red-400'
                : slides.length > 0
                ? 'border-white/20 bg-white/5 text-white/80 hover:border-white/40 hover:text-white'
                : 'cursor-not-allowed border-white/10 text-white/30',
            )}
          >
            {savedToast ? (
              <><BookmarkCheck className="size-3.5" />Saved</>
            ) : isSaving ? (
              <LoadingDots color="pink" />
            ) : (
              <><Bookmark className="size-3.5" />Save</>
            )}
          </motion.button>

          <motion.button
            onClick={() => downloadDeckJSON(deckTitle, slides)}
            disabled={slides.length === 0}
            whileTap={slides.length > 0 ? { scale: 0.96 } : {}}
            title={slides.length === 0 ? 'Add slides first' : 'Export deck as a file to share with colleagues'}
            className={cn(
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-1.5 text-sm font-medium transition-all duration-200',
              slides.length > 0
                ? 'border-white/20 bg-white/5 text-white/80 hover:border-white/40 hover:text-white'
                : 'cursor-not-allowed border-white/10 text-white/30',
            )}
          >
            <Upload className="size-3.5" />
            Export
          </motion.button>

          {(() => {
            const hasResults = !!lastResults && lastResults.questions.length > 0
            return (
              <motion.button
                onClick={async () => {
                  if (!hasResults) return
                  let targetId = currentDeckId
                  if (!targetId) {
                    targetId = await saveDeck() ?? undefined
                  }
                  if (targetId) navigate(`/results/${targetId}`)
                }}
                disabled={!hasResults || isSaving}
                whileTap={hasResults ? { scale: 0.96 } : {}}
                title={
                  !hasResults
                    ? 'No poll results yet — start a session and collect responses first'
                    : 'View live poll results'
                }
                className={cn(
                  'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-1.5 text-sm font-medium transition-all duration-200',
                  hasResults && !isSaving
                    ? 'border-hot-pink/50 bg-hot-pink/5 text-hot-pink hover:border-hot-pink/70 hover:bg-hot-pink/10'
                    : 'cursor-not-allowed border-white/10 text-white/30',
                )}
              >
                <BarChart2 className="size-3.5" />
                Results
              </motion.button>
            )
          })()}

          {/* Session error toast */}
          <AnimatePresence>
            {sessionError && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="max-w-md rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 shadow-sm"
              >
                {sessionError}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Separator before session controls */}
          {resumeCode && <span className="h-4 w-px bg-white/15" />}

          {/* Live audience count */}
          <AnimatePresence>
            {resumeCode && viewerCount > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-1.5 rounded-full bg-fresh-green/10 px-3 py-1.5 text-xs font-medium text-fresh-green"
              >
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fresh-green opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-fresh-green" />
                </span>
                <Users className="size-3" />
                {viewerCount} in room
              </motion.div>
            )}
          </AnimatePresence>

          {/* Start / Resume session */}
          {resumeCode && slides.length > 0 ? (
            <>
              <motion.button
                onClick={resumeSession}
                whileTap={!isStarting ? { scale: 0.96 } : {}}
                disabled={isStarting}
                className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-hot-pink px-3 py-1.5 text-sm font-medium text-white shadow-[0_0_20px_-4px] shadow-hot-pink/50 transition-all hover:shadow-[0_0_28px_-2px] hover:shadow-hot-pink/70 disabled:opacity-60"
              >
                {isStarting ? <LoadingDots /> : <><Play className="size-3.5 fill-white" />Resume</>}
              </motion.button>
              <motion.button
                onClick={startSession}
                whileTap={!isStarting ? { scale: 0.96 } : {}}
                disabled={isStarting}
                className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl bg-sky-blue px-3 py-1.5 text-sm font-semibold text-white shadow-[0_0_16px_-4px] shadow-sky-blue/50 transition-all hover:scale-[1.02] hover:shadow-[0_0_24px_-2px] hover:shadow-sky-blue/70 disabled:opacity-60"
              >
                New Show
              </motion.button>
            </>
          ) : (
            <motion.button
              onClick={startSession}
              whileTap={slides.length > 0 && !isStarting ? { scale: 0.96 } : {}}
              disabled={slides.length === 0 || isStarting}
              className={cn(
                'flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-medium text-white transition-all duration-200',
                slides.length > 0 && !isStarting
                  ? 'bg-hot-pink shadow-[0_0_20px_-4px] shadow-hot-pink/50 hover:shadow-[0_0_28px_-2px] hover:shadow-hot-pink/70'
                  : 'cursor-not-allowed bg-white/10 text-white/30',
              )}
            >
              {isStarting ? <LoadingDots /> : <><Play className="size-3.5 fill-white" />Start Show</>}
            </motion.button>
          )}

        </div>
      </header>

      {/* ── Auto-split toast ─────────────────────────────────────────── */}
      <AnimatePresence>
        {autoSplitToast && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-1/2 top-16 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-fresh-green/30 bg-white px-4 py-2 shadow-[0_8px_24px_-8px_rgba(0,0,121,0.18)]"
          >
            <span className="flex size-2 shrink-0 rounded-full bg-fresh-green" />
            <span className="text-xs font-medium text-midnight-sky-700">
              Auto-split into {autoSplitToast.count} slides
            </span>
            <button
              onClick={undoAutoSplit}
              className="rounded-full bg-midnight-sky-100 px-2.5 py-1 text-[11px] font-semibold text-midnight-sky-700 transition hover:bg-midnight-sky-200"
            >
              Undo split
            </button>
            <button
              onClick={() => setAutoSplitToast(null)}
              className="rounded-full p-0.5 text-midnight-sky-400 transition hover:bg-midnight-sky-100 hover:text-midnight-sky-700"
              aria-label="Dismiss"
            >
              <X className="size-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Large-HTML warning ──────────────────────────────────────── */}
      <AnimatePresence>
        {largeHtmlToast && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-1/2 top-28 z-40 flex max-w-[min(92vw,520px)] -translate-x-1/2 items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-[0_8px_24px_-8px_rgba(0,0,121,0.18)]"
          >
            <span className="mt-0.5 text-base">⚠️</span>
            <div className="flex-1">
              <p className="text-xs font-semibold text-amber-900">
                Large HTML file — {largeHtmlToast.sizeKB.toLocaleString()} KB
              </p>
              <p className="mt-1 text-[11px] leading-snug text-amber-800">
                <span className="font-medium">{largeHtmlToast.fileName}</span> is too big for cloud save (1 MB limit per slide). Use <span className="font-semibold">browser storage</span> instead, or compress the HTML file.
              </p>
            </div>
            <button
              onClick={() => setLargeHtmlToast(null)}
              className="rounded-full p-0.5 text-amber-700 transition hover:bg-amber-100"
              aria-label="Dismiss"
            >
              <X className="size-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Save storage choice modal ───────────────────────────────── */}
      <AnimatePresence>
        {showSaveModal && (
          <SaveStorageModal
            onBrowser={handleChooseBrowser}
            onCloud={handleChooseCloud}
            onCancel={() => setShowSaveModal(false)}
            saving={isSaving}
          />
        )}
      </AnimatePresence>

      {/* ── Canvas layout picker modal ──────────────────────────────── */}
      <AnimatePresence>
        {layoutPicker && (
          <CanvasLayoutPicker
            onSelect={layout => doAddCanvas(layout, layoutPicker.afterId)}
            onCancel={() => setLayoutPicker(null)}
          />
        )}
      </AnimatePresence>

      {/* ── Main area ───────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: slide panel */}
        <SlidePanel
          slides={slides}
          selectedId={selectedId}
          isImporting={isImporting}
          addMenuAfter={addMenuAfter}
          onSelect={setSelectedId}
          onDelete={deleteSlide}
          onDuplicate={duplicateSlide}
          onDragEnd={handleDragEnd}
          onImport={importFile}
          onOpenSorter={() => setShowSorter(true)}
          onSetAddMenu={setAddMenu}
          onAddQuestion={addQuestion}
          onAddContent={addContent}
          onAddCanvas={requestCanvas}
          onAddLeaderboard={addLeaderboard}
        />

        {/* Right: editor */}
        <div className="scrollbar-panel flex flex-1 flex-col overflow-auto" style={{ background: '#f8f7f5' }}>
          {selectedSlide ? (
            <SlideEditor slide={selectedSlide} onUpdate={updateSlide} onSplitHtml={splitHtmlSlide} onPushHistory={pushHistory} />
          ) : (
            <EmptyEditorState onImport={importFile} isImporting={isImporting} />
          )}
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Slide Panel — dark navy left sidebar
   ───────────────────────────────────────────────────────────────────────── */

function SlidePanel({
  slides, selectedId, isImporting, addMenuAfter,
  onSelect, onDelete, onDuplicate, onDragEnd, onImport, onOpenSorter, onSetAddMenu, onAddQuestion, onAddContent, onAddCanvas, onAddLeaderboard,
}: {
  slides: Slide[]
  selectedId: string | null
  isImporting: boolean
  addMenuAfter: string | undefined
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
  onDragEnd: (e: DragEndEvent) => void
  onImport: (file: File) => void
  onOpenSorter: () => void
  onSetAddMenu: (id: string | undefined) => void
  onAddQuestion: (type: QType, afterId?: string) => void
  onAddContent: (template: ContentTemplate, afterId?: string) => void
  onAddCanvas: (afterId?: string) => void
  onAddLeaderboard: (afterId?: string) => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const fileRef = useRef<HTMLInputElement>(null)
  const [addMenuOpen, setAddMenuOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('alaya-add-menu-open') !== 'false' } catch { return true }
  })
  const toggleAddMenu = () => setAddMenuOpen(prev => {
    const next = !prev
    try { localStorage.setItem('alaya-add-menu-open', String(next)) } catch {}
    return next
  })

  return (
    <aside className="flex w-48 shrink-0 flex-col overflow-hidden border-r border-white/8 bg-[#14142b]">

      {/* Import / Sorter button row */}
      <div className="shrink-0 border-b border-white/10 p-3">
        <div className="flex gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={isImporting}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#f97316] py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-[#ea6c0a] active:scale-95 disabled:opacity-40"
          >
            {isImporting ? <LoadingDots /> : 'Import / Merge'}
          </button>
          <button
            onClick={onOpenSorter}
            title="Slide overview"
            className="flex items-center justify-center rounded-xl bg-white/8 px-3 py-2 text-white/60 transition-all hover:bg-white/15 hover:text-white active:scale-95"
          >
            <LayoutGrid className="size-4" />
          </button>
        </div>
        <input
          ref={fileRef} type="file"
          accept=".pdf,.html,.htm,text/html,image/*,video/mp4,video/webm,video/quicktime,.json,.apulse"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = '' }}
        />
      </div>

      {/* Slide list or empty state */}
      <div className="scrollbar-sidebar flex flex-1 flex-col overflow-y-auto py-2">
        {slides.length === 0 ? (
          /* Empty state — show question + content type cards */
          <div className="flex flex-1 flex-col gap-4 p-3">
            <div className="pt-2 text-center">
              <FileText className="mx-auto size-8 text-white/20" />
              <p className="mt-2 text-[11px] text-white/30">
                Import a PDF or start with a slide
              </p>
            </div>
            <div>
              <p className="mb-1.5 px-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/40">
                Question
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {QTYPES.map(q => (
                  <button
                    key={q.type}
                    onClick={() => onAddQuestion(q.type)}
                    className="flex items-center justify-center rounded-xl border border-white/10 px-2 py-2.5 text-[9px] font-medium text-white/75 transition-all hover:border-white/25 hover:bg-white/10 hover:text-white"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 px-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/40">
                Content
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {CONTENT_TEMPLATES.map(t => (
                  <button
                    key={t.template}
                    onClick={() => onAddContent(t.template)}
                    className="flex items-center justify-center rounded-xl border border-white/10 px-1 py-2.5 text-[9px] font-medium text-white/75 transition-all hover:border-white/25 hover:bg-white/10 hover:text-white"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 px-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/40">
                Custom
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => onAddCanvas()}
                  className="flex items-center justify-center rounded-xl border border-white/10 px-2 py-2.5 text-[9px] font-medium text-white/75 transition-all hover:border-white/25 hover:bg-white/10 hover:text-white"
                >
                  Custom Slide
                </button>
                <button
                  onClick={() => onAddLeaderboard()}
                  className="flex items-center justify-center rounded-xl border border-white/10 px-2 py-2.5 text-[9px] font-medium text-white/75 transition-all hover:border-white/25 hover:bg-white/10 hover:text-white"
                >
                  Leaderboard
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Drag-and-drop slide list */
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={slides.map(s => s.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col px-1 pb-1">
                {slides.map((slide, idx) => (
                  <div key={slide.id} data-slide-id={slide.id}>
                    <SlideThumbnail
                      slide={slide}
                      index={idx}
                      isSelected={slide.id === selectedId}
                      onSelect={() => onSelect(slide.id)}
                      onDelete={() => onDelete(slide.id)}
                      onDuplicate={() => onDuplicate(slide.id)}
                    />
                    {/* "+ Add question" between each slide */}
                    <AddBetweenButton
                      isOpen={addMenuAfter === slide.id}
                      onToggle={() => onSetAddMenu(addMenuAfter === slide.id ? undefined : slide.id)}
                      onAdd={(type) => onAddQuestion(type, slide.id)}
                      onAddContent={(template) => onAddContent(template, slide.id)}
                      onAddCanvas={() => onAddCanvas(slide.id)}
                      onAddLeaderboard={() => onAddLeaderboard(slide.id)}
                    />
                  </div>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Bottom: add question / content at end (only when slides exist) */}
      {slides.length > 0 && (
        <div className="shrink-0 border-t border-white/10">
          {/* Toggle strip — always visible */}
          <button
            onClick={toggleAddMenu}
            className="flex w-full items-center justify-between px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-white/40 transition-all hover:bg-white/5 hover:text-white/65"
          >
            <span>Add slide</span>
            {addMenuOpen
              ? <ChevronDown className="size-3" />
              : <ChevronUp   className="size-3" />
            }
          </button>

          {/* Collapsible menu */}
          <AnimatePresence initial={false}>
            {addMenuOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <div className="space-y-1.5 px-3 pb-2">
                  <div>
                    <p className="mb-0.5 px-1 text-[9px] font-semibold uppercase tracking-wider text-white/40">
                      Question
                    </p>
                    <div className="grid grid-cols-2 gap-1">
                      {QTYPES.map(q => (
                        <button
                          key={q.type}
                          onClick={() => onAddQuestion(q.type, selectedId ?? undefined)}
                          className="flex items-center justify-center rounded-lg px-2 py-1 text-[10px] text-white/75 transition-all hover:bg-white/10 hover:text-white"
                        >
                          {q.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-0.5 px-1 text-[9px] font-semibold uppercase tracking-wider text-white/40">
                      Content
                    </p>
                    <div className="grid grid-cols-3 gap-1">
                      {CONTENT_TEMPLATES.map(t => (
                        <button
                          key={t.template}
                          onClick={() => onAddContent(t.template, selectedId ?? undefined)}
                          className="flex items-center justify-center rounded-lg px-1 py-1 text-[10px] text-white/75 transition-all hover:bg-white/10 hover:text-white"
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      onClick={() => onAddCanvas(selectedId ?? undefined)}
                      className="flex items-center justify-center rounded-lg px-2 py-1 text-[10px] text-white/75 transition-all hover:bg-white/10 hover:text-white"
                    >
                      Custom Slide
                    </button>
                    <button
                      onClick={() => onAddLeaderboard(selectedId ?? undefined)}
                      className="flex items-center justify-center rounded-lg px-2 py-1 text-[10px] text-white/75 transition-all hover:bg-white/10 hover:text-white"
                    >
                      Leaderboard
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </aside>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Slide Thumbnail — draggable card in the sidebar
   ───────────────────────────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────────────────────────
   HtmlSlideThumbnail — renders a tiny, scaled-down live preview of the
   actual HTML slide content in the sidebar thumbnail. Uses an
   IntersectionObserver so iframes only mount when the thumbnail is near
   the viewport (avoids loading 30 iframes up-front). A ResizeObserver
   keeps the scale factor in sync with the container width.
   ───────────────────────────────────────────────────────────────────────── */

function HtmlSlideThumbnail({ slide }: { slide: HtmlSlide }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [shouldLoad, setShouldLoad] = useState(false)
  const [scale, setScale] = useState(0.16)
  const IFRAME_W = 1280
  const IFRAME_H = 720

  // Lazy-load: only mount the iframe once the thumbnail is near the viewport
  useEffect(() => {
    if (!containerRef.current) return
    if (shouldLoad) return
    const el = containerRef.current
    const obs = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setShouldLoad(true)
          obs.disconnect()
          break
        }
      }
    }, { rootMargin: '120px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [shouldLoad])

  // Dynamic scale: keep the iframe content fitting the container width
  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const recompute = () => {
      const w = el.offsetWidth
      if (w > 0) setScale(w / IFRAME_W)
    }
    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const srcDoc = useMemo(
    () => injectThumbnailNavScript(slide.html ?? '', slide.slideIndex ?? 0),
    [slide.html, slide.slideIndex],
  )

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-white">
      {shouldLoad ? (
        <iframe
          srcDoc={srcDoc}
          sandbox="allow-scripts allow-popups allow-modals"
          title={slide.fileName}
          className="border-0"
          style={{
            width:           `${IFRAME_W}px`,
            height:          `${IFRAME_H}px`,
            transform:       `scale(${scale})`,
            transformOrigin: 'top left',
            pointerEvents:   'none',
          }}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1">
          <FileText className="size-4 text-midnight-sky-400" />
        </div>
      )}
    </div>
  )
}

/** Lightweight version of the nav script for thumbnails — no postMessage,
 *  no slide-change verification, no transition-disable cleanup. Just snap
 *  to the target internal slide as quickly as possible and stop. */
function injectThumbnailNavScript(html: string, slideIndex: number): string {
  if (slideIndex <= 0) return html
  const script = `
<script>
(function() {
  var target = ${slideIndex};
  function fireKey() {
    try {
      var ev = new KeyboardEvent('keydown', {
        key: 'ArrowRight', code: 'ArrowRight',
        keyCode: 39, which: 39, bubbles: true, cancelable: true,
      });
      document.dispatchEvent(ev);
    } catch (e) {}
  }
  function init() {
    // Kill all transitions/animations so the snapshot reaches its target instantly
    try {
      var s = document.createElement('style');
      s.textContent = '*,*::before,*::after { transition: none !important; animation-duration: 0s !important; animation-delay: 0s !important; }';
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
    try { if (window.Reveal && Reveal.slide) { Reveal.slide(target); return; } } catch (e) {}
    try { if (window.impress) { window.impress().goto(target); return; } } catch (e) {}
    try { window.location.hash = '#/' + target; } catch (e) {}
    // Fire ArrowRights with tiny stagger
    for (var i = 0; i < target; i++) {
      setTimeout(fireKey, i * 12);
    }
  }
  if (document.readyState === 'complete') setTimeout(init, 40);
  else window.addEventListener('load', function() { setTimeout(init, 40); });
})();
</script>`
  if (html.includes('</body>')) return html.replace('</body>', script + '\n</body>')
  return html + script
}

/* Shared thumbnail content renderer — used by both the sidebar SlideThumbnail
   and the full-screen SlideSorter cards. Returns the inner coloured box content. */
function renderThumbContent(slide: Slide): ReactNode {
  if (slide.type === 'pdf') {
    const s = slide as PdfSlide
    return s.imgUrl ? (
      <img src={s.imgUrl} alt={`Page ${s.pageNum}`} className="h-full w-full object-cover" />
    ) : (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1">
        <FileText className="size-4 text-white/30" />
        <span className="text-[8px] text-white/25">Page {s.pageNum}</span>
      </div>
    )
  }
  if (slide.type === 'image') {
    const s = slide as ImageSlide
    return <img src={s.imgUrl} alt={s.fileName} className="h-full w-full object-cover" />
  }
  if (slide.type === 'video') {
    const s = slide as VideoSlide
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1">
        <Video className="size-4 text-white/40" />
        <span className="max-w-full truncate px-1 text-[8px] text-white/25">{s.fileName}</span>
      </div>
    )
  }
  if (slide.type === 'html') {
    return <HtmlSlideThumbnail slide={slide as HtmlSlide} />
  }
  if (slide.type === 'content') {
    const s = slide as ContentSlide
    const cInfo = CONTENT_TEMPLATES.find(t => t.template === s.template)
    return (
      <div
        className="flex h-full w-full items-center justify-center p-2"
        style={{ backgroundColor: (() => { const bg = contentColors(s.theme).bg; return bg === 'transparent' ? '#f4f4f9' : bg })() }}
      >
        <p className="text-center text-[9px] font-medium leading-snug line-clamp-2"
          style={{ color: contentColors(s.theme).text, opacity: s.title ? 1 : 0.4 }}>
          {s.title || cInfo?.label}
        </p>
      </div>
    )
  }
  if (slide.type === 'canvas') {
    const cs = slide as CanvasSlide
    const hasTable  = cs.elements.some(el => el.kind === 'table')
    const hasImgEl  = cs.elements.some(el => el.kind === 'image')
    const hasBgImg  = cs.bg.type === 'image'
    const hasImage  = hasImgEl || hasBgImg
    const firstText = cs.elements.find(el => el.kind === 'text') as CanvasTextEl | undefined
    const rawText   = firstText ? firstText.html.replace(/<[^>]*>/g, '').trim() : ''
    const isEmpty   = cs.elements.length === 0 && !hasBgImg
    return (
      <div
        className="flex h-full w-full items-center justify-center p-2"
        style={
          cs.bg.type === 'color'    ? { background:      cs.bg.value } :
          cs.bg.type === 'gradient' ? { backgroundImage: cs.bg.value } :
          { background: '#1a1a3e' }
        }
      >
        {rawText ? (
          <div className="flex w-full flex-col items-center gap-0.5">
            <p className="w-full text-center text-[9px] font-medium leading-snug line-clamp-2 text-white/80">{rawText}</p>
            {(hasTable || hasImage) && (
              <div className="flex items-center gap-1">
                {hasTable && <Table2    className="size-2.5 text-white/50" />}
                {hasImage  && <ImageIcon className="size-2.5 text-white/50" />}
              </div>
            )}
          </div>
        ) : isEmpty ? (
          <span className="text-[8px] text-white/30">Custom slide</span>
        ) : (hasBgImg && !hasTable && !hasImgEl) ? (
          <div className="flex flex-col items-center gap-1">
            <ImageIcon className="size-4 text-white/50" />
            <span className="text-[8px] text-white/40">Background image</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            {hasTable && <Table2    className="size-4 text-white/50" />}
            {hasImage  && <ImageIcon className="size-4 text-white/50" />}
          </div>
        )}
      </div>
    )
  }
  if (slide.type === 'leaderboard') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-midnight-sky-900">
        <Trophy className="size-4 text-hot-pink/60" />
        <span className="text-[8px] font-medium text-white/35">Leaderboard</span>
      </div>
    )
  }
  // Question slides (mcq / wordcloud / openended / rating)
  const qs    = slide as QuestionSlide
  const qInfo = QTYPES.find(q => q.type === qs.type)
  return (
    <div
      className="flex h-full w-full items-center justify-center p-2"
      style={{ backgroundColor: (() => { const bg = contentColors(qs.theme ?? 'navy').bg; return bg === 'transparent' ? '#f4f4f9' : bg })() }}
    >
      <p className="text-center text-[9px] font-medium leading-snug line-clamp-2"
        style={{ color: contentColors(qs.theme ?? 'navy').text, opacity: qs.question ? 1 : 0.35 }}>
        {qs.question || qInfo?.label}
      </p>
    </div>
  )
}

function SlideThumbnail({
  slide, index, isSelected, onSelect, onDelete, onDuplicate,
}: {
  slide: Slide
  index: number
  isSelected: boolean
  onSelect: () => void
  onDelete: () => void
  onDuplicate: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: slide.id })

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const isQuestionSlide = slide.type === 'mcq' || slide.type === 'wordcloud' || slide.type === 'openended' || slide.type === 'rating'
  const isContentSlide  = slide.type === 'content'
  const qInfo = isQuestionSlide ? QTYPES.find(q => q.type === (slide as QuestionSlide).type) : null
  const cInfo = isContentSlide  ? CONTENT_TEMPLATES.find(t => t.template === (slide as ContentSlide).template) : null

  return (
    <div ref={setNodeRef} style={style} {...attributes} className="group relative my-0.5">
      <button
        onClick={onSelect}
        {...listeners}
        className={cn(
          'relative flex w-full items-start gap-1.5 rounded-xl px-1.5 py-1 text-left transition-all cursor-grab active:cursor-grabbing',
          isSelected ? 'bg-white/15 ring-1 ring-hot-pink/70' : 'hover:bg-white/8',
        )}
      >
        {/* Slide number */}
        <span className="mt-1 w-4 shrink-0 text-[10px] font-medium text-white/60">
          {index + 1}
        </span>

        {/* Thumbnail */}
        <div className="aspect-video flex-1 overflow-hidden rounded-lg bg-midnight-sky-800">
          {renderThumbContent(slide)}
        </div>

        {/* Question type badge */}
        {qInfo && (
          <span
            className="absolute right-3 top-3 rounded-md px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider"
            style={{
              backgroundColor: `${contentColors((slide as QuestionSlide).theme ?? 'navy').accent}22`,
              color: contentColors((slide as QuestionSlide).theme ?? 'navy').accent,
            }}
          >
            {qInfo.badge}
          </span>
        )}
        {/* Content slide badge */}
        {cInfo && (
          <span
            className="absolute right-3 top-3 rounded-md px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider"
            style={{
              backgroundColor: `${contentColors((slide as ContentSlide).theme).accent}22`,
              color: contentColors((slide as ContentSlide).theme).accent,
            }}
          >
            {(slide as ContentSlide).template.slice(0, 1).toUpperCase()}
          </span>
        )}
        {/* Canvas badge */}
        {slide.type === 'canvas' && (
          <span className="absolute right-3 top-3 rounded-md bg-sky-blue/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-sky-blue/70">
            CS
          </span>
        )}
        {/* HTML badge — shows split index if part of a split deck */}
        {slide.type === 'html' && (
          <span className="absolute right-3 top-3 rounded-md bg-golden-sun/20 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-golden-sun/80">
            {(slide as HtmlSlide).slideTotal && (slide as HtmlSlide).slideTotal! > 1
              ? `HTML ${((slide as HtmlSlide).slideIndex ?? 0) + 1}/${(slide as HtmlSlide).slideTotal}`
              : 'HTML'}
          </span>
        )}
        {slide.type === 'leaderboard' && (
          <span className="absolute right-3 top-3 rounded-md bg-hot-pink/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-hot-pink/70">
            LB
          </span>
        )}
      </button>

      {/* Drag handle — appears on hover, left edge */}
      {/* Duplicate button — bottom left, faint at rest, clear on hover */}
      <button
        onClick={e => { e.stopPropagation(); onDuplicate() }}
        title="Duplicate slide"
        className="absolute bottom-2 left-8 rounded-md p-0.5 text-white/35 transition-all [filter:drop-shadow(0_1px_3px_rgba(0,0,0,0.85))] group-hover:text-white/70 hover:!text-sky-blue"
      >
        <Copy className="size-3" />
      </button>

      {/* Delete button — bottom right, faint at rest, clear on hover */}
      <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        title="Delete slide"
        className="absolute bottom-2 right-2 rounded-md p-0.5 text-white/35 transition-all [filter:drop-shadow(0_1px_3px_rgba(0,0,0,0.85))] group-hover:text-white/70 hover:!text-red-400"
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Add-between button — the "+" row between slides
   ───────────────────────────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────────────────────────
   SlideSorter — full-screen slide overview / drag-to-reorder grid
   ───────────────────────────────────────────────────────────────────────── */

function SlideSorterCard({
  slide, index, isSelected, onClick, onDelete, onDuplicate,
}: {
  slide: Slide
  index: number
  isSelected: boolean
  onClick: () => void
  onDelete: () => void
  onDuplicate: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: slide.id })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
        opacity: isDragging ? 0.35 : 1,
      }}
      {...attributes}
      className="group flex flex-col gap-1.5"
    >
      {/* Card + action buttons share this relative wrapper */}
      <div className="relative">
        <button
          onClick={onClick}
          {...listeners}
          className={cn(
            'relative aspect-video w-full overflow-hidden rounded-xl bg-midnight-sky-800 transition-all cursor-grab active:cursor-grabbing',
            isSelected ? 'ring-2 ring-hot-pink' : 'ring-1 ring-white/10 hover:ring-white/30',
          )}
        >
          {renderThumbContent(slide)}
        </button>

        {/* Duplicate — bottom left */}
        <button
          onClick={e => { e.stopPropagation(); onDuplicate() }}
          title="Duplicate slide"
          className="absolute bottom-2 left-2 rounded-md p-1 text-white/35 transition-all [filter:drop-shadow(0_1px_3px_rgba(0,0,0,0.85))] group-hover:text-white/70 hover:!text-sky-blue"
        >
          <Copy className="size-3.5" />
        </button>

        {/* Delete — bottom right */}
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          title="Delete slide"
          className="absolute bottom-2 right-2 rounded-md p-1 text-white/35 transition-all [filter:drop-shadow(0_1px_3px_rgba(0,0,0,0.85))] group-hover:text-white/70 hover:!text-red-400"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <span className="text-center text-[10px] text-white/65">{index + 1}</span>
    </div>
  )
}

function SlideSorter({
  slides, selectedId, onDragEnd, onSelect, onClose, onDelete, onDuplicate,
}: {
  slides: Slide[]
  selectedId: string | null
  onDragEnd: (e: DragEndEvent) => void
  onSelect: (id: string) => void
  onClose: () => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0d0d20]">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-6 py-3">
        <div className="flex items-center gap-2">
          <LayoutGrid className="size-4 text-white/50" />
          <span className="text-sm font-semibold text-white/80">Slide Overview</span>
          <span className="rounded-md bg-white/12 px-2 py-0.5 text-[11px] text-white/65">{slides.length} slides</span>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-white/40 transition-all hover:bg-white/10 hover:text-white"
          title="Close (Esc)"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={slides.map(s => s.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-3 gap-4 lg:grid-cols-4 xl:grid-cols-5">
              {slides.map((slide, idx) => (
                <SlideSorterCard
                  key={slide.id}
                  slide={slide}
                  index={idx}
                  isSelected={slide.id === selectedId}
                  onClick={() => { onSelect(slide.id); onClose() }}
                  onDelete={() => onDelete(slide.id)}
                  onDuplicate={() => onDuplicate(slide.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  )
}

function AddBetweenButton({
  isOpen, onToggle, onAdd, onAddContent, onAddCanvas, onAddLeaderboard,
}: {
  isOpen: boolean
  onToggle: () => void
  onAdd: (type: QType) => void
  onAddContent: (template: ContentTemplate) => void
  onAddCanvas: () => void
  onAddLeaderboard: () => void
}) {
  return (
    <div className="px-2">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-center py-0.5"
      >
        <span className={cn(
          'flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium transition-all',
          isOpen
            ? 'bg-hot-pink/20 text-hot-pink'
            : 'text-white/20 hover:bg-white/10 hover:text-white/50',
        )}>
          <Plus className="size-2.5" />
          {isOpen ? 'Add slide here' : 'Insert slide here'}
        </span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="mb-1 mt-0.5 rounded-xl border border-white/15 bg-midnight-sky-800 p-1.5 shadow-xl"
          >
            <p className="mb-1 px-1 text-[8px] font-semibold uppercase tracking-wider text-white/25">Question</p>
            <div className="mb-1.5 grid grid-cols-2 gap-1">
              {QTYPES.map(q => (
                <button
                  key={q.type}
                  onClick={() => onAdd(q.type)}
                  className="flex items-center justify-center rounded-lg px-1 py-1.5 text-[9px] font-medium text-white/60 transition-all hover:bg-white/10 hover:text-white"
                >
                  {q.label}
                </button>
              ))}
            </div>
            <div className="border-t border-white/10 pt-1.5">
              <p className="mb-1 px-1 text-[8px] font-semibold uppercase tracking-wider text-white/25">Content</p>
              <div className="grid grid-cols-3 gap-1">
                {CONTENT_TEMPLATES.map(t => (
                  <button
                    key={t.template}
                    onClick={() => onAddContent(t.template)}
                    className="flex items-center justify-center rounded-lg px-1 py-1.5 text-[9px] font-medium text-white/60 transition-all hover:bg-white/10 hover:text-white"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-2 gap-1">
                <button
                  onClick={onAddCanvas}
                  className="flex items-center justify-center rounded-lg px-1 py-1.5 text-[9px] font-medium text-white/60 transition-all hover:bg-white/10 hover:text-white"
                >
                  Custom Slide
                </button>
                <button
                  onClick={onAddLeaderboard}
                  className="flex items-center justify-center rounded-lg px-1 py-1.5 text-[9px] font-medium text-white/60 transition-all hover:bg-white/10 hover:text-white"
                >
                  Leaderboard
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Slide Editor — right panel
   ───────────────────────────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────────────────────────
   HTML slide editor — preview, internal-slide selector, and split tool.
   Uses the shared PersistentHtmlIframe so selecting different split slides
   in the sidebar navigates inside the same iframe (no remount, no
   key-press shuffle every click).
   ───────────────────────────────────────────────────────────────────────── */

/** Auto-detect how many internal slides an HTML deck contains, by parsing the
 *  string for common slideshow framework markers. Returns null if unsure. */
function detectHtmlSlideCount(html: string): number | null {
  if (!html || typeof DOMParser === 'undefined') return null
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    // Ordered by specificity — most-specific framework markers first
    const selectors = [
      '.reveal .slides > section',  // reveal.js horizontal slides
      '.reveal > .slides > section',
      '.slides > section',          // generic reveal-style
      '#impress .step',             // impress.js
      '.step',                      // impress.js fallback
      '[data-slide]',               // custom decks
      'section.slide',              // PowerPoint exports
      'div.slide',                  // PowerPoint / Keynote exports
      '.slide',                     // generic fallback
    ]
    for (const sel of selectors) {
      const count = doc.querySelectorAll(sel).length
      if (count > 1) return count
    }
    return null
  } catch {
    return null
  }
}

function HtmlSlideEditor({
  slide, onUpdate, onSplit,
}: {
  slide:    HtmlSlide
  onUpdate: (patch: Partial<HtmlSlide>) => void
  onSplit:  (count: number) => void
}) {
  // Auto-detect once per HTML file (heavy DOM parsing, no need to redo)
  const detected = React.useMemo(() => detectHtmlSlideCount(slide.html), [slide.html])
  const [splitOpen,  setSplitOpen]  = useState(false)
  const [splitCount, setSplitCount] = useState(slide.slideTotal ?? detected ?? 5)

  const isSplit  = slide.slideTotal !== undefined && slide.slideTotal > 1
  const current  = (slide.slideIndex ?? 0) + 1
  const totalLbl = slide.slideTotal ?? 1

  const confirmSplit = () => {
    const n = Math.max(2, Math.min(100, Math.floor(splitCount)))
    onSplit(n)
    setSplitOpen(false)
  }

  return (
    <div className="flex flex-1 flex-col bg-midnight-sky-900 px-4 py-2">
      {/* Top bar — filename + slide info + split control */}
      <div className="mb-2 flex items-center gap-2">
        <div className="flex items-center gap-2 text-xs text-white/45">
          <FileText className="size-3.5" />
          <span className="font-medium">{slide.fileName}</span>
          <span className="text-white/25">· HTML</span>
        </div>

        {isSplit && (
          <span className="rounded-full bg-golden-sun/15 px-2 py-0.5 text-[10px] font-semibold text-golden-sun">
            Slide {current} of {totalLbl}
          </span>
        )}

        <div className="flex-1" />

        {/* Internal slide picker — appears once split */}
        {isSplit && (
          <label className="flex items-center gap-1.5 text-[11px] text-white/55">
            <span>Show internal slide</span>
            <input
              type="number"
              min={1}
              max={totalLbl}
              value={current}
              onChange={e => {
                const v = Math.max(1, Math.min(totalLbl, parseInt(e.target.value || '1', 10)))
                onUpdate({ slideIndex: v - 1 })
              }}
              className="w-12 rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-center text-white outline-none focus:border-hot-pink/60"
            />
            <span className="text-white/35">/ {totalLbl}</span>
          </label>
        )}

        {!isSplit && (
          <button
            onClick={() => setSplitOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-golden-sun/30 bg-golden-sun/10 px-2.5 py-1 text-[11px] font-semibold text-golden-sun transition hover:border-golden-sun/50 hover:bg-golden-sun/15"
            title="If your HTML file contains multiple internal slides, split them into separate Pulse slides so you can insert questions between them."
          >
            <Plus className="size-3" />
            {detected ? `Split into ${detected} slides` : 'Split into multiple slides'}
          </button>
        )}
      </div>

      {/* Helper hint */}
      {!isSplit && (
        <p className="mb-3 text-[11px] font-light leading-snug text-white/40">
          {detected ? (
            <>
              <span className="font-semibold text-fresh-green">Detected {detected} internal slides.</span>
              {' '}Split them into separate Pulse slides so you can insert question slides between them while keeping all JavaScript animations intact.
            </>
          ) : (
            <>If your HTML file is a slideshow (reveal.js, impress.js, etc.), splitting it lets you insert question slides between its internal slides while keeping all JavaScript animations intact.</>
          )}
        </p>
      )}

      {/* Iframe preview — persistent across slide selections in the same
          html group, so clicking different split slides in the sidebar
          navigates the existing iframe instead of remounting it.
          For split decks, interactive is disabled so the HTML's internal
          next/prev buttons can't desync the iframe from the Pulse slide
          index (which would leave the wrong slide showing on revisit). */}
      <div className="relative flex-1 overflow-hidden rounded-2xl bg-white shadow-[0_24px_80px_-12px_rgba(0,0,0,0.6)]">
        <PersistentHtmlIframe
          key={`${slide.fileName}::${slide.slideTotal ?? 0}`}
          html={slide.html}
          fileName={slide.fileName}
          visible={true}
          targetIndex={slide.slideIndex ?? 0}
          interactive={(slide.slideTotal ?? 0) <= 1}
          containerClassName="absolute inset-0"
        />
      </div>

      {/* Split modal */}
      <AnimatePresence>
        {splitOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setSplitOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl border border-white/10 bg-midnight-sky-800 p-7 shadow-2xl"
            >
              <h3 className="text-lg font-semibold text-white">Split HTML into multiple slides</h3>
              <p className="mt-1.5 text-sm font-light leading-relaxed text-white/55">
                Each internal slide becomes its own Pulse slide — you can insert question slides between them.
              </p>

              {/* Auto-detection result */}
              {detected ? (
                <div className="mt-4 flex items-center gap-2 rounded-xl border border-fresh-green/30 bg-fresh-green/10 px-3.5 py-2.5">
                  <span className="text-base">✓</span>
                  <p className="flex-1 text-xs leading-snug text-fresh-green/90">
                    Auto-detected <span className="font-bold">{detected} slides</span> in <span className="font-medium text-white/80">{slide.fileName}</span>. Adjust below if needed.
                  </p>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5">
                  <p className="text-xs leading-snug text-white/55">
                    Couldn't auto-detect slide count in <span className="font-medium text-white/75">{slide.fileName}</span>. Please enter it manually.
                  </p>
                </div>
              )}

              <div className="mt-4 flex items-center gap-3">
                <label className="text-sm text-white/60">Number of slides</label>
                <input
                  type="number"
                  min={2}
                  max={100}
                  value={splitCount}
                  onChange={e => setSplitCount(parseInt(e.target.value || '2', 10))}
                  onKeyDown={e => e.key === 'Enter' && confirmSplit()}
                  autoFocus
                  className="w-20 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-center text-white outline-none focus:border-hot-pink/60"
                />
              </div>
              <p className="mt-3 text-[11px] font-light leading-relaxed text-white/35">
                Tip: this uses URL hash navigation (<span className="font-mono text-white/55">#/0</span>, <span className="font-mono text-white/55">#/1</span>, …). Most HTML slideshow frameworks support this out of the box. If your file doesn't, all split slides will show the first slide.
              </p>
              <div className="mt-6 flex gap-2.5">
                <button
                  onClick={() => setSplitOpen(false)}
                  className="flex-1 rounded-xl border border-white/15 bg-white/5 py-2.5 text-sm font-medium text-white transition hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmSplit}
                  className="flex-1 rounded-xl bg-hot-pink py-2.5 text-sm font-medium text-white shadow-[0_0_20px_-4px] shadow-hot-pink/50 transition hover:shadow-[0_0_28px_-2px] hover:shadow-hot-pink/70"
                >
                  Split into {Math.max(2, Math.min(100, Math.floor(splitCount)))}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function SlideEditor({ slide, onUpdate, onSplitHtml, onPushHistory }: {
  slide: Slide
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onUpdate: (id: string, patch: any) => void
  onSplitHtml?: (id: string, count: number) => void
  onPushHistory?: () => void
}) {
  if (slide.type === 'pdf') {
    if (!slide.imgUrl) {
      return (
        <div className="flex flex-1 items-center justify-center bg-midnight-sky-900 p-10">
          <div className="flex flex-col items-center gap-5 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-white/8">
              <FileText className="size-8 text-white/30" />
            </div>
            <div>
              <p className="text-base font-semibold text-white/70">Page {slide.pageNum}</p>
              <p className="mt-2 max-w-xs text-sm font-light leading-relaxed text-white/40">
                PDF images aren't saved to the cloud to keep file sizes small.
                Re-import your PDF using the button in the left panel to restore this slide.
              </p>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="flex flex-1 items-center justify-center bg-midnight-sky-900 p-10">
        <img
          src={slide.imgUrl}
          alt={`Slide ${slide.pageNum}`}
          className="max-h-full max-w-full rounded-2xl shadow-[0_24px_80px_-12px_rgba(0,0,0,0.6)]"
        />
      </div>
    )
  }

  if (slide.type === 'image') {
    return (
      <div className="flex flex-1 items-center justify-center bg-midnight-sky-900 p-10">
        <img
          src={slide.imgUrl}
          alt={slide.fileName}
          className="max-h-full max-w-full rounded-2xl shadow-[0_24px_80px_-12px_rgba(0,0,0,0.6)]"
        />
      </div>
    )
  }

  if (slide.type === 'video') {
    return (
      <div className="flex flex-1 items-center justify-center bg-midnight-sky-900 p-10">
        {slide.videoUrl ? (
          <video
            src={slide.videoUrl}
            controls
            className="max-h-full max-w-full rounded-2xl shadow-[0_24px_80px_-12px_rgba(0,0,0,0.6)]"
          />
        ) : (
          <div className="flex flex-col items-center gap-5 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-white/8">
              <Video className="size-8 text-white/30" />
            </div>
            <div>
              <p className="text-base font-semibold text-white/70">{slide.fileName}</p>
              <p className="mt-2 max-w-xs text-sm font-light leading-relaxed text-white/40">
                Video slides live in this browser session only and can't be saved to the cloud.
                Re-import the video to restore it.
              </p>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (slide.type === 'html') {
    return (
      <HtmlSlideEditor
        slide={slide}
        onUpdate={patch => onUpdate(slide.id, patch)}
        onSplit={count => onSplitHtml?.(slide.id, count)}
      />
    )
  }

  if (slide.type === 'content') {
    return (
      <div className="scrollbar-panel flex flex-1 flex-col overflow-auto" style={{ background: '#f8f7f5' }}>
        <div className="w-full max-w-3xl px-5 py-4">
          <ContentEditor slide={slide} onUpdate={patch => onUpdate(slide.id, patch)} onPushHistory={onPushHistory} />
        </div>
      </div>
    )
  }

  if (slide.type === 'canvas') {
    return (
      <div className="scrollbar-panel flex flex-1 flex-col overflow-auto" style={{ background: '#f8f7f5' }}>
        <div className="w-full px-5 py-4">
          <CanvasEditor slide={slide} onUpdate={patch => onUpdate(slide.id, patch)} onPushHistory={onPushHistory} />
        </div>
      </div>
    )
  }

  if (slide.type === 'leaderboard') {
    return (
      <div className="flex flex-1 items-center justify-center bg-midnight-sky-900 p-10">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-hot-pink/10">
            <Trophy className="size-8 text-hot-pink/60" />
          </div>
          <div>
            <p className="text-base font-semibold text-white/70">Leaderboard slide</p>
            <p className="mt-2 max-w-xs text-sm font-light leading-relaxed text-white/40">
              Top 10 scores will appear here during a live quiz session.
            </p>
            <p className="mt-1 text-xs text-white/25">No settings needed.</p>
          </div>
        </div>
      </div>
    )
  }

  // Question slides — editor form above, 16:9 slide preview below
  return (
    <div className="scrollbar-panel flex flex-1 flex-col overflow-auto" style={{ background: '#f8f7f5' }}>
      {/* Editor form */}
      <div className="max-w-3xl px-5 py-4">
        <QuestionEditor slide={slide as QuestionSlide} onUpdate={patch => onUpdate(slide.id, patch)} hidePreview onPushHistory={onPushHistory} />
      </div>
      {/* Slide preview */}
      <div className="max-w-3xl px-5 pb-6">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-midnight-sky-500">
          Slide preview
        </p>
        <SlidePreviewCard slide={slide as QuestionSlide} />
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   fileToImageDataUrl — converts any image or PDF (page 1) to a data URL.
   Used by SlideImagePicker and the canvas "Add Image" handler so both
   spots accept PDFs without duplicating the PDF.js rendering logic.
   ───────────────────────────────────────────────────────────────────────── */

async function fileToImageDataUrl(file: File): Promise<string> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const buf      = await file.arrayBuffer()
    const pdfjsLib = await getPdfjs()
    const pdf      = await pdfjsLib.getDocument({ data: buf }).promise
    const page = await pdf.getPage(1)
    const vp   = page.getViewport({ scale: 2.0 })
    const canvas  = document.createElement('canvas')
    canvas.width  = vp.width
    canvas.height = vp.height
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp }).promise
    return canvas.toDataURL('image/jpeg', 0.92)
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/* ─────────────────────────────────────────────────────────────────────────
   SlideImagePicker — reusable image upload widget for question + content slides
   ───────────────────────────────────────────────────────────────────────── */

function SlideImagePicker({ imgUrl, onChange }: {
  imgUrl?: string
  onChange: (url: string | undefined) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = (file: File) => {
    fileToImageDataUrl(file).then(onChange).catch(console.error)
  }

  if (imgUrl) {
    return (
      <div className="flex items-start gap-3">
        <div className="relative">
          <img src={imgUrl} alt="" className="h-20 max-w-[180px] rounded-xl border border-midnight-sky-100 object-cover shadow-sm" />
          <button
            onClick={() => onChange(undefined)}
            className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-red-500 text-white shadow-sm transition hover:bg-red-600"
          >
            <X className="size-3" />
          </button>
        </div>
        <div className="flex flex-col gap-1.5 pt-1">
          <button
            onClick={() => fileRef.current?.click()}
            className="text-[11px] text-midnight-sky-400 transition hover:text-midnight-sky-700"
          >
            Change image
          </button>
          <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
        </div>
      </div>
    )
  }

  return (
    <>
      <button
        onClick={() => fileRef.current?.click()}
        className="flex items-center gap-2 rounded-xl border border-dashed border-midnight-sky-300 px-4 py-2.5 text-sm text-midnight-sky-700 transition hover:border-hot-pink hover:text-hot-pink"
      >
        <Upload className="size-3.5" />
        Upload image
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />
    </>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Question Editor — form for all 4 types
   ───────────────────────────────────────────────────────────────────────── */

function QuestionEditor({ slide, onUpdate, hidePreview = false, onPushHistory }: {
  slide: QuestionSlide
  onUpdate: (patch: Partial<QuestionSlide>) => void
  hidePreview?: boolean
  onPushHistory?: () => void
}) {
  const qInfo = QTYPES.find(q => q.type === slide.type)!

  const PLACEHOLDERS: Record<QType, string> = {
    mcq:       'e.g. What is your biggest leadership challenge right now?',
    wordcloud: 'e.g. In one word, describe your team\'s current culture.',
    openended: 'e.g. What one change would make the biggest difference to your team in the next 90 days?',
    rating:    'e.g. Rate your confidence in these leadership areas:',
  }

  return (
    <div className="w-full">
      <motion.div
        key={slide.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >

        {/* Form card */}
        <div className="overflow-hidden rounded-2xl bg-white shadow-[0_2px_16px_-2px_rgba(0,0,121,0.09)]">

          {/* Type accent stripe — 3 px top bar in question-type colour */}
          <div className={cn('h-[3px] w-full',
            slide.type === 'mcq'       ? 'bg-sky-blue'    :
            slide.type === 'wordcloud' ? 'bg-fresh-green' :
            slide.type === 'openended' ? 'bg-golden-sun'  :
            'bg-hot-pink',
          )} />

          <div className="p-4">

            {/* Type chip */}
            <div className={cn(
              'mb-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold tracking-wide',
              slide.type === 'mcq'       ? 'bg-sky-blue/10 text-sky-blue'       :
              slide.type === 'wordcloud' ? 'bg-fresh-green/10 text-fresh-green' :
              slide.type === 'openended' ? 'bg-golden-sun/10 text-golden-sun'   :
              'bg-hot-pink/10 text-hot-pink',
            )}>
              {qInfo.icon}
              {qInfo.label}
            </div>

            {/* Question text */}
            <div className="mb-3">
              <label className="mb-1.5 block text-xs font-semibold text-midnight-sky-700">
                Question
              </label>
              <textarea
                value={slide.question}
                onChange={e => onUpdate({ question: e.target.value })}
                placeholder={PLACEHOLDERS[slide.type]}
                rows={2}
                style={{ fieldSizing: 'content' } as React.CSSProperties}
                className="w-full resize-none overflow-hidden rounded-xl border border-midnight-sky-150 bg-white px-4 py-3 text-base text-midnight-sky-900 placeholder:font-light placeholder:text-midnight-sky-400 outline-none transition-all focus:border-hot-pink focus:ring-2 focus:ring-hot-pink/10"
              />
            </div>

            {/* Type-specific fields */}
            {slide.type === 'mcq' && <MCQEditor slide={slide} onUpdate={onUpdate} onPushHistory={onPushHistory} />}
            {slide.type === 'rating' && <RatingEditor slide={slide} onUpdate={onUpdate} onPushHistory={onPushHistory} />}
            {slide.type === 'openended' && (
              <div className="mb-6 space-y-4">
                <div className="flex items-start gap-2.5 rounded-xl bg-midnight-sky-50 p-4">
                  <div className="mt-0.5 size-1.5 shrink-0 rounded-full bg-golden-sun" />
                  <p className="text-sm text-midnight-sky-500">
                    Audience members type a short answer. Responses stream in live on the big screen.
                  </p>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-midnight-sky-700">
                    Responses per person
                    <span className="ml-1.5 font-light text-midnight-sky-500">how many answers each person can submit</span>
                  </label>
                  <div className="flex gap-2">
                    {[1, 2, 3].map(n => (
                      <button
                        key={n}
                        onClick={() => onUpdate({ oeMaxSubmissions: n })}
                        className={cn(
                          'rounded-xl border px-4 py-2 text-sm transition-all',
                          (slide.oeMaxSubmissions ?? 1) === n
                            ? 'border-golden-sun bg-golden-sun/10 font-medium text-golden-sun'
                            : 'border-midnight-sky-200 text-midnight-sky-500 hover:border-midnight-sky-400 hover:text-midnight-sky-700',
                        )}
                      >
                        {n} {n === 1 ? 'response' : 'responses'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            {slide.type === 'wordcloud' && (
              <div className="space-y-4">
                <div className="flex items-start gap-2.5 rounded-xl bg-midnight-sky-50 p-4">
                  <div className="mt-0.5 size-1.5 shrink-0 rounded-full bg-fresh-green" />
                  <p className="text-sm text-midnight-sky-500">
                    Each person can submit up to <strong>{slide.wcMaxSubmissions ?? 3}</strong> words or short phrases (max 3 words each). Results appear as a live word cloud.
                  </p>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-midnight-sky-700">
                    Max submissions per person
                  </label>
                  <div className="flex gap-2">
                    {[1, 2, 3, 5, 8, 10].map(n => (
                      <button
                        key={n}
                        onClick={() => onUpdate({ wcMaxSubmissions: n })}
                        className={cn(
                          'rounded-lg px-3 py-1.5 text-sm font-semibold transition-all',
                          (slide.wcMaxSubmissions ?? 3) === n
                            ? 'bg-midnight-sky-900 text-white'
                            : 'bg-midnight-sky-100 text-midnight-sky-600 hover:bg-midnight-sky-200',
                        )}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Slide image + layout */}
            <div className="mt-3 border-t border-midnight-sky-100 pt-3">
              <label className="mb-2 block text-xs font-semibold text-midnight-sky-700">
                Slide image <span className="font-normal text-midnight-sky-500">(optional)</span>
              </label>
              <SlideImagePicker imgUrl={slide.imgUrl} onChange={url => onUpdate({ imgUrl: url, imgLayout: url ? (slide.imgLayout ?? 'reference') : undefined })} />
              {slide.imgUrl && (
                <div className="mt-3 flex items-center gap-1">
                  <span className="mr-1 text-[10px] font-medium text-midnight-sky-400">Display:</span>
                  {(['reference', 'background'] as const).map(opt => (
                    <button
                      key={opt}
                      onClick={() => onUpdate({ imgLayout: opt })}
                      className={cn(
                        'rounded-md px-2.5 py-1 text-[10px] font-medium transition-all',
                        // treat legacy 'top'/'right' as 'reference' for highlight purposes
                        (['reference', 'top', 'right'].includes(slide.imgLayout ?? 'reference') ? 'reference' : slide.imgLayout) === opt
                          ? 'bg-midnight-sky-900 text-white'
                          : 'bg-midnight-sky-100 text-midnight-sky-500 hover:bg-midnight-sky-200',
                      )}
                    >
                      {opt === 'reference' ? 'Reference' : 'Background'}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Slide background theme */}
            <div className="mt-3 border-t border-midnight-sky-100 pt-3">
              <label className="mb-2 block text-xs font-semibold text-midnight-sky-700">
                Slide background
                <span className="ml-1.5 font-normal text-midnight-sky-500">how it looks on screen</span>
              </label>
              <div className="flex flex-wrap gap-3">
                {CONTENT_THEMES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => onUpdate({ theme: t.id })}
                    className={cn(
                      'flex flex-col items-center gap-1 transition-all',
                      (slide.theme ?? 'navy') === t.id ? 'opacity-100' : 'opacity-60 hover:opacity-90',
                    )}
                  >
                    <span
                      className={cn('size-6 rounded-full ring-offset-1', (slide.theme ?? 'navy') === t.id ? 'ring-2 ring-midnight-sky-700' : '')}
                      style={t.id === 'transparent'
                        ? { backgroundImage: 'repeating-linear-gradient(45deg, #e0e0e0 0px, #e0e0e0 4px, white 4px, white 8px)', border: '1px solid #ccc' }
                        : { backgroundColor: t.swatch, border: t.id === 'white' ? '1px solid rgba(0,0,0,0.12)' : undefined }
                      }
                    />
                    <span className="text-[9px] font-medium text-midnight-sky-700">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Audience preview — only shown when not in two-column layout */}
        {!hidePreview && (
          <div className="mt-4">
            <p className="mb-2 px-1 text-[11px] font-semibold text-midnight-sky-600">
              Audience view
            </p>
            <div
              className="overflow-hidden rounded-2xl p-5 shadow-[0_8px_32px_-8px_rgba(0,0,121,0.25)] transition-colors duration-300"
              style={{ backgroundColor: contentColors(slide.theme ?? 'navy').bg }}
            >
              <SlidePreviewCard slide={slide} />
            </div>
          </div>
        )}

      </motion.div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   MCQ Editor — answer options A–F
   ───────────────────────────────────────────────────────────────────────── */

function MCQEditor({ slide, onUpdate, onPushHistory }: {
  slide: QuestionSlide
  onUpdate: (patch: Partial<QuestionSlide>) => void
  onPushHistory?: () => void
}) {
  const setOption = (i: number, val: string) => {
    const next = [...slide.options]
    next[i] = val
    onUpdate({ options: next })
  }
  const addOption = () => {
    if (slide.options.length >= 6) return
    onPushHistory?.()
    onUpdate({ options: [...slide.options, ''] })
  }
  const removeOption = (i: number) => {
    if (slide.options.length <= 2) return
    onPushHistory?.()
    onUpdate({ options: slide.options.filter((_, idx) => idx !== i) })
  }

  return (
    <div className="mb-4 space-y-2">
      <label className="mb-2 block text-xs font-semibold text-midnight-sky-700">
        Answer options
        <span className="ml-1 font-normal text-midnight-sky-600">({slide.options.length}/6)</span>
      </label>
      {slide.options.map((opt, i) => {
        const isCorrect = (slide.correctAnswers ?? []).includes(i)
        return (
          <div key={i} className="flex items-start gap-2">
            <span className={cn(
              'mt-2 flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold transition-colors',
              isCorrect ? 'bg-fresh-green/15 text-fresh-green' : 'bg-midnight-sky-200 text-midnight-sky-800',
            )}>
              {String.fromCharCode(65 + i)}
            </span>
            <textarea
              value={opt}
              rows={1}
              onChange={e => setOption(i, e.target.value)}
              placeholder={`Option ${String.fromCharCode(65 + i)}`}
              style={{ fieldSizing: 'content' } as React.CSSProperties}
              className="flex-1 resize-none overflow-hidden rounded-xl border border-midnight-sky-200 bg-white px-3 py-2 text-sm leading-snug text-midnight-sky-900 placeholder:text-midnight-sky-400 outline-none transition-all focus:border-hot-pink focus:ring-2 focus:ring-hot-pink/15"
            />
            {/* Correct-answer tick — always visible, turns solid green when marked */}
            <button
              onClick={() => {
                const cur = slide.correctAnswers ?? []
                onUpdate({ correctAnswers: isCorrect ? cur.filter(x => x !== i) : [...cur, i] })
              }}
              title={isCorrect ? 'Remove correct answer' : 'Mark as correct answer'}
              className={cn(
                'mt-1 rounded-lg border p-1.5 transition-all',
                isCorrect
                  ? 'border-fresh-green/40 bg-fresh-green/15 text-fresh-green'
                  : 'border-midnight-sky-300 bg-white text-midnight-sky-600 hover:border-fresh-green/60 hover:bg-fresh-green/10 hover:text-fresh-green',
              )}
            >
              <Check className="size-3.5" />
            </button>
            {slide.options.length > 2 && (
              <button
                onClick={() => removeOption(i)}
                title="Remove option"
                className="mt-1 rounded-lg p-1.5 text-midnight-sky-600 transition hover:bg-red-50 hover:text-red-500"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        )
      })}
      {(slide.correctAnswers ?? []).length > 0 && (
        <p className="mt-1 text-[11px] font-medium text-fresh-green">
          {(slide.correctAnswers!).map(i => String.fromCharCode(65 + i)).join(', ')} marked correct — press Reveal Answer on the results screen.
        </p>
      )}
      {slide.options.length < 6 && (
        <button
          onClick={addOption}
          className="mt-1 flex items-center gap-1.5 rounded-xl border border-dashed border-midnight-sky-200 px-3.5 py-2.5 text-sm text-midnight-sky-600 transition hover:border-hot-pink hover:text-hot-pink"
        >
          <Plus className="size-3.5" />
          Add option
        </button>
      )}

      {/* Results display type — bar, pie, or donut */}
      <div className="mt-5 border-t border-midnight-sky-100 pt-5">
        <label className="mb-2.5 block text-sm font-medium text-midnight-sky-700">
          Results display
          <span className="ml-1.5 font-light text-midnight-sky-500">how results appear on the big screen</span>
        </label>
        <div className="flex gap-2">
          {([
            { type: 'bar'   as const, label: 'Bar chart', icon: <BarChart2 className="size-3.5" /> },
            { type: 'pie'   as const, label: 'Pie chart',  icon: <PieChart  className="size-3.5" /> },
            { type: 'donut' as const, label: 'Donut',      icon: (
              <svg className="size-3.5" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="4" />
              </svg>
            )},
          ]).map(v => (
            <button
              key={v.type}
              onClick={() => onUpdate({ vizType: v.type })}
              className={cn(
                'flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition-all',
                (slide.vizType ?? 'bar') === v.type
                  ? 'border-sky-blue bg-sky-blue/10 font-medium text-sky-blue'
                  : 'border-midnight-sky-200 text-midnight-sky-500 hover:border-midnight-sky-400 hover:text-midnight-sky-700',
              )}
            >
              {v.icon}
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Timer — per-question time limit (also used for speed points in quiz mode) */}
      <div className="mt-5 border-t border-midnight-sky-100 pt-5">
        <label className="mb-2.5 flex items-center gap-1.5 text-sm font-medium text-midnight-sky-700">
          <Clock className="size-3.5" />
          Timer
          <span className="ml-0.5 font-light text-midnight-sky-500">response time limit</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {([undefined, 15, 30, 45, 60, 90] as (number | undefined)[]).map(t => (
            <button
              key={t ?? 'no-limit'}
              onClick={() => onUpdate({ timer: t })}
              className={cn(
                'rounded-xl border px-3 py-2 text-sm transition-all',
                (slide.timer ?? undefined) === t
                  ? 'border-golden-sun bg-golden-sun/10 font-medium text-golden-sun'
                  : 'border-midnight-sky-200 text-midnight-sky-500 hover:border-midnight-sky-400 hover:text-midnight-sky-700',
              )}
            >
              {t ? `${t}s` : 'No limit'}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Rating Editor — up to 5 named parameters
   ───────────────────────────────────────────────────────────────────────── */

function RatingEditor({ slide, onUpdate, onPushHistory }: {
  slide: QuestionSlide
  onUpdate: (patch: Partial<QuestionSlide>) => void
  onPushHistory?: () => void
}) {
  const params = slide.options.length > 0 ? slide.options : ['', '', '']
  const ratingMax = (slide.ratingMax === 10 ? 10 : 5) as 5 | 10
  // Per-parameter labels — fall back to old slide-wide labels for legacy decks
  const leftLabels  = slide.leftLabels  ?? params.map(() => slide.leftLabel  ?? '')
  const rightLabels = slide.rightLabels ?? params.map(() => slide.rightLabel ?? '')

  const setParam = (i: number, val: string) => {
    const next = [...params]
    next[i] = val
    onUpdate({ options: next })
  }
  const setLeft = (i: number, val: string) => {
    const next = [...leftLabels]
    while (next.length < params.length) next.push('')
    next[i] = val
    onUpdate({ leftLabels: next })
  }
  const setRight = (i: number, val: string) => {
    const next = [...rightLabels]
    while (next.length < params.length) next.push('')
    next[i] = val
    onUpdate({ rightLabels: next })
  }
  const addParam = () => {
    if (params.length >= 5) return
    onPushHistory?.()
    onUpdate({
      options:     [...params, ''],
      leftLabels:  [...leftLabels,  ''],
      rightLabels: [...rightLabels, ''],
    })
  }
  const removeParam = (i: number) => {
    if (params.length <= 1) return
    onPushHistory?.()
    onUpdate({
      options:     params.filter((_, idx) => idx !== i),
      leftLabels:  leftLabels.filter((_, idx) => idx !== i),
      rightLabels: rightLabels.filter((_, idx) => idx !== i),
    })
  }

  return (
    <div className="mb-6 space-y-3">
      {/* Scale toggle */}
      <div className="flex items-center justify-between rounded-xl border border-midnight-sky-100 bg-midnight-sky-50/50 px-3.5 py-2.5">
        <div>
          <p className="text-sm font-medium text-midnight-sky-700">Rating scale</p>
          <p className="text-[11px] font-light text-midnight-sky-500">
            How many stars audience can give per parameter
          </p>
        </div>
        <div className="flex overflow-hidden rounded-lg border border-midnight-sky-200 bg-white">
          {([5, 10] as const).map(n => (
            <button
              key={n}
              onClick={() => onUpdate({ ratingMax: n })}
              className={cn(
                'px-3 py-1.5 text-xs font-semibold transition-colors',
                ratingMax === n
                  ? 'bg-hot-pink text-white'
                  : 'text-midnight-sky-500 hover:bg-midnight-sky-100',
              )}
            >
              0–{n}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <label className="mb-1 block text-sm font-medium text-midnight-sky-700">
          What are they rating?
          <span className="ml-1 font-light text-midnight-sky-500">
            (1–5 parameters, each rated 0–{ratingMax} with its own scale labels)
          </span>
        </label>
        {params.map((p, i) => (
          <div key={i} className="rounded-2xl border border-midnight-sky-100 bg-midnight-sky-50/30 p-3">
            {/* Parameter name */}
            <div className="flex items-center gap-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-hot-pink/10 text-xs font-bold text-hot-pink">
                {i + 1}
              </span>
              <input
                value={p}
                onChange={e => setParam(i, e.target.value)}
                placeholder={`Parameter ${i + 1} (e.g. How are you feeling?)`}
                className="flex-1 rounded-xl border border-midnight-sky-200 bg-white px-3.5 py-2.5 text-sm font-medium text-midnight-sky-900 placeholder:text-midnight-sky-400 outline-none transition-all focus:border-hot-pink focus:ring-2 focus:ring-hot-pink/15"
              />
              {params.length > 1 && (
                <button
                  onClick={() => removeParam(i)}
                  className="rounded-lg p-1.5 text-midnight-sky-400 transition hover:bg-red-50 hover:text-red-400"
                  title="Remove parameter"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>

            {/* Per-parameter scale labels */}
            <div className="mt-2 grid grid-cols-2 gap-2 pl-9">
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-midnight-sky-600">
                  Left (at 0)
                </label>
                <input
                  value={leftLabels[i] ?? ''}
                  onChange={e => setLeft(i, e.target.value)}
                  placeholder="e.g. Very bad"
                  className="w-full rounded-lg border border-midnight-sky-200 bg-white px-2.5 py-1.5 text-xs text-midnight-sky-900 placeholder:text-midnight-sky-400 outline-none transition-all focus:border-hot-pink focus:ring-1 focus:ring-hot-pink/30"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-midnight-sky-600">
                  Right (at {ratingMax})
                </label>
                <input
                  value={rightLabels[i] ?? ''}
                  onChange={e => setRight(i, e.target.value)}
                  placeholder="e.g. Excellent"
                  className="w-full rounded-lg border border-midnight-sky-200 bg-white px-2.5 py-1.5 text-xs text-midnight-sky-900 placeholder:text-midnight-sky-400 outline-none transition-all focus:border-hot-pink focus:ring-1 focus:ring-hot-pink/30"
                />
              </div>
            </div>
          </div>
        ))}
        {params.length < 5 && (
          <button
            onClick={addParam}
            className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-midnight-sky-200 px-3.5 py-2.5 text-sm text-midnight-sky-600 transition hover:border-hot-pink hover:text-hot-pink"
          >
            <Plus className="size-3.5" />
            Add parameter
          </button>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Slide Preview Card — 16:9 slideshow-faithful preview inside the editor.
   Matches the actual presenter screen layout and colours exactly.
   ───────────────────────────────────────────────────────────────────────── */

function SlidePreviewCard({ slide }: { slide: QuestionSlide }) {
  const c      = contentColors(slide.theme ?? 'navy')
  const qtype  = QTYPES.find(q => q.type === slide.type)
  const layout = slide.imgLayout ?? 'reference'
  const hasRef = !!(slide.imgUrl && layout !== 'background')
  const hasBg  = !!(slide.imgUrl && layout === 'background')



  // MCQ options — styled like the actual presenter slide option cards
  const mcqOptions = slide.type === 'mcq' ? (
    <div className="mt-3 flex flex-col gap-1.5">
      {(slide.options.length > 0 ? slide.options : ['Option A', 'Option B', 'Option C']).map((opt, i) => (
        <div key={i} className="flex min-w-0 items-start gap-2 rounded-xl px-3 py-2"
          style={{ border: `1px solid ${c.cardBorder}`, backgroundColor: c.cardBg }}
        >
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md text-[9px] font-bold"
            style={{ backgroundColor: c.text, color: c.bg }}>
            {String.fromCharCode(65 + i)}
          </span>
          <span className="min-w-0 break-words text-xs font-medium leading-snug"
            style={{ color: opt ? c.text : c.textDim }}>
            {opt || `Option ${String.fromCharCode(65 + i)}`}
          </span>
        </div>
      ))}
    </div>
  ) : slide.type === 'wordcloud' ? (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {['culture', 'growth', 'trust', 'innovation', 'team'].map(w => (
        <span key={w} className="rounded-full px-2 py-0.5 text-[9px] font-medium"
          style={{ backgroundColor: c.cardBg, color: c.text }}>{w}</span>
      ))}
    </div>
  ) : slide.type === 'openended' ? (
    <div className="mt-3 rounded-xl px-3 py-2.5 text-xs"
      style={{ backgroundColor: c.cardBg, color: c.textDim }}>
      Type your answer here…
    </div>
  ) : slide.type === 'rating' ? (
    <div className="mt-3 flex flex-col gap-1.5">
      {(slide.options.length > 0 ? slide.options.slice(0, 3) : ['Parameter 1', 'Parameter 2']).map((p, i) => (
        <div key={i} className="rounded-xl px-3 py-2" style={{ backgroundColor: c.cardBg }}>
          <p className="mb-1 text-[9px] font-medium" style={{ color: c.textDim }}>{p || `Parameter ${i + 1}`}</p>
          <div className="flex gap-0.5">
            {Array.from({ length: slide.ratingMax === 10 ? 11 : 6 }, (_, v) => (
              <div key={v} className="flex-1 rounded py-0.5 text-center text-[7px] font-bold"
                style={{ border: `1px solid ${c.cardBorder}`, color: c.textDim }}>{v}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  ) : null

  const questionPanel = (
    <div className="flex flex-col overflow-hidden px-6 py-5">
      {/* Type badge */}
      <span className="mb-2.5 w-fit rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
        style={{ backgroundColor: c.text, color: c.bg }}>
        {qtype?.label ?? slide.type}
      </span>
      {/* Question text */}
      <p className="text-sm font-semibold leading-snug" style={{ color: c.text }}>
        {slide.question || <span style={{ opacity: 0.4 }}>Your question appears here…</span>}
      </p>
      {mcqOptions}
    </div>
  )

  const isTransparent = (slide.theme ?? 'navy') === 'transparent'

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl shadow-[0_8px_32px_-8px_rgba(0,0,0,0.35)]"
      style={{
        aspectRatio: '16/9',
        backgroundColor: c.bg,
        // Show a subtle checkerboard when transparent so the user can see "no background"
        ...(isTransparent ? { backgroundImage: 'repeating-linear-gradient(45deg, #f0f0f0 0px, #f0f0f0 6px, white 6px, white 12px)' } : {}),
      }}
    >
      {/* Background image layout */}
      {hasBg && slide.imgUrl && (
        <>
          {/* Blurred ambient fill — skip for transparent theme */}
          {!isTransparent && (
            <img src={slide.imgUrl} alt="" aria-hidden
              className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl opacity-25" />
          )}
          <img src={slide.imgUrl} alt=""
            className="absolute inset-0 h-full w-full object-cover" />
          {/* Colour overlay — skip for transparent theme so image shows unshaded */}
          {!isTransparent && (
            <div className="absolute inset-0" style={{ backgroundColor: `${c.bg}cc` }} />
          )}
        </>
      )}

      {/* Slide content */}
      <div className="relative flex h-full">
        {hasRef && slide.imgUrl ? (
          /* Reference image always in right panel.
             Portrait: object-contain (full image). Landscape: object-cover (no empty bars). */
          <>
            <div className="flex w-[48%] flex-col overflow-hidden">
              {questionPanel}
            </div>
            <div className="relative flex-1 overflow-hidden">
              {/* Full image — never cropped. Letterbox areas show slide background colour. */}
              <img src={slide.imgUrl} alt="Reference"
                className="absolute inset-0 h-full w-full object-contain px-3 py-2" />
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            {questionPanel}
          </div>
        )}
      </div>

      {/* Subtle branding watermark — same as presenter screen */}
      <div className="absolute bottom-2 right-3 select-none">
        <span className="text-[8px] font-bold tracking-tight" style={{ color: c.text, opacity: 0.3 }}>
          alaya <span style={{ color: c.accent }}>pulse</span>
        </span>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Content slide preview — scaled-down render used in the editor
   ───────────────────────────────────────────────────────────────────────── */

function ContentSlidePreview({ slide }: { slide: ContentSlide }) {
  const c       = contentColors(slide.theme)
  const bullets = slide.body.split('\n').filter(b => b.trim())
  const hasContent = !!(slide.title || slide.body || slide.attribution)

  // Mirror the slideshow's image layouts so the editor preview is faithful.
  const layout    = slide.imgLayout ?? 'reference'
  const hasBgImg  = !!(slide.imgUrl && layout === 'background')
  const hasRefImg = !!(slide.imgUrl && (layout === 'reference' || layout === 'right'))
  const hasTopImg = !!(slide.imgUrl && (layout === 'top' || (!slide.imgLayout && slide.imgUrl)))
  // Reserve the right ~42% for the reference image; text fills the left side.
  const padX = hasRefImg ? 'pl-8 pr-[44%]' : 'px-8'

  return (
    <div
      className="relative aspect-video w-full overflow-hidden rounded-xl"
      style={{
        backgroundColor: c.bg,
        ...(slide.theme === 'transparent' ? { backgroundImage: 'repeating-linear-gradient(45deg, #f0f0f0 0px, #f0f0f0 6px, white 6px, white 12px)' } : {}),
      }}
    >
      {/* Ambient glow for navy */}
      {slide.theme === 'navy' && (
        <div
          className="pointer-events-none absolute -bottom-20 -left-20 size-48 rounded-full blur-3xl opacity-35"
          style={{ backgroundColor: '#ff0065' }}
        />
      )}

      {/* Background image — full-bleed with colour wash */}
      {hasBgImg && (
        <>
          <img src={slide.imgUrl} alt="" className="absolute inset-0 z-0 h-full w-full object-cover" />
          {slide.theme !== 'transparent' && (
            <div className="absolute inset-0 z-0" style={{ backgroundColor: `${c.bg}cc` }} />
          )}
        </>
      )}

      {/* Reference image — right panel, object-contain (matches slideshow) */}
      {hasRefImg && (
        <div className="absolute right-0 top-0 z-20 h-full w-[42%] overflow-hidden">
          <img src={slide.imgUrl} alt="" className="absolute inset-0 h-full w-full object-contain object-right" />
        </div>
      )}

      {/* Top image — small floated corner thumbnail */}
      {hasTopImg && (
        <img src={slide.imgUrl} alt="" className="absolute right-2 top-2 z-20 h-12 max-w-[40%] rounded-lg object-cover shadow" />
      )}

      {!hasContent ? (
        <div className="flex h-full items-center justify-center">
          <p className="text-xs" style={{ color: c.textDim }}>Preview appears here…</p>
        </div>
      ) : slide.template === 'heading' ? (
        <div className={cn('relative z-10 flex h-full flex-col items-center justify-center text-center', padX)}>
          <p className="text-lg font-bold leading-tight line-clamp-3" style={{ color: c.text }}>
            {slide.title || <span style={{ opacity: 0.35 }}>Untitled</span>}
          </p>
          {slide.body && (
            <p className="mt-2 text-sm font-light line-clamp-3" style={{ color: c.textDim }}>
              {slide.body}
            </p>
          )}
        </div>
      ) : slide.template === 'bullets' ? (
        <div className={cn('relative z-10 flex h-full flex-col justify-center py-5', padX)}>
          {slide.title && (
            <p className="mb-2.5 text-sm font-bold line-clamp-1" style={{ color: c.text }}>{slide.title}</p>
          )}
          <ul className="space-y-1.5">
            {bullets.slice(0, 5).map((b, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ backgroundColor: c.accent }} />
                <span className="text-[11px] leading-snug line-clamp-2" style={{ color: c.text }}>{b}</span>
              </li>
            ))}
            {bullets.length > 5 && (
              <li className="text-[10px] pl-3.5" style={{ color: c.textDim }}>+{bullets.length - 5} more</li>
            )}
          </ul>
        </div>
      ) : (
        <div className={cn('relative z-10 flex h-full flex-col items-center justify-center text-center', padX)}>
          <div
            className="pointer-events-none absolute left-3 top-1 select-none font-serif text-5xl leading-none"
            style={{ color: c.quoteMark }}
            aria-hidden
          >
            &#8220;
          </div>
          {slide.title && (
            <p className="mb-2 text-[9px] font-bold uppercase tracking-widest" style={{ color: c.accent }}>
              {slide.title}
            </p>
          )}
          <p className="relative z-10 text-xs leading-relaxed line-clamp-4" style={{ color: c.text }}>
            {slide.body || <span style={{ opacity: 0.35 }}>Quote text…</span>}
          </p>
          {slide.attribution && (
            <p className="mt-1.5 text-[10px]" style={{ color: c.textDim }}>— {slide.attribution}</p>
          )}
        </div>
      )}

      {/* Watermark */}
      <div className="absolute bottom-2 right-2.5 z-30">
        <span className="text-[8px] font-bold tracking-tight" style={{ color: c.textDim, opacity: 0.45 }}>
          alaya <span style={{ color: c.accent }}>pulse</span>
        </span>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Content Editor — template fields + theme picker + live preview
   ───────────────────────────────────────────────────────────────────────── */

function ContentEditor({ slide, onUpdate, onPushHistory }: {
  slide: ContentSlide
  onUpdate: (patch: Partial<ContentSlide>) => void
  onPushHistory?: () => void
}) {
  const INPUT_CLASS = 'w-full rounded-xl border border-midnight-sky-150 bg-white px-4 py-3 text-sm text-midnight-sky-900 placeholder:font-light placeholder:text-midnight-sky-400 outline-none transition-all focus:border-hot-pink focus:ring-2 focus:ring-hot-pink/10'
  const TITLE_PLACEHOLDERS: Record<ContentTemplate, string> = {
    heading: 'e.g. Our Leadership Principles',
    bullets: 'e.g. Key Takeaways',
    quote:   'Section heading (optional)',
  }

  return (
    <div className="w-full">
      <motion.div
        key={slide.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Form card */}
        <div className="overflow-hidden rounded-2xl bg-white shadow-[0_2px_16px_-2px_rgba(0,0,121,0.09)]">
          <div className="h-[3px] w-full bg-midnight-sky-200" />

          <div className="p-6">

            {/* Slide image + layout */}
            <div className="mb-5">
              <label className="mb-2 block text-[11px] font-semibold text-midnight-sky-600">
                Slide image <span className="font-light">(optional)</span>
              </label>
              <SlideImagePicker imgUrl={slide.imgUrl} onChange={url => { onPushHistory?.(); onUpdate({ imgUrl: url, imgLayout: url ? (slide.imgLayout ?? 'reference') : undefined }) }} />
              {slide.imgUrl && (
                <div className="mt-3 flex items-center gap-1">
                  <span className="mr-1 text-[10px] font-medium text-midnight-sky-400">Display:</span>
                  {(['reference', 'background'] as const).map(opt => (
                    <button
                      key={opt}
                      onClick={() => { onPushHistory?.(); onUpdate({ imgLayout: opt }) }}
                      className={cn(
                        'rounded-md px-2.5 py-1 text-[10px] font-medium transition-all',
                        // treat legacy 'top'/'right' as 'reference' for highlight purposes
                        (['reference', 'top', 'right'].includes(slide.imgLayout ?? 'reference') ? 'reference' : slide.imgLayout) === opt
                          ? 'bg-midnight-sky-900 text-white'
                          : 'bg-midnight-sky-100 text-midnight-sky-500 hover:bg-midnight-sky-200',
                      )}
                    >
                      {opt === 'reference' ? 'Reference' : 'Background'}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Template picker */}
            <div className="mb-5">
              <label className="mb-2 block text-[11px] font-semibold text-midnight-sky-600">Template</label>
              <div className="flex gap-1.5">
                {CONTENT_TEMPLATES.map(t => (
                  <button
                    key={t.template}
                    onClick={() => { onPushHistory?.(); onUpdate({ template: t.template }) }}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all',
                      slide.template === t.template
                        ? 'bg-midnight-sky-900 text-white'
                        : 'bg-midnight-sky-100 text-midnight-sky-500 hover:bg-midnight-sky-200 hover:text-midnight-sky-800',
                    )}
                  >
                    {t.icon}
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Title / heading field */}
            <div className="mb-4">
              <label className="mb-1.5 block text-[11px] font-semibold text-midnight-sky-600">
                {slide.template === 'quote' ? 'Section heading' : 'Title'}
                {slide.template === 'quote' && <span className="ml-1 font-light">(optional)</span>}
              </label>
              <input
                value={slide.title}
                onChange={e => onUpdate({ title: e.target.value })}
                placeholder={TITLE_PLACEHOLDERS[slide.template]}
                className={INPUT_CLASS}
              />
            </div>

            {/* Heading: subtitle */}
            {slide.template === 'heading' && (
              <div className="mb-4">
                <label className="mb-1.5 block text-[11px] font-semibold text-midnight-sky-600">
                  Subtitle <span className="font-light">(optional)</span>
                </label>
                <input
                  value={slide.body}
                  onChange={e => onUpdate({ body: e.target.value })}
                  placeholder="e.g. A framework for lasting change"
                  className={INPUT_CLASS}
                />
              </div>
            )}

            {/* Bullets: body */}
            {slide.template === 'bullets' && (
              <div className="mb-4">
                <label className="mb-1.5 block text-[11px] font-semibold text-midnight-sky-600">
                  Bullet points <span className="font-light">(one per line)</span>
                </label>
                <textarea
                  value={slide.body}
                  onChange={e => onUpdate({ body: e.target.value })}
                  placeholder={'Listen first, speak second\nAsk better questions\nCelebrate small wins'}
                  rows={5}
                  className={cn(INPUT_CLASS, 'resize-none')}
                />
              </div>
            )}

            {/* Quote: body + attribution */}
            {slide.template === 'quote' && (
              <>
                <div className="mb-4">
                  <label className="mb-1.5 block text-[11px] font-semibold text-midnight-sky-600">Quote text</label>
                  <textarea
                    value={slide.body}
                    onChange={e => onUpdate({ body: e.target.value })}
                    placeholder="e.g. Leadership is not about being in charge. It's about taking care of those in your charge."
                    rows={4}
                    className={cn(INPUT_CLASS, 'resize-none text-base')}
                  />
                </div>
                <div className="mb-4">
                  <label className="mb-1.5 block text-[11px] font-semibold text-midnight-sky-600">
                    Attribution <span className="font-light">(optional)</span>
                  </label>
                  <input
                    value={slide.attribution}
                    onChange={e => onUpdate({ attribution: e.target.value })}
                    placeholder="e.g. Simon Sinek"
                    className={INPUT_CLASS}
                  />
                </div>
              </>
            )}

            {/* Theme picker */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold text-midnight-sky-600">Theme</label>
              <div className="flex flex-wrap gap-3">
                {CONTENT_THEMES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => onUpdate({ theme: t.id })}
                    className={cn(
                      'flex flex-col items-center gap-1 transition-all',
                      slide.theme === t.id ? 'opacity-100' : 'opacity-60 hover:opacity-90',
                    )}
                  >
                    <span
                      className={cn('size-6 rounded-full ring-offset-1', slide.theme === t.id ? 'ring-2 ring-midnight-sky-700' : '')}
                      style={t.id === 'transparent'
                        ? { backgroundImage: 'repeating-linear-gradient(45deg, #e0e0e0 0px, #e0e0e0 4px, white 4px, white 8px)', border: '1px solid #ccc' }
                        : { backgroundColor: t.swatch, border: t.id === 'white' ? '1px solid rgba(0,0,0,0.12)' : undefined }
                      }
                    />
                    <span className="text-[9px] font-medium text-midnight-sky-700">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Live preview */}
        <div className="mt-4">
          <p className="mb-2 px-1 text-[11px] font-semibold text-midnight-sky-600">Preview</p>
          <div className="overflow-hidden rounded-2xl shadow-[0_8px_32px_-8px_rgba(0,0,121,0.25)]">
            <ContentSlidePreview slide={slide} />
          </div>
        </div>
      </motion.div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Empty editor state — shown when no slide is selected
   ───────────────────────────────────────────────────────────────────────── */

function EmptyEditorState({ onImport, isImporting }: {
  onImport: (f: File) => void
  isImporting: boolean
}) {
  const [dragging, setDragging] = useState(false)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) onImport(file)
  }

  return (
    <div className="flex flex-1 items-center justify-center p-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'flex w-full max-w-lg flex-col items-center gap-6 rounded-3xl border-2 border-dashed p-14 text-center transition-all duration-200',
          dragging ? 'border-hot-pink bg-hot-pink/5' : 'border-midnight-sky-200 bg-midnight-sky-50',
        )}
      >
        {isImporting ? (
          <>
            <div className="flex size-14 items-center justify-center rounded-2xl bg-hot-pink/10">
              <LoadingDots color="pink" />
            </div>
            <p className="text-base font-medium text-midnight-sky-700">Importing slides…</p>
            <p className="text-sm font-light text-midnight-sky-500">This may take a moment for large PDFs</p>
          </>
        ) : dragging ? (
          <>
            <div className="flex size-14 items-center justify-center rounded-2xl bg-hot-pink/15">
              <Upload className="size-6 text-hot-pink" />
            </div>
            <p className="text-lg font-semibold text-hot-pink">Drop to import</p>
          </>
        ) : (
          <>
            <div className="flex size-14 items-center justify-center rounded-2xl bg-midnight-sky-100">
              <Upload className="size-6 text-midnight-sky-500" />
            </div>
            <div>
              <p className="text-lg font-semibold text-midnight-sky-900">Drop a file here</p>
              <p className="mt-1.5 text-sm font-light text-midnight-sky-500">
                PDF, image (PNG, JPG, GIF), or video (MP4, MOV, WebM). Export PowerPoint/Keynote as PDF for best results.
              </p>
            </div>
            <label className="cursor-pointer rounded-xl border border-midnight-sky-200 bg-white px-5 py-2.5 text-sm font-medium text-midnight-sky-700 transition hover:border-midnight-sky-400">
              Browse files
              <input
                type="file" accept=".pdf,.html,.htm,text/html,image/*,video/mp4,video/webm,video/quicktime" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = '' }}
              />
            </label>
            <p className="text-xs text-midnight-sky-400">
              Or add question slides directly from the panel on the left
            </p>
          </>
        )}
      </motion.div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Save Storage Modal — first-time save: choose browser or cloud
   ───────────────────────────────────────────────────────────────────────── */

function SaveStorageModal({ onBrowser, onCloud, onCancel, saving }: {
  onBrowser: () => void
  onCloud:   () => void
  onCancel:  () => void
  saving:    boolean
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-6"
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.94, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg rounded-3xl bg-white p-8 shadow-2xl"
      >
        <h3 className="mb-1.5 text-xl font-semibold text-midnight-sky-900">
          Where would you like to save?
        </h3>
        <p className="mb-6 text-sm font-light text-midnight-sky-500">
          Choose once — you can always change it later from My Decks.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            onClick={onBrowser}
            disabled={saving}
            className="group flex flex-col gap-3 rounded-2xl border-2 border-midnight-sky-200 p-5 text-left transition-all hover:border-midnight-sky-400 hover:bg-midnight-sky-50 disabled:opacity-60"
          >
            <Monitor className="size-6 text-midnight-sky-500" />
            <div>
              <p className="font-semibold text-midnight-sky-900">This browser</p>
              <p className="mt-0.5 text-xs font-light text-midnight-sky-500">No login · instant · this device only</p>
            </div>
          </button>

          <button
            onClick={onCloud}
            disabled={saving}
            className="group flex flex-col gap-3 rounded-2xl border-2 border-hot-pink/25 bg-hot-pink/[0.03] p-5 text-left transition-all hover:border-hot-pink/50 hover:bg-hot-pink/5 disabled:opacity-60"
          >
            {saving ? <LoadingDots color="pink" /> : <Cloud className="size-6 text-hot-pink" />}
            <div>
              <p className="font-semibold text-midnight-sky-900">Google account</p>
              <p className="mt-0.5 text-xs font-light text-midnight-sky-500">Sign in · any device · any browser</p>
              <p className="mt-1.5 text-[10px] font-light text-midnight-sky-400">PDF slide images are kept on this device only</p>
            </div>
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Canvas Editor — free-form drag/resize canvas slide
   ───────────────────────────────────────────────────────────────────────── */

/* ── Layout picker modal — shown when "Custom Slide" is clicked ─────────── */

function CanvasLayoutPicker({ onSelect, onCancel }: {
  onSelect: (layout: CanvasLayout) => void
  onCancel: () => void
}) {
  const layouts: { id: CanvasLayout; label: string; preview: React.ReactNode }[] = [
    {
      id: 'blank',
      label: 'Blank',
      preview: (
        <div style={{ width: '100%', height: '100%', borderRadius: 6, background: 'rgba(255,255,255,0.07)' }} />
      ),
    },
    {
      id: 'title-only',
      label: 'Title only',
      preview: (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: '75%', height: '28%', borderRadius: 4, background: 'rgba(255,255,255,0.40)' }} />
        </div>
      ),
    },
    {
      id: 'title-body',
      label: 'Title + Body',
      preview: (
        <div style={{ width: '100%', height: '100%', padding: 8, display: 'flex', flexDirection: 'column', gap: 5, boxSizing: 'border-box' }}>
          <div style={{ width: '85%', height: '20%', borderRadius: 4, background: 'rgba(255,255,255,0.45)', flexShrink: 0 }} />
          <div style={{ flex: 1, borderRadius: 4, background: 'rgba(255,255,255,0.18)' }} />
        </div>
      ),
    },
    {
      id: 'two-columns',
      label: 'Two columns',
      preview: (
        <div style={{ width: '100%', height: '100%', padding: 8, display: 'flex', flexDirection: 'column', gap: 5, boxSizing: 'border-box' }}>
          <div style={{ width: '100%', height: '18%', borderRadius: 4, background: 'rgba(255,255,255,0.45)', flexShrink: 0 }} />
          <div style={{ flex: 1, display: 'flex', gap: 5 }}>
            <div style={{ flex: 1, borderRadius: 4, background: 'rgba(255,255,255,0.18)' }} />
            <div style={{ flex: 1, borderRadius: 4, background: 'rgba(255,255,255,0.18)' }} />
          </div>
        </div>
      ),
    },
  ]

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm px-6"
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.94, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.94, opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg rounded-3xl border border-white/10 bg-midnight-sky-900 p-7 shadow-2xl"
      >
        <h3 className="mb-1 text-lg font-semibold text-white">Choose a layout</h3>
        <p className="mb-5 text-sm font-light text-white/45">You can add, move and resize everything after.</p>
        <div className="grid grid-cols-2 gap-3">
          {layouts.map(l => (
            <button
              key={l.id}
              onClick={() => onSelect(l.id)}
              className="group flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 text-left transition-all hover:border-sky-blue/50 hover:bg-white/10 active:scale-[0.98]"
            >
              <div
                style={{ aspectRatio: '16/9', background: '#000079', borderRadius: 8, overflow: 'hidden', width: '100%' }}
              >
                {l.preview}
              </div>
              <span className="text-xs font-medium text-white/65 transition-colors group-hover:text-white">{l.label}</span>
            </button>
          ))}
        </div>
        <button
          onClick={onCancel}
          className="mt-5 w-full rounded-xl border border-white/10 bg-white/5 py-2 text-sm text-white/50 transition hover:bg-white/10 hover:text-white/80"
        >
          Cancel
        </button>
      </motion.div>
    </motion.div>
  )
}

/* ── Background panel ──────────────────────────────────────────────────── */

function BgPanel({ bg, onChange }: { bg: CanvasBg; onChange: (bg: CanvasBg) => void }) {
  const bgImgRef = useRef<HTMLInputElement>(null)
  return (
    <div className="mb-2 flex flex-wrap items-start gap-x-5 gap-y-3 rounded-xl border border-midnight-sky-150 bg-white px-4 py-3 shadow-sm">
      {/* Solid colours */}
      <div className="flex flex-col gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-midnight-sky-700">Solid</p>
        <div className="flex gap-2.5">
          {CANVAS_BG_COLORS.map(c => (
            <button
              key={c.value}
              onClick={() => onChange({ type: 'color', value: c.value })}
              className={cn('flex flex-col items-center gap-1 transition-all', bg.type === 'color' && bg.value === c.value ? 'opacity-100' : 'opacity-65 hover:opacity-100')}
            >
              <span
                className={cn('size-6 rounded-full ring-offset-1', bg.type === 'color' && bg.value === c.value ? 'ring-2 ring-midnight-sky-700' : '')}
                style={{ backgroundColor: c.value, border: c.value === '#f4f4f9' ? '1px solid #d0d0e0' : undefined }}
              />
              <span className="text-[9px] font-medium text-midnight-sky-700">{c.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="self-stretch w-px bg-midnight-sky-100" />

      {/* Gradients */}
      <div className="flex flex-col gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-midnight-sky-700">Gradient</p>
        <div className="flex flex-wrap gap-2">
          {CANVAS_BG_GRADIENTS.map(g => (
            <button
              key={g.value}
              onClick={() => onChange({ type: 'gradient', value: g.value })}
              className={cn(
                'h-7 w-14 rounded-lg text-[9px] font-semibold text-white transition-all hover:scale-105',
                bg.type === 'gradient' && bg.value === g.value ? 'ring-2 ring-midnight-sky-700 ring-offset-1' : 'opacity-75',
              )}
              style={{ background: g.value }}
            >{g.label}</button>
          ))}
        </div>
      </div>

      <div className="self-stretch w-px bg-midnight-sky-100" />

      {/* Image */}
      <div className="flex flex-col gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-midnight-sky-700">Image</p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => bgImgRef.current?.click()}
            className={cn(
              'flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-all',
              bg.type === 'image' ? 'border-sky-blue bg-sky-blue/10 text-sky-blue' : 'border-midnight-sky-200 text-midnight-sky-700 hover:border-midnight-sky-400',
            )}
          >
            <ImageIcon className="size-3" />
            {bg.type === 'image' ? 'Change' : 'Upload'}
          </button>
          {bg.type === 'image' && (
            <button onClick={() => onChange({ type: 'color', value: '#000079' })} className="text-xs text-red-500 hover:text-red-700 transition">
              Remove
            </button>
          )}
        </div>
      </div>

      <input
        ref={bgImgRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const f = e.target.files?.[0]
          if (!f) return
          fileToImageDataUrl(f).then(url => onChange({ type: 'image', value: url })).catch(console.error)
          e.target.value = ''
        }}
      />
    </div>
  )
}

/* ── Table config panel ────────────────────────────────────────────────── */

function TableConfigPanel({ onAdd, onCancel }: { onAdd: (rows: number, cols: number) => void; onCancel: () => void }) {
  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(3)

  const Step = ({ val, min, max, onChange }: { val: number; min: number; max: number; onChange: (n: number) => void }) => (
    <div className="flex items-center gap-1.5">
      <button onClick={() => onChange(Math.max(min, val - 1))} className="flex size-6 items-center justify-center rounded-lg border border-midnight-sky-200 text-midnight-sky-700 transition hover:bg-midnight-sky-50 text-sm">−</button>
      <span className="w-5 text-center text-sm font-semibold text-midnight-sky-900">{val}</span>
      <button onClick={() => onChange(Math.min(max, val + 1))} className="flex size-6 items-center justify-center rounded-lg border border-midnight-sky-200 text-midnight-sky-700 transition hover:bg-midnight-sky-50 text-sm">+</button>
    </div>
  )

  return (
    <div className="mb-2 flex flex-wrap items-center gap-4 rounded-xl border border-midnight-sky-150 bg-white px-4 py-3 shadow-sm">
      <span className="text-xs font-semibold text-midnight-sky-800">Table size</span>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-midnight-sky-700">Rows</span>
        <Step val={rows} min={1} max={12} onChange={setRows} />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-midnight-sky-700">Columns</span>
        <Step val={cols} min={1} max={8} onChange={setCols} />
      </div>
      <div className="ml-auto flex gap-2">
        <button onClick={onCancel} className="rounded-xl border border-midnight-sky-200 px-3 py-1.5 text-xs font-medium text-midnight-sky-700 transition hover:bg-midnight-sky-50">Cancel</button>
        <button onClick={() => onAdd(rows, cols)} className="rounded-xl bg-hot-pink px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-hot-pink/90">Insert</button>
      </div>
    </div>
  )
}

/* ── Text formatting toolbar ───────────────────────────────────────────── */

const TEXT_COLORS_CANVAS = [
  '#ffffff', '#0a0a14', '#000079', '#ff0065', '#00b0ff', '#42db66', '#ffc709',
]
const FONT_SIZES_CANVAS = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 80]

function TextFormatBar({ el, onUpdate }: { el: CanvasTextEl; onUpdate: (p: Partial<CanvasTextEl>) => void }) {
  function cmd(command: string, value?: string) {
    document.execCommand(command, false, value ?? undefined)
  }

  // queryCommandState('superscript') is unreliable in Chrome — it returns false
  // even when the cursor is inside a <sup>. We use a DOM walk instead.
  function findAncestorTag(tagName: string): Element | null {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return null
    let n: Node | null = sel.getRangeAt(0).commonAncestorContainer
    if (n.nodeType === Node.TEXT_NODE) n = n.parentNode
    while (n) {
      if (n.nodeType === Node.ELEMENT_NODE) {
        if ((n as Element).tagName.toLowerCase() === tagName) return n as Element
        if ((n as Element).hasAttribute('contenteditable')) break
      }
      n = n.parentNode
    }
    return null
  }

  function unwrapTag(el: Element) {
    const parent = el.parentNode!
    // Move all children out before the tag, then remove the now-empty tag
    Array.from(el.childNodes).forEach(child => parent.insertBefore(child, el))
    parent.removeChild(el)
  }

  function toggleSupSub(type: 'superscript' | 'subscript') {
    const tag      = type === 'superscript' ? 'sup' : 'sub'
    const otherTag = type === 'superscript' ? 'sub' : 'sup'
    const otherCmd = type === 'superscript' ? 'subscript' : 'superscript'

    const targetEl = findAncestorTag(tag)
    if (targetEl) {
      // Already in this tag — manually unwrap it (execCommand toggle is unreliable in Chrome)
      unwrapTag(targetEl)
      return
    }
    // Remove the opposite if active
    const otherEl = findAncestorTag(otherTag)
    if (otherEl) {
      unwrapTag(otherEl)
      // Re-select so execCommand below has something to act on
      document.execCommand(otherCmd, false, undefined) // no-op but keeps undo stack consistent
    }
    document.execCommand(type, false, undefined)
  }

  const FmtBtn = ({ onClick, children, title }: { onClick: () => void; children: React.ReactNode; title?: string }) => (
    <button
      title={title}
      onMouseDown={e => { e.preventDefault(); onClick() }}
      className="flex min-w-[28px] items-center justify-center rounded px-1.5 py-1 text-sm text-midnight-sky-700 transition hover:bg-midnight-sky-100 active:bg-midnight-sky-200"
    >
      {children}
    </button>
  )

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1 rounded-xl border border-midnight-sky-150 bg-midnight-sky-50 px-2.5 py-2">
      {/* Font size */}
      <select
        value={el.fontSize}
        onChange={e => onUpdate({ fontSize: Number(e.target.value) })}
        className="h-7 rounded-lg border border-midnight-sky-200 bg-white px-1.5 text-xs text-midnight-sky-700 outline-none focus:border-hot-pink"
      >
        {FONT_SIZES_CANVAS.map(s => <option key={s} value={s}>{s}px</option>)}
      </select>

      <span className="mx-0.5 h-5 w-px bg-midnight-sky-200" />

      <FmtBtn onClick={() => cmd('bold')} title="Bold"><strong>B</strong></FmtBtn>
      <FmtBtn onClick={() => cmd('italic')} title="Italic"><em>I</em></FmtBtn>
      <FmtBtn onClick={() => cmd('underline')} title="Underline"><span className="underline">U</span></FmtBtn>
      <FmtBtn onClick={() => cmd('strikethrough')} title="Strikethrough"><span className="line-through">S</span></FmtBtn>

      <span className="mx-0.5 h-5 w-px bg-midnight-sky-200" />

      <FmtBtn onClick={() => toggleSupSub('superscript')} title="Superscript (click again to remove)">
        <span className="text-xs leading-none">x<sup className="text-[8px]">2</sup></span>
      </FmtBtn>
      <FmtBtn onClick={() => toggleSupSub('subscript')} title="Subscript (click again to remove)">
        <span className="text-xs leading-none">x<sub className="text-[8px]">2</sub></span>
      </FmtBtn>

      <span className="mx-0.5 h-5 w-px bg-midnight-sky-200" />

      <FmtBtn onClick={() => onUpdate({ align: 'left' })} title="Align left">
        <AlignLeft className={cn('size-3.5', el.align === 'left' && 'text-hot-pink')} />
      </FmtBtn>
      <FmtBtn onClick={() => onUpdate({ align: 'center' })} title="Align centre">
        <AlignCenter className={cn('size-3.5', el.align === 'center' && 'text-hot-pink')} />
      </FmtBtn>
      <FmtBtn onClick={() => onUpdate({ align: 'right' })} title="Align right">
        <AlignRight className={cn('size-3.5', el.align === 'right' && 'text-hot-pink')} />
      </FmtBtn>

      <span className="mx-0.5 h-5 w-px bg-midnight-sky-200" />

      {/* Text colour swatches */}
      <div className="flex items-center gap-1">
        {TEXT_COLORS_CANVAS.map(c => (
          <button
            key={c}
            title={c}
            onMouseDown={e => { e.preventDefault(); onUpdate({ color: c }) }}
            className="size-5 rounded-full transition hover:scale-110"
            style={{
              backgroundColor: c,
              outline: el.color === c ? '2px solid #000079' : '1px solid rgba(0,0,0,0.15)',
              outlineOffset: el.color === c ? 2 : 0,
            }}
          />
        ))}
      </div>
    </div>
  )
}

/* ── Individual table cell ─────────────────────────────────────────────── */

function TableCell({ value, isEditable, isHeader, cellColor, borderColor, borderStyle, onChange, onTabNext, onTabPrev, autoFocus, onFocus }: {
  value:        string
  isEditable:   boolean
  isHeader:     boolean
  cellColor?:   string | null
  borderColor?: string
  borderStyle?: 'solid' | 'dashed' | 'none'
  onChange:     (v: string) => void
  onTabNext:    () => void
  onTabPrev:    () => void
  autoFocus?:   boolean
  onFocus?:     () => void
}) {
  const ref = useRef<HTMLTableCellElement>(null)

  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) {
      ref.current.innerText = value
    }
  }, [value, isEditable])

  // Focus this cell when autoFocus is set (Tab navigation) — skip if already focused
  useEffect(() => {
    if (autoFocus && isEditable && ref.current && document.activeElement !== ref.current) {
      ref.current.focus()
      const range = document.createRange()
      range.selectNodeContents(ref.current)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
  }, [autoFocus, isEditable])

  const borderStr = borderStyle === 'none'
    ? 'none'
    : `1px ${borderStyle ?? 'solid'} ${borderColor ?? 'rgba(255,255,255,0.25)'}`
  const bgColor = (cellColor != null)
    ? cellColor
    : (isHeader ? 'rgba(0,0,121,0.55)' : 'rgba(255,255,255,0.04)')

  return (
    <td
      ref={ref}
      contentEditable={isEditable || undefined}
      suppressContentEditableWarning
      onFocus={onFocus}
      onBlur={e => onChange(e.currentTarget.innerText)}
      onKeyDown={e => {
        if (!isEditable) return
        if (e.key === 'Tab') {
          e.preventDefault()
          onChange(ref.current?.innerText ?? '')
          if (e.shiftKey) onTabPrev(); else onTabNext()
        }
      }}
      style={{
        border: borderStr,
        padding: '6px 10px',
        fontSize: 13,
        color: '#ffffff',
        backgroundColor: bgColor,
        fontWeight: isHeader ? 600 : 400,
        outline: 'none',
        verticalAlign: 'middle',
        overflow: 'hidden',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        cursor: isEditable ? 'text' : 'default',
        transition: 'background 0.15s',
      }}
    />
  )
}

/* ── Canvas text element view ──────────────────────────────────────────── */

function CanvasTextView({ el, isEditing, onUpdate }: {
  el:        CanvasTextEl
  isEditing: boolean
  onUpdate:  (p: Partial<CanvasTextEl>) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Only rewrite DOM when the element is first mounted, not on every keystroke
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) {
      ref.current.innerHTML = el.html
    }
  }, [el.id])

  // Auto-focus when entering edit mode
  useEffect(() => {
    if (isEditing && ref.current) {
      ref.current.focus()
      // Place cursor at end
      const range = document.createRange()
      range.selectNodeContents(ref.current)
      range.collapse(false)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
  }, [isEditing])

  return (
    <div
      ref={ref}
      contentEditable={isEditing || undefined}
      suppressContentEditableWarning
      onBlur={e => onUpdate({ html: e.currentTarget.innerHTML })}
      style={{
        width: '100%',
        height: '100%',
        fontSize: `${el.fontSize}px`,
        textAlign: el.align,
        color: el.color,
        padding: '6px 8px',
        outline: 'none',
        overflow: 'hidden',
        lineHeight: 1.4,
        wordBreak: 'break-word',
        // Crosshair when just selected (ready to move), text cursor when editing
        cursor: isEditing ? 'text' : 'default',
        userSelect: isEditing ? 'text' : 'none',
        boxSizing: 'border-box',
      }}
    />
  )
}

/* ── Canvas table element view ─────────────────────────────────────────── */

const TABLE_CELL_COLORS  = ['#000079','#ff0065','#00b0ff','#42db66','#ffc709','rgba(255,255,255,0.15)','rgba(0,0,0,0.4)'] as const
const TABLE_BORDER_COLORS = ['rgba(255,255,255,0.25)','#ffffff','#00b0ff','#ff0065','rgba(0,0,0,0.6)','transparent'] as const

function CanvasTableView({ el, isSelected, onUpdate }: {
  el:         CanvasTableEl
  isSelected: boolean
  onUpdate:   (p: Partial<CanvasTableEl>) => void
}) {
  const [focusedCell, setFocusedCell] = useState<[number, number] | null>(null)

  useEffect(() => { if (!isSelected) setFocusedCell(null) }, [isSelected])

  // All cell access uses flat indexing: cells[ri * cols + ci]
  function flatIdx(ri: number, ci: number) { return ri * el.cols + ci }

  function updateCell(r: number, c: number, text: string) {
    const cells = [...el.cells]; cells[flatIdx(r, c)] = text; onUpdate({ cells })
  }

  function setCellColor(ri: number, ci: number, color: string | null) {
    const size = el.rows * el.cols
    const colors: (string | null)[] = el.cellColors ? [...el.cellColors] : Array<string | null>(size).fill(null)
    while (colors.length < size) colors.push(null)
    colors[flatIdx(ri, ci)] = color
    onUpdate({ cellColors: colors })
  }

  function addRow() {
    onUpdate({
      cells:      [...el.cells, ...Array<string>(el.cols).fill('')],
      rows:       el.rows + 1,
      cellColors: el.cellColors ? [...el.cellColors, ...Array<string | null>(el.cols).fill(null)] : undefined,
    })
  }
  function removeRow() {
    if (el.rows <= 1) return
    onUpdate({
      cells:      el.cells.slice(0, -el.cols),
      rows:       el.rows - 1,
      cellColors: el.cellColors ? el.cellColors.slice(0, -el.cols) : undefined,
    })
  }
  function addCol() {
    const nc: string[]           = []
    const ncc: (string|null)[] | undefined = el.cellColors ? [] : undefined
    for (let ri = 0; ri < el.rows; ri++) {
      for (let ci = 0; ci < el.cols; ci++) { nc.push(el.cells[flatIdx(ri,ci)] ?? ''); ncc?.push(el.cellColors?.[flatIdx(ri,ci)] ?? null) }
      nc.push(''); ncc?.push(null)
    }
    onUpdate({ cells: nc, cols: el.cols + 1, cellColors: ncc })
  }
  function removeCol() {
    if (el.cols <= 1) return
    const nc: string[]           = []
    const ncc: (string|null)[] | undefined = el.cellColors ? [] : undefined
    for (let ri = 0; ri < el.rows; ri++) {
      for (let ci = 0; ci < el.cols - 1; ci++) { nc.push(el.cells[flatIdx(ri,ci)] ?? ''); ncc?.push(el.cellColors?.[flatIdx(ri,ci)] ?? null) }
    }
    onUpdate({ cells: nc, cols: el.cols - 1, cellColors: ncc })
  }

  const totalCells = el.rows * el.cols
  function tabNext(ri: number, ci: number) { const n=(flatIdx(ri,ci)+1)%totalCells; setFocusedCell([Math.floor(n/el.cols),n%el.cols]) }
  function tabPrev(ri: number, ci: number) { const p=(flatIdx(ri,ci)-1+totalCells)%totalCells; setFocusedCell([Math.floor(p/el.cols),p%el.cols]) }

  const fc = focusedCell
  const activeBorderColor = el.borderColor ?? 'rgba(255,255,255,0.25)'
  const activeCellColor   = fc != null ? (el.cellColors?.[flatIdx(fc[0],fc[1])] ?? null) : null

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {isSelected && (
        <div
          onPointerDown={e => e.stopPropagation()}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 3, padding: '3px 5px', background: 'rgba(0,0,0,0.7)', flexShrink: 0, alignItems: 'center' }}
        >
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', fontWeight: 600, display: 'flex', alignItems: 'center', paddingRight: 3 }}>ROWS</span>
          <CtrlBtn onClick={addRow}    title="Add row"><Plus  className="size-2.5" /></CtrlBtn>
          <CtrlBtn onClick={removeRow} title="Remove last row"    disabled={el.rows <= 1}><Minus className="size-2.5" /></CtrlBtn>
          <span style={{ width: 1, background: 'rgba(255,255,255,0.15)', alignSelf: 'stretch', margin: '0 2px' }} />
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', fontWeight: 600, display: 'flex', alignItems: 'center', paddingRight: 3 }}>COLS</span>
          <CtrlBtn onClick={addCol}    title="Add column"><Plus  className="size-2.5" /></CtrlBtn>
          <CtrlBtn onClick={removeCol} title="Remove last column" disabled={el.cols <= 1}><Minus className="size-2.5" /></CtrlBtn>
          <span style={{ width: 1, background: 'rgba(255,255,255,0.15)', alignSelf: 'stretch', margin: '0 2px' }} />
          <CtrlBtn onClick={() => onUpdate({ hasHeader: !el.hasHeader })} title={el.hasHeader ? 'Remove header row' : 'Add header row'} active={el.hasHeader}>
            <span style={{ fontSize: 8, fontWeight: 700 }}>H</span>
          </CtrlBtn>
          <div style={{ width: '100%', height: 0 }} />
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', fontWeight: 600, display: 'flex', alignItems: 'center', paddingRight: 3 }}>BORDER</span>
          {(['solid','dashed','none'] as const).map(s => (
            <CtrlBtn key={s} onClick={() => onUpdate({ borderStyle: s })} title={`Border: ${s}`} active={(el.borderStyle ?? 'solid') === s}>
              <span style={{ fontSize: 8, fontWeight: 700 }}>{s === 'solid' ? '—' : s === 'dashed' ? '╌' : '✕'}</span>
            </CtrlBtn>
          ))}
          <span style={{ width: 1, background: 'rgba(255,255,255,0.15)', alignSelf: 'stretch', margin: '0 2px' }} />
          {TABLE_BORDER_COLORS.map(c => (
            <button key={c} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onUpdate({ borderColor: c }) }} title="Border colour"
              style={{ width: 13, height: 13, borderRadius: 2, padding: 0, cursor: 'pointer', flexShrink: 0,
                background: c === 'transparent' ? 'repeating-linear-gradient(45deg,#888 0,#888 1px,transparent 0,transparent 50%) 0/4px 4px' : c,
                outline: activeBorderColor === c ? '2px solid #fff' : '1px solid rgba(255,255,255,0.25)', outlineOffset: activeBorderColor === c ? 1 : 0 }} />
          ))}
          {fc && (<>
            <span style={{ width: 1, background: 'rgba(255,255,255,0.15)', alignSelf: 'stretch', margin: '0 2px' }} />
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', fontWeight: 600, display: 'flex', alignItems: 'center', paddingRight: 3 }}>CELL</span>
            <CtrlBtn onClick={() => setCellColor(fc[0], fc[1], null)} title="Clear cell fill" active={activeCellColor === null}><X className="size-2.5" /></CtrlBtn>
            {TABLE_CELL_COLORS.map(c => (
              <button key={c} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setCellColor(fc[0], fc[1], c) }} title="Cell fill colour"
                style={{ width: 13, height: 13, borderRadius: 2, padding: 0, cursor: 'pointer', flexShrink: 0, background: c,
                  outline: activeCellColor === c ? '2px solid #fff' : '1px solid rgba(255,255,255,0.25)', outlineOffset: activeCellColor === c ? 1 : 0 }} />
            ))}
          </>)}
        </div>
      )}
      <table style={{ width: '100%', flex: 1, borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <tbody>
          {Array.from({ length: el.rows }, (_, ri) => (
            <tr key={ri}>
              {Array.from({ length: el.cols }, (_, ci) => (
                <TableCell
                  key={`${ri}-${ci}`}
                  value={el.cells[flatIdx(ri, ci)] ?? ''}
                  isEditable={isSelected}
                  isHeader={el.hasHeader && ri === 0}
                  cellColor={el.cellColors?.[flatIdx(ri, ci)] ?? null}
                  borderColor={el.borderColor}
                  borderStyle={el.borderStyle}
                  autoFocus={isSelected && !!focusedCell && focusedCell[0] === ri && focusedCell[1] === ci}
                  onFocus={() => setFocusedCell([ri, ci])}
                  onChange={text => updateCell(ri, ci, text)}
                  onTabNext={() => tabNext(ri, ci)}
                  onTabPrev={() => tabPrev(ri, ci)}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* Tiny control button used in the table toolbar */
function CtrlBtn({ onClick, title, disabled, active, children }: {
  onClick:   () => void
  title?:    string
  disabled?: boolean
  active?:   boolean
  children:  React.ReactNode
}) {
  return (
    <button
      onPointerDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onClick() }}
      disabled={disabled}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 18, height: 18, borderRadius: 3, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        background: active ? 'rgba(0,176,255,0.5)' : 'rgba(255,255,255,0.15)',
        color: disabled ? 'rgba(255,255,255,0.25)' : 'white',
        padding: 0, flexShrink: 0,
      }}
    >
      {children}
    </button>
  )
}

/* ── Single positioned element (drag + resize wrapper) ─────────────────── */

const RESIZE_HANDLES: { id: ResizeHandle; style: React.CSSProperties }[] = [
  { id: 'nw', style: { top: -5,  left: -5,                            cursor: 'nw-resize' } },
  { id: 'n',  style: { top: -5,  left: 'calc(50% - 5px)',             cursor: 'n-resize'  } },
  { id: 'ne', style: { top: -5,  right: -5,                           cursor: 'ne-resize' } },
  { id: 'e',  style: { top: 'calc(50% - 5px)', right: -5,             cursor: 'e-resize'  } },
  { id: 'se', style: { bottom: -5, right: -5,                         cursor: 'se-resize' } },
  { id: 's',  style: { bottom: -5, left: 'calc(50% - 5px)',           cursor: 's-resize'  } },
  { id: 'sw', style: { bottom: -5, left: -5,                          cursor: 'sw-resize' } },
  { id: 'w',  style: { top: 'calc(50% - 5px)', left: -5,              cursor: 'w-resize'  } },
]

function CanvasElView({ el, isSelected, isEditing, onSelect, onDoubleClick, onMoveStart, onResizeStart, onUpdate, onDelete, onDuplicate }: {
  el:            CanvasEl
  isSelected:    boolean
  isEditing:     boolean
  onSelect:      (e: React.MouseEvent) => void
  onDoubleClick: () => void
  onMoveStart:   (e: React.PointerEvent) => void
  onResizeStart: (e: React.PointerEvent, handle: ResizeHandle) => void
  onUpdate:      (p: Partial<CanvasEl>) => void
  onDelete:      () => void
  onDuplicate:   () => void
}) {
  // Border: blue when selected, green when actively editing text
  const borderColor = isEditing ? '#42db66' : '#00b0ff'

  return (
    <div
      onClick={onSelect}
      onDoubleClick={e => { e.stopPropagation(); onDoubleClick() }}
      style={{
        position: 'absolute',
        left: `${el.x}%`,
        top: `${el.y}%`,
        width: `${el.w}%`,
        height: `${el.h}%`,
        boxSizing: 'border-box',
        border: isSelected ? `2px solid ${borderColor}` : '1px dashed rgba(255,255,255,0.0)',
        borderRadius: 4,
        overflow: 'visible',
      }}
    >
      {/* Drag handle bar — appears when selected */}
      {isSelected && (
        <div
          onPointerDown={onMoveStart}
          style={{
            position: 'absolute',
            top: -22,
            left: 0,
            right: 0,
            height: 20,
            cursor: 'move',
            background: borderColor,
            borderRadius: '4px 4px 0 0',
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 6,
            gap: 4,
            zIndex: 20,
            userSelect: 'none',
          }}
        >
          <GripVertical className="size-3 text-white/80 shrink-0" />
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)', fontWeight: 600 }}>
            {el.kind === 'text'
              ? (isEditing ? 'Editing — click outside to finish' : 'Text · double-click to edit')
              : el.kind === 'image' ? 'Image' : 'Table'}
          </span>
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onDuplicate() }}
            title="Duplicate element"
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}
          >
            <Copy className="size-3 text-white/80 hover:text-white" />
          </button>
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onDelete() }}
            title="Delete element"
            style={{ marginRight: 4, background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}
          >
            <X className="size-3 text-white/80 hover:text-white" />
          </button>
        </div>
      )}

      {/* Content */}
      {el.kind === 'text' ? (
        <CanvasTextView
          el={el as CanvasTextEl}
          isEditing={isEditing}
          onUpdate={p => onUpdate(p as Partial<CanvasEl>)}
        />
      ) : el.kind === 'image' ? (
        <img
          src={(el as CanvasImageEl).imgUrl}
          alt=""
          draggable={false}
          style={{
            width: '100%', height: '100%',
            objectFit: (el as CanvasImageEl).objectFit ?? 'cover',
            borderRadius: 4,
            display: 'block',
            pointerEvents: 'none',
          }}
        />
      ) : (
        <CanvasTableView
          el={el as CanvasTableEl}
          isSelected={isSelected}
          onUpdate={p => onUpdate(p as Partial<CanvasEl>)}
        />
      )}

      {/* 8 resize handles — corners + edge midpoints */}
      {isSelected && RESIZE_HANDLES.map(h => (
        <div
          key={h.id}
          onPointerDown={e => { e.stopPropagation(); onResizeStart(e, h.id) }}
          style={{
            position: 'absolute',
            width: 10,
            height: 10,
            background: borderColor,
            border: '2px solid white',
            borderRadius: 2,
            zIndex: 25,
            ...h.style,
          }}
        />
      ))}
    </div>
  )
}

/* ── Main CanvasEditor ─────────────────────────────────────────────────── */

// Snap threshold in % units. During move, element edges snap to guide lines
// when they come within this distance of a candidate position.
const SNAP_THRESHOLD = 1.5

/** Returns the snapped element position and the guide line position, or null
 *  if no candidate is close enough. Checks start, centre, and end edge. */
function snapAxis(
  pos: number, size: number, candidates: number[],
): { newPos: number; guide: number } | null {
  const edges   = [pos, pos + size / 2, pos + size]
  const offsets = [0,   size / 2,       size]
  let best: { dist: number; newPos: number; guide: number } | null = null
  for (const cand of candidates) {
    for (let i = 0; i < 3; i++) {
      const dist = Math.abs(edges[i] - cand)
      if (dist < SNAP_THRESHOLD && (!best || dist < best.dist)) {
        best = { dist, newPos: cand - offsets[i], guide: cand }
      }
    }
  }
  return best
}

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
type CanvasDrag = {
  mode:    'move' | 'resize'
  elId:    string
  handle?: ResizeHandle
  px0:     number; py0: number
  ex0:     number; ey0: number; ew0: number; eh0: number
} | null

function CanvasEditor({ slide, onUpdate, onPushHistory = () => {} }: {
  slide:    CanvasSlide
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onUpdate: (p: any) => void
  onPushHistory?: () => void
}) {
  const [selectedId,   setSelectedId]   = useState<string | null>(null)
  const [editingId,    setEditingId]    = useState<string | null>(null)
  const [showBg,       setShowBg]       = useState(false)
  const [showTableCfg, setShowTableCfg] = useState(false)
  const [drag,         setDrag]         = useState<CanvasDrag>(null)
  const [snapGuides,   setSnapGuides]   = useState<{ x?: number; y?: number }[]>([])
  const canvasRef     = useRef<HTMLDivElement>(null)
  const imgFileRef    = useRef<HTMLInputElement>(null)
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevEditingRef = useRef<string | null>(null)

  const updateEl = useCallback((id: string, patch: Partial<CanvasEl>) => {
    onUpdate({ elements: slide.elements.map(e => e.id === id ? { ...e, ...patch } as CanvasEl : e) })
  }, [slide.elements, onUpdate])

  // Push history when text editing starts (double-click into a text element).
  // Uses a ref to detect the transition from null → id without firing on every re-render.
  useEffect(() => {
    if (editingId && !prevEditingRef.current) {
      onPushHistory()
    }
    prevEditingRef.current = editingId
  }, [editingId, onPushHistory])

  function addText() {
    onPushHistory()
    const el: CanvasTextEl = {
      id: uid(), kind: 'text',
      x: 8, y: 12, w: 45, h: 20,
      html: 'Type here...', fontSize: 28, align: 'left', color: '#ffffff',
    }
    onUpdate({ elements: [...slide.elements, el] })
    setSelectedId(el.id)
  }

  function addImage(imgUrl: string) {
    onPushHistory()
    const el: CanvasImageEl = {
      id: uid(), kind: 'image',
      x: 8, y: 12, w: 40, h: 45,
      imgUrl, objectFit: 'cover',
    }
    onUpdate({ elements: [...slide.elements, el] })
    setSelectedId(el.id)
  }

  function addTable(rows: number, cols: number) {
    onPushHistory()
    const el: CanvasTableEl = {
      id: uid(), kind: 'table',
      x: 8, y: 12, w: 62, h: 38,
      rows, cols,
      cells: Array<string>(rows * cols).fill(''),   // flat — Firestore-compatible
      hasHeader: true,
    }
    onUpdate({ elements: [...slide.elements, el] })
    setSelectedId(el.id)
    setShowTableCfg(false)
  }

  /* ── Layer ordering ──────────────────────────────────────────────── */
  function bringToFront(id: string) {
    const idx = slide.elements.findIndex(e => e.id === id)
    if (idx === slide.elements.length - 1) return
    onPushHistory()
    const next = [...slide.elements]
    next.push(next.splice(idx, 1)[0])
    onUpdate({ elements: next })
  }
  function sendToBack(id: string) {
    const idx = slide.elements.findIndex(e => e.id === id)
    if (idx === 0) return
    onPushHistory()
    const next = [...slide.elements]
    next.unshift(next.splice(idx, 1)[0])
    onUpdate({ elements: next })
  }
  function bringForward(id: string) {
    const idx = slide.elements.findIndex(e => e.id === id)
    if (idx >= slide.elements.length - 1) return
    onPushHistory()
    const next = [...slide.elements]
    const tmp = next[idx]; next[idx] = next[idx + 1]; next[idx + 1] = tmp
    onUpdate({ elements: next })
  }
  function sendBackward(id: string) {
    const idx = slide.elements.findIndex(e => e.id === id)
    if (idx <= 0) return
    onPushHistory()
    const next = [...slide.elements]
    const tmp = next[idx]; next[idx] = next[idx - 1]; next[idx - 1] = tmp
    onUpdate({ elements: next })
  }

  const deleteEl = useCallback((id: string) => {
    onPushHistory()
    onUpdate({ elements: slide.elements.filter(e => e.id !== id) })
    setSelectedId(null)
    setEditingId(null)
  }, [slide.elements, onUpdate, onPushHistory])

  const duplicateEl = useCallback((id: string) => {
    const el = slide.elements.find(e => e.id === id)
    if (!el) return
    onPushHistory()
    const copy = {
      ...JSON.parse(JSON.stringify(el)) as CanvasEl,
      id:  uid(),
      x:   Math.min(el.x + 3, 100 - el.w),
      y:   Math.min(el.y + 3, 100 - el.h),
    }
    onUpdate({ elements: [...slide.elements, copy] })
    setSelectedId(copy.id)
    setEditingId(null)
  }, [slide.elements, onUpdate, onPushHistory])

  // Arrow key nudge (1% normal, 5% with Shift) + Delete/Backspace to remove selected element.
  // Only fires when an element is selected, NOT in text-edit mode, and focus is NOT in an input.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!selectedId) return
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (editingId) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteEl(selectedId)   // deleteEl now calls onPushHistory internally
        return
      }
      const step = e.shiftKey ? 5 : 1
      let dx = 0, dy = 0
      if (e.key === 'ArrowLeft')  dx = -step
      if (e.key === 'ArrowRight') dx =  step
      if (e.key === 'ArrowUp')    dy = -step
      if (e.key === 'ArrowDown')  dy =  step
      if (dx !== 0 || dy !== 0) {
        e.preventDefault()
        // Push history only on the first keydown in a burst; debounce repeats.
        if (!nudgeTimerRef.current) onPushHistory()
        clearTimeout(nudgeTimerRef.current!)
        nudgeTimerRef.current = setTimeout(() => { nudgeTimerRef.current = null }, 600)
        const el = slide.elements.find(x => x.id === selectedId)
        if (!el) return
        updateEl(selectedId, {
          x: Math.max(0, Math.min(100 - el.w, el.x + dx)),
          y: Math.max(0, Math.min(100 - el.h, el.y + dy)),
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, editingId, slide.elements, updateEl, deleteEl])

  function startMove(e: React.PointerEvent, elId: string) {
    e.stopPropagation()
    onPushHistory()
    const el = slide.elements.find(x => x.id === elId)!
    setSelectedId(elId)
    setDrag({ mode: 'move', elId, px0: e.clientX, py0: e.clientY, ex0: el.x, ey0: el.y, ew0: el.w, eh0: el.h })
  }

  function startResize(e: React.PointerEvent, elId: string, handle: ResizeHandle) {
    e.stopPropagation()
    onPushHistory()
    const el = slide.elements.find(x => x.id === elId)!
    setDrag({ mode: 'resize', elId, handle, px0: e.clientX, py0: e.clientY, ex0: el.x, ey0: el.y, ew0: el.w, eh0: el.h })
  }

  function onPtrMove(e: React.PointerEvent) {
    if (!drag || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const dx = ((e.clientX - drag.px0) / rect.width)  * 100
    const dy = ((e.clientY - drag.py0) / rect.height) * 100
    const el = slide.elements.find(x => x.id === drag.elId)
    if (!el) return
    const MIN_W = 8, MIN_H = 5

    if (drag.mode === 'move') {
      let nx = drag.ex0 + dx
      let ny = drag.ey0 + dy

      // Snap candidates: canvas edges, canvas centre, other elements' edges/centres
      const others = slide.elements.filter(x => x.id !== drag.elId)
      const xCands = [0, 50, 100, ...others.flatMap(x => [x.x, x.x + x.w / 2, x.x + x.w])]
      const yCands = [0, 50, 100, ...others.flatMap(x => [x.y, x.y + x.h / 2, x.y + x.h])]

      const xSnap = snapAxis(nx, el.w, xCands)
      const ySnap = snapAxis(ny, el.h, yCands)

      const guides: { x?: number; y?: number }[] = []
      if (xSnap) { nx = xSnap.newPos; guides.push({ x: xSnap.guide }) }
      if (ySnap) { ny = ySnap.newPos; guides.push({ y: ySnap.guide }) }
      setSnapGuides(guides)

      updateEl(drag.elId, {
        x: Math.max(0, Math.min(100 - el.w, nx)),
        y: Math.max(0, Math.min(100 - el.h, ny)),
      })
    } else {
      setSnapGuides([])
      // Elegant 8-handle resize: use string-includes to determine which edges to move.
      // 'n' in handle → top edge; 's' → bottom; 'e' → right; 'w' → left.
      // Works for all combinations: 'ne', 'nw', 'se', 'sw', 'n', 's', 'e', 'w'.
      const hnd = drag.handle ?? 'se'
      let rx = drag.ex0, ry = drag.ey0, rw = drag.ew0, rh = drag.eh0
      if (hnd.includes('e')) { rw = Math.max(MIN_W, drag.ew0 + dx) }
      if (hnd.includes('w')) { const nw = Math.max(MIN_W, drag.ew0 - dx); rx = drag.ex0 + drag.ew0 - nw; rw = nw }
      if (hnd.includes('s')) { rh = Math.max(MIN_H, drag.eh0 + dy) }
      if (hnd.includes('n')) { const nh = Math.max(MIN_H, drag.eh0 - dy); ry = drag.ey0 + drag.eh0 - nh; rh = nh }
      updateEl(drag.elId, { x: rx, y: ry, w: rw, h: rh })
    }
  }

  const selectedEl  = slide.elements.find(e => e.id === selectedId) ?? null
  const bgStyle: React.CSSProperties =
    slide.bg.type === 'color'    ? { backgroundColor: slide.bg.value } :
    slide.bg.type === 'gradient' ? { backgroundImage: slide.bg.value } :
    /* image */                    { backgroundImage: `url(${slide.bg.value})`, backgroundSize: 'cover', backgroundPosition: 'center' }

  return (
    <motion.div
      key={slide.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* ── Toolbar ── */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => { setShowBg(v => !v); setShowTableCfg(false) }}
          className={cn(
            'flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all',
            showBg ? 'border-sky-blue bg-sky-blue/10 text-sky-blue' : 'border-midnight-sky-200 text-midnight-sky-600 hover:border-midnight-sky-400',
          )}
        >
          <span
            className="size-3.5 rounded-full border border-midnight-sky-200"
            style={{ background: slide.bg.type === 'gradient' ? 'linear-gradient(135deg,#ff0065,#00b0ff)' : slide.bg.value }}
          />
          Background
        </button>

        <button
          onClick={addText}
          className="flex items-center gap-1.5 rounded-xl border border-midnight-sky-200 px-3 py-1.5 text-xs font-medium text-midnight-sky-600 transition-all hover:border-midnight-sky-400 hover:text-midnight-sky-900"
        >
          <Type className="size-3.5" />
          Add Text
        </button>

        <button
          onClick={() => { setShowTableCfg(v => !v); setShowBg(false) }}
          className={cn(
            'flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all',
            showTableCfg ? 'border-sky-blue bg-sky-blue/10 text-sky-blue' : 'border-midnight-sky-200 text-midnight-sky-600 hover:border-midnight-sky-400',
          )}
        >
          <Table2 className="size-3.5" />
          Add Table
        </button>

        <button
          onClick={() => imgFileRef.current?.click()}
          className="flex items-center gap-1.5 rounded-xl border border-midnight-sky-200 px-3 py-1.5 text-xs font-medium text-midnight-sky-600 transition-all hover:border-midnight-sky-400 hover:text-midnight-sky-900"
        >
          <Upload className="size-3.5" />
          Add Image
        </button>
        <input
          ref={imgFileRef}
          type="file"
          accept="image/*,.pdf"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            if (!f) return
            fileToImageDataUrl(f).then(addImage).catch(console.error)
            e.target.value = ''
          }}
        />

        {selectedId && (() => {
          const elIdx   = slide.elements.findIndex(e => e.id === selectedId)
          const elTotal = slide.elements.length
          return (
            <>
              {/* Layer ordering buttons */}
              <div className="ml-auto flex items-center overflow-hidden rounded-xl border border-midnight-sky-200 bg-white">
                <button onClick={() => sendToBack(selectedId)}    disabled={elIdx === 0}            title="Send to back"    className="px-1.5 py-1.5 text-midnight-sky-500 transition hover:bg-midnight-sky-100 hover:text-midnight-sky-900 disabled:cursor-not-allowed disabled:opacity-25"><ChevronsDown className="size-3.5" /></button>
                <button onClick={() => sendBackward(selectedId)}  disabled={elIdx === 0}            title="Send backward"   className="px-1.5 py-1.5 text-midnight-sky-500 transition hover:bg-midnight-sky-100 hover:text-midnight-sky-900 disabled:cursor-not-allowed disabled:opacity-25"><ChevronDown  className="size-3.5" /></button>
                <button onClick={() => bringForward(selectedId)}  disabled={elIdx === elTotal - 1} title="Bring forward"   className="px-1.5 py-1.5 text-midnight-sky-500 transition hover:bg-midnight-sky-100 hover:text-midnight-sky-900 disabled:cursor-not-allowed disabled:opacity-25"><ChevronUp    className="size-3.5" /></button>
                <button onClick={() => bringToFront(selectedId)}  disabled={elIdx === elTotal - 1} title="Bring to front"  className="px-1.5 py-1.5 text-midnight-sky-500 transition hover:bg-midnight-sky-100 hover:text-midnight-sky-900 disabled:cursor-not-allowed disabled:opacity-25"><ChevronsUp   className="size-3.5" /></button>
              </div>
              <button
                onClick={() => deleteEl(selectedId)}
                className="flex items-center gap-1.5 rounded-xl border border-red-200 px-3 py-1.5 text-xs font-medium text-red-500 transition-all hover:bg-red-50"
              >
                <Trash2 className="size-3" />
                Delete
              </button>
            </>
          )
        })()}
      </div>

      {/* ── Panels ── */}
      {showBg && (
        <BgPanel
          bg={slide.bg}
          onChange={bg => { onPushHistory(); onUpdate({ bg }); setShowBg(false) }}
        />
      )}
      {showTableCfg && (
        <TableConfigPanel onAdd={addTable} onCancel={() => setShowTableCfg(false)} />
      )}

      {/* ── Text formatting toolbar — shown when a text element is selected (editing or not) ── */}
      {selectedEl?.kind === 'text' && (
        <TextFormatBar
          el={selectedEl as CanvasTextEl}
          onUpdate={p => { onPushHistory(); updateEl(selectedEl.id, p) }}
        />
      )}


      {/* ── Canvas area — sized to always fit the viewport without scrolling ── */}
      <div
        ref={canvasRef}
        className="relative touch-none rounded-xl"
        style={{
          // Never wider than the container, never taller than the usable viewport.
          // 200 px covers: header (56) + toolbar (40) + padding (32) + breathing room.
          // Compact panels add ~65px when open; TextFormatBar adds ~48px.
          width: 'min(100%, calc((100vh - 200px) * 16 / 9))',
          aspectRatio: '16 / 9',
          ...bgStyle,
        }}
        onPointerMove={onPtrMove}
        onPointerUp={() => { setDrag(null); setSnapGuides([]) }}
        onPointerLeave={() => { setDrag(null); setSnapGuides([]) }}
      >
        <div
          className="absolute inset-0 rounded-xl overflow-visible"
          onClick={e => {
            if (e.target === e.currentTarget) {
              setSelectedId(null)
              setEditingId(null)
            }
          }}
        >
          {slide.elements.map(el => (
            <CanvasElView
              key={el.id}
              el={el}
              isSelected={el.id === selectedId}
              isEditing={el.id === editingId}
              onSelect={e => { e.stopPropagation(); setSelectedId(el.id); if (editingId !== el.id) setEditingId(null) }}
              onDoubleClick={() => { setSelectedId(el.id); if (el.kind === 'text') setEditingId(el.id) }}
              onMoveStart={e => startMove(e, el.id)}
              onResizeStart={(e, handle) => startResize(e, el.id, handle)}
              onUpdate={patch => updateEl(el.id, patch)}
              onDelete={() => deleteEl(el.id)}
              onDuplicate={() => duplicateEl(el.id)}
            />
          ))}

          {/* Snap alignment guides — rendered during drag-move only */}
          {snapGuides.map((g, i) => g.x !== undefined ? (
            <div key={`gx${i}`} style={{
              position: 'absolute', left: `${g.x}%`, top: 0, bottom: 0, width: 0,
              borderLeft: '1.5px dashed #ff0065', opacity: 0.85,
              pointerEvents: 'none', zIndex: 50, transform: 'translateX(-0.75px)',
            }} />
          ) : (
            <div key={`gy${i}`} style={{
              position: 'absolute', top: `${g.y!}%`, left: 0, right: 0, height: 0,
              borderTop: '1.5px dashed #ff0065', opacity: 0.85,
              pointerEvents: 'none', zIndex: 50, transform: 'translateY(-0.75px)',
            }} />
          ))}
        </div>
      </div>

    </motion.div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Loading Dots — three bouncing dots
   ───────────────────────────────────────────────────────────────────────── */

function LoadingDots({ color = 'white' }: { color?: 'white' | 'pink' }) {
  return (
    <span className="flex items-center gap-1">
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          className={cn('inline-block size-1.5 rounded-full', color === 'pink' ? 'bg-hot-pink' : 'bg-white')}
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
        />
      ))}
    </span>
  )
}
