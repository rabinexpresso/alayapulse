import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, ChevronLeft, ChevronRight, X,
  BarChart2, Wifi, ArrowRight,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { cn } from '@/lib/utils'

/* ─────────────────────────────────────────────────────────────────────────
   Presenter full-screen slideshow mode.

   Flow per question slide:
     ① Question phase  — question text + options visible, votes collecting
     ② Results phase   — live animated results (Space / → to advance)

   Keyboard nav:
     → / Space   = next (or reveal results)
     ←           = prev (or hide results)
     Escape       = exit to /create
   ───────────────────────────────────────────────────────────────────────── */

// ── Types ─────────────────────────────────────────────────────────────────

type QType = 'mcq' | 'wordcloud' | 'openended' | 'rating'
type SlidePhase = 'question' | 'results'

interface PdfDemoSlide    { id: string; type: 'pdf';    title: string; subtitle: string }
interface QDemoSlide      { id: string; type: QType;    question: string; options: string[] }
type DemoSlide = PdfDemoSlide | QDemoSlide

// ── Demo deck ─────────────────────────────────────────────────────────────

const DEMO_DECK: DemoSlide[] = [
  { id: 's1', type: 'pdf',       title: 'Leadership Pulse Check',                    subtitle: 'Q3 All-Hands · Alaya' },
  { id: 's2', type: 'mcq',       question: 'What is your biggest leadership challenge right now?',
    options: ['Giving honest feedback', 'Managing team conflict', 'Building trust quickly', 'Motivating others'] },
  { id: 's3', type: 'pdf',       title: "Let's check in on culture",                 subtitle: 'One word from everyone in the room' },
  { id: 's4', type: 'wordcloud', question: 'In one word — how would you describe our team culture right now?',  options: [] },
  { id: 's5', type: 'openended', question: 'What one change would make the biggest difference to your team in the next 90 days?', options: [] },
  { id: 's6', type: 'rating',    question: 'Rate your confidence in these leadership areas:',
    options: ['Giving feedback', 'Decision making', 'Coaching others'] },
]

// ── Demo results data ──────────────────────────────────────────────────────

const MCQ_VOTES = [19, 12, 10, 6]

const CLOUD_WORDS = [
  { text: 'collaborative', count: 18 }, { text: 'innovative',  count: 12 },
  { text: 'challenging',   count: 14 }, { text: 'growth',      count: 10 },
  { text: 'busy',          count: 15 }, { text: 'focused',     count:  9 },
  { text: 'exciting',      count:  7 }, { text: 'trust',       count: 13 },
  { text: 'creative',      count:  8 }, { text: 'driven',      count:  6 },
  { text: 'dynamic',       count: 11 }, { text: 'supportive',  count:  7 },
]

const OPEN_ANSWERS = [
  { name: 'Sarah M.',   text: 'More time for strategic thinking instead of back-to-back meetings.' },
  { name: 'Anonymous',  text: "A clear framework for giving feedback that doesn't feel personal." },
  { name: 'James T.',   text: 'Better tools for async communication across time zones.' },
  { name: 'Anonymous',  text: 'Regular 1:1s with clear agendas so nothing falls through the cracks.' },
  { name: 'Priya K.',   text: 'Psychological safety to try new ideas without fear of failure.' },
]

const RATING_AVGS = [4.2, 3.8, 4.6]

// ── Transition variants ────────────────────────────────────────────────────

