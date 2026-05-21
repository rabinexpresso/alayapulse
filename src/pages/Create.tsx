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
  ArrowLeft, LayoutList,
} from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import { AlayaMark } from '@/components/AlayaMark'
import { cn } from '@/lib/utils'

/* ─────────────────────────────────────────────────────────────────────────
   PDF.js worker — Vite resolves new URL() at build time, so the worker
   file is automatically copied to /dist. No CDN dependency needed.
   ───────────────────────────────────────────────────────────────────────── */
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href

/* ─────────────────────────────────────────────────────────────────────────
   Types
   ───────────────────────────────────────────────────────────────────────── */

type QType = 'mcq' | 'wordcloud' | 'openended' | 'rating'

interface PdfSlide {
  id: string
  type: 'pdf'
  pageNum: number
  imgUrl: string
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
  const resumeCode   = returnState.sessionCode as string | undefined  // existing session to resume

  const [slides, setSlides]         = useState<Slide[]>(returnState.slides ?? [])
  const [selectedId, setSelectedId] = useState<string | null>(returnState.slides?.[0]?.id ?? null)
  const [deckTitle, setDeckTitle]   = useState(returnState.deckTitle ?? 'Untitled session')
  const [isImporting, setImporting] = useState(false)
  const [isStarting,  setStarting]  = useState(false)
  const [addMenuAfter, setAddMenu]  = useState<string | undefined>(undefined)
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
            onClick={() => navigate('/')}
            className="flex items-center gap-1.5 text-sm text-midnight-sky-500 transition-colors hover:text-midnight-sky-800"
          >
            <ArrowLeft className="size-4" />
            Back
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
            <img src={slide.imgUrl} alt={`Page ${slide.pageNum}`} className="h-full w-full object-cover" />
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
    <div className="flex flex-1 flex-col overflow-auto px-10 py-8">
      <QuestionEditor slide={slide} onUpdate={patch => onUpdate(slide.id, patch)} />
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
    <div className="mx-auto w-full max-w-2xl">

      {/* Type chip */}
      <motion.div
        key={slide.id}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className={cn(
          'mb-5 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold',
          'bg-midnight-sky-50',
          qInfo.color,
        )}>
          {qInfo.icon}
          {qInfo.label}
        </div>

        {/* Question text */}
        <div className="mb-6">
          <label className="mb-1.5 block text-sm font-medium text-midnight-sky-700">
            Question text
          </label>
          <textarea
            value={slide.question}
            onChange={e => onUpdate({ question: e.target.value })}
            placeholder={PLACEHOLDERS[slide.type]}
            rows={3}
            className="w-full resize-none rounded-2xl border border-midnight-sky-200 bg-white px-4 py-3 text-base text-midnight-sky-900 placeholder:font-light placeholder:text-midnight-sky-400 outline-none transition-all focus:border-hot-pink focus:ring-2 focus:ring-hot-pink/15"
          />
        </div>

        {/* Type-specific fields */}
        {slide.type === 'mcq' && <MCQEditor slide={slide} onUpdate={onUpdate} />}
        {slide.type === 'rating' && <RatingEditor slide={slide} onUpdate={onUpdate} />}
        {(slide.type === 'wordcloud' || slide.type === 'openended') && (
          <div className="mb-6 rounded-2xl border border-dashed border-midnight-sky-200 bg-midnight-sky-50 p-5 text-center">
            <p className="text-sm font-light text-midnight-sky-500">
              {slide.type === 'wordcloud'
                ? 'Audience members type one word each. Results appear as a live word cloud on the big screen.'
                : 'Audience members type a short answer (up to 280 characters). Responses stream in live on the big screen.'}
            </p>
          </div>
        )}

        {/* Audience preview card */}
        <div className="mt-2 rounded-2xl border border-midnight-sky-100 bg-midnight-sky-50 p-5">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-midnight-sky-400">
            Audience preview
          </p>
          <SlidePreviewCard slide={slide} />
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
    <p className="mb-3 text-sm font-semibold text-midnight-sky-900">
      {empty ? <span className="font-light text-midnight-sky-400">Your question appears here</span> : slide.question}
    </p>
  )

  if (slide.type === 'mcq') {
    const opts = slide.options.some(o => o) ? slide.options : ['Option A', 'Option B', 'Option C', 'Option D']
    return (
      <div>
        <QuestionText />
        <div className="space-y-1.5">
          {opts.map((opt, i) => (
            <div key={i} className="flex items-center gap-2 rounded-xl border border-midnight-sky-200 bg-white px-3 py-2 text-sm text-midnight-sky-700">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-lg bg-midnight-sky-100 text-[10px] font-bold text-midnight-sky-600">
                {String.fromCharCode(65 + i)}
              </span>
              {opt || <span className="text-midnight-sky-400">{`Option ${String.fromCharCode(65 + i)}`}</span>}
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
        <div className="flex items-center gap-2 rounded-2xl border border-midnight-sky-200 bg-white px-3 py-2.5">
          <span className="flex-1 text-sm text-midnight-sky-400">Type one word…</span>
          <span className="rounded-lg bg-hot-pink px-2.5 py-1 text-xs font-medium text-white">Send</span>
        </div>
      </div>
    )
  }

  if (slide.type === 'openended') {
    return (
      <div>
        <QuestionText />
        <div className="rounded-2xl border border-midnight-sky-200 bg-white px-3 py-2.5 text-sm text-midnight-sky-400">
          Share your thoughts…
        </div>
        <div className="mt-2 flex justify-end">
          <span className="rounded-xl bg-midnight-sky-200 px-3 py-1.5 text-xs font-medium text-midnight-sky-500">Submit</span>
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
            <div key={i} className="flex items-center justify-between rounded-xl border border-midnight-sky-200 bg-white px-3 py-2">
              <span className="text-xs text-midnight-sky-700">{p || `Parameter ${i + 1}`}</span>
              <div className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map(s => (
                  <Star key={s} className="size-3.5 text-midnight-sky-200" />
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
