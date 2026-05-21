import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Users, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ─────────────────────────────────────────────────────────────────────────
   Results page — presenter's big screen view (dark navy, full-screen).
   Shows live incoming votes as dramatic animated visuals.
   Demo mode simulates votes trickling in every ~1.5 s.
   ───────────────────────────────────────────────────────────────────────── */

type ResultType = 'mcq' | 'wordcloud' | 'openended' | 'rating'

// ── Demo data ─────────────────────────────────────────────────────────────

const MCQ_OPTIONS = [
  { label: 'A', text: 'Giving honest feedback',    votes: 19 },
  { label: 'B', text: 'Managing team conflict',    votes: 12 },
  { label: 'C', text: 'Building trust quickly',    votes: 10 },
  { label: 'D', text: 'Motivating others',         votes:  6 },
]

const CLOUD_WORDS = [
  { text: 'collaborative', count: 18 }, { text: 'innovative',  count: 12 },
  { text: 'challenging',   count: 14 }, { text: 'growth',      count: 10 },
  { text: 'busy',          count: 15 }, { text: 'focused',     count:  9 },
  { text: 'exciting',      count:  7 }, { text: 'trust',       count: 13 },
  { text: 'creative',      count:  8 }, { text: 'driven',      count:  6 },
  { text: 'energetic',     count:  9 }, { text: 'change',      count:  5 },
  { text: 'dynamic',       count: 11 }, { text: 'supportive',  count:  7 },
]

const OPEN_ANSWERS = [
  { name: 'Sarah M.',   text: 'More time for strategic thinking instead of back-to-back meetings.' },
  { name: 'Anonymous', text: 'A clear framework for giving feedback that doesn\'t feel personal.' },
  { name: 'James T.',   text: 'Better tools for async communication across time zones.' },
  { name: 'Anonymous', text: 'Regular 1:1s with clear agendas so nothing falls through the cracks.' },
  { name: 'Priya K.',   text: 'Psychological safety to try new ideas without fear of failure.' },
  { name: 'Anonymous', text: 'Clearer decision-making processes — who decides what and when.' },
]

const RATING_PARAMS = [
  { name: 'Giving feedback',  average: 4.2, counts: [2, 4, 8, 16, 13] },
  { name: 'Decision making',  average: 3.8, counts: [3, 6, 12, 14,  8] },
  { name: 'Coaching others',  average: 4.6, counts: [1, 2,  5, 12, 23] },
]

// ── Hooks ─────────────────────────────────────────────────────────────────

/** Smoothly counts from 0 to target over `duration` ms (ease-out cubic). */
function useCountUp(target: number, duration = 900, delay = 0) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let raf: number
    const startTime = performance.now() + delay
    function step(now: number) {
      if (now < startTime) { raf = requestAnimationFrame(step); return }
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setCount(Math.round(eased * target))
      if (progress < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration, delay])
  return count
}