const slideVariants = {
  enter: ({ dir, type }: { dir: number; type: 'slide' | 'phase' }) => ({
    opacity: 0,
    x: type === 'slide' ? (dir > 0 ? 60 : -60) : 0,
    y: type === 'phase' ? (dir > 0 ? 24 : -24) : 0,
    scale: type === 'phase' ? 0.97 : 1,
  }),
  center: { opacity: 1, x: 0, y: 0, scale: 1 },
  exit: ({ dir, type }: { dir: number; type: 'slide' | 'phase' }) => ({
    opacity: 0,
    x: type === 'slide' ? (dir > 0 ? -60 : 60) : 0,
    y: type === 'phase' ? (dir > 0 ? -24 : 24) : 0,
    scale: type === 'phase' ? 0.97 : 1,
  }),
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function Present() {
  const { sessionId } = useParams()
  const navigate      = useNavigate()

  const [current,   setCurrent]   = useState(0)
  const [direction, setDirection] = useState(1)
  const [transType, setTransType] = useState<'slide' | 'phase'>('slide')
  const [phase,     setPhase]     = useState<SlidePhase>('question')
  const [audience,  setAudience]  = useState(12)

  const slide      = DEMO_DECK[current]
  const isQuestion = slide.type !== 'pdf'
  const code       = (sessionId ?? 'abc123').slice(0, 6).toUpperCase()
  const joinUrl    = `localhost:5173/join?code=${code}`

  // Simulate audience joining every few seconds
  useEffect(() => {
    const t = setInterval(() => {
      setAudience(prev => Math.min(prev + (Math.random() > 0.55 ? 2 : 1), 63))
    }, 2800)
    return () => clearInterval(t)
  }, [])

  // Navigation
  const goNext = useCallback(() => {
    if (isQuestion && phase === 'question') {
      setTransType('phase'); setDirection(1); setPhase('results')
      return
    }
    if (current >= DEMO_DECK.length - 1) return
    setTransType('slide'); setDirection(1); setPhase('question')
    setCurrent(prev => prev + 1)
  }, [isQuestion, phase, current])

  const goPrev = useCallback(() => {
    if (isQuestion && phase === 'results') {
      setTransType('phase'); setDirection(-1); setPhase('question')
      return
    }
    if (current <= 0) return
    setTransType('slide'); setDirection(-1); setPhase('question')
    setCurrent(prev => prev - 1)
  }, [isQuestion, phase, current])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); goNext() }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')                { e.preventDefault(); goPrev() }
      else if (e.key === 'Escape')                                           { navigate('/create') }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [goNext, goPrev, navigate])

  const canGoPrev = !(current === 0 && !(isQuestion && phase === 'results'))
  const canGoNext = !(current === DEMO_DECK.length - 1 && (!isQuestion || phase === 'results'))

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-midnight-sky-900 text-white">

      {/* Gradient orbs */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -bottom-40 -left-40 size-[600px] rounded-full bg-hot-pink/10 blur-[130px]" />
        <div className="absolute -right-40 -top-40 size-[500px] rounded-full bg-sky-blue/10 blur-[110px]" />
      </div>

      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <header className="relative z-10 flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-6 backdrop-blur-sm">

        {/* Logo + code */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-white">
            alaya <span className="text-hot-pink">pulse</span>
          </span>
          <span className="h-3.5 w-px bg-white/20" />
          <div className="flex items-center gap-1.5">
            <Wifi className="size-3 text-white/30" />
            <span className="font-mono text-xs font-bold tracking-widest text-white/70">{code}</span>
          </div>
        </div>

        {/* Slide counter + nav */}
        <div className="flex items-center gap-2">
          <button
            onClick={goPrev} disabled={!canGoPrev}
            className="rounded-lg p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-[72px] text-center text-xs font-medium text-white/50">
            <span className="text-white/80">{current + 1}</span>
            {' / '}
            {DEMO_DECK.length}
          </span>
          <button
            onClick={goNext} disabled={!canGoNext}
            className="rounded-lg p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>

        {/* Audience count + exit */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs">
            <Users className="size-3 text-white/40" />
            <motion.span
              key={audience}
              animate={{ scale: [1, 1.25, 1] }}
              transition={{ duration: 0.2 }}
              className="tabular-nums font-semibold text-white/80"
            >
              {audience}
            </motion.span>
            <span className="text-white/40">online</span>
          </div>
          <button
            onClick={() => navigate('/create')}
            className="rounded-lg p-1.5 text-white/40 transition hover:bg-white/10 hover:text-white"
            title="Exit (Esc)"
          >
            <X className="size-4" />
          </button>
        </div>
      </header>

      {/* ── Slide area ──────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-1 overflow-hidden">

        <div className="relative flex flex-1 items-center justify-center overflow-hidden">
          <AnimatePresence custom={{ dir: direction, type: transType }} mode="wait">
            <motion.div
              key={`${current}-${phase}`}
              custom={{ dir: direction, type: transType }}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="flex h-full w-full items-center justify-center px-16 py-8"
            >
              <SlideContent
                slide={slide}
                phase={phase}
                audience={audience}
                onReveal={() => { setTransType('phase'); setDirection(1); setPhase('results') }}
              />
            </motion.div>
          </AnimatePresence>

          {/* Left nav hover zone */}
          {canGoPrev && (
            <button
              onClick={goPrev}
              className="absolute left-0 top-0 flex h-full w-24 items-center justify-start pl-5 opacity-0 transition-opacity hover:opacity-100"
            >
              <div className="rounded-full bg-white/10 p-3 backdrop-blur-sm transition hover:bg-white/20">
                <ChevronLeft className="size-6 text-white" />
              </div>
            </button>
          )}

          {/* Right nav hover zone */}
          {canGoNext && (
            <button
              onClick={goNext}
              className="absolute right-0 top-0 flex h-full w-24 items-center justify-end pr-5 opacity-0 transition-opacity hover:opacity-100"
            >
              <div className="rounded-full bg-white/10 p-3 backdrop-blur-sm transition hover:bg-white/20">
                <ChevronRight className="size-6 text-white" />
              </div>
            </button>
          )}
        </div>
      </div>

      {/* ── Bottom bar — always-visible join strip ───────────────────── */}
      <footer className="relative z-10 flex h-[68px] shrink-0 items-center gap-5 border-t border-white/10 px-6">

        {/* QR code */}
        <div className="shrink-0 rounded-xl bg-white p-1.5 shadow-lg">
          <QRCodeSVG
            value={`http://${joinUrl}`}
            size={46}
            bgColor="#ffffff"
            fgColor="#000079"
            level="M"
          />
        </div>

        {/* Join text */}
        <div className="flex flex-col leading-tight">
          <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">Join at</span>
          <span className="text-sm font-medium text-white/80">{joinUrl}</span>
        </div>

        <div className="h-8 w-px shrink-0 bg-white/15" />

        {/* Session code — large + mono */}
        <div className="flex flex-col leading-tight">
          <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">Code</span>
          <span className="font-mono text-2xl font-bold tracking-[0.18em] text-white">
            {code}
          </span>
        </div>

        <div className="flex-1" />

        {/* Live response counter */}
        <div className="flex items-center gap-1.5 text-sm text-white/50">
          <BarChart2 className="size-4" />
          <span className="tabular-nums font-semibold text-white/70">{audience}</span>
          <span>responses</span>
        </div>

        {/* Keyboard hints */}
        <div className="hidden items-center gap-1 text-[10px] text-white/25 lg:flex">
          <kbd className="rounded border border-white/20 px-1.5 py-0.5">←</kbd>
          <kbd className="rounded border border-white/20 px-1.5 py-0.5">→</kbd>
          <span className="ml-1">navigate</span>
          <span className="mx-2 text-white/15">·</span>
          <kbd className="rounded border border-white/20 px-1.5 py-0.5">Esc</kbd>
          <span className="ml-1">exit</span>
        </div>
      </footer>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Slide content — switches between PDF, question, and results views
   ───────────────────────────────────────────────────────────────────────── */

function SlideContent({
  slide, phase, audience, onReveal,
}: {
  slide: DemoSlide
  phase: SlidePhase
  audience: number
  onReveal: () => void
}) {
  if (slide.type === 'pdf') return <PdfSlideView slide={slide} />
  if (phase === 'results')  return <ResultsSlideView slide={slide} />
  return <QuestionSlideView slide={slide} audience={audience} onReveal={onReveal} />
}

/* ─────────────────────────────────────────────────────────────────────────
   PDF placeholder slide
   ───────────────────────────────────────────────────────────────────────── */

function PdfSlideView({ slide }: { slide: PdfDemoSlide }) {
  return (
    <div className="relative flex aspect-video w-full max-w-5xl items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-midnight-sky-800 to-midnight-sky-900 shadow-[0_32px_100px_-16px_rgba(0,0,121,0.5)]">
      {/* Decorative radial */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="size-96 rounded-full bg-hot-pink/8 blur-[100px]" />
      </div>
      <div className="relative z-10 text-center px-14">
        <h1 className="text-5xl font-semibold leading-tight tracking-tight text-white lg:text-6xl xl:text-7xl">
          {slide.title}
        </h1>
        {slide.subtitle && (
          <p className="mt-5 text-xl font-light text-white/45 lg:text-2xl">{slide.subtitle}</p>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Question slide — voting open, collecting responses
   ───────────────────────────────────────────────────────────────────────── */

const QTYPE_META: Record<QType, { label: string; ring: string; bg: string; text: string }> = {
  mcq:       { label: 'Multiple Choice', ring: 'border-sky-blue/40',    bg: 'bg-sky-blue/10',    text: 'text-sky-blue'    },
  wordcloud: { label: 'Word Cloud',       ring: 'border-fresh-green/40', bg: 'bg-fresh-green/10', text: 'text-fresh-green' },
  openended: { label: 'Open-ended',       ring: 'border-golden-sun/40',  bg: 'bg-golden-sun/10',  text: 'text-golden-sun'  },
  rating:    { label: 'Rating',           ring: 'border-hot-pink/40',    bg: 'bg-hot-pink/10',    text: 'text-hot-pink'    },
}

function QuestionSlideView({
  slide, audience, onReveal,
}: {
  slide: QDemoSlide
  audience: number
  onReveal: () => void
}) {
  const meta = QTYPE_META[slide.type]

  return (
    <div className="flex w-full max-w-4xl flex-col items-center gap-8 text-center">

      {/* Type badge */}
      <span className={cn('rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider', meta.ring, meta.bg, meta.text)}>
        {meta.label}
      </span>

      {/* Question */}
      <h1 className="text-4xl font-semibold leading-tight tracking-tight text-white md:text-5xl lg:text-[3.5rem]">
        {slide.question}
      </h1>

      {/* MCQ — show options so audience can follow along */}
      {slide.type === 'mcq' && (
        <div className="grid w-full max-w-2xl grid-cols-2 gap-3">
          {slide.options.map((opt, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-left backdrop-blur-sm"
            >
              <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold', meta.bg, meta.text)}>
                {String.fromCharCode(65 + i)}
              </span>
              <span className="text-sm font-medium text-white/80 leading-snug">{opt}</span>
            </motion.div>
          ))}
        </div>
      )}

      {/* Collecting indicator + reveal button */}
      <div className="flex flex-col items-center gap-4">

        {/* Live pulse */}
        <div className="flex items-center gap-2.5 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 backdrop-blur-sm">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fresh-green opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-fresh-green" />
          </span>
          <span className="text-sm font-medium text-white/70">Collecting responses</span>
          <motion.span
            key={audience}
            animate={{ scale: [1, 1.3, 1] }}
            transition={{ duration: 0.2 }}
            className="tabular-nums font-bold text-white"
          >
            {audience}
          </motion.span>
          <span className="text-sm text-white/40">so far</span>
        </div>

        {/* Show results CTA */}
        <motion.button
          onClick={onReveal}
          whileTap={{ scale: 0.97 }}
          className="flex items-center gap-2.5 rounded-2xl bg-hot-pink px-7 py-3.5 text-sm font-semibold text-white shadow-[0_0_28px_-6px] shadow-hot-pink/60 transition-shadow hover:shadow-[0_0_36px_-4px] hover:shadow-hot-pink/80"
        >
          <BarChart2 className="size-4" />
          Show results
          <span className="flex items-center gap-1 text-white/60 text-xs font-normal">
            or press <kbd className="rounded border border-white/30 px-1 py-0.5 text-[10px] font-mono text-white/70">Space</kbd>
          </span>
        </motion.button>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Results slide — live animated visualizations
   ───────────────────────────────────────────────────────────────────────── */

function ResultsSlideView({ slide }: { slide: QDemoSlide }) {
  const meta = QTYPE_META[slide.type]

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <span className={cn('rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider', meta.ring, meta.bg, meta.text)}>
          Results live
        </span>
        <h2 className="text-2xl font-semibold text-white md:text-3xl">
          {slide.question}
        </h2>
      </div>

      {/* Visualization */}
      {slide.type === 'mcq'       && <MCQResults   options={slide.options} />}
      {slide.type === 'wordcloud' && <WordCloudResults />}
      {slide.type === 'openended' && <OpenEndedResults />}
      {slide.type === 'rating'    && <RatingResults  params={slide.options} />}

      {/* Next hint */}
      <div className="flex justify-end">
        <div className="flex items-center gap-1.5 text-xs text-white/25">
          <ArrowRight className="size-3" />
          <span>Press → to continue</span>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   MCQ Results — animated bars
   ───────────────────────────────────────────────────────────────────────── */

function MCQResults({ options }: { options: string[] }) {
  const total  = MCQ_VOTES.reduce((s, v) => s + v, 0)
  const maxV   = Math.max(...MCQ_VOTES)

  return (
    <div className="flex flex-col gap-4">
      {options.map((opt, i) => {
        const pct      = Math.round((MCQ_VOTES[i] / total) * 100)
        const isWinner = MCQ_VOTES[i] === maxV
        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.08, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="flex items-center gap-4"
          >
            <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold', isWinner ? 'bg-hot-pink text-white' : 'bg-white/10 text-white/50')}>
              {String.fromCharCode(65 + i)}
            </span>
            <span className={cn('w-52 shrink-0 text-base font-medium leading-tight', isWinner ? 'text-white' : 'text-white/65')}>
              {opt}
            </span>
            <div className="relative h-10 flex-1 overflow-hidden rounded-xl bg-white/10">
              <motion.div
                className={cn('absolute inset-y-0 left-0 rounded-xl', isWinner ? 'bg-hot-pink' : 'bg-white/25')}
                initial={{ width: '0%' }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: i * 0.08 }}
              />
              {isWinner && (
                <motion.div
                  className="absolute inset-y-0 left-0 w-full bg-gradient-to-r from-transparent via-white/20 to-transparent"
                  animate={{ x: ['-100%', '200%'] }}
                  transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 1 }}
                />
              )}
            </div>
            <span className={cn('w-14 text-right text-2xl font-bold tabular-nums', isWinner ? 'text-hot-pink' : 'text-white/50')}>
              {pct}%
            </span>
          </motion.div>
        )
      })}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Word Cloud Results — dramatic dark cloud
   ───────────────────────────────────────────────────────────────────────── */

const CLOUD_COLORS = [
  'text-white', 'text-sky-blue', 'text-fresh-green', 'text-white/80',
  'text-golden-sun', 'text-sky-blue/80', 'text-white/70', 'text-fresh-green/80',
]
const ROTATIONS = [-7, -3, 0, 3, 7, -5, 5, -2, 2, 0, -4, 4]

function cloudSize(count: number) {
  if (count >= 17) return 'text-6xl font-bold md:text-7xl'
  if (count >= 13) return 'text-5xl font-bold md:text-6xl'
  if (count >= 10) return 'text-4xl font-semibold md:text-5xl'
  if (count >=  7) return 'text-3xl font-semibold md:text-4xl'
  if (count >=  5) return 'text-2xl font-medium  md:text-3xl'
  return                  'text-xl  font-medium  md:text-2xl'
}

function WordCloudResults() {
  const top = CLOUD_WORDS.reduce((a, b) => a.count > b.count ? a : b).text
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4 py-4">
      {CLOUD_WORDS.map((w, i) => (
        <motion.span
          key={w.text}
          initial={{ opacity: 0, scale: 0.1 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 280, damping: 20, delay: i * 0.05 }}
          style={{ rotate: ROTATIONS[i % ROTATIONS.length] }}
          className={cn(
            cloudSize(w.count),
            w.text === top
              ? 'text-hot-pink drop-shadow-[0_0_24px_rgba(255,0,101,0.65)]'
              : CLOUD_COLORS[i % CLOUD_COLORS.length],
            'select-none leading-none',
          )}
        >
          {w.text}
        </motion.span>
      ))}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Open-ended Results — live answer cards
   ───────────────────────────────────────────────────────────────────────── */

function OpenEndedResults() {
  const [visible, setVisible] = useState<typeof OPEN_ANSWERS>([])

  useEffect(() => {
    setVisible([])
    let i = 0
    const reveal = () => {
      setVisible(OPEN_ANSWERS.slice(0, i + 1))
      i++
      if (i < OPEN_ANSWERS.length) setTimeout(reveal, 1200)
    }
    const t = setTimeout(reveal, 150)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="grid auto-rows-min gap-3 md:grid-cols-2 lg:grid-cols-3">
      <AnimatePresence>
        {visible.map((ans, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm"
          >
            <p className="text-base font-light leading-relaxed text-white/90">"{ans.text}"</p>
            <p className="mt-3 text-xs font-medium text-white/35">— {ans.name}</p>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Rating Results — animated average bars
   ───────────────────────────────────────────────────────────────────────── */

function RatingResults({ params }: { params: string[] }) {
  return (
    <div className="flex flex-col gap-4">
      {params.map((label, idx) => (
        <RatingRow key={idx} label={label} avg={RATING_AVGS[idx] ?? 4.0} delay={idx * 0.13} />
      ))}
    </div>
  )
}

function RatingRow({ label, avg, delay }: { label: string; avg: number; delay: number }) {
  const displayed = useCountUp(Math.round(avg * 10), 950) / 10

  return (
    <motion.div
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
      className="flex items-center gap-6 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 backdrop-blur-sm"
    >
      <span className="w-44 shrink-0 text-lg font-medium text-white">{label}</span>
      <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-white/10">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-hot-pink"
          initial={{ width: '0%' }}
          animate={{ width: `${(avg / 5) * 100}%` }}
          transition={{ duration: 1, delay, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
      <span className="w-16 shrink-0 text-right text-3xl font-bold tabular-nums text-hot-pink">
        {displayed.toFixed(1)}
      </span>
      <span className="text-lg text-white/30">/5</span>
    </motion.div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Shared hook — smooth count-up animation
   ───────────────────────────────────────────────────────────────────────── */

function useCountUp(target: number, duration = 900) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let raf: number
    const start = performance.now()
    const step  = (now: number) => {
      const p = Math.min((now - start) / duration, 1)
      setCount(Math.round((1 - Math.pow(1 - p, 3)) * target))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return count
}
