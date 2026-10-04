import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, X, Clock, Pause, ChevronLeft, ChevronRight, ClipboardCheck } from 'lucide-react'
import { cn, optionLabel } from '@/lib/utils'
import { Confetti, CountUp } from '@/components/Celebration'
import { saveTestAnswers, submitTestAnswers, subscribeToTestAnswers } from '@/lib/session'
import {
  remainingOf, formatClock, formatDuration, sameAnswer,
  type StoredTestBlockSlide, type TestState, type TestAnswerDoc,
} from '@/lib/selfPacedTest'

/* ─────────────────────────────────────────────────────────────────────────
   A participant's self-paced test, on their phone.
   Answers save as they go (one sheet per person), so a closed tab or a
   rescan carries on where it left off. Correct answers only arrive once
   the host's test has ended.
   ───────────────────────────────────────────────────────────────────────── */

const tsMs = (t: unknown): number | null => {
  const x = t as { toMillis?: () => number; seconds?: number; nanoseconds?: number } | null | undefined
  if (!x) return null
  if (typeof x.toMillis === 'function') return x.toMillis()
  if (typeof x.seconds === 'number') return x.seconds * 1000 + Math.round((x.nanoseconds ?? 0) / 1e6)
  return null
}
const ordinal = (n: number) => {
  const t = n % 100
  if (t >= 11 && t <= 13) return `${n}th`
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`
}

export function TestRunner({ code, block, state, personId, name, emoji }: {
  code:     string
  block:    StoredTestBlockSlide
  state:    TestState | undefined
  personId: string
  name:     string
  emoji?:   string
}) {
  const qs = block.questions
  const round = state?.round ?? 0
  const [sheet, setSheet] = useState<TestAnswerDoc | null | undefined>(undefined)
  const [answers, setAnswers] = useState<Record<string, number[]>>({})
  const [current, setCurrent] = useState(0)
  const [reviewing, setReviewing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const loadedRound = useRef<number | null>(null)
  const createdRound = useRef<number | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ answers, current })
  latest.current = { answers, current }

  // My own sheet
  useEffect(() => subscribeToTestAnswers(code, block.id, personId, setSheet), [code, block.id, personId])

  // Restore from the sheet once per round (a reload or rescan picks up here)
  useEffect(() => {
    if (!sheet || sheet.round !== round || loadedRound.current === round) return
    loadedRound.current = round
    setAnswers(sheet.answers ?? {})
    setCurrent(Math.min(sheet.current ?? 0, Math.max(0, qs.length - 1)))
  }, [sheet, round, qs.length])

  // Open a sheet as soon as the test is running
  useEffect(() => {
    if (!state || (state.status !== 'running' && state.status !== 'paused')) return
    if (sheet === undefined) return
    if (sheet && sheet.round === round) return
    if (createdRound.current === round) return
    createdRound.current = round
    loadedRound.current = round
    setAnswers({}); setCurrent(0); setReviewing(false)
    saveTestAnswers(code, block.id, personId, {
      respondentId: personId, respondentName: name || 'Anonymous', ...(emoji ? { respondentEmoji: emoji } : {}),
      round, answers: {}, current: 0, finished: false, finishedServer: null,
    }, true).catch(console.error)
  }, [state, sheet, round, code, block.id, personId, name, emoji])

  // Clock
  useEffect(() => {
    if (state?.status !== 'running') return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [state?.status])

  const save = (next: Record<string, number[]>, cur: number) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTestAnswers(code, block.id, personId, { answers: next, current: cur, round }).catch(console.error)
    }, 400)
  }
  const flush = async () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    await saveTestAnswers(code, block.id, personId, { answers: latest.current.answers, current: latest.current.current, round })
  }

  const remaining = remainingOf(state, now)
  const finished = !!(sheet && sheet.round === round && sheet.finished)
  const timeUp = state?.status === 'running' && remaining <= 0

  const answeredFully = (qi: number) => (answers[qs[qi].id]?.length ?? 0) >= qs[qi].pick
  const missing = qs.map((_, i) => i).filter(i => !answeredFully(i))

  const pick = (qi: number, opt: number) => {
    const q = qs[qi]
    const cur = answers[q.id] ?? []
    let next: number[]
    if (q.pick <= 1) next = [opt]
    else if (cur.includes(opt)) next = cur.filter(x => x !== opt)
    else if (cur.length >= q.pick) {
      setNote(`You can choose ${q.pick} — tap one you picked to remove it first`)
      window.setTimeout(() => setNote(null), 2600)
      return
    } else next = [...cur, opt]
    const all = { ...answers, [q.id]: next }
    setAnswers(all)
    save(all, qi)
  }
  const go = (qi: number) => { setCurrent(qi); setReviewing(false); save(answers, qi) }

  const submit = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      await flush()
      await submitTestAnswers(code, block.id, personId, round, state?.pausedTotalMs ?? 0)
    } catch (e) {
      console.error(e)
      setNote("Couldn't submit — check your connection and try again")
    } finally {
      setSubmitting(false)
    }
  }

  /* ── Screens ───────────────────────────────────────────────────────── */

  // Before the host starts
  if (!state || state.status === 'ready') {
    return (
      <Card>
        <Badge />
        <h2 className="mt-3 text-2xl font-bold text-midnight-sky-900">Get ready</h2>
        <p className="mt-1 text-midnight-sky-500">{qs.length} question{qs.length !== 1 ? 's' : ''} · {block.timeLimit} minutes</p>
        <Rules block={block} />
        <p className="mt-6 text-center text-sm text-midnight-sky-400">Waiting for the host to start the test…</p>
      </Card>
    )
  }

  // After the test
  if (state.status === 'ended') {
    return <Results block={block} state={state} sheet={sheet && sheet.round === round ? sheet : null} personId={personId} />
  }

  // Submitted, waiting for the end
  if (finished) {
    const start = tsMs(state.startedServer), fin = tsMs(sheet?.finishedServer)
    const took = start !== null && fin !== null ? Math.max(0, fin - start - (sheet?.pausedAtFinish ?? state.pausedTotalMs ?? 0)) : null
    return (
      <Card>
        <Badge />
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mt-6 flex size-16 items-center justify-center rounded-full bg-fresh-green/15">
          <Check className="size-8 text-fresh-green" />
        </motion.div>
        <h2 className="mt-4 text-2xl font-bold text-midnight-sky-900">Submitted</h2>
        {typeof sheet?.score === 'number' && (
          <p className="mt-3 text-5xl font-extrabold tabular-nums text-midnight-sky-900">{sheet.score} <span className="text-2xl font-bold text-midnight-sky-400">/ {qs.length}</span></p>
        )}
        {took !== null && <p className="mt-2 text-midnight-sky-500">Finished in {formatDuration(took)}</p>}
        <p className="mt-4 text-sm text-midnight-sky-400">
          {typeof sheet?.score === 'number'
            ? 'The answers and everyone’s places appear when the test ends.'
            : 'Your score, the answers and everyone’s places appear when the test ends.'}
        </p>
        <p className="mt-6 text-xs text-midnight-sky-400">Time left for others: {formatClock(remaining)}</p>
      </Card>
    )
  }

  // Waiting for my sheet to be created
  if (sheet === undefined) return <Card><p className="text-midnight-sky-400">Loading the test…</p></Card>

  const q = qs[current]
  const mine = answers[q.id] ?? []

  return (
    <div className="relative flex flex-1 flex-col">
      {/* Clock + progress */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-midnight-sky-500">Question {current + 1} of {qs.length}</span>
        <span className={cn('flex items-center gap-1.5 font-mono text-lg font-bold tabular-nums', remaining < 60_000 ? 'text-hot-pink' : 'text-midnight-sky-900')}>
          <Clock className="size-4" /> {formatClock(remaining)}
        </span>
      </div>
      {/* Numbered boxes — tap to jump */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {qs.map((x, i) => (
          <button
            key={x.id}
            onClick={() => go(i)}
            className={cn(
              'flex size-8 items-center justify-center rounded-lg text-xs font-semibold transition',
              i === current && !reviewing ? 'ring-2 ring-hot-pink ring-offset-1' : '',
              answeredFully(i) ? 'bg-sky-blue text-white' : (answers[x.id]?.length ? 'bg-sky-blue/30 text-midnight-sky-800' : 'bg-midnight-sky-50 text-midnight-sky-500'),
            )}
            aria-label={`Question ${i + 1}${answeredFully(i) ? ', answered' : ''}`}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {reviewing ? (
        <div className="mt-6 flex flex-1 flex-col">
          <h2 className="text-2xl font-bold text-midnight-sky-900">Ready to submit?</h2>
          <p className="mt-1 text-midnight-sky-500">{qs.length - missing.length} of {qs.length} answered</p>
          {missing.length > 0 && (
            <div className="mt-4 rounded-2xl border border-golden-sun/40 bg-golden-sun/10 p-4">
              <p className="text-sm font-medium text-[#8a6600]">Not answered yet — tap to go there:</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {missing.map(i => (
                  <button key={i} onClick={() => go(i)} className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-midnight-sky-800 shadow-sm">
                    Q{i + 1}{qs[i].pick > 1 && (answers[qs[i].id]?.length ?? 0) > 0 ? ` (${answers[qs[i].id].length}/${qs[i].pick})` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="mt-4 text-sm text-midnight-sky-500">Once you submit you can't change your answers. If two people get the same score, the faster finish ranks higher.</p>
          <div className="mt-auto flex gap-2.5 pt-6">
            <button onClick={() => setReviewing(false)} className="flex-1 rounded-xl border border-midnight-sky-200 py-3.5 text-sm font-medium text-midnight-sky-700">Go back</button>
            <button onClick={submit} disabled={submitting || timeUp} className="flex-1 rounded-xl bg-hot-pink py-3.5 text-sm font-semibold text-white shadow-[0_0_20px_-4px] shadow-hot-pink/40 disabled:opacity-50">
              {submitting ? 'Submitting…' : 'Submit test'}
            </button>
          </div>
        </div>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={q.id}
            initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }}
            className="mt-5 flex flex-1 flex-col"
          >
            {q.imgUrl && <img src={q.imgUrl} alt="" className="mb-3 max-h-40 w-full rounded-xl object-cover" />}
            <h2 className="text-lg font-semibold leading-snug text-midnight-sky-900">{q.question}</h2>
            {q.pick > 1 && <p className="mt-1.5 text-sm font-medium text-sky-blue">Choose {q.pick}</p>}
            <div className="mt-4 flex flex-col gap-2.5">
              {q.options.map((o, i) => {
                const on = mine.includes(i)
                return (
                  <button
                    key={i}
                    onClick={() => pick(current, i)}
                    className={cn(
                      'flex items-center gap-3 rounded-2xl border-2 px-4 py-3.5 text-left transition active:scale-[0.99]',
                      on ? 'border-sky-blue bg-sky-blue/10' : 'border-midnight-sky-100 bg-white',
                    )}
                  >
                    <span className={cn(
                      'flex size-8 shrink-0 items-center justify-center text-sm font-bold',
                      q.pick > 1 ? 'rounded-lg' : 'rounded-full',
                      on ? 'bg-sky-blue text-white' : 'bg-midnight-sky-50 text-midnight-sky-500',
                    )}>
                      {on ? <Check className="size-4" /> : optionLabel(i, q.options.length)}
                    </span>
                    <span className="text-base text-midnight-sky-900">{o}</span>
                  </button>
                )
              })}
            </div>
            <div className="mt-auto flex gap-2.5 pt-6">
              <button
                onClick={() => go(Math.max(0, current - 1))}
                disabled={current === 0}
                className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-midnight-sky-200 py-3.5 text-sm font-medium text-midnight-sky-700 disabled:opacity-30"
              >
                <ChevronLeft className="size-4" /> Back
              </button>
              {current < qs.length - 1 ? (
                <button onClick={() => go(current + 1)} className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-sky-blue py-3.5 text-sm font-semibold text-white">
                  Next <ChevronRight className="size-4" />
                </button>
              ) : (
                <button onClick={() => setReviewing(true)} className="flex-1 rounded-xl bg-hot-pink py-3.5 text-sm font-semibold text-white">
                  Review &amp; submit
                </button>
              )}
            </div>
            {current < qs.length - 1 && (
              <button onClick={() => setReviewing(true)} className="mt-3 text-center text-sm font-medium text-hot-pink">Finish and submit</button>
            )}
          </motion.div>
        </AnimatePresence>
      )}

      {/* Small notes */}
      <AnimatePresence>
        {note && (
          <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="fixed inset-x-4 bottom-24 z-40 rounded-xl bg-midnight-sky-900 px-4 py-3 text-center text-sm text-white shadow-xl">
            {note}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Paused or time's up: questions hidden */}
      {(state.status === 'paused' || timeUp) && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center rounded-2xl bg-white/97 text-center backdrop-blur-sm">
          {timeUp ? <Clock className="size-10 text-hot-pink" /> : <Pause className="size-10 text-midnight-sky-400" />}
          <h2 className="mt-4 text-2xl font-bold text-midnight-sky-900">{timeUp ? "Time's up" : 'Test paused'}</h2>
          <p className="mt-2 max-w-xs text-midnight-sky-500">
            {timeUp ? 'Your answers so far have been saved.' : 'The host has paused the test. You’ll be back on this question when it resumes.'}
          </p>
          {!timeUp && <p className="mt-4 font-mono text-lg font-bold tabular-nums text-midnight-sky-700">{formatClock(remaining)} left</p>}
        </div>
      )}
    </div>
  )
}

/* ── After the test: score, place (once announced) and every answer ──── */

function Results({ block, state, sheet, personId }: {
  block: StoredTestBlockSlide
  state: TestState
  sheet: TestAnswerDoc | null
  personId: string
}) {
  const qs = block.questions
  const reveal = state.reveal ?? {}
  const mine = sheet?.answers ?? {}
  const score = useMemo(() => qs.reduce((n, q) => n + (reveal[q.id] && sameAnswer(mine[q.id], reveal[q.id].correct) ? 1 : 0), 0), [qs, reveal, mine])
  const rank = state.ranks?.entries?.[personId]
  const total = state.ranks?.total ?? 0
  const onLeaderboard = state.stage === 'leaderboard' && !state.ranks

  if (!sheet) {
    return (
      <Card>
        <Badge />
        <h2 className="mt-3 text-2xl font-bold text-midnight-sky-900">The test has ended</h2>
        <p className="mt-2 text-midnight-sky-500">You didn't take part in this one.</p>
      </Card>
    )
  }

  if (onLeaderboard) {
    return (
      <Card>
        <motion.div className="text-7xl" animate={{ y: [0, -10, 0], rotate: [0, -6, 6, 0] }} transition={{ duration: 1.6, repeat: Infinity }}>🏆</motion.div>
        <h2 className="mt-4 text-2xl font-bold text-midnight-sky-900">Eyes on the big screen!</h2>
        <p className="mt-2 text-midnight-sky-500">The leaderboard is being revealed…</p>
      </Card>
    )
  }

  const place = rank?.[0]
  const podium = !!place && place <= 3
  return (
    <div className="flex flex-1 flex-col gap-4">
      {podium && (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-40">
          <Confetti pieces={place === 1 ? 90 : 50} waves={place === 1 ? 3 : 1} />
        </div>
      )}
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 220, damping: 18 }}
        className={cn(
          'rounded-3xl px-6 py-7 text-center',
          place === 1 ? 'bg-gradient-to-br from-golden-sun via-[#ffd84d] to-[#ffb300] text-midnight-sky-900'
          : podium ? 'bg-gradient-to-br from-midnight-sky-800 to-midnight-sky-900 text-white'
          : 'bg-midnight-sky-50 text-midnight-sky-900',
        )}
      >
        {place ? (
          <>
            <div className="text-6xl">{place === 1 ? '🏆' : place === 2 ? '🥈' : place === 3 ? '🥉' : place <= 10 ? '⭐' : '🎉'}</div>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight">
              {place === 1 ? 'You won!' : podium ? `${ordinal(place)} place!` : place <= 10 ? 'Top 10!' : 'Great effort!'}
            </h2>
            <p className="mt-2 opacity-80">You placed <span className="font-bold">{ordinal(place)}</span> of {total.toLocaleString()}</p>
          </>
        ) : (
          <p className="text-sm font-semibold uppercase tracking-widest opacity-60">Your score</p>
        )}
        <p className="mt-3 text-5xl font-extrabold tabular-nums">
          <CountUp value={score} duration={1200} delay={300} /> <span className="text-2xl font-bold opacity-60">/ {qs.length}</span>
        </p>
        {rank && <p className="mt-1 text-sm opacity-70">{rank[3] ? 'Ran out of time' : `in ${formatDuration(rank[2])}`}</p>}
        {!place && block.afterOrder && <p className="mt-3 text-xs opacity-60">Your place appears with the leaderboard.</p>}
      </motion.div>

      <h3 className="mt-2 text-sm font-semibold uppercase tracking-wider text-midnight-sky-400">Your answers</h3>
      <div className="flex flex-col gap-3 pb-4">
        {qs.map((q, i) => {
          const r = reveal[q.id]
          const got = mine[q.id] ?? []
          const ok = !!r && sameAnswer(got, r.correct)
          return (
            <div key={q.id} className={cn('rounded-2xl border p-4', ok ? 'border-fresh-green/30 bg-fresh-green/5' : 'border-hot-pink/25 bg-hot-pink/[0.04]')}>
              <div className="flex items-start gap-2">
                <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full', ok ? 'bg-fresh-green text-white' : 'bg-hot-pink text-white')}>
                  {ok ? <Check className="size-3" /> : <X className="size-3" />}
                </span>
                <p className="text-sm font-medium leading-snug text-midnight-sky-900">Q{i + 1}. {q.question}</p>
              </div>
              <p className="mt-2 text-sm text-midnight-sky-600">
                <span className="text-midnight-sky-400">Your answer: </span>
                {got.length ? got.slice().sort((a, b) => a - b).map(k => `${optionLabel(k, q.options.length)}. ${q.options[k]}`).join(', ') : 'Not answered'}
              </p>
              {!ok && r && (
                <p className="mt-1 text-sm text-fresh-green">
                  <span className="text-midnight-sky-400">Correct: </span>
                  {r.correct.slice().sort((a, b) => a - b).map(k => `${optionLabel(k, q.options.length)}. ${q.options[k]}`).join(', ')}
                </p>
              )}
              {r?.explanation && <p className="mt-2 rounded-xl bg-white/70 px-3 py-2 text-xs leading-relaxed text-midnight-sky-600">{r.explanation}</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Bits ───────────────────────────────────────────────────────────────── */

function Card({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
      className="flex flex-1 flex-col items-center justify-center py-8 text-center"
    >
      {children}
    </motion.div>
  )
}

function Badge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-golden-sun/15 px-3 py-1 text-xs font-bold text-[#8a6600]">
      <ClipboardCheck className="size-3.5" /> Self-paced test
    </span>
  )
}

function Rules({ block }: { block: StoredTestBlockSlide }) {
  const items = [
    'Go at your own pace',
    'Change any answer until you submit',
    'Most correct answers wins',
    'Tie? The faster finish ranks higher',
    ...(block.rules ? [block.rules] : []),
  ]
  return (
    <ul className="mt-6 w-full max-w-xs space-y-2.5 text-left">
      {items.map(t => (
        <li key={t} className="flex items-start gap-2.5 text-midnight-sky-700">
          <Check className="mt-0.5 size-4 shrink-0 text-fresh-green" /> {t}
        </li>
      ))}
    </ul>
  )
}
