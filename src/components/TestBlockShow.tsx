import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ClipboardCheck, Pause, Play, RotateCcw, Square, Check, Clock, Users, Timer,
} from 'lucide-react'
import { cn, optionLabel } from '@/lib/utils'
import {
  subscribeToSession, subscribeToSlideResponses, setTestState, updateTestState, setTestScore, serverNow,
  type Response as FirestoreResponse,
} from '@/lib/session'
import {
  freshTestState, remainingOf, formatClock, formatDuration, rankTest, countCorrect, afterSteps, sameAnswer,
  type TestBlockShowSlide, type TestState, type TestAnswerDoc, type TestResultRow,
} from '@/lib/selfPacedTest'

/* ─────────────────────────────────────────────────────────────────────────
   Self-paced test block on the big screen.
   Stages: rules → live dashboard (running / paused) → finished summary →
   the host's chosen after-test steps (leaderboard and/or answer review) →
   the next slide. The live state is on the session doc (tests.<blockId>),
   so phones follow along and a presenter refresh picks up where it was.
   ───────────────────────────────────────────────────────────────────────── */

export interface TestNav {
  /** Returns true when the block handled the arrow itself. */
  next: () => boolean
  prev: () => boolean
}

export interface LeaderboardEntry { id: string; name: string; score: number; emoji?: string; display: string }

