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
  SortableContext, verticalListSortingStrategy,
  useSortable, arrayMove, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import {
  Plus, Trash2, GripVertical, FileText, Copy,
  Cloud, AlignLeft, AlignCenter, AlignRight, Star, Upload, Play,
  LayoutList, Bookmark, BookmarkCheck, Monitor, LayoutGrid,
  Video, Type, List, Quote, Users, BarChart2, PieChart,
  Layers, X, Table2, Download,
} from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
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
   PDF.js worker — Vite resolves new URL() at build time, so the worker
   file is automatically copied to /dist. No CDN dependency needed.
   ───────────────────────────────────────────────────────────────────────── */
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href

/* ─────────────────────────────────────────────────────────────────────────
   Cloudinary — unsigned upload helper
   Images are uploaded when saving to cloud so Firestore only stores a URL.
   ───────────────────────────────────────────────────────────────────────── */

const CLOUDINARY_CLOUD  = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME  as string
const CLOUDINARY_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string

async function uploadToCloudinary(base64DataUrl: string): Promise<string> {
  // Convert base64 data URL → Blob → proper file upload (avoids filename/slash issues)
  const blob = await fetch(base64DataUrl).then(r => r.blob())
  const form = new FormData()
  form.append('file', blob, `slide-${uid()}.jpg`)
  form.append('upload_preset', CLOUDINARY_PRESET)

  const res  = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`,
    { method: 'POST', body: form },
  )
  const data = await res.json()
  if (!res.ok) {
    const reason = data?.error?.message ?? `HTTP ${res.status}`
    throw new Error(`Cloudinary: ${reason}`)
  }
  return data.secure_url as string
}

/** Replaces base64 imgUrls / video data URLs with Cloudinary URLs before cloud-saving. */
async function toCloudinarySlides(slides: Slide[]): Promise<Slide[]> {
  return Promise.all(
    slides.map(async slide => {
      // PDF slides: upload base64 images to Cloudinary
      if (slide.type === 'pdf') {
        if (!slide.imgUrl || slide.imgUrl.startsWith('https://')) return slide
        const cloudUrl = await uploadToCloudinary(slide.imgUrl)
        return { ...slide, imgUrl: cloudUrl }
      }
      // Image slides: upload base64 data URLs to Cloudinary
      if (slide.type === 'image') {
        if (slide.imgUrl.startsWith('https://')) return slide
        const cloudUrl = await uploadToCloudinary(slide.imgUrl)
        return { ...slide, imgUrl: cloudUrl }
      }
      // Video slides: strip from cloud saves (data URLs too large)
      if (slide.type === 'video') {
        return { ...slide, videoUrl: '' }
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
  imgLayout?: 'top' | 'right' | 'background'
}
/* ── Canvas slide types ───────────────────────────────────────────── */
type CanvasBgType = 'color' | 'gradient'
interface CanvasBg { type: CanvasBgType; value: string }
interface CanvasBaseEl { id: string; kind: 'text' | 'table' | 'image'; x: number; y: number; w: number; h: number }
interface CanvasTextEl extends CanvasBaseEl {
  kind: 'text'; html: string; fontSize: number; align: 'left' | 'center' | 'right'; color: string
}
interface CanvasTableEl extends CanvasBaseEl {
  kind: 'table'; rows: number; cols: number; cells: string[][]; hasHeader: boolean
}
interface CanvasImageEl extends CanvasBaseEl {
  kind: 'image'; imgUrl: string; objectFit: 'cover' | 'contain'
}
type CanvasEl = CanvasTextEl | CanvasTableEl | CanvasImageEl
interface CanvasSlide { id: string; type: 'canvas'; bg: CanvasBg; elements: CanvasEl[] }

type Slide = PdfSlide | ImageSlide | VideoSlide | HtmlSlide | QuestionSlide | ContentSlide | CanvasSlide

/* ─────────────────────────────────────────────────────────────────────────
   Constants
   ───────────────────────────────────────────────────────────────────────── */

const QTYPES: { type: QType; label: string; icon: ReactNode; color: string; badge: string }[] = [
  { type: 'mcq',       label: 'Multiple Choice', icon: <LayoutList className="size-4" />, color: 'text-sky-blue',    badge: 'MCQ' },
  { type: 'wordcloud', label: 'Word Cloud',       icon: <Cloud className="size-4" />,      color: 'text-fresh-green', badge: 'WC'  },
  { type: 'openended', label: 'Open-ended',       icon: <AlignLeft className="size-4" />,  color: 'text-golden-sun',  badge: 'OE'  },
  { type: 'rating',    label: 'Rating',           icon: <Star className="size-4" />,        color: 'text-hot-pink',    badge: 'RT'  },
]

function uid() { return Math.random().toString(36).slice(2, 10) }

function makeQuestion(type: QType): QuestionSlide {
  return {
    id: uid(),
    type,
    question: '',
    options: type === 'mcq' ? ['', '', '', ''] : type === 'rating' ? ['', '', ''] : [],
  }
}

/* ── Content slide helpers ─────────────────────────────────────────────── */

type CThemeKey = 'navy' | 'pink' | 'sky' | 'green' | 'golden' | 'white'
const CONTENT_COLORS: Record<CThemeKey, {
  bg: string; text: string; textDim: string; accent: string; quoteMark: string;
  cardBg: string; cardBorder: string; isDark: boolean
}> = {
  navy:   { bg: '#000079', text: '#ffffff', textDim: 'rgba(255,255,255,0.58)', accent: '#ff0065', quoteMark: 'rgba(255,0,101,0.18)', cardBg: 'rgba(255,255,255,0.10)', cardBorder: 'rgba(255,255,255,0.18)', isDark: true  },
  pink:   { bg: '#ff0065', text: '#ffffff', textDim: 'rgba(255,255,255,0.72)', accent: '#ffffff', quoteMark: 'rgba(255,255,255,0.18)', cardBg: 'rgba(255,255,255,0.15)', cardBorder: 'rgba(255,255,255,0.25)', isDark: true  },
  sky:    { bg: '#00b0ff', text: '#000079', textDim: 'rgba(0,0,121,0.62)',     accent: '#000079', quoteMark: 'rgba(0,0,121,0.14)',     cardBg: 'rgba(0,0,121,0.10)',     cardBorder: 'rgba(0,0,121,0.18)',     isDark: false },
  green:  { bg: '#42db66', text: '#000079', textDim: 'rgba(0,0,121,0.62)',     accent: '#000079', quoteMark: 'rgba(0,0,121,0.14)',     cardBg: 'rgba(0,0,121,0.10)',     cardBorder: 'rgba(0,0,121,0.18)',     isDark: false },
  golden: { bg: '#ffc709', text: '#000079', textDim: 'rgba(0,0,121,0.62)',     accent: '#000079', quoteMark: 'rgba(0,0,121,0.14)',     cardBg: 'rgba(0,0,121,0.10)',     cardBorder: 'rgba(0,0,121,0.18)',     isDark: false },
  white:  { bg: '#f4f4f9', text: '#000079', textDim: 'rgba(0,0,121,0.52)',     accent: '#ff0065', quoteMark: 'rgba(255,0,101,0.1)',    cardBg: 'rgba(0,0,121,0.06)',     cardBorder: 'rgba(0,0,121,0.14)',     isDark: false },
}
function contentColors(themeId: string) { return CONTENT_COLORS[themeId as CThemeKey] ?? CONTENT_COLORS.navy }

const CONTENT_TEMPLATES: { template: ContentTemplate; label: string; icon: ReactNode }[] = [
  { template: 'heading', label: 'Heading', icon: <Type className="size-3.5" /> },
  { template: 'bullets', label: 'Bullets', icon: <List className="size-3.5" /> },
  { template: 'quote',   label: 'Quote',   icon: <Quote className="size-3.5" /> },
]

const CONTENT_THEMES: { id: string; label: string; swatch: string }[] = [
  { id: 'navy',   label: 'Navy',   swatch: '#000079' },
  { id: 'pink',   label: 'Pink',   swatch: '#ff0065' },
  { id: 'sky',    label: 'Sky',    swatch: '#00b0ff' },
  { id: 'green',  label: 'Green',  swatch: '#42db66' },
  { id: 'golden', label: 'Golden', swatch: '#ffc709' },
  { id: 'white',  label: 'White',  swatch: '#f4f4f9' },
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

function makeCanvas(): CanvasSlide {
  return { id: uid(), type: 'canvas', bg: { type: 'color', value: '#000079' }, elements: [] }
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
    deckFromState?.slides as Slide[] ?? returnState.slides ?? [],
  )
  const [selectedId, setSelectedId] = useState<string | null>(
    (returnState.selectedSlideId as string | undefined)
      ?? (deckFromState?.slides?.[0] as any)?.id
      ?? returnState.slides?.[0]?.id
      ?? null,
  )
  const [deckTitle, setDeckTitle]   = useState(
    deckFromState?.title ?? returnState.deckTitle ?? 'Untitled session',
  )
  const [currentDeckId, setCurrentDeckId] = useState<string | undefined>(
    deckFromState?.id ?? (returnState.deckId as string | undefined),
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
      // For cloud saves: upload any base64 PDF images to Cloudinary first
      const slidesToSave = b === 'cloud'
        ? await toCloudinarySlides(slides)
        : slides

      // If saving a NEW deck (no id yet), auto-disambiguate the title against existing decks.
      // Existing decks keep whatever title the user typed — no surprise renames on update.
      // Cloud saves run this AFTER sign-in so the listing reflects the right user's decks.
      const needsAuthForCloud = b === 'cloud'
      if (needsAuthForCloud) {
        const existingUser = await waitForAuth()
        if (!existingUser) {
          await signInWithGoogle()
          setStorageBackend('cloud')
          setStorageBackend_('cloud')
        }
      }
      const finalTitle = currentDeckId
        ? deckTitle
        : await getUniqueDeckTitle(deckTitle || 'Untitled session', b, currentDeckId)
      if (!currentDeckId && finalTitle !== deckTitle) {
        // Reflect the new unique title in the input so the user can see what was saved
        setDeckTitle(finalTitle)
      }

      const deck: Deck = {
        id:        currentDeckId ?? uid(),
        title:     finalTitle,
        slides:    slidesToSave as unknown[],
        createdAt: Date.now(),
        updatedAt: Date.now(),
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
    const slide = makeQuestion(type)
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

  const deleteSlide = useCallback((id: string) => {
    setSlides(prev => {
      const next = prev.filter(s => s.id !== id)
      if (selectedId === id) {
        const idx = prev.findIndex(s => s.id === id)
        setSelectedId(next[Math.min(idx, next.length - 1)]?.id ?? null)
      }
      return next
    })
  }, [selectedId])

  const duplicateSlide = useCallback((id: string) => {
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
  }, [])

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
      setSlides(prev => {
        const from = prev.findIndex(s => s.id === active.id)
        const to   = prev.findIndex(s => s.id === over.id)
        return arrayMove(prev, from, to)
      })
    }
  }, [])

  const addContent = useCallback((template: ContentTemplate, afterId?: string) => {
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
  }, [])

  const addCanvas = useCallback((afterId?: string) => {
    const slide = makeCanvas()
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

  const startSession = async () => {
    if (slides.length === 0 || isStarting) return
    setStarting(true)
    setSessionError(null)
    // Start from whichever slide is currently selected in the panel
    const startSlide = Math.max(0, slides.findIndex(s => s.id === selectedId))
    try {
      const code = await createSession(deckTitle, slides)
      navigate(`/present/${code}`, { state: { slides, deckTitle, sessionCode: code, startSlide, deckId: currentDeckId } })
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
      // Resync slides first so audience index matches presenter's deck
      await updateSessionSlides(resumeCode, slides)
      await updateSessionState(resumeCode, startSlide, 'question')
      navigate(`/present/${resumeCode}`, { state: { slides, deckTitle, sessionCode: resumeCode, startSlide, deckId: currentDeckId } })
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

      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-midnight-sky-900 px-5">

        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/decks')}
            className="flex items-center gap-1.5 rounded-lg bg-fresh-green px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-fresh-green/85 active:scale-95"
          >
            <LayoutGrid className="size-4" />
            My Decks
          </button>
          <span className="h-4 w-px bg-white/15" />
          <AlayaMark className="text-white" />
        </div>

        {/* Editable deck title */}
        <input
          value={deckTitle}
          onChange={e => setDeckTitle(e.target.value)}
          className="w-64 border-b border-transparent bg-transparent px-2 py-1 text-center text-sm font-semibold text-white outline-none transition-colors placeholder:text-white/30 hover:border-white/20 focus:border-hot-pink"
        />

        {/* Save deck button + error toast */}
        <div className="flex items-center gap-2">
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
              'flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-all duration-200',
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

          {/* Export deck as shareable JSON */}
          <motion.button
            onClick={() => downloadDeckJSON(deckTitle, slides)}
            disabled={slides.length === 0}
            whileTap={slides.length > 0 ? { scale: 0.96 } : {}}
            title={slides.length === 0 ? 'Add slides first' : 'Export deck as a file to share with colleagues'}
            className={cn(
              'flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-all duration-200',
              slides.length > 0
                ? 'border-white/20 bg-white/5 text-white/80 hover:border-white/40 hover:text-white'
                : 'cursor-not-allowed border-white/10 text-white/30',
            )}
          >
            <Upload className="size-3.5" />
            Export
          </motion.button>

          {/* Results button — enabled whenever we have poll results, even
              if the deck hasn't been saved yet. In that case clicking it
              saves the deck first (to mint an ID) and then navigates. */}
          {(() => {
            const hasResults = !!lastResults && lastResults.questions.length > 0
            return (
              <motion.button
                onClick={async () => {
                  if (!hasResults) return
                  let targetId = currentDeckId
                  if (!targetId) {
                    // Save first to mint a deck ID. saveDeck will open the
                    // storage modal if no backend is chosen yet.
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
                  'flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-all duration-200',
                  hasResults && !isSaving
                    ? 'border-hot-pink/30 bg-hot-pink/5 text-hot-pink hover:border-hot-pink/60 hover:bg-hot-pink/10'
                    : 'cursor-not-allowed border-white/10 text-white/30',
                )}
              >
                <BarChart2 className="size-3.5" />
                Results
              </motion.button>
            )
          })()}
        </div>

        {/* Session error toast — surfaces silent createSession / resumeSession failures */}
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

        {/* Live audience count — only visible when a session is active */}
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
          /* Has an existing session — offer Resume (same code) or New */
          <div className="flex items-center gap-2">
            <motion.button
              onClick={resumeSession}
              whileTap={!isStarting ? { scale: 0.96 } : {}}
              disabled={isStarting}
              className="flex items-center gap-2 rounded-xl bg-hot-pink px-4 py-2 text-sm font-medium text-white shadow-[0_0_20px_-4px] shadow-hot-pink/50 transition-all hover:shadow-[0_0_28px_-2px] hover:shadow-hot-pink/70 disabled:opacity-60"
            >
              {isStarting ? <LoadingDots /> : <><Play className="size-3.5 fill-white" />Resume · {resumeCode}</>}
            </motion.button>
            <motion.button
              onClick={startSession}
              whileTap={!isStarting ? { scale: 0.96 } : {}}
              disabled={isStarting}
              className="flex items-center gap-2 rounded-xl bg-sky-blue px-3 py-2 text-sm font-semibold text-white shadow-[0_0_16px_-4px] shadow-sky-blue/50 transition-all hover:scale-[1.02] hover:shadow-[0_0_24px_-2px] hover:shadow-sky-blue/70 disabled:opacity-60"
            >
              New Slide Show
            </motion.button>
          </div>
        ) : (
          /* No existing session — single Start button */
          <motion.button
            onClick={startSession}
            whileTap={slides.length > 0 && !isStarting ? { scale: 0.96 } : {}}
            disabled={slides.length === 0 || isStarting}
            className={cn(
              'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white transition-all duration-200',
              slides.length > 0 && !isStarting
                ? 'bg-hot-pink shadow-[0_0_20px_-4px] shadow-hot-pink/50 hover:shadow-[0_0_28px_-2px] hover:shadow-hot-pink/70'
                : 'cursor-not-allowed bg-white/10 text-white/30',
            )}
          >
            {isStarting ? <LoadingDots /> : <><Play className="size-3.5 fill-white" />Start session</>}
          </motion.button>
        )}
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
          onSetAddMenu={setAddMenu}
          onAddQuestion={addQuestion}
          onAddContent={addContent}
          onAddCanvas={addCanvas}
        />

        {/* Right: editor */}
        <div className="scrollbar-panel flex flex-1 flex-col overflow-auto">
          {selectedSlide ? (
            <SlideEditor slide={selectedSlide} onUpdate={updateSlide} onSplitHtml={splitHtmlSlide} />
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
  onSelect, onDelete, onDuplicate, onDragEnd, onImport, onSetAddMenu, onAddQuestion, onAddContent, onAddCanvas,
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
  onSetAddMenu: (id: string | undefined) => void
  onAddQuestion: (type: QType, afterId?: string) => void
  onAddContent: (template: ContentTemplate, afterId?: string) => void
  onAddCanvas: (afterId?: string) => void
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <aside className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-white/10 bg-midnight-sky-900">

      {/* Import PDF button */}
      <div className="shrink-0 border-b border-white/10 p-3">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={isImporting}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/25 py-2.5 text-xs font-medium text-white/60 transition-all hover:border-white/50 hover:bg-white/5 hover:text-white disabled:opacity-40"
        >
          {isImporting ? <LoadingDots /> : <><Download className="size-3.5" />Import / Merge</>}
        </button>
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
                    className="flex flex-col items-center gap-1.5 rounded-xl border border-white/10 p-3 text-white/75 transition-all hover:border-white/25 hover:bg-white/10 hover:text-white"
                  >
                    <span className={cn('text-lg', q.color)}>{q.icon}</span>
                    <span className="text-[9px] font-medium leading-none">{q.label}</span>
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
                    className="flex flex-col items-center gap-1.5 rounded-xl border border-white/10 p-3 text-white/75 transition-all hover:border-white/25 hover:bg-white/10 hover:text-white"
                  >
                    <span className="text-white/80">{t.icon}</span>
                    <span className="text-[9px] font-medium leading-none">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 px-0.5 text-[9px] font-semibold uppercase tracking-wider text-white/40">
                Custom
              </p>
              <button
                onClick={() => onAddCanvas()}
                className="flex w-full items-center gap-2 rounded-xl border border-white/10 px-3 py-2.5 text-white/75 transition-all hover:border-white/25 hover:bg-white/10 hover:text-white"
              >
                <Layers className="size-3.5 shrink-0 text-sky-blue/70" />
                <span className="text-[9px] font-medium">Custom Slide</span>
              </button>
            </div>
          </div>
        ) : (
          /* Drag-and-drop slide list */
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={slides.map(s => s.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col px-2 pb-2">
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
        <div className="shrink-0 border-t border-white/10 p-3 space-y-2">
          <div>
            <p className="mb-1 px-1 text-[9px] font-semibold uppercase tracking-wider text-white/40">
              Question
            </p>
            <div className="grid grid-cols-2 gap-1">
              {QTYPES.map(q => (
                <button
                  key={q.type}
                  onClick={() => onAddQuestion(q.type, selectedId ?? undefined)}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-white/75 transition-all hover:bg-white/10 hover:text-white"
                >
                  <span className={cn('shrink-0', q.color)}>{q.icon}</span>
                  <span className="truncate">{q.label.split(' ')[0]}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 px-1 text-[9px] font-semibold uppercase tracking-wider text-white/40">
              Content
            </p>
            <div className="grid grid-cols-3 gap-1">
              {CONTENT_TEMPLATES.map(t => (
                <button
                  key={t.template}
                  onClick={() => onAddContent(t.template, selectedId ?? undefined)}
                  className="flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[10px] text-white/75 transition-all hover:bg-white/10 hover:text-white"
                >
                  <span className="text-white/80">{t.icon}</span>
                  <span className="truncate">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => onAddCanvas(selectedId ?? undefined)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] text-white/75 transition-all hover:bg-white/10 hover:text-white"
          >
            <Layers className="size-3.5 shrink-0 text-sky-blue/70" />
            <span>Custom Slide</span>
          </button>
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
        className={cn(
          'relative flex w-full items-start gap-2 rounded-xl p-2 text-left transition-all',
          isSelected ? 'bg-white/15 ring-1 ring-hot-pink/70' : 'hover:bg-white/8',
        )}
      >
        {/* Slide number */}
        <span className="mt-1 w-4 shrink-0 text-[10px] font-medium text-white/60">
          {index + 1}
        </span>

        {/* Thumbnail */}
        <div className="aspect-video flex-1 overflow-hidden rounded-lg bg-midnight-sky-800">
          {slide.type === 'pdf' ? (
            slide.imgUrl ? (
              <img src={slide.imgUrl} alt={`Page ${slide.pageNum}`} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1">
                <FileText className="size-4 text-white/30" />
                <span className="text-[8px] text-white/25">Page {slide.pageNum}</span>
              </div>
            )
          ) : slide.type === 'image' ? (
            <img src={slide.imgUrl} alt={slide.fileName} className="h-full w-full object-cover" />
          ) : slide.type === 'video' ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1">
              <Video className="size-4 text-white/40" />
              <span className="max-w-full truncate px-1 text-[8px] text-white/25">{slide.fileName}</span>
            </div>
          ) : slide.type === 'html' ? (
            <HtmlSlideThumbnail slide={slide as HtmlSlide} />
          ) : slide.type === 'content' ? (
            <div
              className="flex h-full w-full items-center justify-center p-2"
              style={{ backgroundColor: contentColors((slide as ContentSlide).theme).bg }}
            >
              <p
                className="text-center text-[9px] font-medium leading-snug line-clamp-2"
                style={{
                  color: contentColors((slide as ContentSlide).theme).text,
                  opacity: (slide as ContentSlide).title ? 1 : 0.4,
                }}
              >
                {(slide as ContentSlide).title || cInfo?.label}
              </p>
            </div>
          ) : slide.type === 'canvas' ? (
            <div
              className="flex h-full w-full items-center justify-center"
              style={{
                background: (slide as CanvasSlide).bg.type === 'color'
                  ? (slide as CanvasSlide).bg.value
                  : undefined,
                backgroundImage: (slide as CanvasSlide).bg.type === 'gradient'
                  ? (slide as CanvasSlide).bg.value
                  : undefined,
              }}
            >
              {(slide as CanvasSlide).elements.length === 0 ? (
                <Layers className="size-4 text-white/25" />
              ) : (
                <Layers className="size-3.5 text-white/50" />
              )}
            </div>
          ) : (
            <div
              className="flex h-full w-full items-center justify-center p-2"
              style={{ backgroundColor: contentColors((slide as QuestionSlide).theme ?? 'navy').bg }}
            >
              <p
                className="text-center text-[9px] font-medium leading-snug line-clamp-2"
                style={{
                  color: contentColors((slide as QuestionSlide).theme ?? 'navy').text,
                  opacity: (slide as QuestionSlide).question ? 1 : 0.35,
                }}
              >
                {(slide as QuestionSlide).question || `${qInfo?.label}`}
              </p>
            </div>
          )}
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
      </button>

      {/* Drag handle — appears on hover, left edge */}
      <button
        {...listeners}
        className="absolute left-0.5 top-1/2 -translate-y-1/2 cursor-grab rounded p-0.5 text-white/0 transition-all group-hover:text-white/35 hover:text-white/60 active:cursor-grabbing"
      >
        <GripVertical className="size-3" />
      </button>

      {/* Duplicate button — bottom left, only on slide hover */}
      <button
        onClick={e => { e.stopPropagation(); onDuplicate() }}
        title="Duplicate slide"
        className="absolute bottom-2 left-8 rounded-md p-0.5 text-white/0 transition-all group-hover:text-white/50 hover:!text-sky-blue"
      >
        <Copy className="size-3" />
      </button>

      {/* Delete button — bottom right, only on slide hover */}
      <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        title="Delete slide"
        className="absolute bottom-2 right-2 rounded-md p-0.5 text-white/0 transition-all group-hover:text-white/50 hover:!text-red-400"
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Add-between button — the "+" row between slides
   ───────────────────────────────────────────────────────────────────────── */

function AddBetweenButton({
  isOpen, onToggle, onAdd, onAddContent, onAddCanvas,
}: {
  isOpen: boolean
  onToggle: () => void
  onAdd: (type: QType) => void
  onAddContent: (template: ContentTemplate) => void
  onAddCanvas: () => void
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
                  className="flex flex-col items-center gap-1 rounded-lg p-2 text-white/60 transition-all hover:bg-white/10 hover:text-white"
                >
                  <span className={cn('text-base', q.color)}>{q.icon}</span>
                  <span className="text-[9px] font-medium leading-none">{q.label}</span>
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
                    className="flex flex-col items-center gap-1 rounded-lg p-2 text-white/60 transition-all hover:bg-white/10 hover:text-white"
                  >
                    <span>{t.icon}</span>
                    <span className="text-[9px] font-medium leading-none">{t.label}</span>
                  </button>
                ))}
              </div>
              <button
                onClick={onAddCanvas}
                className="mt-1 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-[9px] font-medium text-white/60 transition-all hover:bg-white/10 hover:text-white"
              >
                <Layers className="size-3 shrink-0 text-sky-blue/70" />
                Custom Slide
              </button>
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
    <div className="flex flex-1 flex-col bg-midnight-sky-900 p-6">
      {/* Top bar — filename + slide info + split control */}
      <div className="mb-3 flex items-center gap-2">
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

function SlideEditor({ slide, onUpdate, onSplitHtml }: {
  slide: Slide
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onUpdate: (id: string, patch: any) => void
  onSplitHtml?: (id: string, count: number) => void
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
      <div className="scrollbar-panel flex flex-1 flex-col overflow-auto" style={{ background: 'oklch(0.972 0.006 258)' }}>
        <div className="w-full max-w-4xl px-8 py-8">
          <ContentEditor slide={slide} onUpdate={patch => onUpdate(slide.id, patch)} />
        </div>
      </div>
    )
  }

  if (slide.type === 'canvas') {
    return (
      <div className="scrollbar-panel flex flex-1 flex-col overflow-auto" style={{ background: 'oklch(0.972 0.006 258)' }}>
        <div className="w-full px-6 py-6">
          <CanvasEditor slide={slide} onUpdate={patch => onUpdate(slide.id, patch)} />
        </div>
      </div>
    )
  }

  // Question slides — editor form above, 16:9 slide preview below
  return (
    <div className="scrollbar-panel flex flex-1 flex-col overflow-auto" style={{ background: 'oklch(0.972 0.006 258)' }}>
      {/* Editor form */}
      <div className="px-8 py-8">
        <QuestionEditor slide={slide as QuestionSlide} onUpdate={patch => onUpdate(slide.id, patch)} hidePreview />
      </div>
      {/* Slide preview — full width, 16:9, looks like the actual presenter screen */}
      <div className="px-8 pb-10">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-midnight-sky-500">
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
    const buf  = await file.arrayBuffer()
    const pdf  = await pdfjsLib.getDocument({ data: buf }).promise
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
        className="flex items-center gap-2 rounded-xl border border-dashed border-midnight-sky-200 px-4 py-2.5 text-sm text-midnight-sky-400 transition hover:border-hot-pink hover:text-hot-pink"
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

function QuestionEditor({ slide, onUpdate, hidePreview = false }: {
  slide: QuestionSlide
  onUpdate: (patch: Partial<QuestionSlide>) => void
  hidePreview?: boolean
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

          <div className="p-6">

            {/* Type chip */}
            <div className={cn(
              'mb-5 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold tracking-wide',
              slide.type === 'mcq'       ? 'bg-sky-blue/10 text-sky-blue'       :
              slide.type === 'wordcloud' ? 'bg-fresh-green/10 text-fresh-green' :
              slide.type === 'openended' ? 'bg-golden-sun/10 text-golden-sun'   :
              'bg-hot-pink/10 text-hot-pink',
            )}>
              {qInfo.icon}
              {qInfo.label}
            </div>

            {/* Question text */}
            <div className="mb-5">
              <label className="mb-2 block text-[11px] font-semibold text-midnight-sky-600">
                Question
              </label>
              <textarea
                value={slide.question}
                onChange={e => onUpdate({ question: e.target.value })}
                placeholder={PLACEHOLDERS[slide.type]}
                rows={3}
                className="w-full resize-none rounded-xl border border-midnight-sky-150 bg-white px-4 py-3 text-base text-midnight-sky-900 placeholder:font-light placeholder:text-midnight-sky-400 outline-none transition-all focus:border-hot-pink focus:ring-2 focus:ring-hot-pink/10"
              />
            </div>

            {/* Type-specific fields */}
            {slide.type === 'mcq' && <MCQEditor slide={slide} onUpdate={onUpdate} />}
            {slide.type === 'rating' && <RatingEditor slide={slide} onUpdate={onUpdate} />}
            {(slide.type === 'wordcloud' || slide.type === 'openended') && (
              <div className="mb-1 flex items-start gap-2.5 rounded-xl bg-midnight-sky-50 p-4">
                <div className={cn(
                  'mt-0.5 shrink-0 size-1.5 rounded-full',
                  slide.type === 'wordcloud' ? 'bg-fresh-green' : 'bg-golden-sun',
                )} />
                <p className="text-sm text-midnight-sky-500">
                  {slide.type === 'wordcloud'
                    ? 'Each audience member types one word. Results appear as a live word cloud on the big screen.'
                    : 'Audience members type a short answer. Responses stream in live on the big screen.'}
                </p>
              </div>
            )}

            {/* Slide image + layout */}
            <div className="mt-5 border-t border-midnight-sky-100 pt-5">
              <label className="mb-2.5 block text-[11px] font-semibold text-midnight-sky-600">
                Slide image <span className="font-light">(optional)</span>
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
            <div className="mt-5 border-t border-midnight-sky-100 pt-5">
              <label className="mb-2.5 block text-sm font-medium text-midnight-sky-700">
                Slide background
                <span className="ml-1.5 font-light text-midnight-sky-500">how this slide looks on the big screen</span>
              </label>
              <div className="flex items-center gap-2">
                {CONTENT_THEMES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => onUpdate({ theme: t.id })}
                    title={t.label}
                    className={cn(
                      'size-7 rounded-full transition-all ring-offset-2',
                      (slide.theme ?? 'navy') === t.id
                        ? 'ring-2 ring-midnight-sky-700 scale-110'
                        : 'hover:scale-105 opacity-75 hover:opacity-100',
                    )}
                    style={{ backgroundColor: t.swatch }}
                  />
                ))}
                <span className="ml-1 text-xs font-light text-midnight-sky-400">
                  {CONTENT_THEMES.find(t => t.id === (slide.theme ?? 'navy'))?.label ?? 'Navy'}
                </span>
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

function MCQEditor({ slide, onUpdate }: {
  slide: QuestionSlide
  onUpdate: (patch: Partial<QuestionSlide>) => void
}) {
  const setOption = (i: number, val: string) => {
    const next = [...slide.options]
    next[i] = val
    onUpdate({ options: next })
  }
  const addOption = () => {
    if (slide.options.length >= 6) return
    onUpdate({ options: [...slide.options, ''] })
  }
  const removeOption = (i: number) => {
    if (slide.options.length <= 2) return
    onUpdate({ options: slide.options.filter((_, idx) => idx !== i) })
  }

  return (
    <div className="mb-6 space-y-2">
      <label className="mb-2 block text-sm font-medium text-midnight-sky-700">
        Answer options
        <span className="ml-1 font-light text-midnight-sky-500">({slide.options.length}/6 — pick one)</span>
      </label>
      {slide.options.map((opt, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className="mt-2.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-midnight-sky-100 text-xs font-bold text-midnight-sky-600">
            {String.fromCharCode(65 + i)}
          </span>
          {/* Auto-expanding textarea — grows with content, no horizontal overflow */}
          <textarea
            value={opt}
            rows={1}
            onChange={e => setOption(i, e.target.value)}
            placeholder={`Option ${String.fromCharCode(65 + i)}`}
            style={{ fieldSizing: 'content' } as React.CSSProperties}
            className="flex-1 resize-none overflow-hidden rounded-xl border border-midnight-sky-200 bg-white px-3.5 py-2.5 text-sm leading-snug text-midnight-sky-900 placeholder:text-midnight-sky-400 outline-none transition-all focus:border-hot-pink focus:ring-2 focus:ring-hot-pink/15"
          />
          {slide.options.length > 2 && (
            <button
              onClick={() => removeOption(i)}
              className="mt-1.5 rounded-lg p-1.5 text-midnight-sky-400 transition hover:bg-red-50 hover:text-red-400"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      ))}
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
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Rating Editor — up to 5 named parameters
   ───────────────────────────────────────────────────────────────────────── */

function RatingEditor({ slide, onUpdate }: {
  slide: QuestionSlide
  onUpdate: (patch: Partial<QuestionSlide>) => void
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
    onUpdate({
      options:     [...params, ''],
      leftLabels:  [...leftLabels,  ''],
      rightLabels: [...rightLabels, ''],
    })
  }
  const removeParam = (i: number) => {
    if (params.length <= 1) return
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
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-midnight-sky-400">
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
                <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-midnight-sky-400">
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

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl shadow-[0_8px_32px_-8px_rgba(0,0,0,0.35)]"
      style={{ aspectRatio: '16/9', backgroundColor: c.bg }}
    >
      {/* Background image layout */}
      {hasBg && slide.imgUrl && (
        <>
          <img src={slide.imgUrl} alt="" aria-hidden
            className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl opacity-25" />
          <img src={slide.imgUrl} alt=""
            className="absolute inset-0 h-full w-full object-contain" />
          <div className="absolute inset-0" style={{ backgroundColor: `${c.bg}cc` }} />
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
              {/* Blurred fill for letterbox areas */}
              <img src={slide.imgUrl} alt="" aria-hidden
                className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl opacity-30" />
              {/* Sharp full image — never cropped */}
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

  return (
    <div
      className="relative aspect-video w-full overflow-hidden rounded-xl"
      style={{ backgroundColor: c.bg }}
    >
      {/* Ambient glow for navy */}
      {slide.theme === 'navy' && (
        <div
          className="pointer-events-none absolute -bottom-20 -left-20 size-48 rounded-full blur-3xl opacity-35"
          style={{ backgroundColor: '#ff0065' }}
        />
      )}

      {!hasContent ? (
        <div className="flex h-full items-center justify-center">
          <p className="text-xs" style={{ color: c.textDim }}>Preview appears here…</p>
        </div>
      ) : slide.template === 'heading' ? (
        <div className="flex h-full flex-col items-center justify-center px-8 text-center">
          <p className="text-lg font-bold leading-tight line-clamp-2" style={{ color: c.text }}>
            {slide.title || <span style={{ opacity: 0.35 }}>Untitled</span>}
          </p>
          {slide.body && (
            <p className="mt-2 text-sm font-light line-clamp-2" style={{ color: c.textDim }}>
              {slide.body}
            </p>
          )}
        </div>
      ) : slide.template === 'bullets' ? (
        <div className="flex h-full flex-col justify-center px-8 py-5">
          {slide.title && (
            <p className="mb-2.5 text-sm font-bold line-clamp-1" style={{ color: c.text }}>{slide.title}</p>
          )}
          <ul className="space-y-1.5">
            {bullets.slice(0, 5).map((b, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ backgroundColor: c.accent }} />
                <span className="text-[11px] leading-snug line-clamp-1" style={{ color: c.text }}>{b}</span>
              </li>
            ))}
            {bullets.length > 5 && (
              <li className="text-[10px] pl-3.5" style={{ color: c.textDim }}>+{bullets.length - 5} more</li>
            )}
          </ul>
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center px-8 text-center">
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
          <p className="relative z-10 text-xs leading-relaxed line-clamp-3" style={{ color: c.text }}>
            {slide.body || <span style={{ opacity: 0.35 }}>Quote text…</span>}
          </p>
          {slide.attribution && (
            <p className="mt-1.5 text-[10px]" style={{ color: c.textDim }}>— {slide.attribution}</p>
          )}
        </div>
      )}

      {/* Watermark */}
      <div className="absolute bottom-2 right-2.5">
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

function ContentEditor({ slide, onUpdate }: {
  slide: ContentSlide
  onUpdate: (patch: Partial<ContentSlide>) => void
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
              <SlideImagePicker imgUrl={slide.imgUrl} onChange={url => onUpdate({ imgUrl: url, imgLayout: url ? (slide.imgLayout ?? 'right') : undefined })} />
              {slide.imgUrl && (
                <div className="mt-3 flex items-center gap-1">
                  <span className="mr-1 text-[10px] font-medium text-midnight-sky-400">Position:</span>
                  {(['right', 'top', 'background'] as const).map(layout => (
                    <button
                      key={layout}
                      onClick={() => onUpdate({ imgLayout: layout })}
                      className={cn(
                        'rounded-md px-2.5 py-1 text-[10px] font-medium transition-all',
                        (slide.imgLayout ?? 'right') === layout
                          ? 'bg-midnight-sky-900 text-white'
                          : 'bg-midnight-sky-100 text-midnight-sky-500 hover:bg-midnight-sky-200',
                      )}
                    >
                      {layout === 'right' ? 'Side' : layout === 'top' ? 'Above' : 'Background'}
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
                    onClick={() => onUpdate({ template: t.template })}
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
              <div className="flex gap-2">
                {CONTENT_THEMES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => onUpdate({ theme: t.id })}
                    title={t.label}
                    className={cn(
                      'size-7 rounded-full transition-all ring-offset-2',
                      slide.theme === t.id
                        ? 'ring-2 ring-midnight-sky-700 scale-110'
                        : 'hover:scale-105 opacity-75 hover:opacity-100',
                    )}
                    style={{ backgroundColor: t.swatch, border: t.id === 'white' ? '1px solid rgba(0,0,0,0.12)' : undefined }}
                  />
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

/* ── Background panel ──────────────────────────────────────────────────── */

function BgPanel({ bg, onChange }: { bg: CanvasBg; onChange: (bg: CanvasBg) => void }) {
  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-midnight-sky-150 bg-white p-4 shadow-sm">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-midnight-sky-400">Solid colour</p>
      <div className="flex flex-wrap gap-2">
        {CANVAS_BG_COLORS.map(c => (
          <button
            key={c.value}
            onClick={() => onChange({ type: 'color', value: c.value })}
            title={c.label}
            className={cn(
              'size-8 rounded-full transition-all ring-offset-2 hover:scale-110',
              bg.value === c.value ? 'ring-2 ring-midnight-sky-700' : 'opacity-80',
            )}
            style={{ backgroundColor: c.value, border: c.value === '#f4f4f9' ? '1px solid #e8e8f1' : undefined }}
          />
        ))}
      </div>
      <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-midnight-sky-400">Gradient</p>
      <div className="flex flex-wrap gap-2">
        {CANVAS_BG_GRADIENTS.map(g => (
          <button
            key={g.value}
            onClick={() => onChange({ type: 'gradient', value: g.value })}
            title={g.label}
            className={cn(
              'h-8 w-16 rounded-lg text-[9px] font-semibold text-white transition-all hover:scale-105',
              bg.value === g.value ? 'ring-2 ring-midnight-sky-700 ring-offset-2' : 'opacity-80',
            )}
            style={{ background: g.value }}
          >
            {g.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ── Table config panel ────────────────────────────────────────────────── */

function TableConfigPanel({ onAdd, onCancel }: { onAdd: (rows: number, cols: number) => void; onCancel: () => void }) {
  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(3)

  const Step = ({ val, min, max, onChange }: { val: number; min: number; max: number; onChange: (n: number) => void }) => (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange(Math.max(min, val - 1))}
        className="flex size-7 items-center justify-center rounded-lg border border-midnight-sky-200 text-midnight-sky-600 transition hover:bg-midnight-sky-50"
      >−</button>
      <span className="w-5 text-center text-sm font-semibold text-midnight-sky-900">{val}</span>
      <button
        onClick={() => onChange(Math.min(max, val + 1))}
        className="flex size-7 items-center justify-center rounded-lg border border-midnight-sky-200 text-midnight-sky-600 transition hover:bg-midnight-sky-50"
      >+</button>
    </div>
  )

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-midnight-sky-150 bg-white p-4 shadow-sm">
      <p className="mb-3 text-sm font-semibold text-midnight-sky-700">Configure table</p>
      <div className="flex items-center gap-8">
        <div>
          <p className="mb-1.5 text-xs text-midnight-sky-400">Rows</p>
          <Step val={rows} min={1} max={12} onChange={setRows} />
        </div>
        <div>
          <p className="mb-1.5 text-xs text-midnight-sky-400">Columns</p>
          <Step val={cols} min={1} max={8} onChange={setCols} />
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={onCancel} className="rounded-xl border border-midnight-sky-200 px-3 py-1.5 text-sm text-midnight-sky-500 transition hover:bg-midnight-sky-50">
            Cancel
          </button>
          <button onClick={() => onAdd(rows, cols)} className="rounded-xl bg-hot-pink px-4 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-hot-pink/90">
            Insert
          </button>
        </div>
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

      <FmtBtn onClick={() => cmd('superscript')} title="Superscript">
        <span className="text-xs leading-none">x<sup className="text-[8px]">2</sup></span>
      </FmtBtn>
      <FmtBtn onClick={() => cmd('subscript')} title="Subscript">
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

function TableCell({ value, isEditable, isHeader, onChange }: {
  value:      string
  isEditable: boolean
  isHeader:   boolean
  onChange:   (v: string) => void
}) {
  const ref = useRef<HTMLTableCellElement>(null)

  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) {
      ref.current.innerText = value
    }
  }, [value, isEditable])

  return (
    <td
      ref={ref}
      contentEditable={isEditable || undefined}
      suppressContentEditableWarning
      onBlur={e => onChange(e.currentTarget.innerText)}
      style={{
        border: '1px solid rgba(255,255,255,0.22)',
        padding: '4px 8px',
        fontSize: 13,
        color: '#ffffff',
        backgroundColor: isHeader ? 'rgba(0,0,121,0.65)' : 'rgba(255,255,255,0.05)',
        fontWeight: isHeader ? 600 : 400,
        outline: 'none',
        verticalAlign: 'middle',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        cursor: isEditable ? 'text' : 'default',
      }}
    />
  )
}

/* ── Canvas text element view ──────────────────────────────────────────── */

function CanvasTextView({ el, isSelected, onUpdate }: {
  el:         CanvasTextEl
  isSelected: boolean
  onUpdate:   (p: Partial<CanvasTextEl>) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) {
      ref.current.innerHTML = el.html
    }
  }, [el.id]) // Only rewrite DOM on element mount, not every keystroke

  return (
    <div
      ref={ref}
      contentEditable={isSelected || undefined}
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
        cursor: isSelected ? 'text' : 'default',
        userSelect: isSelected ? 'text' : 'none',
        boxSizing: 'border-box',
      }}
    />
  )
}

/* ── Canvas table element view ─────────────────────────────────────────── */

function CanvasTableView({ el, isSelected, onUpdate }: {
  el:         CanvasTableEl
  isSelected: boolean
  onUpdate:   (p: Partial<CanvasTableEl>) => void
}) {
  function updateCell(r: number, c: number, text: string) {
    const cells = el.cells.map((row, ri) =>
      row.map((cell, ci) => (ri === r && ci === c ? text : cell)),
    )
    onUpdate({ cells })
  }

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
      <table style={{ width: '100%', height: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <tbody>
          {el.cells.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <TableCell
                  key={`${ri}-${ci}`}
                  value={cell}
                  isEditable={isSelected}
                  isHeader={el.hasHeader && ri === 0}
                  onChange={text => updateCell(ri, ci, text)}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── Single positioned element (drag + resize wrapper) ─────────────────── */

const RESIZE_CORNERS = [
  { id: 'nw' as const, style: { top: -5, left: -5,   cursor: 'nw-resize' } },
  { id: 'ne' as const, style: { top: -5, right: -5,  cursor: 'ne-resize' } },
  { id: 'se' as const, style: { bottom: -5, right: -5, cursor: 'se-resize' } },
  { id: 'sw' as const, style: { bottom: -5, left: -5, cursor: 'sw-resize' } },
]

function CanvasElView({ el, isSelected, onSelect, onMoveStart, onResizeStart, onUpdate, onDelete }: {
  el:            CanvasEl
  isSelected:    boolean
  onSelect:      (e: React.MouseEvent) => void
  onMoveStart:   (e: React.PointerEvent) => void
  onResizeStart: (e: React.PointerEvent, corner: 'nw' | 'ne' | 'se' | 'sw') => void
  onUpdate:      (p: Partial<CanvasEl>) => void
  onDelete:      () => void
}) {
  return (
    <div
      onClick={onSelect}
      style={{
        position: 'absolute',
        left: `${el.x}%`,
        top: `${el.y}%`,
        width: `${el.w}%`,
        height: `${el.h}%`,
        boxSizing: 'border-box',
        border: isSelected ? '2px solid #00b0ff' : '1px dashed rgba(255,255,255,0.0)',
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
            background: '#00b0ff',
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
            {el.kind === 'text' ? 'Text' : el.kind === 'image' ? 'Image' : 'Table'}
          </span>
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onDelete() }}
            style={{ marginLeft: 'auto', marginRight: 4, background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}
          >
            <X className="size-3 text-white/80 hover:text-white" />
          </button>
        </div>
      )}

      {/* Content */}
      {el.kind === 'text' ? (
        <CanvasTextView
          el={el as CanvasTextEl}
          isSelected={isSelected}
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

      {/* Resize handles */}
      {isSelected && RESIZE_CORNERS.map(c => (
        <div
          key={c.id}
          onPointerDown={e => { e.stopPropagation(); onResizeStart(e, c.id) }}
          style={{
            position: 'absolute',
            width: 10,
            height: 10,
            background: '#00b0ff',
            border: '2px solid white',
            borderRadius: 2,
            zIndex: 25,
            ...c.style,
          }}
        />
      ))}
    </div>
  )
}

/* ── Main CanvasEditor ─────────────────────────────────────────────────── */

type CanvasDrag = {
  mode:    'move' | 'resize'
  elId:    string
  corner?: 'nw' | 'ne' | 'se' | 'sw'
  px0:     number; py0: number
  ex0:     number; ey0: number; ew0: number; eh0: number
} | null

function CanvasEditor({ slide, onUpdate }: {
  slide:    CanvasSlide
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onUpdate: (p: any) => void
}) {
  const [selectedId,   setSelectedId]   = useState<string | null>(null)
  const [showBg,       setShowBg]       = useState(false)
  const [showTableCfg, setShowTableCfg] = useState(false)
  const [drag,         setDrag]         = useState<CanvasDrag>(null)
  const canvasRef   = useRef<HTMLDivElement>(null)
  const imgFileRef  = useRef<HTMLInputElement>(null)

  const updateEl = useCallback((id: string, patch: Partial<CanvasEl>) => {
    onUpdate({ elements: slide.elements.map(e => e.id === id ? { ...e, ...patch } as CanvasEl : e) })
  }, [slide.elements, onUpdate])

  function addText() {
    const el: CanvasTextEl = {
      id: uid(), kind: 'text',
      x: 8, y: 12, w: 45, h: 20,
      html: 'Type here...', fontSize: 28, align: 'left', color: '#ffffff',
    }
    onUpdate({ elements: [...slide.elements, el] })
    setSelectedId(el.id)
  }

  function addImage(imgUrl: string) {
    const el: CanvasImageEl = {
      id: uid(), kind: 'image',
      x: 8, y: 12, w: 40, h: 45,
      imgUrl, objectFit: 'cover',
    }
    onUpdate({ elements: [...slide.elements, el] })
    setSelectedId(el.id)
  }

  function addTable(rows: number, cols: number) {
    const cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''))
    const el: CanvasTableEl = {
      id: uid(), kind: 'table',
      x: 8, y: 12, w: 62, h: 38,
      rows, cols, cells, hasHeader: true,
    }
    onUpdate({ elements: [...slide.elements, el] })
    setSelectedId(el.id)
    setShowTableCfg(false)
  }

  function deleteEl(id: string) {
    onUpdate({ elements: slide.elements.filter(e => e.id !== id) })
    setSelectedId(null)
  }

  function startMove(e: React.PointerEvent, elId: string) {
    e.stopPropagation()
    const el = slide.elements.find(x => x.id === elId)!
    setSelectedId(elId)
    setDrag({ mode: 'move', elId, px0: e.clientX, py0: e.clientY, ex0: el.x, ey0: el.y, ew0: el.w, eh0: el.h })
  }

  function startResize(e: React.PointerEvent, elId: string, corner: 'nw' | 'ne' | 'se' | 'sw') {
    e.stopPropagation()
    const el = slide.elements.find(x => x.id === elId)!
    setDrag({ mode: 'resize', elId, corner, px0: e.clientX, py0: e.clientY, ex0: el.x, ey0: el.y, ew0: el.w, eh0: el.h })
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
      updateEl(drag.elId, {
        x: Math.max(0, Math.min(100 - el.w, drag.ex0 + dx)),
        y: Math.max(0, Math.min(100 - el.h, drag.ey0 + dy)),
      })
    } else {
      let { x, y, w, h } = { x: drag.ex0, y: drag.ey0, w: drag.ew0, h: drag.eh0 }
      if      (drag.corner === 'se') { w = Math.max(MIN_W, drag.ew0 + dx); h = Math.max(MIN_H, drag.eh0 + dy) }
      else if (drag.corner === 'sw') { const nw = Math.max(MIN_W, drag.ew0 - dx); x = drag.ex0 + drag.ew0 - nw; w = nw; h = Math.max(MIN_H, drag.eh0 + dy) }
      else if (drag.corner === 'ne') { const nh = Math.max(MIN_H, drag.eh0 - dy); y = drag.ey0 + drag.eh0 - nh; w = Math.max(MIN_W, drag.ew0 + dx); h = nh }
      else if (drag.corner === 'nw') { const nw = Math.max(MIN_W, drag.ew0 - dx); const nh = Math.max(MIN_H, drag.eh0 - dy); x = drag.ex0 + drag.ew0 - nw; y = drag.ey0 + drag.eh0 - nh; w = nw; h = nh }
      updateEl(drag.elId, { x, y, w, h })
    }
  }

  const selectedEl  = slide.elements.find(e => e.id === selectedId) ?? null
  const bgStyle: React.CSSProperties = slide.bg.type === 'color'
    ? { backgroundColor: slide.bg.value }
    : { backgroundImage: slide.bg.value }

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

        {selectedId && (
          <button
            onClick={() => deleteEl(selectedId)}
            className="ml-auto flex items-center gap-1.5 rounded-xl border border-red-200 px-3 py-1.5 text-xs font-medium text-red-500 transition-all hover:bg-red-50"
          >
            <Trash2 className="size-3" />
            Delete
          </button>
        )}
      </div>

      {/* ── Panels ── */}
      {showBg && (
        <BgPanel
          bg={slide.bg}
          onChange={bg => { onUpdate({ bg }); setShowBg(false) }}
        />
      )}
      {showTableCfg && (
        <TableConfigPanel onAdd={addTable} onCancel={() => setShowTableCfg(false)} />
      )}

      {/* ── Text formatting toolbar ── */}
      {selectedEl?.kind === 'text' && (
        <TextFormatBar
          el={selectedEl as CanvasTextEl}
          onUpdate={p => updateEl(selectedEl.id, p)}
        />
      )}

      {/* ── Canvas area ── */}
      <div
        ref={canvasRef}
        className="relative w-full touch-none rounded-xl"
        style={{ paddingBottom: '56.25%', ...bgStyle }}
        onPointerMove={onPtrMove}
        onPointerUp={() => setDrag(null)}
        onPointerLeave={() => setDrag(null)}
      >
        <div
          className="absolute inset-0 rounded-xl overflow-visible"
          onClick={e => { if (e.target === e.currentTarget) setSelectedId(null) }}
        >
          {slide.elements.length === 0 && (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-white/25 select-none pointer-events-none">
              <Layers className="size-10" />
              <p className="text-sm font-light">Click "Add Text", "Add Image" or "Add Table" to build your slide</p>
            </div>
          )}
          {slide.elements.map(el => (
            <CanvasElView
              key={el.id}
              el={el}
              isSelected={el.id === selectedId}
              onSelect={e => { e.stopPropagation(); setSelectedId(el.id) }}
              onMoveStart={e => startMove(e, el.id)}
              onResizeStart={(e, corner) => startResize(e, el.id, corner)}
              onUpdate={patch => updateEl(el.id, patch)}
              onDelete={() => deleteEl(el.id)}
            />
          ))}
        </div>
      </div>

      <p className="mt-2 text-[11px] text-midnight-sky-400">
        Click to select · Drag the blue bar to move · Pull corners to resize · Click outside to deselect
      </p>
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