/** Simulates votes trickling in for MCQ demo. Returns live vote array. */
function useLiveMCQ(initial: typeof MCQ_OPTIONS) {
  const [votes, setVotes] = useState(initial.map(o => ({ ...o })))
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // Reset on mount
    setVotes(initial.map(o => ({ ...o })))
    let added = 0

    intervalRef.current = setInterval(() => {
      if (added >= 18) { clearInterval(intervalRef.current!); return }
      const idx = Math.floor(Math.random() * initial.length)
      setVotes(prev => {
        const n = [...prev]
        n[idx] = { ...n[idx], votes: n[idx].votes + 1 }
        return n
      })
      added++
    }, 1200)

    return () => clearInterval(intervalRef.current!)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const total = votes.reduce((s, o) => s + o.votes, 0)
  return { votes, total, maxVotes: Math.max(...votes.map(o => o.votes)) }
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function Results() {
  const [activeType, setActiveType] = useState<ResultType>('mcq')

  const TABS: { type: ResultType; label: string }[] = [
    { type: 'mcq',       label: 'MCQ'         },
    { type: 'wordcloud', label: 'Word Cloud'   },
    { type: 'openended', label: 'Open-ended'   },
    { type: 'rating',    label: 'Rating'       },
  ]

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-midnight-sky-900 text-white">
      {/* Subtle gradient glow — bottom left pink, top right blue */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -bottom-32 -left-32 size-[500px] rounded-full bg-hot-pink/10 blur-[100px]" />
        <div className="absolute -right-32 -top-32 size-[400px] rounded-full bg-sky-blue/10 blur-[100px]" />
      </div>

      {/* Header bar */}
      <header className="relative z-10 flex items-center justify-between border-b border-white/10 px-8 py-4">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold tracking-tight text-white">
            alaya <span className="text-hot-pink">pulse</span>
          </span>
          <span className="rounded-full border border-white/20 px-2.5 py-0.5 text-xs font-mono text-white/60">
            ABC123
          </span>
        </div>

        {/* Demo type tabs */}
        <div className="flex gap-1.5">
          {TABS.map(t => (
            <button
              key={t.type}
              onClick={() => setActiveType(t.type)}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs font-medium transition-all',
                activeType === t.type
                  ? 'bg-white/15 text-white'
                  : 'text-white/50 hover:text-white/80',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 text-xs text-white/50">
          <TrendingUp className="size-3.5" />
          <span>Question 2 of 5</span>
        </div>
      </header>

      {/* Results content */}
      <div className="relative z-10 flex flex-1 flex-col px-8 py-8 md:px-14 md:py-10">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeType}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-1 flex-col"
          >
            {activeType === 'mcq'       && <MCQResults />}
            {activeType === 'wordcloud' && <WordCloudResults />}
            {activeType === 'openended' && <OpenEndedResults />}
            {activeType === 'rating'    && <RatingResults />}
          </motion.div>
        </AnimatePresence>
      </div>
    </main>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   1. MCQ Results — animated horizontal bars
   ───────────────────────────────────────────────────────────────────────── */

function MCQResults() {
  const { votes, total } = useLiveMCQ(MCQ_OPTIONS)
  const maxVotes = Math.max(...votes.map(o => o.votes))
  const displayTotal = useCountUp(total, 800)

  return (
    <div className="flex flex-1 flex-col">
      {/* Question */}
      <h2 className="mb-2 text-2xl font-semibold text-white md:text-3xl lg:text-4xl">
        What is your biggest leadership challenge right now?
      </h2>

      {/* Response counter */}
      <div className="mb-8 flex items-center gap-1.5 text-sm font-medium text-white/50">
        <Users className="size-4" />
        <motion.span
          key={displayTotal}
          animate={{ scale: [1, 1.15, 1] }}
          transition={{ duration: 0.25 }}
          className="text-white/80"
        >
          {displayTotal}
        </motion.span>
        <span>responses</span>
      </div>

      {/* Bars */}
      <div className="flex flex-1 flex-col justify-center gap-5">
        {votes.map((opt, i) => {
          const pct = total > 0 ? Math.round((opt.votes / total) * 100) : 0
          const isWinner = opt.votes === maxVotes && opt.votes > 0
          const barColor = isWinner ? 'bg-hot-pink' : 'bg-white/25'
          const textColor = isWinner ? 'text-hot-pink' : 'text-white/80'

          return (
            <motion.div
              key={opt.label}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center gap-4"
            >
              {/* Letter badge */}
              <span className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold transition-colors duration-500 md:size-11 md:text-base',
                isWinner ? 'bg-hot-pink text-white' : 'bg-white/10 text-white/60',
              )}>
                {opt.label}
              </span>

              {/* Option text */}
              <span className={cn(
                'w-52 shrink-0 text-sm font-medium leading-tight transition-colors duration-500 md:w-64 md:text-base lg:text-lg',
                isWinner ? 'text-white' : 'text-white/70',
              )}>
                {opt.text}
              </span>

              {/* Bar track */}
              <div className="relative h-10 flex-1 overflow-hidden rounded-xl bg-white/8 md:h-12">
                <motion.div
                  className={cn('absolute inset-y-0 left-0 rounded-xl transition-colors duration-500', barColor)}
                  initial={{ width: '0%' }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                />
                {/* Winner shimmer */}
                {isWinner && (
                  <motion.div
                    className="absolute inset-y-0 left-0 w-full rounded-xl bg-gradient-to-r from-transparent via-white/20 to-transparent"
                    animate={{ x: ['-100%', '200%'] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', repeatDelay: 1 }}
                  />
                )}
              </div>

              {/* Percentage */}
              <span className={cn('w-14 text-right text-lg font-bold tabular-nums md:text-2xl', textColor)}>
                <PercentCounter target={pct} />%
              </span>

              {/* Vote count */}
              <span className="w-12 text-right text-sm text-white/40 tabular-nums md:text-base">
                ({opt.votes})
              </span>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

function PercentCounter({ target }: { target: number }) {
  const count = useCountUp(target, 700)
  return <>{count}</>
}

/* ─────────────────────────────────────────────────────────────────────────
   2. Word Cloud Results — full-screen dramatic cloud on dark bg
   ───────────────────────────────────────────────────────────────────────── */

const CLOUD_COLORS_DARK = [
  'text-white',        'text-sky-blue',    'text-fresh-green',
  'text-white/80',     'text-golden-sun',  'text-sky-blue/80',
  'text-white/70',     'text-fresh-green/80',
]
const ROTATIONS_BIG = [-8, -4, 0, 4, 8, -6, 6, -3, 3, 0, -5, 5, -7, 7]

function cloudSizeClass(count: number) {
  if (count >= 17) return 'text-6xl font-bold md:text-8xl'
  if (count >= 13) return 'text-4xl font-bold md:text-6xl'
  if (count >= 10) return 'text-3xl font-semibold md:text-5xl'
  if (count >= 7)  return 'text-2xl font-semibold md:text-4xl'
  if (count >= 5)  return 'text-xl  font-medium  md:text-3xl'
  return                  'text-lg  font-medium  md:text-xl'
}

function WordCloudResults() {
  const topWord = CLOUD_WORDS.reduce((a, b) => a.count > b.count ? a : b).text

  return (
    <div className="flex flex-1 flex-col">
      <h2 className="mb-8 text-2xl font-semibold text-white md:text-3xl">
        In one word, how would you describe your team's current culture?
      </h2>

      <div className="flex flex-1 flex-wrap items-center justify-center gap-x-8 gap-y-4 py-4">
        {CLOUD_WORDS.map((w, i) => (
          <motion.span
            key={w.text}
            initial={{ opacity: 0, scale: 0.2 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{
              type: 'spring', stiffness: 320, damping: 22,
              delay: i * 0.06,
            }}
            style={{ rotate: ROTATIONS_BIG[i % ROTATIONS_BIG.length] }}
            className={cn(
              cloudSizeClass(w.count),
              w.text === topWord
                ? 'text-hot-pink drop-shadow-[0_0_20px_rgba(255,0,101,0.6)]'
                : CLOUD_COLORS_DARK[i % CLOUD_COLORS_DARK.length],
              'select-none leading-none',
            )}
          >
            {w.text}
          </motion.span>
        ))}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   3. Open-ended Results — live scrolling answer cards
   ───────────────────────────────────────────────────────────────────────── */

function OpenEndedResults() {
  const [visible, setVisible] = useState<typeof OPEN_ANSWERS>([])
  const indexRef = useRef(0)

  useEffect(() => {
    // Reveal answers one by one, then loop
    setVisible([])
    indexRef.current = 0

    const reveal = () => {
      setVisible(OPEN_ANSWERS.slice(0, indexRef.current + 1))
      indexRef.current++
      if (indexRef.current < OPEN_ANSWERS.length) {
        setTimeout(reveal, 1400)
      }
    }
    const t = setTimeout(reveal, 300)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="flex flex-1 flex-col">
      <h2 className="mb-6 text-2xl font-semibold text-white md:text-3xl">
        What one change would make the biggest difference to your team in the next 90 days?
      </h2>

      <div className="flex items-center gap-2 mb-6 text-sm text-white/50">
        <Users className="size-4" />
        <span>{visible.length} responses so far</span>
      </div>

      <div className="grid flex-1 auto-rows-min gap-3 md:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence>
          {visible.map((ans, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm"
            >
              <p className="text-base font-light leading-relaxed text-white/90 md:text-lg">
                "{ans.text}"
              </p>
              <p className="mt-3 text-xs font-medium text-white/40">
                — {ans.name}
              </p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   4. Rating Results — animated averages with star fill
   ───────────────────────────────────────────────────────────────────────── */

const STAR_COLORS = ['bg-white/20', 'bg-sky-blue/60', 'bg-fresh-green/70', 'bg-golden-sun/80', 'bg-hot-pink']

function RatingResults() {
  const totalVoters = RATING_PARAMS[0].counts.reduce((s, c) => s + c, 0)

  return (
    <div className="flex flex-1 flex-col">
      <h2 className="mb-8 text-2xl font-semibold text-white md:text-3xl">
        Rate your confidence in these leadership areas:
      </h2>

      <div className="flex flex-1 flex-col justify-center gap-6 lg:gap-8">
        {RATING_PARAMS.map((param, idx) => (
          <RatingRow key={param.name} param={param} delay={idx * 0.15} totalVoters={totalVoters} />
        ))}
      </div>
    </div>
  )
}

function RatingRow({
  param,
  delay,
  totalVoters,
}: {
  param: typeof RATING_PARAMS[number]
  delay: number
  totalVoters: number
}) {
  const displayAvg = useCountUp(Math.round(param.average * 10), 900, delay * 1000)
  const realAvg = displayAvg / 10

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-5 md:p-6"
    >
      {/* Row header */}
      <div className="flex items-center justify-between">
        <span className="text-lg font-semibold text-white md:text-xl">{param.name}</span>
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-bold tabular-nums text-hot-pink md:text-5xl">
            {realAvg.toFixed(1)}
          </span>
          <span className="text-lg text-white/40">/5</span>
        </div>
      </div>

      {/* Star fill bar */}
      <div className="relative h-3 overflow-hidden rounded-full bg-white/10">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-hot-pink"
          initial={{ width: '0%' }}
          animate={{ width: `${(param.average / 5) * 100}%` }}
          transition={{ duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>

      {/* Star distribution bars */}
      <div className="flex items-end gap-1.5 pt-1">
        {param.counts.map((count, i) => {
          const pct = (count / totalVoters) * 100
          return (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <motion.div
                className={cn('w-full rounded-t-md', STAR_COLORS[i])}
                initial={{ height: 0 }}
                animate={{ height: `${Math.max(pct * 1.2, 4)}px` }}
                transition={{ duration: 0.7, delay: delay + i * 0.06, ease: [0.16, 1, 0.3, 1] }}
              />
              <span className="text-[10px] font-medium text-white/40">{i + 1}★</span>
            </div>
          )
        })}
        <div className="ml-2 flex flex-col justify-end pb-4 text-xs text-white/40">
          <span>{totalVoters} votes</span>
        </div>
      </div>
    </motion.div>
  )
}