export function TestBlockView({
  slide, code, viewerCount, navRef, renderLeaderboard,
}: {
  slide:        TestBlockShowSlide
  code:         string
  viewerCount:  number
  navRef:       React.MutableRefObject<TestNav | null>
  renderLeaderboard: (entries: LeaderboardEntry[], onWinnerRevealed: () => void) => ReactNode
}) {
  const [state, setState] = useState<TestState | undefined>(undefined)
  const [loaded, setLoaded] = useState(false)
  const [docs, setDocs] = useState<TestAnswerDoc[]>([])
  const [now, setNow] = useState(Date.now())
  const [confirm, setConfirm] = useState<null | { title: string; body: string; action: string; danger?: boolean; run: () => void }>(null)
  const [showRestart, setShowRestart] = useState(false)
  const [setMinutes, setSetMinutes] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const endingRef = useRef(false)

  const durationMs = slide.timeLimit * 60_000
  const questions = slide.questions

  // Live state + everyone's answer sheets
  useEffect(() => subscribeToSession(code, s => {
    setState(s?.tests?.[slide.id])
    setLoaded(true)
  }), [code, slide.id])
  useEffect(() => subscribeToSlideResponses(code, slide.id, rs => {
    setDocs((rs as unknown as TestAnswerDoc[]).filter(d => d.type === 'testblock'))
  }), [code, slide.id])

  // First visit: set up a fresh, not-yet-started test
  useEffect(() => {
    if (loaded && !state) setTestState(code, slide.id, freshTestState(durationMs)).catch(console.error)
  }, [loaded, state, code, slide.id, durationMs])

  // Tick the clock while running
  useEffect(() => {
    if (state?.status !== 'running') return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [state?.status])

  const round = state?.round ?? 0
  const sheets = useMemo(() => docs.filter(d => d.round === round), [docs, round])
  const submitted = sheets.filter(d => d.finished).length
  const answering = sheets.length - submitted
  const participants = Math.max(viewerCount, sheets.length)
  const notStarted = Math.max(0, participants - sheets.length)
  const remaining = remainingOf(state, now)

  /* ── Host actions ──────────────────────────────────────────────────── */

  const reveal = () => Object.fromEntries(questions.map(q => [q.id, {
    correct: q.correctAnswers, ...(q.explanation ? { explanation: q.explanation } : {}),
  }]))

  const startClock = (extra: Record<string, unknown> = {}) => updateTestState(code, slide.id, {
    status: 'running', endsAt: Date.now() + durationMs, remainingMs: null, pausedAt: null, pausedTotalMs: 0,
    startedServer: serverNow(), endedServer: null, stage: 'test', reviewIndex: 0, reveal: undefined, ranks: undefined,
    ...extra,
  }).catch(console.error)

  const endTest = () => {
    if (!state || state.status === 'ended') return
    const extraPause = state.status === 'paused' && state.pausedAt ? Date.now() - state.pausedAt : 0
    updateTestState(code, slide.id, {
      status: 'ended', endsAt: null, remainingMs: 0, pausedAt: null,
      pausedTotalMs: (state.pausedTotalMs ?? 0) + extraPause,
      endedServer: serverNow(), stage: 'test', reviewIndex: 0, reveal: reveal(),
    }).catch(console.error)
  }

  // Time's up: end it for everyone (once)
  useEffect(() => {
    if (state?.status === 'running' && remaining <= 0 && !endingRef.current) {
      endingRef.current = true
      endTest()
    }
    if (state?.status !== 'running') endingRef.current = false
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, state?.status])

  const pause = () => state?.status === 'running' && updateTestState(code, slide.id, {
    status: 'paused', remainingMs: Math.max(0, (state.endsAt ?? Date.now()) - Date.now()), endsAt: null, pausedAt: Date.now(),
  }).catch(console.error)

  const resume = () => state?.status === 'paused' && updateTestState(code, slide.id, {
    status: 'running', endsAt: Date.now() + (state.remainingMs ?? 0), remainingMs: null,
    pausedTotalMs: (state.pausedTotalMs ?? 0) + (state.pausedAt ? Date.now() - state.pausedAt : 0), pausedAt: null,
  }).catch(console.error)

  const setTimeLeft = (ms: number) => {
    if (!state) return
    if (ms <= 0) {
      setConfirm({
        title: 'End the test now?',
        body: `Only ${formatDuration(remaining)} is left. Taking that much time away ends the test now for everyone.`,
        action: 'End test now', danger: true, run: endTest,
      })
      return
    }
    if (state.status === 'running') updateTestState(code, slide.id, { endsAt: Date.now() + ms }).catch(console.error)
    else if (state.status === 'paused') updateTestState(code, slide.id, { remainingMs: ms }).catch(console.error)
  }
  const adjust = (deltaMs: number) => setTimeLeft(remaining + deltaMs)

  // Scores on submit: mark each finished sheet with its score
  useEffect(() => {
    if (slide.scoreTiming !== 'submit') return
    for (const d of sheets) {
      if (!d.finished || typeof d.score === 'number') continue
      setTestScore(code, slide.id, d.respondentId, countCorrect(d.answers ?? {}, questions)).catch(console.error)
    }
  }, [sheets, slide.scoreTiming, code, slide.id, questions])

  /* ── After-test steps ──────────────────────────────────────────────── */

  const steps = useMemo(() => afterSteps(slide.afterOrder, questions.length), [slide.afterOrder, questions.length])
  const pos = !state || state.stage === 'test' ? -1
    : state.stage === 'leaderboard' ? steps.findIndex(s => s.stage === 'leaderboard')
    : steps.findIndex(s => s.stage === 'review' && s.index === state.reviewIndex)
  const goTo = (p: number) => {
    const st = steps[p]
    updateTestState(code, slide.id, st
      ? { stage: st.stage, reviewIndex: st.stage === 'review' ? st.index : 0 }
      : { stage: 'test', reviewIndex: 0 }).catch(console.error)
  }

  const flash = (msg: string) => { setHint(msg); window.setTimeout(() => setHint(null), 3500) }
  navRef.current = {
    next: () => {
      if (!state) return true
      if (state.status === 'ready') { flash('Press Start test when everyone is ready'); return true }
      if (state.status !== 'ended') { flash('The test is still running — use End test to finish early'); return true }
      if (pos + 1 < steps.length) { goTo(pos + 1); return true }
      return false
    },
    prev: () => {
      if (state?.status === 'ended' && pos >= 0) { goTo(pos - 1); return true }
      if (state && (state.status === 'running' || state.status === 'paused')) { flash('The test is still running'); return true }
      return false
    },
  }

  const rows: TestResultRow[] = useMemo(
    () => (state && state.status === 'ended' ? rankTest(sheets, questions, state) : []),
    [sheets, questions, state],
  )

  /* ── Render ────────────────────────────────────────────────────────── */

  if (!state) return <div className="h-full w-full" />

  const step = pos >= 0 ? steps[pos] : null
  let body: ReactNode
  if (step?.stage === 'leaderboard') {
    const entries: LeaderboardEntry[] = rows.slice(0, 10).map(r => ({
      id: r.id, name: r.name, emoji: r.emoji, score: r.correct,
      display: `${r.correct}/${r.total} · ${r.status === 'timeout' ? 'out of time' : formatDuration(r.timeMs)}`,
    }))
    body = renderLeaderboard(entries, () => {
      updateTestState(code, slide.id, {
        ranks: {
          total: rows.length, questions: questions.length, at: Date.now(),
          entries: Object.fromEntries(rows.map(r => [r.id, [r.place, r.correct, Math.round(r.timeMs), r.status === 'timeout' ? 1 : 0]])),
        },
      }).catch(console.error)
    })
  } else if (step?.stage === 'review') {
    body = <TestReviewView index={step.index} total={questions.length} question={questions[step.index]} sheets={sheets} />
  } else if (state.status === 'ready') {
    body = <RulesView slide={slide} participants={participants} onStart={() => startClock()} />
  } else if (state.status === 'ended') {
    const timedOut = rows.filter(r => r.status === 'timeout').length
    const avg = rows.length ? rows.reduce((a, r) => a + r.correct, 0) / rows.length : 0
    body = (
      <Centered>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-golden-sun">Self-paced test</p>
        <h1 className="mt-3 text-6xl font-extrabold tracking-tight">Test finished</h1>
        <p className="mt-6 text-2xl text-white/80">
          <span className="font-bold text-white">{submitted}</span> of {participants} submitted
          {timedOut > 0 && <> · <span className="font-bold text-white">{timedOut}</span> ran out of time</>}
        </p>
        {rows.length > 0 && (
          <p className="mt-2 text-lg text-white/55">Average score {avg.toFixed(1)} / {questions.length}</p>
        )}
        <p className="mt-10 text-sm text-white/40">
          Press → for {steps[0]?.stage === 'leaderboard' ? 'the leaderboard' : 'the answer review'}
        </p>
        <button onClick={() => setShowRestart(true)} className="mt-4 text-xs text-white/35 underline-offset-4 hover:text-white/70 hover:underline">
          Restart…
        </button>
      </Centered>
    )
  } else {
    // running / paused dashboard
    const paused = state.status === 'paused'
    const done = participants > 0 ? submitted / participants : 0
    body = (
      <div className="flex h-full w-full flex-col items-center justify-center px-14 pb-24 pt-10">
        <div className="flex w-full max-w-5xl items-end justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-golden-sun">
              <ClipboardCheck className="size-4" /> Self-paced test
            </p>
            <h1 className="mt-2 text-4xl font-extrabold tracking-tight">{paused ? 'Test paused' : 'Test in progress'}</h1>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-widest text-white/45">Time left</p>
            <p className={cn('font-mono text-7xl font-bold tabular-nums', remaining < 60_000 && !paused ? 'text-hot-pink' : 'text-white')}>
              {formatClock(remaining)}
            </p>
          </div>
        </div>

        <div className="mt-10 w-full max-w-5xl">
          <p className="text-3xl font-semibold">
            <span className="text-fresh-green">{submitted}</span>
            <span className="text-white/70"> of {participants} completed</span>
          </p>
          <div className="mt-4 h-4 overflow-hidden rounded-full bg-white/10">
            <motion.div className="h-full rounded-full bg-fresh-green" animate={{ width: `${done * 100}%` }} transition={{ duration: 0.6 }} />
          </div>
          <div className="mt-6 grid grid-cols-3 gap-4">
            <Stat icon={<Timer className="size-4" />} label="Answering" value={answering} />
            <Stat icon={<Check className="size-4" />} label="Submitted" value={submitted} />
            <Stat icon={<Users className="size-4" />} label="Not started" value={notStarted} />
          </div>
        </div>

        {/* Host controls */}
        <div className="mt-10 flex w-full max-w-5xl flex-wrap items-center gap-2">
          {[-5, -1, 1, 5].map(m => (
            <button key={m} onClick={() => adjust(m * 60_000)} className="rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold transition hover:bg-white/12">
              {m > 0 ? `+${m}` : `−${-m}`} min
            </button>
          ))}
          <form
            onSubmit={e => { e.preventDefault(); const v = parseFloat(setMinutes); if (!isNaN(v)) { setTimeLeft(Math.round(v * 60_000)); setSetMinutes('') } }}
            className="flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 py-1 pl-3 pr-1"
          >
            <span className="text-xs text-white/50">Set</span>
            <input
              value={setMinutes} onChange={e => setSetMinutes(e.target.value)} inputMode="decimal" placeholder="10"
              className="w-12 bg-transparent text-center text-sm text-white outline-none placeholder:text-white/25"
            />
            <span className="text-xs text-white/50">min left</span>
            <button type="submit" className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-semibold hover:bg-white/20">Set</button>
          </form>
          <div className="flex-1" />
          {paused ? (
            <button onClick={resume} className="flex items-center gap-2 rounded-xl bg-fresh-green px-5 py-2.5 text-sm font-bold text-midnight-sky-900 transition hover:brightness-105">
              <Play className="size-4" /> Resume
            </button>
          ) : (
            <button onClick={pause} className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold transition hover:bg-white/12">
              <Pause className="size-4" /> Pause
            </button>
          )}
          <button onClick={() => setShowRestart(true)} className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold transition hover:bg-white/12">
            <RotateCcw className="size-4" /> Restart
          </button>
          <button
            onClick={() => setConfirm({ title: 'End the test now?', body: `${submitted} of ${participants} have submitted. Everyone else's answers so far will be marked as they are.`, action: 'End test', danger: true, run: endTest })}
            className="flex items-center gap-2 rounded-xl bg-hot-pink px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-105"
          >
            <Square className="size-4" /> End test
          </button>
        </div>

        {/* Paused overlay text */}
        <AnimatePresence>
          {paused && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-6 text-sm text-white/50">
              Questions are hidden on every phone until you press Resume.
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full bg-midnight-sky-900 text-white">
      {body}

      {/* Little "can't do that yet" note */}
      <AnimatePresence>
        {hint && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            className="absolute bottom-24 left-1/2 z-30 -translate-x-1/2 rounded-full bg-white/10 px-4 py-2 text-sm text-white/80 backdrop-blur"
          >
            {hint}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Restart menu */}
      <AnimatePresence>
        {showRestart && (
          <Modal onClose={() => setShowRestart(false)}>
            <h3 className="text-xl font-semibold">Restart</h3>
            <p className="mt-1 text-sm text-white/55">Choose what to restart.</p>
            <button
              onClick={() => {
                setShowRestart(false)
                setConfirm({
                  title: 'Restart the timer?', action: 'Restart timer',
                  body: `The clock goes back to ${slide.timeLimit} minutes for everyone. Everyone keeps the answers they've given.`,
                  run: () => startClock(),
                })
              }}
              className="mt-5 w-full rounded-xl border border-white/15 bg-white/5 p-4 text-left transition hover:bg-white/10"
            >
              <p className="flex items-center gap-2 font-semibold"><Clock className="size-4" /> Restart timer</p>
              <p className="mt-1 text-sm text-white/55">Clock back to full time. Everyone keeps their answers.</p>
            </button>
            <button
              onClick={() => {
                setShowRestart(false)
                setConfirm({
                  title: 'Restart the whole test?', action: 'Restart test', danger: true,
                  body: 'Every answer is cleared and everyone starts again from question 1, with the full time.',
                  run: () => startClock({ round: round + 1 }),
                })
              }}
              className="mt-3 w-full rounded-xl border border-hot-pink/30 bg-hot-pink/10 p-4 text-left transition hover:bg-hot-pink/15"
            >
              <p className="flex items-center gap-2 font-semibold"><RotateCcw className="size-4" /> Restart test</p>
              <p className="mt-1 text-sm text-white/55">Clears every answer. Everyone starts again from question 1.</p>
            </button>
            <button onClick={() => setShowRestart(false)} className="mt-4 w-full rounded-xl py-2 text-sm text-white/50 hover:text-white">Cancel</button>
          </Modal>
        )}
      </AnimatePresence>

      {/* Are you sure? */}
      <AnimatePresence>
        {confirm && (
          <Modal onClose={() => setConfirm(null)}>
            <h3 className="text-xl font-semibold">{confirm.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-white/60">{confirm.body}</p>
            <div className="mt-6 flex gap-3">
              <button onClick={() => setConfirm(null)} className="flex-1 rounded-xl border border-white/15 bg-white/5 py-3 text-sm font-medium hover:bg-white/10">Cancel</button>
              <button
                onClick={() => { confirm.run(); setConfirm(null) }}
                className={cn('flex-1 rounded-xl py-3 text-sm font-semibold', confirm.danger ? 'bg-hot-pink text-white' : 'bg-fresh-green text-midnight-sky-900')}
              >
                {confirm.action}
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ── Pieces ─────────────────────────────────────────────────────────────── */

function Centered({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
      className="flex h-full w-full flex-col items-center justify-center px-10 pb-20 text-center"
    >
      {children}
    </motion.div>
  )
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4">
      <p className="flex items-center gap-2 text-sm text-white/55">{icon}{label}</p>
      <p className="mt-1 text-4xl font-bold tabular-nums">{value}</p>
    </div>
  )
}

function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-white/10 bg-midnight-sky-800 p-7 text-white shadow-2xl"
      >
        {children}
      </motion.div>
    </motion.div>
  )
}

function RulesView({ slide, participants, onStart }: { slide: TestBlockShowSlide; participants: number; onStart: () => void }) {
  const n = slide.questions.length
  return (
    <Centered>
      <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-golden-sun">
        <ClipboardCheck className="size-4" /> Self-paced test
      </p>
      <h1 className="mt-4 text-6xl font-extrabold tracking-tight">{n} question{n !== 1 ? 's' : ''} · {slide.timeLimit} minutes</h1>
      <ul className="mt-8 space-y-3 text-left text-2xl text-white/80">
        <li className="flex items-center gap-3"><Check className="size-6 text-fresh-green" /> Answer on your phone, at your own pace</li>
        <li className="flex items-center gap-3"><Check className="size-6 text-fresh-green" /> Go back and change answers until you submit</li>
        <li className="flex items-center gap-3"><Check className="size-6 text-fresh-green" /> Most correct answers wins</li>
        <li className="flex items-center gap-3"><Check className="size-6 text-fresh-green" /> Tie? The faster finish ranks higher</li>
        {slide.rules && <li className="flex items-center gap-3"><Check className="size-6 text-fresh-green" /> {slide.rules}</li>}
      </ul>
      <p className="mt-10 text-lg text-white/55"><span className="font-bold text-white">{participants}</span> {participants === 1 ? 'person' : 'people'} joined</p>
      <button
        onClick={onStart}
        className="mt-5 flex items-center gap-2.5 rounded-2xl bg-golden-sun px-10 py-4 text-xl font-extrabold text-midnight-sky-900 shadow-[0_0_40px_-6px] shadow-golden-sun/60 transition hover:brightness-105 active:scale-[0.98]"
      >
        <Play className="size-5" /> Start test
      </button>
    </Centered>
  )
}

/** One question of the answer review: how the room answered, and the right answer. */
function TestReviewView({ index, total, question, sheets }: {
  index: number
  total: number
  question: TestBlockShowSlide['questions'][number]
  sheets: TestAnswerDoc[]
}) {
  const answered = sheets.filter(d => (d.answers?.[question.id]?.length ?? 0) > 0)
  const counts = question.options.map((_, i) => answered.filter(d => d.answers[question.id].includes(i)).length)
  const right = answered.filter(d => sameAnswer(d.answers[question.id], question.correctAnswers)).length
  const pct = (n: number) => (answered.length ? Math.round((n / answered.length) * 100) : 0)
  const multi = question.correctAnswers.length > 1
  return (
    <motion.div
      key={question.id}
      initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35 }}
      className="flex h-full w-full flex-col px-14 pb-24 pt-10"
    >
      <div className="flex items-start justify-between gap-8">
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-golden-sun">Answer review · {index + 1} of {total}</p>
          <h2 className="mt-3 text-2xl font-semibold leading-snug text-white/95 xl:text-3xl">{question.question}</h2>
        </div>
        <div className="shrink-0 rounded-2xl border border-fresh-green/30 bg-fresh-green/10 px-6 py-4 text-center">
          <p className="text-5xl font-extrabold text-fresh-green">{pct(right)}%</p>
          <p className="mt-1 text-xs uppercase tracking-wider text-white/55">got it right</p>
        </div>
      </div>

      <div className="mt-8 flex flex-col gap-3">
        {question.options.map((o, i) => {
          const isRight = question.correctAnswers.includes(i)
          return (
            <div key={i} className="flex items-center gap-4">
              <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl text-base font-bold', isRight ? 'bg-fresh-green text-midnight-sky-900' : 'bg-white/10 text-white/70')}>
                {isRight ? <Check className="size-5" /> : optionLabel(i, question.options.length)}
              </span>
              <div className="relative h-12 flex-1 overflow-hidden rounded-xl bg-white/5">
                <motion.div
                  className={cn('absolute inset-y-0 left-0 rounded-xl', isRight ? 'bg-fresh-green/35' : 'bg-white/12')}
                  initial={{ width: 0 }} animate={{ width: `${pct(counts[i])}%` }} transition={{ duration: 0.7, delay: 0.1 + i * 0.05 }}
                />
                <span className={cn('relative flex h-full items-center px-4 text-lg', isRight ? 'font-semibold text-white' : 'text-white/80')}>{o}</span>
              </div>
              <span className="w-16 shrink-0 text-right text-lg font-semibold tabular-nums text-white/80">{pct(counts[i])}%</span>
            </div>
          )
        })}
      </div>

      {multi && <p className="mt-3 text-sm text-white/45">{question.correctAnswers.length} correct options — percentages show how many people picked each one.</p>}

      {question.explanation && (
        <div className="mt-6 rounded-2xl border border-golden-sun/25 bg-golden-sun/10 px-6 py-4">
          <p className="text-xs font-bold uppercase tracking-widest text-golden-sun">Explanation</p>
          <p className="mt-1.5 text-lg leading-relaxed text-white/90">{question.explanation}</p>
        </div>
      )}
      <p className="mt-auto pt-4 text-sm text-white/35">{answered.length} answered this question</p>
    </motion.div>
  )
}

export type { FirestoreResponse }
