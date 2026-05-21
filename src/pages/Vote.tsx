import { useState, useEffect } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Send, Star, Sparkles, ArrowRight } from 'lucide-react'
import { AlayaMark, DnaMonogram } from '@/components/AlayaMark'
import { cn } from '@/lib/utils'
import {
  subscribeToSession, submitResponse,
  type Session, type QType,
} from '@/lib/session'

/* ─────────────────────────────────────────────────────────────────────────
   Vote page — the screen every audience member sees on their phone.
   Subscribes to the session doc for live slide / phase changes.
   Responses are submitted via addDoc (no persistent WebSocket per user).
   ───────────────────────────────────────────────────────────────────────── */

export default function Vote() {
  const { sessionCode } = useParams<{ sessionCode: string }>()
  const [searchParams]  = useSearchParams()
  const attendeeName    = searchParams.get('name') ?? ''

  const [session,        setSession]        = useState<Session | null | undefined>(undefined)
  const [submittedSlides, setSubmittedSlides] = useState<Set<string>>(new Set())
  const [submitting,     setSubmitting]     = useState(false)

  // undefined = still loading, null = not found / error
  useEffect(() => {
    if (!sessionCode) { setSession(null); return }
    const unsub = subscribeToSession(sessionCode, s => setSession(s))
    return unsub
  }, [sessionCode])

  // ── Loading ────────────────────────────────────────────────────────────
  if (session === undefined) {
    return <FullPageSpinner />
  }

  // ── Session gone ───────────────────────────────────────────────────────
  if (session === null) {
    return (
      <FullPageMessage
        title="Session not found"
        body="The code may have expired — ask the presenter for a new link."
      />
    )
  }

  // ── Session ended ──────────────────────────────────────────────────────
  if (session.status === 'ended') {
    return <WrapState session={session} attendeeName={attendeeName} />
  }

  const slideData = session.slides[session.currentSlide]
  const slideId   = slideData?.id ?? ''
  const alreadySubmitted = submittedSlides.has(slideId)

  // ── Handle submit for any question type ───────────────────────────────
  const handleSubmit = async (value: string) => {
    if (!slideData || slideData.type === 'pdf' || alreadySubmitted || submitting) return
    setSubmitting(true)
    try {
      await submitResponse(sessionCode!, {
        slideId: slideData.id,
        type:    slideData.type as QType,
        value,
        respondentName: attendeeName || undefined,
      })
      setSubmittedSlides(prev => new Set([...prev, slideData.id]))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Waiting state: only PDF slides. Results phase keeps question open
  //    so audience can still answer while the presenter views live results.
  const isWaiting = !slideData || slideData.type === 'pdf'
  const isResultsPhase = session.currentPhase === 'results'

  // Total slides (question slides only) for progress bar
  const questionSlides = session.slides.filter(s => s.type !== 'pdf')
  const questionIdx    = questionSlides.findIndex(s => s.id === slideId)
  const progressPct    = questionSlides.length > 0
    ? ((questionIdx + 1) / questionSlides.length) * 100
    : 0

  return (
    <main className="flex min-h-screen flex-col bg-white">
      {/* Top progress bar */}
      <motion.div
        className="h-1 shrink-0 bg-hot-pink"
        animate={{ width: `${progressPct}%` }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        style={{ width: 0 }}
      />

      {/* Header */}
      <header className="flex shrink-0 items-center justify-between px-5 py-4">
        <Link to="/"><AlayaMark /></Link>
        {attendeeName && (
          <span className="text-sm font-light text-midnight-sky-500">
            Hi, {attendeeName}
          </span>
        )}
      </header>

      {/* Content */}
      <div className="flex flex-1 flex-col overflow-y-auto px-5 pb-8 pt-2">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${slideId}-${session.currentPhase}`}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-1 flex-col"
          >
            {isWaiting ? (
              <WaitingState sessionCode={sessionCode} />
            ) : alreadySubmitted ? (
              <SubmittedState />
            ) : (
              <>
                {/* "Results are live" nudge — shown when presenter has revealed results */}
                <AnimatePresence>
                  {isResultsPhase && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="mb-4 flex items-center gap-2 rounded-xl bg-hot-pink/8 px-4 py-2.5 text-sm text-hot-pink"
                    >
                      <span className="relative flex size-2 shrink-0">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-hot-pink opacity-60" />
                        <span className="relative inline-flex size-2 rounded-full bg-hot-pink" />
                      </span>
                      Results are live on screen — you can still submit your answer!
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Question text */}
                <h2 className="mb-6 text-xl font-semibold leading-snug text-midnight-sky-900 sm:text-2xl">
                  {(slideData as { question: string }).question}
                </h2>

                {slideData.type === 'mcq' && (
                  <MCQQuestion
                    options={(slideData as { options: string[] }).options}
                    submitting={submitting}
                    onSubmit={idx => handleSubmit(String(idx))}
                  />
                )}
                {slideData.type === 'wordcloud' && (
                  <WordCloudQuestion
                    submitting={submitting}
                    onSubmit={word => handleSubmit(word)}
                  />
                )}
                {slideData.type === 'openended' && (
                  <OpenEndedQuestion
                    submitting={submitting}
                    onSubmit={text => handleSubmit(text)}
                  />
                )}
                {slideData.type === 'rating' && (
                  <RatingQuestion
                    parameters={(slideData as { options: string[] }).options}
                    submitting={submitting}
                    onSubmit={ratings => handleSubmit(JSON.stringify(ratings))}
                  />
                )}
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </main>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Waiting state — shown when the current slide is a PDF / transition slide
   ───────────────────────────────────────────────────────────────────────── */

function WaitingState({ sessionCode }: { sessionCode?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-1 flex-col items-center justify-center gap-8 py-10 text-center"
    >
      {/* Animated concentric rings with DNA monogram centre */}
      <div className="relative flex size-36 items-center justify-center">
        {[0, 1, 2].map(i => (
          <motion.span
            key={i}
            className="absolute inset-0 rounded-full border border-midnight-sky-200"
            animate={{ scale: [1, 1.75], opacity: [0.55, 0] }}
            transition={{
              duration: 2.6,
              repeat: Infinity,
              ease: 'easeOut',
              delay: i * 0.75,
            }}
          />
        ))}
        {/* Centre orb */}
        <div className="relative flex size-20 items-center justify-center rounded-full bg-gradient-to-br from-midnight-sky-50 to-midnight-sky-100 shadow-[inset_0_1px_2px_rgba(0,0,121,0.12)]">
          <DnaMonogram className="h-8 w-auto" animate={false} />
        </div>
      </div>

      <div>
        <h3 className="text-2xl font-semibold text-midnight-sky-900">Hang tight</h3>
        <p className="mt-2 font-light text-midnight-sky-500">
          The next question is on its way…
        </p>
      </div>

      {sessionCode && (
        <div className="flex items-center gap-2 rounded-full bg-midnight-sky-50 px-4 py-1.5">
          <span className="text-xs text-midnight-sky-400">Session</span>
          <span className="font-mono text-sm font-semibold tracking-widest text-midnight-sky-700">
            {sessionCode}
          </span>
        </div>
      )}

      <p className="text-xs text-midnight-sky-400">
        Keep this page open — questions appear here automatically
      </p>
    </motion.div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Submitted state — shown after any question is answered
   ───────────────────────────────────────────────────────────────────────── */

function SubmittedState() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-1 flex-col items-center justify-center gap-6 py-10 text-center"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 18, delay: 0.1 }}
        className="flex size-20 items-center justify-center rounded-full bg-hot-pink shadow-[0_0_40px_-4px] shadow-hot-pink/50"
      >
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.28, duration: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
        >
          <Check className="size-10 text-white" strokeWidth={3} />
        </motion.div>
      </motion.div>

      <div>
        <h3 className="text-2xl font-semibold text-midnight-sky-900">Response recorded</h3>
        <p className="mt-2 font-light text-midnight-sky-500">
          Waiting for the next question…
        </p>
      </div>
    </motion.div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Wrap state — full-page dark screen shown when the session has ended
   ───────────────────────────────────────────────────────────────────────── */

function WrapState({ session, attendeeName }: { session: Session; attendeeName?: string }) {
  return (
    <motion.main
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.55 }}
      className="relative flex min-h-screen flex-col overflow-hidden bg-midnight-sky-900"
    >
      {/* Soft gradient orbs */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute left-1/2 top-[-8%] h-80 w-80 -translate-x-1/2 rounded-full bg-hot-pink/12 blur-3xl" />
        <div className="absolute bottom-[-5%] left-[-8%] h-56 w-56 rounded-full bg-sky-blue/10 blur-3xl" />
        <div className="absolute bottom-[-5%] right-[-8%] h-56 w-56 rounded-full bg-fresh-green/10 blur-3xl" />
      </div>

      {/* Main content */}
      <div className="relative flex flex-1 flex-col items-center justify-center gap-8 px-6 pb-20 text-center">

        {/* Celebration icon */}
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1], delay: 0.1 }}
          className="flex size-24 items-center justify-center rounded-full bg-golden-sun/10 ring-1 ring-golden-sun/25"
        >
          <Sparkles className="size-10 text-golden-sun" />
        </motion.div>

        {/* Heading + subtitle */}
        <div className="max-w-xs">
          <motion.h2
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="text-3xl font-semibold text-white sm:text-4xl"
          >
            That's a wrap!
          </motion.h2>

          {session.title && session.title !== 'Untitled session' && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.32 }}
              className="mt-1.5 text-sm font-light tracking-wide text-white/40"
            >
              {session.title}
            </motion.p>
          )}

          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.38, ease: [0.16, 1, 0.3, 1] }}
            className="mt-4 text-base font-light leading-relaxed text-white/65"
          >
            {attendeeName
              ? `Great work, ${attendeeName}! Your responses have been recorded.`
              : 'Thanks for participating! Your responses have been recorded.'}
          </motion.p>
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.52, ease: [0.16, 1, 0.3, 1] }}
        >
          <Link
            to="/join"
            className="inline-flex items-center gap-2 rounded-2xl border border-white/18 bg-white/8 px-6 py-3 text-sm font-medium text-white/85 backdrop-blur-sm transition hover:bg-white/14 hover:text-white"
          >
            Join another session
            <ArrowRight className="size-4" />
          </Link>
        </motion.div>
      </div>

      {/* Footer logo */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
        <DnaMonogram className="h-7 w-auto opacity-25" animate={false} />
      </div>
    </motion.main>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   1. MCQ — tap-to-select option cards
   ───────────────────────────────────────────────────────────────────────── */

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F']

function MCQQuestion({
  options, submitting, onSubmit,
}: {
  options:   string[]
  submitting: boolean
  onSubmit:  (idx: number) => void
}) {
  const [selected, setSelected] = useState<number | null>(null)

  return (
    <div className="flex flex-1 flex-col gap-3">
      {options.map((opt, i) => {
        const isSelected = selected === i
        return (
          <motion.button
            key={i}
            onClick={() => !submitting && setSelected(i)}
            whileTap={{ scale: 0.98 }}
            animate={isSelected ? { scale: [1, 1.02, 1] } : { scale: 1 }}
            transition={{ duration: 0.25, ease: [0.34, 1.56, 0.64, 1] }}
            className={cn(
              'relative flex w-full items-center gap-3 overflow-hidden rounded-2xl border-2 px-4 py-4 text-left transition-all duration-200',
              isSelected
                ? 'border-hot-pink bg-[#ff0065]/[0.06]'
                : 'border-midnight-sky-200 bg-white hover:border-midnight-sky-300 hover:bg-midnight-sky-50/50',
            )}
          >
            <AnimatePresence>
              {isSelected && (
                <motion.span
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  exit={{ scaleY: 0 }}
                  className="absolute inset-y-0 left-0 w-1 origin-center bg-hot-pink"
                />
              )}
            </AnimatePresence>

            <span className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold transition-all duration-200',
              isSelected ? 'bg-hot-pink text-white' : 'bg-midnight-sky-100 text-midnight-sky-600',
            )}>
              {OPTION_LABELS[i]}
            </span>

            <span className={cn(
              'flex-1 text-sm font-medium leading-snug transition-colors duration-200 sm:text-base',
              isSelected ? 'text-hot-pink' : 'text-midnight-sky-800',
            )}>
              {opt}
            </span>

            <AnimatePresence>
              {isSelected && (
                <motion.span
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-hot-pink"
                >
                  <Check className="size-3.5 text-white" strokeWidth={3} />
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        )
      })}

      <AnimatePresence>
        {selected !== null && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="mt-2"
          >
            <SubmitButton
              onClick={() => selected !== null && onSubmit(selected)}
              loading={submitting}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   2. Word Cloud — type a word and submit
   ───────────────────────────────────────────────────────────────────────── */

function WordCloudQuestion({
  submitting, onSubmit,
}: {
  submitting: boolean
  onSubmit:  (word: string) => void
}) {
  const [input, setInput] = useState('')
  const MAX = 30

  const handleSubmit = () => {
    const trimmed = input.trim()
    if (!trimmed || submitting) return
    onSubmit(trimmed.toLowerCase())
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value.slice(0, MAX))}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="Type one word or short phrase…"
          disabled={submitting}
          className={cn(
            'flex-1 rounded-2xl border-2 border-midnight-sky-200 bg-white px-4 py-3.5 text-base text-midnight-sky-900 placeholder:text-midnight-sky-400',
            'outline-none transition-all focus:border-hot-pink focus:ring-2 focus:ring-hot-pink/15',
            'disabled:opacity-50',
          )}
        />
        <motion.button
          onClick={handleSubmit}
          whileTap={{ scale: 0.92 }}
          disabled={!input.trim() || submitting}
          className={cn(
            'flex size-[52px] shrink-0 items-center justify-center rounded-2xl transition-all',
            input.trim() && !submitting
              ? 'bg-hot-pink text-white shadow-[0_0_20px_-4px] shadow-hot-pink/50'
              : 'bg-midnight-sky-100 text-midnight-sky-400 cursor-not-allowed',
          )}
        >
          {submitting ? <LoadingDots /> : <Send className="size-4" />}
        </motion.button>
      </div>
      <p className="mt-[-10px] text-right text-xs text-midnight-sky-400">{input.length}/{MAX}</p>

      <div className="mt-4 rounded-2xl bg-midnight-sky-50 p-5 text-center">
        <p className="text-sm font-light text-midnight-sky-500">
          Your word will appear in the live cloud on the presenter's screen.
        </p>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   3. Open-ended — textarea + submit
   ───────────────────────────────────────────────────────────────────────── */

function OpenEndedQuestion({
  submitting, onSubmit,
}: {
  submitting: boolean
  onSubmit:  (text: string) => void
}) {
  const [text, setText] = useState('')
  const MAX = 280

  const handleSubmit = () => {
    const trimmed = text.trim()
    if (!trimmed || submitting) return
    onSubmit(trimmed)
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="relative">
        <textarea
          value={text}
          onChange={e => setText(e.target.value.slice(0, MAX))}
          placeholder="Share your thoughts…"
          rows={5}
          disabled={submitting}
          className={cn(
            'w-full resize-none rounded-2xl border-2 border-midnight-sky-200 bg-white px-4 py-3.5 pb-7 text-base text-midnight-sky-900 placeholder:text-midnight-sky-400',
            'outline-none transition-all focus:border-hot-pink focus:ring-2 focus:ring-hot-pink/15',
            'disabled:opacity-50',
          )}
        />
        <span className="absolute bottom-3 right-4 text-xs text-midnight-sky-400">
          {text.length}/{MAX}
        </span>
      </div>

      <AnimatePresence>
        {text.trim() && !submitting && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <SubmitButton onClick={handleSubmit} label="Submit answer" loading={submitting} />
          </motion.div>
        )}
      </AnimatePresence>

      {submitting && (
        <div className="flex justify-center py-2">
          <LoadingDots color="pink" />
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   4. Rating — interactive star rows, one per parameter
   ───────────────────────────────────────────────────────────────────────── */

function RatingQuestion({
  parameters, submitting, onSubmit,
}: {
  parameters: string[]
  submitting: boolean
  onSubmit:  (ratings: number[]) => void
}) {
  const [ratings, setRatings] = useState<(number | null)[]>(Array(parameters.length).fill(null))
  const [hovered, setHovered] = useState<{ row: number; star: number } | null>(null)

  const allRated = ratings.every(r => r !== null)

  const setRating = (row: number, star: number) =>
    setRatings(prev => { const n = [...prev]; n[row] = star; return n })

  return (
    <div className="flex flex-1 flex-col gap-4">
      {parameters.map((param, row) => (
        <motion.div
          key={param}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: row * 0.09, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-2xl border-2 border-midnight-sky-200 bg-white px-5 py-4 transition-colors"
          style={ratings[row] !== null ? { borderColor: 'rgba(255,0,101,0.3)', background: 'rgba(255,0,101,0.03)' } : {}}
        >
          <p className="mb-3 text-sm font-semibold text-midnight-sky-800">{param}</p>
          <div className="flex items-center gap-1" onMouseLeave={() => setHovered(null)}>
            {[1, 2, 3, 4, 5].map(star => {
              const active = hovered?.row === row
                ? star <= hovered.star
                : star <= (ratings[row] ?? 0)
              return (
                <motion.button
                  key={star}
                  onClick={() => !submitting && setRating(row, star)}
                  onMouseEnter={() => !submitting && setHovered({ row, star })}
                  whileTap={{ scale: 0.82 }}
                  animate={active && ratings[row] === star ? { scale: [1, 1.25, 1] } : {}}
                  transition={{ duration: 0.22, ease: [0.34, 1.56, 0.64, 1] }}
                  className="touch-manipulation rounded-lg p-1 focus:outline-none"
                >
                  <Star className={cn(
                    'size-8 transition-all duration-150',
                    active
                      ? 'fill-hot-pink text-hot-pink drop-shadow-[0_0_8px_rgba(255,0,101,0.45)]'
                      : 'fill-midnight-sky-100 text-midnight-sky-200',
                  )} />
                </motion.button>
              )
            })}
            <AnimatePresence>
              {ratings[row] !== null && (
                <motion.span
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="ml-1 text-sm font-bold text-hot-pink"
                >
                  {ratings[row]}/5
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      ))}

      <AnimatePresence>
        {allRated && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <SubmitButton
              onClick={() => onSubmit(ratings.map(r => r ?? 0))}
              label="Submit ratings"
              loading={submitting}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Full-page helpers
   ───────────────────────────────────────────────────────────────────────── */

function FullPageSpinner() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-white">
      <AlayaMark />
      <LoadingDots color="pink" />
    </main>
  )
}

function FullPageMessage({ title, body, icon }: { title: string; body: string; icon?: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white px-6 text-center">
      {icon && <span className="text-5xl">{icon}</span>}
      <h2 className="text-2xl font-semibold text-midnight-sky-900">{title}</h2>
      <p className="max-w-xs font-light text-midnight-sky-500">{body}</p>
      <Link
        to="/"
        className="mt-4 rounded-xl bg-midnight-sky-100 px-5 py-2.5 text-sm font-medium text-midnight-sky-700 transition hover:bg-midnight-sky-200"
      >
        Go home
      </Link>
    </main>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Shared hot-pink submit button
   ───────────────────────────────────────────────────────────────────────── */

function SubmitButton({
  onClick, label = 'Submit', loading = false,
}: {
  onClick:  () => void
  label?:   string
  loading?: boolean
}) {
  return (
    <motion.button
      onClick={onClick}
      disabled={loading}
      whileTap={{ scale: 0.97 }}
      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-hot-pink px-6 py-4 text-base font-medium text-white shadow-[0_0_24px_-6px] shadow-hot-pink/50 transition-all hover:shadow-[0_0_36px_-4px] hover:shadow-hot-pink/70 disabled:opacity-70"
    >
      {loading ? <LoadingDots /> : <>{label}<Send className="size-4" /></>}
    </motion.button>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Loading Dots
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
