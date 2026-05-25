import { useState, useEffect, useRef } from 'react'
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Send, LogOut, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  subscribeToSession, submitResponse, joinAsViewer,
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
  const navigate        = useNavigate()

  const [session,        setSession]        = useState<Session | null | undefined>(undefined)
  // Persist submitted slides to sessionStorage so a page refresh doesn't let someone vote twice
  const storageKey = `alaya-submitted-${sessionCode ?? ''}`
  const [submittedSlides, setSubmittedSlides] = useState<Set<string>>(() => {
    try {
      const stored = sessionStorage.getItem(`alaya-submitted-${sessionCode ?? ''}`)
      return stored ? new Set<string>(JSON.parse(stored) as string[]) : new Set<string>()
    } catch { return new Set<string>() }
  })
  const [submitting,      setSubmitting]      = useState(false)
  const [submitError,     setSubmitError]     = useState<string | null>(null)
  const [showLeaveModal,  setShowLeaveModal]  = useState(false)
  // Timer countdown — read from session.timerEndsAt, computed client-side
  const [timerSecsLeft,   setTimerSecsLeft]   = useState<number | null>(null)
  const timerIntervalRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  // Leave the room — clear locally stored submitted-slide markers so the
  // attendee can vote fresh if they later rejoin a different session.
  const leaveRoom = () => {
    try { sessionStorage.removeItem(storageKey) } catch {}
    navigate('/join')
  }

  // undefined = still loading, null = not found / error
  useEffect(() => {
    if (!sessionCode) { setSession(null); return }
    const unsub = subscribeToSession(sessionCode, s => setSession(s))
    return unsub
  }, [sessionCode])

  // Register presence so the presenter can see how many people are watching
  useEffect(() => {
    if (!sessionCode) return
    return joinAsViewer(sessionCode)
  }, [sessionCode])

  // Countdown from session.timerEndsAt — each client computes locally from the absolute timestamp
  useEffect(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current)
      timerIntervalRef.current = null
    }
    const endsAt = (session as Session | null)?.timerEndsAt ?? null
    if (!endsAt || endsAt <= Date.now()) {
      setTimerSecsLeft(endsAt && endsAt <= Date.now() ? 0 : null)
      return
    }
    // Set immediately, then tick every 250 ms
    setTimerSecsLeft(Math.ceil((endsAt - Date.now()) / 1000))
    timerIntervalRef.current = setInterval(() => {
      const remaining = Math.ceil((endsAt - Date.now()) / 1000)
      setTimerSecsLeft(Math.max(0, remaining))
      if (remaining <= 0) {
        clearInterval(timerIntervalRef.current!)
        timerIntervalRef.current = null
      }
    }, 250)
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(session as Session | null)?.timerEndsAt])

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
  const INTERACTIVE_TYPES = new Set(['mcq', 'wordcloud', 'openended', 'rating'])

  const handleSubmit = async (value: string) => {
    const sType = (slideData as { type: string } | undefined)?.type ?? ''
    if (!slideData || !INTERACTIVE_TYPES.has(sType) || alreadySubmitted || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await submitResponse(sessionCode!, {
        slideId: slideData.id,
        type:    slideData.type as QType,
        value,
        respondentName: attendeeName || 'Anonymous',
      })
      setSubmittedSlides(prev => {
        const next = new Set([...prev, slideData.id])
        try { sessionStorage.setItem(storageKey, JSON.stringify([...next])) } catch {}
        return next
      })
    } catch (err) {
      console.error('Submit failed:', err)
      setSubmitError('Could not send your response — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Waiting state: non-interactive slides (pdf, image, video)
  const isWaiting      = !slideData || !INTERACTIVE_TYPES.has((slideData as { type: string }).type)
  const isResultsPhase = session.currentPhase === 'results'
  const timerDuration  = session.timerDuration ?? null
  const timerExpired   = timerSecsLeft === 0 && !isResultsPhase

  // Total slides (question slides only) for progress bar
  const questionSlides = session.slides.filter(s => INTERACTIVE_TYPES.has((s as { type: string }).type))
  const questionIdx    = questionSlides.findIndex(s => s.id === slideId)
  const progressPct    = questionSlides.length > 0
    ? ((questionIdx + 1) / questionSlides.length) * 100
    : 0

  return (
    <main className="flex min-h-screen flex-col bg-white">
      {/* Top progress bar (question progress) */}
      <motion.div
        className="h-1 shrink-0 bg-hot-pink"
        animate={{ width: `${progressPct}%` }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        style={{ width: 0 }}
      />

      {/* Timer bar — shows while a countdown is active */}
      {timerSecsLeft !== null && timerDuration && (
        <div className="relative h-1.5 w-full shrink-0 bg-midnight-sky-100">
          <motion.div
            className={cn(
              'h-full',
              timerSecsLeft <= 10 ? 'bg-hot-pink' : timerSecsLeft <= 30 ? 'bg-golden-sun' : 'bg-sky-blue',
            )}
            animate={{ width: `${Math.max(0, (timerSecsLeft / timerDuration) * 100)}%` }}
            transition={{ duration: 0.3, ease: 'linear' }}
          />
          {/* Seconds label at the right end */}
          <span className={cn(
            'absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] font-bold tabular-nums',
            timerSecsLeft <= 10 ? 'text-hot-pink' : 'text-midnight-sky-500',
          )}>
            {timerSecsLeft}s
          </span>
        </div>
      )}

      {/* Header */}
      <header className="flex shrink-0 items-center justify-between gap-3 px-5 py-4">
        <span className="text-sm font-bold tracking-tight text-midnight-sky-900">
          alaya <span className="text-hot-pink">pulse</span>
        </span>
        <div className="flex items-center gap-3">
          {attendeeName && (
            <span className="text-sm font-medium text-midnight-sky-600">
              Hi, {attendeeName}
            </span>
          )}
          <button
            onClick={() => setShowLeaveModal(true)}
            className="flex items-center gap-1.5 rounded-full border border-midnight-sky-200 px-3 py-1.5 text-xs font-medium text-midnight-sky-500 transition-all hover:border-hot-pink/40 hover:bg-hot-pink/5 hover:text-hot-pink active:scale-95"
            aria-label="Leave room"
          >
            <LogOut className="size-3.5" />
            Leave
          </button>
        </div>
      </header>

      {/* Leave room confirmation modal */}
      <AnimatePresence>
        {showLeaveModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center"
            onClick={() => setShowLeaveModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.96 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-sm rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl sm:p-7"
            >
              <h3 className="text-lg font-semibold text-midnight-sky-900">Leave this room?</h3>
              <p className="mt-1.5 text-sm font-light text-midnight-sky-500">
                You'll be sent back to the join page where you can enter a different session code.
              </p>
              <div className="mt-6 flex gap-2.5">
                <button
                  onClick={() => setShowLeaveModal(false)}
                  className="flex-1 rounded-xl border border-midnight-sky-200 bg-white py-3 text-sm font-medium text-midnight-sky-700 transition hover:bg-midnight-sky-50 active:scale-[0.98]"
                >
                  Stay
                </button>
                <button
                  onClick={leaveRoom}
                  className="flex-1 rounded-xl bg-hot-pink py-3 text-sm font-medium text-white shadow-[0_0_20px_-4px] shadow-hot-pink/40 transition hover:shadow-[0_0_28px_-2px] hover:shadow-hot-pink/60 active:scale-[0.98]"
                >
                  Leave room
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      <div className="flex flex-1 flex-col overflow-y-auto px-5 pb-8 pt-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
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
            ) : timerExpired ? (
              <TimesUpState />
            ) : alreadySubmitted ? (
              <SubmittedState />
            ) : (
              <>
                {/* Submission error banner */}
                <AnimatePresence>
                  {submitError && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="mb-4 flex items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600"
                    >
                      <span>{submitError}</span>
                      <button onClick={() => setSubmitError(null)} className="shrink-0 text-red-400 transition hover:text-red-600">✕</button>
                    </motion.div>
                  )}
                </AnimatePresence>

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

                {/* Optional slide image */}
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(slideData as any).imgUrl && (
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  <img
                    src={(slideData as any).imgUrl as string}
                    alt=""
                    className="mb-4 h-32 w-full max-w-xs rounded-xl object-cover shadow-sm"
                  />
                )}

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
                {slideData.type === 'rating' && (() => {
                  const sd = slideData as {
                    options: string[]
                    ratingMax?: number
                    leftLabels?: string[]; rightLabels?: string[]
                    leftLabel?: string;    rightLabel?: string
                  }
                  // Per-parameter labels with slide-wide fallback for older decks
                  const lefts  = sd.leftLabels  ?? sd.options.map(() => sd.leftLabel  ?? '')
                  const rights = sd.rightLabels ?? sd.options.map(() => sd.rightLabel ?? '')
                  return (
                    <RatingQuestion
                      parameters ={sd.options}
                      ratingMax  ={Number(sd.ratingMax) === 10 ? 10 : 5}
                      leftLabels ={lefts}
                      rightLabels={rights}
                      submitting ={submitting}
                      onSubmit   ={ratings => handleSubmit(JSON.stringify(ratings))}
                    />
                  )
                })()}
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
          <span className="text-[11px] font-bold tracking-tight text-midnight-sky-700">
            alaya<br /><span className="text-hot-pink">pulse</span>
          </span>
        </div>
      </div>

      <div>
        <h3 className="text-2xl font-semibold text-midnight-sky-900">Hang tight</h3>
        <p className="mt-2 font-light text-midnight-sky-700">
          The next question is on its way…
        </p>
      </div>

      {sessionCode && (
        <div className="flex items-center gap-2 rounded-full bg-midnight-sky-100 px-4 py-1.5">
          <span className="text-xs font-medium text-midnight-sky-500">Session</span>
          <span className="font-mono text-sm font-bold tracking-widest text-midnight-sky-800">
            {sessionCode}
          </span>
        </div>
      )}

      <p className="text-xs font-medium text-midnight-sky-600">
        Keep this page open — questions appear here automatically
      </p>
    </motion.div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Time's up state — timer expired before the user responded
   ───────────────────────────────────────────────────────────────────────── */

function TimesUpState() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-1 flex-col items-center justify-center gap-6 py-10 text-center"
    >
      {/* Hot-pink clock icon */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 18, delay: 0.1 }}
        className="flex size-20 items-center justify-center rounded-full bg-hot-pink/10"
      >
        <Clock className="size-10 text-hot-pink" />
      </motion.div>
      <div>
        <h3 className="text-2xl font-semibold text-midnight-sky-900">Time's up!</h3>
        <p className="mt-2 font-light text-midnight-sky-500">
          The presenter will show results shortly.
        </p>
      </div>
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

function WrapState({ session: _session, attendeeName }: { session: Session; attendeeName?: string }) {
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
      <div className="relative flex flex-1 flex-col items-center justify-center gap-8 px-6 pb-8 text-center">

        {/* alaya pulse brand */}
        <motion.span
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="text-base font-bold tracking-tight text-white"
        >
          alaya <span className="text-hot-pink">pulse</span>
        </motion.span>

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

          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.38, ease: [0.16, 1, 0.3, 1] }}
            className="mt-4 text-base font-light leading-relaxed text-white/65"
          >
            {attendeeName
              ? <>Great work, {attendeeName}!<br />Your responses have been recorded.</>
              : <>Thanks for participating!<br />Your responses have been recorded.</>}
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
            className="inline-flex items-center rounded-2xl border border-white/18 bg-white/8 px-6 py-3 text-sm font-medium text-white/85 backdrop-blur-sm transition hover:bg-white/14 hover:text-white"
          >
            Join another session
          </Link>
        </motion.div>
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
  parameters, ratingMax = 5, leftLabels = [], rightLabels = [], submitting, onSubmit,
}: {
  parameters: string[]
  ratingMax?: 5 | 10
  leftLabels?:  string[]
  rightLabels?: string[]
  submitting: boolean
  onSubmit:  (ratings: number[]) => void
}) {
  // -1 means "not yet rated". Submitted values are integers 0..ratingMax.
  const [ratings, setRatings] = useState<number[]>(Array(parameters.length).fill(-1))
  // Build [0..N] scale — audience may want to vote 0 (e.g. "Terrible")
  const SCALE = Array.from({ length: ratingMax + 1 }, (_, i) => i)
  const allRated = ratings.every(r => r >= 0)

  const setRating = (row: number, v: number) =>
    setRatings(prev => { const n = [...prev]; n[row] = v; return n })

  return (
    <div className="flex flex-1 flex-col gap-4">
      {parameters.map((param, row) => {
        const selected = ratings[row]
        const left  = leftLabels[row]  ?? ''
        const right = rightLabels[row] ?? ''
        return (
          <motion.div
            key={`${param}-${row}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: row * 0.09, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-2xl border-2 border-midnight-sky-200 bg-white px-5 py-4 transition-colors"
            style={selected >= 0 ? { borderColor: 'rgba(255,0,101,0.3)', background: 'rgba(255,0,101,0.03)' } : {}}
          >
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-midnight-sky-800">{param}</p>
              <AnimatePresence>
                {selected >= 0 && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-base font-extrabold tabular-nums text-hot-pink"
                  >
                    {selected}<span className="text-sm font-semibold text-midnight-sky-500">/{ratingMax}</span>
                  </motion.span>
                )}
              </AnimatePresence>
            </div>

            {/* Per-parameter end labels — only shown if configured */}
            {(left || right) && (
              <div className="mb-1.5 flex justify-between text-[10px] font-semibold uppercase tracking-wider text-midnight-sky-400">
                <span className="truncate pr-2">{left}</span>
                <span className="truncate pl-2 text-right">{right}</span>
              </div>
            )}

            {/* Number scale 0..ratingMax */}
            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${SCALE.length}, minmax(0, 1fr))` }}>
              {SCALE.map(v => {
                const active = selected === v
                return (
                  <motion.button
                    key={v}
                    onClick={() => !submitting && setRating(row, v)}
                    whileTap={{ scale: 0.92 }}
                    animate={active ? { scale: [1, 1.08, 1] } : {}}
                    transition={{ duration: 0.22, ease: [0.34, 1.56, 0.64, 1] }}
                    className={cn(
                      'touch-manipulation rounded-lg border py-2 text-xs font-bold tabular-nums transition-colors focus:outline-none',
                      ratingMax === 10 ? 'sm:text-sm' : 'text-sm',
                      active
                        ? 'border-hot-pink bg-hot-pink text-white shadow-[0_0_18px_-2px] shadow-hot-pink/40'
                        : 'border-midnight-sky-200 bg-white text-midnight-sky-600 hover:border-hot-pink/40 hover:text-hot-pink',
                    )}
                  >
                    {v}
                  </motion.button>
                )
              })}
            </div>
          </motion.div>
        )
      })}

      <AnimatePresence>
        {allRated && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            <SubmitButton
              onClick={() => onSubmit(ratings.map(r => Math.max(0, r)))}
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
      <span className="text-sm font-bold tracking-tight text-midnight-sky-900">
        alaya <span className="text-hot-pink">pulse</span>
      </span>
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
