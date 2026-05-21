import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Send, Star } from 'lucide-react'
import { AlayaMark } from '@/components/AlayaMark'
import { cn } from '@/lib/utils'

/* ─────────────────────────────────────────────────────────────────────────
   Vote page — the screen every audience member sees on their phone.
   Demo mode cycles through all 4 question types.
   In production: question type + content comes from Firestore in real-time.
   ───────────────────────────────────────────────────────────────────────── */

type QuestionType = 'mcq' | 'wordcloud' | 'openended' | 'rating'

const DEMO_QUESTIONS = [
  {
    type: 'mcq' as QuestionType,
    text: 'What is your biggest leadership challenge right now?',
    options: ['Giving honest feedback', 'Managing team conflict', 'Building trust quickly', 'Motivating others'],
  },
  {
    type: 'wordcloud' as QuestionType,
    text: "In one word, how would you describe your team's current culture?",
  },
  {
    type: 'openended' as QuestionType,
    text: 'What one change would make the biggest difference to your team in the next 90 days?',
  },
  {
    type: 'rating' as QuestionType,
    text: 'Rate your confidence in these leadership areas:',
    parameters: ['Giving feedback', 'Decision making', 'Coaching others'],
  },
]

export default function Vote() {
  const [activeIdx, setActiveIdx] = useState(0)
  const [submitted, setSubmitted] = useState<boolean[]>(Array(DEMO_QUESTIONS.length).fill(false))

  const question = DEMO_QUESTIONS[activeIdx]
  const isSubmitted = submitted[activeIdx]

  const handleSubmit = () => {
    setSubmitted(prev => { const n = [...prev]; n[activeIdx] = true; return n })
  }

  const handleNext = () => {
    setActiveIdx(i => (i + 1) % DEMO_QUESTIONS.length)
  }

  return (
    <main className="flex min-h-screen flex-col bg-white">
      {/* Top progress bar */}
      <motion.div
        className="h-1 shrink-0 bg-hot-pink"
        initial={{ width: '0%' }}
        animate={{ width: `${((activeIdx + 1) / DEMO_QUESTIONS.length) * 100}%` }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      />

      {/* Header */}
      <header className="flex shrink-0 items-center justify-between px-5 py-4">
        <Link to="/"><AlayaMark /></Link>
        <span className="text-sm font-light text-midnight-sky-500">
          {activeIdx + 1} of {DEMO_QUESTIONS.length}
        </span>
      </header>

      {/* Demo type switcher — remove in production */}
      <div className="flex shrink-0 gap-2 overflow-x-auto px-5 pb-3 [&::-webkit-scrollbar]:hidden">
        {DEMO_QUESTIONS.map((q, i) => (
          <button
            key={i}
            onClick={() => setActiveIdx(i)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-all',
              i === activeIdx
                ? 'bg-midnight-sky-900 text-white'
                : 'bg-midnight-sky-100 text-midnight-sky-600 hover:bg-midnight-sky-200',
            )}
          >
            {q.type === 'mcq' ? 'MCQ' : q.type === 'wordcloud' ? 'Word Cloud' : q.type === 'openended' ? 'Open-ended' : 'Rating'}
          </button>
        ))}
      </div>

      {/* Question area */}
      <div className="flex flex-1 flex-col overflow-y-auto px-5 pb-8 pt-2">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeIdx}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-1 flex-col"
          >
            {/* Question text */}
            <h2 className="mb-6 text-xl font-semibold leading-snug text-midnight-sky-900 sm:text-2xl">
              {question.text}
            </h2>

            {/* Render the right question type */}
            {!isSubmitted ? (
              <>
                {question.type === 'mcq' && (
                  <MCQQuestion options={question.options!} onSubmit={handleSubmit} />
                )}
                {question.type === 'wordcloud' && (
                  <WordCloudQuestion onSubmit={handleSubmit} />
                )}
                {question.type === 'openended' && (
                  <OpenEndedQuestion onSubmit={handleSubmit} />
                )}
                {question.type === 'rating' && (
                  <RatingQuestion parameters={question.parameters!} onSubmit={handleSubmit} />
                )}
              </>
            ) : (
              <SubmittedState onNext={handleNext} isLast={activeIdx === DEMO_QUESTIONS.length - 1} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </main>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   1. MCQ — tap-to-select option cards with spring animation
   ───────────────────────────────────────────────────────────────────────── */

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F']

function MCQQuestion({ options, onSubmit }: { options: string[]; onSubmit: () => void }) {
  const [selected, setSelected] = useState<number | null>(null)

  return (
    <div className="flex flex-1 flex-col gap-3">
      {options.map((opt, i) => {
        const isSelected = selected === i
        return (
          <motion.button
            key={i}
            onClick={() => setSelected(i)}
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
            {/* Hot pink left accent bar */}
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

            {/* Letter badge */}
            <span className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold transition-all duration-200',
              isSelected ? 'bg-hot-pink text-white' : 'bg-midnight-sky-100 text-midnight-sky-600',
            )}>
              {OPTION_LABELS[i]}
            </span>

            {/* Option text */}
            <span className={cn(
              'flex-1 text-sm font-medium leading-snug transition-colors duration-200 sm:text-base',
              isSelected ? 'text-hot-pink' : 'text-midnight-sky-800',
            )}>
              {opt}
            </span>

            {/* Checkmark */}
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

      {/* Submit appears once an option is selected */}
      <AnimatePresence>
        {selected !== null && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="mt-2"
          >
            <SubmitButton onClick={onSubmit} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   2. Word Cloud — type a word, watch it join the live cloud
   ───────────────────────────────────────────────────────────────────────── */

const SEED_WORDS = [
  { text: 'innovative', count: 8 },  { text: 'collaborative', count: 14 },
  { text: 'exciting', count: 5 },    { text: 'challenging', count: 11 },
  { text: 'growth', count: 9 },      { text: 'focused', count: 7 },
  { text: 'busy', count: 12 },       { text: 'creative', count: 6 },
  { text: 'driven', count: 4 },      { text: 'trust', count: 10 },
  { text: 'energetic', count: 7 },   { text: 'change', count: 3 },
]

const CLOUD_COLORS = [
  'text-midnight-sky-800', 'text-sky-blue', 'text-fresh-green',
  'text-midnight-sky-700', 'text-midnight-sky-600',
]
const ROTATIONS = [-6, -3, 0, 3, 6, -4, 4, -2, 2, 0, -5, 5]

function countToSize(count: number) {
  if (count >= 13) return 'text-3xl font-bold'
  if (count >= 10) return 'text-2xl font-semibold'
  if (count >= 7)  return 'text-xl font-semibold'
  if (count >= 4)  return 'text-lg font-medium'
  return 'text-base font-medium'
}

function WordCloudQuestion({ onSubmit }: { onSubmit: () => void }) {
  const [input, setInput] = useState('')
  const [words, setWords] = useState(SEED_WORDS)
  const [submitted, setSubmitted] = useState(false)
  const [userWord, setUserWord] = useState('')
  const MAX = 30

  const handleSubmit = () => {
    if (!input.trim()) return
    const trimmed = input.trim().toLowerCase()
    setUserWord(trimmed)
    setWords(prev => {
      const existing = prev.find(w => w.text === trimmed)
      if (existing) return prev.map(w => w.text === trimmed ? { ...w, count: w.count + 1 } : w)
      return [...prev, { text: trimmed, count: 5 }]
    })
    setSubmitted(true)
    onSubmit()
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Input + send */}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value.slice(0, MAX))}
          onKeyDown={e => e.key === 'Enter' && !submitted && input.trim() && handleSubmit()}
          placeholder="Type a word or short phrase…"
          disabled={submitted}
          className={cn(
            'flex-1 rounded-2xl border-2 border-midnight-sky-200 bg-white px-4 py-3.5 text-base text-midnight-sky-900 placeholder:text-midnight-sky-400',
            'outline-none transition-all focus:border-hot-pink focus:ring-2 focus:ring-hot-pink/15',
            'disabled:opacity-50',
          )}
        />
        <motion.button
          onClick={handleSubmit}
          whileTap={{ scale: 0.92 }}
          disabled={!input.trim() || submitted}
          className={cn(
            'flex size-[52px] shrink-0 items-center justify-center rounded-2xl transition-all',
            input.trim() && !submitted
              ? 'bg-hot-pink text-white shadow-[0_0_20px_-4px] shadow-hot-pink/50'
              : 'bg-midnight-sky-100 text-midnight-sky-400 cursor-not-allowed',
          )}
        >
          <Send className="size-4" />
        </motion.button>
      </div>
      <p className="mt-[-10px] text-right text-xs text-midnight-sky-400">{input.length}/{MAX}</p>

      {/* Word cloud */}
      <div className="mx-auto w-full max-w-lg">
        <div className="flex min-h-[220px] flex-wrap items-center justify-center gap-x-4 gap-y-3 rounded-2xl bg-midnight-sky-50 p-6">
          {words.map((w, i) => (
            <motion.span
              key={w.text}
              initial={{ opacity: 0, scale: 0.3 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{
                type: 'spring', stiffness: 380, damping: 20,
                delay: i < SEED_WORDS.length ? i * 0.04 : 0,
              }}
              style={{ rotate: ROTATIONS[i % ROTATIONS.length] }}
              className={cn(
                countToSize(w.count),
                w.text === userWord ? 'text-hot-pink' : CLOUD_COLORS[i % CLOUD_COLORS.length],
                'select-none leading-tight',
              )}
            >
              {w.text}
            </motion.span>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   3. Open-ended — textarea + live scrolling answer feed
   ───────────────────────────────────────────────────────────────────────── */

const SEED_ANSWERS = [
  'More time for strategic thinking instead of back-to-back meetings.',
  'A clear framework for giving feedback that doesn\'t feel personal.',
  'Better tools for async communication across time zones.',
  'Regular 1:1s with clear agendas so nothing falls through the cracks.',
  'Psychological safety to try new ideas without fear of failure.',
]

function OpenEndedQuestion({ onSubmit }: { onSubmit: () => void }) {
  const [text, setText] = useState('')
  const [answers, setAnswers] = useState(SEED_ANSWERS)
  const [submitted, setSubmitted] = useState(false)
  const MAX = 280

  const handleSubmit = () => {
    if (!text.trim()) return
    setAnswers(prev => [text.trim(), ...prev])
    setSubmitted(true)
    onSubmit()
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="relative">
        <textarea
          value={text}
          onChange={e => setText(e.target.value.slice(0, MAX))}
          placeholder="Share your thoughts…"
          rows={4}
          disabled={submitted}
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
        {!submitted && text.trim() && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <SubmitButton onClick={handleSubmit} label="Submit answer" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Live feed */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-widest text-midnight-sky-400">
          Live responses
        </p>
        <div className="flex flex-col gap-2">
          {answers.map((ans, i) => (
            <motion.div
              key={`${ans.slice(0, 20)}-${i}`}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i === 0 && submitted ? 0 : i * 0.05 }}
              className={cn(
                'rounded-xl border px-4 py-3 text-sm leading-relaxed',
                i === 0 && submitted
                  ? 'border-hot-pink/40 bg-[#ff0065]/[0.04] text-hot-pink'
                  : 'border-midnight-sky-200 bg-midnight-sky-50/70 text-midnight-sky-800',
              )}
            >
              {i === 0 && submitted && (
                <span className="mr-1 text-xs font-bold">You · </span>
              )}
              {ans}
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   4. Rating — interactive star rows, one per parameter
   ───────────────────────────────────────────────────────────────────────── */

function RatingQuestion({ parameters, onSubmit }: { parameters: string[]; onSubmit: () => void }) {
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
          <div
            className="flex items-center gap-1"
            onMouseLeave={() => setHovered(null)}
          >
            {[1, 2, 3, 4, 5].map(star => {
              const active = hovered?.row === row
                ? star <= hovered.star
                : star <= (ratings[row] ?? 0)
              return (
                <motion.button
                  key={star}
                  onClick={() => setRating(row, star)}
                  onMouseEnter={() => setHovered({ row, star })}
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
            <SubmitButton onClick={onSubmit} label="Submit ratings" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Submitted confirmation — shown after any question is answered
   ───────────────────────────────────────────────────────────────────────── */

function SubmittedState({ onNext, isLast }: { onNext: () => void; isLast: boolean }) {
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
          {isLast ? "That's all — thanks for participating!" : 'Waiting for the next question…'}
        </p>
      </div>

      {!isLast && (
        <button
          onClick={onNext}
          className="rounded-full bg-midnight-sky-100 px-6 py-2.5 text-sm font-medium text-midnight-sky-700 transition hover:bg-midnight-sky-200"
        >
          Preview next question →
        </button>
      )}
    </motion.div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Shared hot-pink submit button
   ───────────────────────────────────────────────────────────────────────── */

function SubmitButton({ onClick, label = 'Submit' }: { onClick: () => void; label?: string }) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-hot-pink px-6 py-4 text-base font-medium text-white shadow-[0_0_24px_-6px] shadow-hot-pink/50 transition-all hover:shadow-[0_0_36px_-4px] hover:shadow-hot-pink/70"
    >
      {label}
      <Send className="size-4" />
    </motion.button>
  )
}
