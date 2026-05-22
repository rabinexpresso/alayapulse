import React, { useState, useCallback, useRef, type ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { createSession, updateSessionState } from '@/lib/session'
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
  Plus, Trash2, GripVertical, FileText,
  Cloud, AlignLeft, Star, Upload, Play,
  LayoutList, Bookmark, BookmarkCheck, Monitor,
} from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import { AlayaMark } from '@/components/AlayaMark'
import { cn } from '@/lib/utils'
import {
  getStorageBackend, setStorageBackend,
  browserSaveDeck, cloudSaveDeck,
  signInWithGoogle, onAuthStateChanged, auth,
  type StorageBackend, type Deck, type User,
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

/** Replaces any base64 imgUrls with Cloudinary URLs before cloud-saving. */
async function toCloudinarySlides(slides: Slide[]): Promise<Slide[]> {
  return Promise.all(
    slides.map(async slide => {
      if (slide.type !== 'pdf' || !slide.imgUrl || slide.imgUrl.startsWith('https://')) {
        return slide   // already a URL or no image — nothing to do
      }
      const cloudUrl = await uploadToCloudinary(slide.imgUrl)
      return { ...slide, imgUrl: cloudUrl }
    }),
  )
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
interface QuestionSlide {
  id: string
  type: QType
  question: string
  /** MCQ: answer options A–F. Rating: parameter labels. Others: unused. */
  options: string[]
}
type Slide = PdfSlide | QuestionSlide

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
    (deckFromState?.slides?.[0] as any)?.id ?? returnState.slides?.[0]?.id ?? null,
  )
  const [deckTitle, setDeckTitle]   = useState(
    deckFromState?.title ?? returnState.deckTitle ?? 'Untitled session',
  )
  const [currentDeckId, setCurrentDeckId] = useState<string | undefined>(deckFromState?.id)
  const [isImporting, setImporting] = useState(false)
  const [isStarting,  setStarting]  = useState(false)
  const [addMenuAfter, setAddMenu]  = useState<string | undefined>(undefined)

  // Deck saving state
  const [storageBackend, setStorageBackend_] = useState<StorageBackend | null>(getStorageBackend)
  const [showSaveModal,  setShowSaveModal]   = useState(false)
  const [isSaving,       setIsSaving]        = useState(false)
  const [savedToast,     setSavedToast]      = useState(false)
  const [saveError,      setSaveError]       = useState<string | null>(null)

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

  const saveDeck = async (backend?: StorageBackend) => {
    const b = backend ?? storageBackend
    if (!b) { setShowSaveModal(true); return }
    setIsSaving(true)
    try {
      // For cloud saves: upload any base64 PDF images to Cloudinary first
      const slidesToSave = b === 'cloud'
        ? await toCloudinarySlides(slides)
        : slides

      const deck: Deck = {
        id:        currentDeckId ?? uid(),
        title:     deckTitle,
        slides:    slidesToSave as unknown[],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      if (b === 'browser') {
        await browserSaveDeck(deck)
      } else {
        // Wait for Firebase to restore auth state (handles race on first page load)
        const existingUser = await waitForAuth()
        if (!existingUser) {
          await signInWithGoogle()
          setStorageBackend('cloud')
          setStorageBackend_('cloud')
        }
        await cloudSaveDeck(deck)
      }
      if (!currentDeckId) setCurrentDeckId(deck.id)
      setSavedToast(true)
      setTimeout(() => setSavedToast(false), 2500)
    } catch (err) {
      console.error('Save failed:', err)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setSaveError(`Save failed: ${msg}`)
      setTimeout(() => setSaveError(null), 5000)
    } finally {
      setIsSaving(false)
      setShowSaveModal(false)
    }
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

  const importPdf = useCallback(async (file: File) => {
    if (!file.type.includes('pdf')) return
    setImporting(true)
    try {
      const buf = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise
      const newSlides: PdfSlide[] = []

      for (let p = 1; p <= pdf.numPages; p++) {
        const page     = await pdf.getPage(p)
        const viewport = page.getViewport({ scale: 1.5 })
        const canvas   = document.createElement('canvas')
        canvas.width   = viewport.width
        canvas.height  = viewport.height
        const ctx      = canvas.getContext('2d')!
        await page.render({ canvas, canvasContext: ctx, viewport }).promise
        newSlides.push({ id: uid(), type: 'pdf', pageNum: p, imgUrl: canvas.toDataURL('image/jpeg', 0.85) })
      }

      setSlides(prev => [...prev, ...newSlides])
      // Select first imported slide only if nothing is selected yet
      setSelectedId(prev => prev ?? (newSlides[0]?.id ?? null))
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

  const updateSlide = useCallback((id: string, patch: Partial<QuestionSlide>) => {
    setSlides(prev => prev.map(s => {
      if (s.id !== id || s.type === 'pdf') return s
      return { ...s, ...patch }
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

  const startSession = async () => {
    if (slides.length === 0 || isStarting) return
    setStarting(true)
    try {
      const code = await createSession(deckTitle, slides)
      navigate(`/present/${code}`, { state: { slides, deckTitle, sessionCode: code } })
    } catch (err) {
      console.error('Failed to start session:', err)
      setStarting(false)
    }
  }

  // Resume an existing session — resets to slide 0 so audience auto-follows
  const resumeSession = async () => {
    if (!resumeCode || isStarting) return
    setStarting(true)
    try {
      await updateSessionState(resumeCode, 0, 'question')
      navigate(`/present/${resumeCode}`, { state: { slides, deckTitle, sessionCode: resumeCode } })
    } catch (err) {
      console.error('Failed to resume session:', err)
      setStarting(false)
    }
  }

  /* ── Render ─────────────────────────────────────────────────────────── */

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">

      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-midnight-sky-100 px-5">

        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/decks')}
            className="flex items-center gap-1.5 text-sm text-midnight-sky-500 transition-colors hover:text-midnight-sky-800"
          >
            <Bookmark className="size-4" />
            My Decks
          </button>
          <span className="h-4 w-px bg-midnight-sky-200" />
          <AlayaMark />
        </div>

        {/* Editable deck title */}
        <input
          value={deckTitle}
          onChange={e => setDeckTitle(e.target.value)}
          className="w-56 rounded-lg px-3 py-1.5 text-center text-sm font-medium text-midnight-sky-800 outline-none ring-0 transition hover:bg-midnight-sky-50 focus:bg-midnight-sky-50 focus:ring-1 focus:ring-midnight-sky-200"
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
                ? 'border-red-200 bg-red-50 text-red-500'
                : slides.length > 0
                ? 'border-midnight-sky-200 bg-white text-midnight-sky-600 hover:border-midnight-sky-400'
                : 'cursor-not-allowed border-midnight-sky-100 text-midnight-sky-300',
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
        </div>

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
              className="flex items-center gap-2 rounded-xl border border-midnight-sky-200 bg-white px-3 py-2 text-sm font-medium text-midnight-sky-600 transition-all hover:border-midnight-sky-400 hover:text-midnight-sky-900 disabled:opacity-60"
            >
              New session
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
                : 'cursor-not-allowed bg-midnight-sky-300',
            )}
          >
            {isStarting ? <LoadingDots /> : <><Play className="size-3.5 fill-white" />Start session</>}
          </motion.button>
        )}
      </header>

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
          onDragEnd={handleDragEnd}
          onImport={importPdf}
          onSetAddMenu={setAddMenu}
          onAddQuestion={addQuestion}
        />

        {/* Right: editor */}
        <div className="flex flex-1 flex-col overflow-auto">
          {selectedSlide ? (
            <SlideEditor slide={selectedSlide} onUpdate={updateSlide} />
          ) : (
            <EmptyEditorState onImport={importPdf} isImporting={isImporting} />
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
  onSelect, onDelete, onDragEnd, onImport, onSetAddMenu, onAddQuestion,
}: {
  slides: Slide[]
  selectedId: string | null
  isImporting: boolean
  addMenuAfter: string | undefined
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onDragEnd: (e: DragEndEvent) => void
  onImport: (file: File) => void
  onSetAddMenu: (id: string | undefined) => void
  onAddQuestion: (type: QType, afterId?: string) => void
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
          {isImporting ? <LoadingDots /> : <><Upload className="size-3.5" />Import PDF</>}
        </button>
        <input
          ref={fileRef} type="file" accept=".pdf" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = '' }}
        />
      </div>

      {/* Slide list or empty state */}
      <div className="flex flex-1 flex-col overflow-y-auto py-2">
        {slides.length === 0 ? (
          /* Empty state — show question type cards */
          <div className="flex flex-1 flex-col gap-4 p-3">
            <div className="pt-2 text-center">
              <FileText className="mx-auto size-8 text-white/20" />
              <p className="mt-2 text-[11px] text-white/30">
                Import a PDF or start with a question slide
              </p>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {QTYPES.map(q => (
                <button
                  key={q.type}
                  onClick={() => onAddQuestion(q.type)}
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-white/10 p-3 text-white/50 transition-all hover:border-white/25 hover:bg-white/10 hover:text-white"
                >
                  <span className={cn('text-lg', q.color)}>{q.icon}</span>
                  <span className="text-[9px] font-medium leading-none">{q.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Drag-and-drop slide list */
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={slides.map(s => s.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col px-2 pb-2">
                {slides.map((slide, idx) => (
                  <div key={slide.id}>
                    <SlideThumbnail
                      slide={slide}
                      index={idx}
                      isSelected={slide.id === selectedId}
                      onSelect={() => onSelect(slide.id)}
                      onDelete={() => onDelete(slide.id)}
                    />
                    {/* "+ Add question" between each slide */}
                    <AddBetweenButton
                      isOpen={addMenuAfter === slide.id}
                      onToggle={() => onSetAddMenu(addMenuAfter === slide.id ? undefined : slide.id)}
                      onAdd={(type) => onAddQuestion(type, slide.id)}
                    />
                  </div>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Bottom: add question at end (only when slides exist) */}
      {slides.length > 0 && (
        <div className="shrink-0 border-t border-white/10 p-3">
          <p className="mb-1.5 px-1 text-[9px] font-semibold uppercase tracking-wider text-white/30">
            Add question
          </p>
          <div className="grid grid-cols-2 gap-1">
            {QTYPES.map(q => (
              <button
                key={q.type}
                onClick={() => onAddQuestion(q.type)}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-white/50 transition-all hover:bg-white/10 hover:text-white"
              >
                <span className={cn('shrink-0', q.color)}>{q.icon}</span>
                <span className="truncate">{q.label.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Slide Thumbnail — draggable card in the sidebar
   ───────────────────────────────────────────────────────────────────────── */

function SlideThumbnail({
  slide, index, isSelected, onSelect, onDelete,
}: {
  slide: Slide
  index: number
  isSelected: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: slide.id })

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const qInfo = slide.type !== 'pdf' ? QTYPES.find(q => q.type === slide.type) : null

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
        <span className="mt-1 w-4 shrink-0 text-[10px] font-medium text-white/30">
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
          ) : (
            <div className={cn(
              'flex h-full w-full items-center justify-center p-2',
              // Subtle tinted background per question type
              slide.type === 'mcq'       ? 'bg-sky-blue/10'    :
              slide.type === 'wordcloud' ? 'bg-fresh-green/10' :
              slide.type === 'openended' ? 'bg-golden-sun/10'  :
              'bg-hot-pink/10',
            )}>
              <p className={cn(
                'text-center text-[9px] font-medium leading-snug',
                slide.question ? 'text-white/80' : 'text-white/30',
              )}>
                {slide.question || `${qInfo?.label}`}
              </p>
            </div>
          )}
        </div>

        {/* Question type badge */}
        {qInfo && (
          <span className={cn(
            'absolute right-3 top-3 rounded-md px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider',
            'bg-white/10 text-white/50',
          )}>
            {qInfo.badge}
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

      {/* Delete button — top right */}
      <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        className="absolute right-2 top-2 rounded-md p-0.5 text-white/0 transition-all group-hover:text-white/35 hover:!text-red-400"
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
  isOpen, onToggle, onAdd,
}: {
  isOpen: boolean
  onToggle: () => void
  onAdd: (type: QType) => void
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
          {isOpen ? 'Choose type' : 'Add question here'}
        </span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="mb-1 mt-0.5 grid grid-cols-2 gap-1 rounded-xl border border-white/15 bg-midnight-sky-800 p-1.5 shadow-xl"
          >
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Slide Editor — right panel
   ───────────────────────────────────────────────────────────────────────── */

function SlideEditor({ slide, onUpdate }: {
  slide: Slide
  onUpdate: (id: string, patch: Partial<QuestionSlide>) => void
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

  return (
    <div className="flex flex-1 flex-col overflow-auto" style={{ background: 'oklch(0.972 0.006 258)' }}>
      <div className="mx-auto w-full max-w-2xl px-8 py-8">
        <QuestionEditor slide={slide} onUpdate={patch => onUpdate(slide.id, patch)} />
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Question Editor — form for all 4 types
   ───────────────────────────────────────────────────────────────────────── */

function QuestionEditor({ slide, onUpdate }: {
  slide: QuestionSlide
  onUpdate: (patch: Partial<QuestionSlide>) => void
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
        <div className="rounded-2xl bg-white p-6 shadow-[0_2px_12px_-2px_rgba(0,0,121,0.08)]">

          {/* Type chip */}
          <div className={cn(
            'mb-5 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold tracking-wide',
            slide.type === 'mcq'       ? 'bg-sky-blue/10 text-sky-blue'    :
            slide.type === 'wordcloud' ? 'bg-fresh-green/10 text-fresh-green' :
            slide.type === 'openended' ? 'bg-golden-sun/10 text-golden-sun' :
            'bg-hot-pink/10 text-hot-pink',
          )}>
            {qInfo.icon}
            {qInfo.label}
          </div>

          {/* Question text */}
          <div className="mb-5">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-midnight-sky-400">
              Question
            </label>
            <textarea
              value={slide.question}
              onChange={e => onUpdate({ question: e.target.value })}
              placeholder={PLACEHOLDERS[slide.type]}
              rows={3}
              className="w-full resize-none rounded-xl border border-midnight-sky-150 bg-white px-4 py-3 text-base text-midnight-sky-900 placeholder:font-light placeholder:text-midnight-sky-300 outline-none transition-all focus:border-hot-pink focus:ring-2 focus:ring-hot-pink/10"
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
        </div>

        {/* Audience preview — dark phone-style card */}
        <div className="mt-4">
          <p className="mb-2.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-midnight-sky-400">
            What the audience sees
          </p>
          <div className="overflow-hidden rounded-2xl bg-midnight-sky-900 p-5 shadow-[0_8px_32px_-8px_rgba(0,0,121,0.3)]">
            <SlidePreviewCard slide={slide} />
          </div>
        </div>

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
        <div key={i} className="flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-midnight-sky-100 text-xs font-bold text-midnight-sky-600">
            {String.fromCharCode(65 + i)}
          </span>
          <input
            value={opt}
            onChange={e => setOption(i, e.target.value)}
            placeholder={`Option ${String.fromCharCode(65 + i)}`}
            className="flex-1 rounded-xl border border-midnight-sky-200 bg-white px-3.5 py-2.5 text-sm text-midnight-sky-900 placeholder:text-midnight-sky-400 outline-none transition-all focus:border-hot-pink focus:ring-2 focus:ring-hot-pink/15"
          />
          {slide.options.length > 2 && (
            <button
              onClick={() => removeOption(i)}
              className="rounded-lg p-1.5 text-midnight-sky-300 transition hover:bg-red-50 hover:text-red-400"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      ))}
      {slide.options.length < 6 && (
        <button
          onClick={addOption}
          className="mt-1 flex items-center gap-1.5 rounded-xl border border-dashed border-midnight-sky-200 px-3.5 py-2.5 text-sm text-midnight-sky-400 transition hover:border-hot-pink hover:text-hot-pink"
        >
          <Plus className="size-3.5" />
          Add option
        </button>
      )}
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

  const setParam = (i: number, val: string) => {
    const next = [...params]
    next[i] = val
    onUpdate({ options: next })
  }
  const addParam = () => {
    if (params.length >= 5) return
    onUpdate({ options: [...params, ''] })
  }
  const removeParam = (i: number) => {
    if (params.length <= 1) return
    onUpdate({ options: params.filter((_, idx) => idx !== i) })
  }

  return (
    <div className="mb-6 space-y-2">
      <label className="mb-1 block text-sm font-medium text-midnight-sky-700">
        What are they rating?
        <span className="ml-1 font-light text-midnight-sky-500">(1–5 parameters, each rated 1–5 stars)</span>
      </label>
      {params.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-hot-pink/10 text-xs font-bold text-hot-pink">
            {i + 1}
          </span>
          <input
            value={p}
            onChange={e => setParam(i, e.target.value)}
            placeholder={`Parameter ${i + 1} (e.g. Giving feedback)`}
            className="flex-1 rounded-xl border border-midnight-sky-200 bg-white px-3.5 py-2.5 text-sm text-midnight-sky-900 placeholder:text-midnight-sky-400 outline-none transition-all focus:border-hot-pink focus:ring-2 focus:ring-hot-pink/15"
          />
          {params.length > 1 && (
            <button
              onClick={() => removeParam(i)}
              className="rounded-lg p-1.5 text-midnight-sky-300 transition hover:bg-red-50 hover:text-red-400"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      ))}
      {params.length < 5 && (
        <button
          onClick={addParam}
          className="mt-1 flex items-center gap-1.5 rounded-xl border border-dashed border-midnight-sky-200 px-3.5 py-2.5 text-sm text-midnight-sky-400 transition hover:border-hot-pink hover:text-hot-pink"
        >
          <Plus className="size-3.5" />
          Add parameter
        </button>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Slide Preview Card — mini audience-view preview inside the editor
   ───────────────────────────────────────────────────────────────────────── */

function SlidePreviewCard({ slide }: { slide: QuestionSlide }) {
  const empty = !slide.question

  const QuestionText = () => (
    <p className="mb-4 text-sm font-semibold leading-snug text-white">
      {empty ? <span className="font-light text-white/30">Your question appears here…</span> : slide.question}
    </p>
  )

  if (slide.type === 'mcq') {
    const opts = slide.options.some(o => o) ? slide.options : ['Option A', 'Option B', 'Option C', 'Option D']
    return (
      <div>
        <QuestionText />
        <div className="space-y-1.5">
          {opts.map((opt, i) => (
            <div key={i} className="flex items-center gap-2.5 rounded-xl bg-white/10 px-3 py-2.5 text-sm text-white transition-colors hover:bg-white/15">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-white/15 text-[10px] font-bold text-white/70">
                {String.fromCharCode(65 + i)}
              </span>
              <span className={opt ? 'text-white' : 'text-white/30'}>
                {opt || `Option ${String.fromCharCode(65 + i)}`}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (slide.type === 'wordcloud') {
    return (
      <div>
        <QuestionText />
        <div className="flex items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2.5">
          <span className="flex-1 text-sm text-white/30">Type one word…</span>
          <span className="rounded-lg bg-hot-pink px-3 py-1.5 text-xs font-semibold text-white">Send</span>
        </div>
      </div>
    )
  }

  if (slide.type === 'openended') {
    return (
      <div>
        <QuestionText />
        <div className="min-h-[56px] rounded-xl bg-white/10 px-3.5 py-3 text-sm text-white/30">
          Share your thoughts…
        </div>
        <div className="mt-2.5 flex justify-end">
          <span className="rounded-xl bg-white/15 px-4 py-1.5 text-xs font-semibold text-white/60">Submit</span>
        </div>
      </div>
    )
  }

  if (slide.type === 'rating') {
    const params = slide.options.some(p => p) ? slide.options : ['Parameter 1', 'Parameter 2', 'Parameter 3']
    return (
      <div>
        <QuestionText />
        <div className="space-y-2">
          {params.slice(0, 3).map((p, i) => (
            <div key={i} className="flex items-center justify-between rounded-xl bg-white/10 px-3.5 py-2.5">
              <span className="text-xs font-medium text-white/70">{p || `Parameter ${i + 1}`}</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map(s => (
                  <Star key={s} className="size-3.5 text-white/20" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return null
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
              <p className="text-lg font-semibold text-midnight-sky-900">Drop your PDF here</p>
              <p className="mt-1.5 text-sm font-light text-midnight-sky-500">
                Export your deck from PowerPoint, Keynote, or Google Slides as a PDF — then drop it here for pixel-perfect slides.
              </p>
            </div>
            <label className="cursor-pointer rounded-xl border border-midnight-sky-200 bg-white px-5 py-2.5 text-sm font-medium text-midnight-sky-700 transition hover:border-midnight-sky-400">
              Browse files
              <input
                type="file" accept=".pdf" className="hidden"
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
