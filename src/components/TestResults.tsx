import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Check, X, ChevronDown, ChevronUp, Info, ClipboardCheck, Users, Clock, Trophy, Target, PenLine, Sparkles, Copy, Download,
} from 'lucide-react'
import { cn, optionLabel } from '@/lib/utils'
import type { ResultQuestion, TestResult, TestResultQuestion, TestResultParticipant } from '@/lib/deckStorage'
import {
  formatDuration, sameAnswer, qTypeOf, isMarkable, hasAnswer, answerText, autoMarked, TEST_QTYPE_LABEL, type TestAnswer,
} from '@/lib/selfPacedTest'
import { aggregateRanking, rankingOrder } from '@/lib/ranking'

/* ─────────────────────────────────────────────────────────────────────────
   Results for self-paced tests, plus the three question kinds every
   results view, export and PDF labels questions with.
   Multiple choice is marked automatically; every other type is collected
   for the host to mark — by hand in Excel's "To mark" tab, or with AI.
   ───────────────────────────────────────────────────────────────────────── */

export type QuestionKind = 'test' | 'live' | 'poll'

export const KIND_INFO: Record<QuestionKind, { label: string; definition: string; cls: string }> = {
  test: {
    label: 'Self-paced test',
    definition: 'Questions inside a Self-paced test block. Everyone answers on their own phone at their own pace within one time limit. Multiple choice is marked automatically and ranked by correct answers, then finish time; other question types are marked by the host afterwards.',
    cls: 'bg-golden-sun/15 text-[#8a6600]',
  },
  live: {
    label: 'Live quiz',
    definition: 'Multiple-choice questions with a correct answer, shown one at a time on the big screen while Live quiz is on. Points for each right answer, plus extra points for answering fast.',
    cls: 'bg-hot-pink/10 text-hot-pink',
  },
  poll: {
    label: 'Poll',
    definition: "Questions that aren't scored, such as word clouds, open-ended, rating, ranking, and multiple choice with no correct answer. They show what the room thinks.",
    cls: 'bg-midnight-sky-100 text-midnight-sky-600',
  },
}

/** Live quiz if it was scored live (or marked while the deck is a live quiz); otherwise a poll. */
export function liveKind(q: ResultQuestion, deckIsQuiz: boolean): QuestionKind {
  if (q.type !== 'mcq' || !(q.correctAnswers?.length)) return 'poll'
  return q.responses.some(r => r.quizPoints) || deckIsQuiz ? 'live' : 'poll'
}

/** A small tag with the kind's definition on hover / tap. */
export function KindTag({ kind }: { kind: QuestionKind }) {
  const [open, setOpen] = useState(false)
  const info = KIND_INFO[kind]
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        title={info.definition}
        className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', info.cls)}
      >
        {info.label}
        <Info className="size-3 opacity-70" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.span
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
            className="absolute left-0 top-full z-30 mt-1.5 w-72 rounded-xl border border-midnight-sky-100 bg-white p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-midnight-sky-700 shadow-xl"
          >
            {info.definition}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

/* ── Shared text helpers (page, Excel, PDF) ─────────────────────────────── */

const letters = (idxs: number[], n: number) => idxs.slice().sort((a, b) => a - b).map(i => optionLabel(i, n)).join(', ')
const full = (idxs: number[], q: TestResultQuestion) =>
  idxs.slice().sort((a, b) => a - b).map(i => `${optionLabel(i, q.options.length)}. ${q.options[i] ?? ''}`.trim()).join(', ')
const picks = (a: TestAnswer | undefined) => (Array.isArray(a) ? a : []) as number[]
const given = (q: TestResultQuestion, a: TestAnswer | undefined) => hasAnswer({ ...q, pick: 1 }, a)
const isMcq = (q: TestResultQuestion) => qTypeOf(q) === 'mcq'
const marksLabel = (q: TestResultQuestion) => `${q.marks} mark${q.marks !== 1 ? 's' : ''}`

/** "✗ missed B", "✗ C wasn't correct", "✗ not answered", "✓" — multiple choice */
export function answerVerdict(got: TestAnswer | undefined, q: TestResultQuestion): { ok: boolean; note: string } {
  const g = picks(got)
  if (!g.length) return { ok: false, note: 'not answered' }
  if (sameAnswer(g, q.correctAnswers)) return { ok: true, note: '' }
  const missed = q.correctAnswers.filter(c => !g.includes(c))
  const extra = g.filter(x => !q.correctAnswers.includes(x))
  const parts = []
  if (missed.length) parts.push(`missed ${letters(missed, q.options.length)}`)
  if (extra.length) parts.push(`${letters(extra, q.options.length)} ${extra.length > 1 ? "weren't" : "wasn't"} correct`)
  return { ok: false, note: parts.join(' · ') }
}

/** The result column for any type, in plain words. */
function resultLabel(q: TestResultQuestion, a: TestAnswer | undefined): string {
  if (isMcq(q)) {
    const g = picks(a)
    if (!g.length) return 'Not answered'
    if (sameAnswer(g, q.correctAnswers)) return '✓ Right'
    const hits = g.filter(x => q.correctAnswers.includes(x)).length
    return q.correctAnswers.length > 1 && hits > 0 ? `✗ Partly right (${hits} of ${q.correctAnswers.length})` : '✗ Wrong'
  }
  if (!given(q, a)) return 'Not answered'
  return isMarkable(q) ? `To mark (${marksLabel(q)})` : 'Not marked (just collected)'
}

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`

/** One plain sentence on what everyone answered, for any question type. */
function answersShow(q: TestResultQuestion, ps: TestResultParticipant[]): string {
  const t = qTypeOf(q)
  const answers = ps.map(p => p.answers[q.id]).filter(a => given(q, a))
  if (!answers.length) return 'Nobody answered'
  if (t === 'mcq') {
    const wrong = new Map<string, number>()
    answers.forEach(a => { if (!sameAnswer(a, q.correctAnswers)) { const k = full(picks(a), q); wrong.set(k, (wrong.get(k) ?? 0) + 1) } })
    const top = [...wrong.entries()].sort((x, y) => y[1] - x[1])[0]
    return top ? `Most common wrong answer: ${top[0]} (${people(top[1])})` : 'Everyone who answered got it right'
  }
  if (t === 'openended') return isMarkable(q) ? 'Written answers: read and mark them in the To mark tab' : 'Written answers: see the Test answers tab'
  if (t === 'wordcloud') return `Answers given, most common first: ${topWords(q, ps).slice(0, 10).map(([w, n]) => `${w} (${people(n)})`).join(', ')}`
  if (t === 'rating') {
    const max = q.ratingMax ?? 5
    return `Average rating out of ${max}: ` + q.options.map((o, i) => {
      const vs = answers.map(a => (a as number[])[i]).filter(v => typeof v === 'number' && v >= 0)
      return `${o} ${vs.length ? (vs.reduce((x, y) => x + y, 0) / vs.length).toFixed(1) : '–'}`
    }).join(', ')
  }
  const r = aggregateRanking(answers.map(a => JSON.stringify(a)), q.options.length)
  const ord = ['1st', '2nd', '3rd']
  return `Everyone's rankings combined: ` + rankingOrder(r, q.options.length).map((k, i) => `${ord[i] ?? `${i + 1}th`} ${q.options[k]}`).join(', ')
}

/** A short version of a non-multiple-choice answer for the one-row-per-person overview. */
function shortAnswer(q: TestResultQuestion, a: TestAnswer | undefined): string {
  if (!given(q, a)) return '—'
  const t = qTypeOf(q)
  if (t === 'openended') { const n = String(a).trim().split(/\s+/).length; return `✎ ${n} word${n !== 1 ? 's' : ''}` }
  if (t === 'wordcloud') return (a as string[]).map(w => String(w).trim()).filter(Boolean).join(', ')
  if (t === 'ranking') return (a as number[]).map(k => q.options[k]).join(' › ')
  return (a as number[]).map(v => (v >= 0 ? String(v) : '–')).join(' · ') + ` (out of ${q.ratingMax ?? 5})`
}

function topWords(q: TestResultQuestion, ps: TestResultParticipant[]): [string, number][] {
  const freq = new Map<string, number>()
  ps.forEach(p => { const a = p.answers[q.id]; if (Array.isArray(a)) (a as string[]).forEach(w => { const k = String(w).trim().toLowerCase(); if (k) freq.set(k, (freq.get(k) ?? 0) + 1) }) })
  return [...freq].sort((a, b) => b[1] - a[1])
}

export const statusLabel = (p: TestResultParticipant) => (p.status === 'submitted' ? 'Submitted' : 'Ran out of time')
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
/** Answers given to questions the host marks. */
const toMarkCount = (test: TestResult) =>
  test.participants.reduce((n, p) => n + test.questions.filter(q => isMarkable(q) && given(q, p.answers[q.id])).length, 0)

/* ── Results page section ──────────────────────────────────────────────── */

export function TestResultSection({ test, index, title }: { test: TestResult; index: number; title?: string }) {
  const [openPerson, setOpenPerson] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const ps = test.participants
  const n = test.questions.length
  const auto = autoMarked(test.questions).length
  const mixed = auto > 0 && auto < n
  const toMark = toMarkCount(test)
  const submitted = ps.filter(p => p.status === 'submitted')
  const shown = showAll ? ps : ps.slice(0, 25)

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: index * 0.05 }}
      className="overflow-hidden rounded-2xl border border-golden-sun/40 bg-white shadow-[0_2px_12px_-4px_rgba(0,0,121,0.06)]"
    >
      <div className="h-1 bg-golden-sun" />
      <div className="px-6 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <KindTag kind="test" />
        </div>
        <h2 className="mt-2 flex items-center gap-2 text-2xl font-bold text-midnight-sky-900">
          <ClipboardCheck className="size-6 text-golden-sun" />
          Self-paced test · {n} question{n !== 1 ? 's' : ''} · {test.timeLimit} min
        </h2>

        {/* Summary */}
        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Mini icon={<Users className="size-4" />} label="Took the test" value={String(ps.length)} />
          <Mini icon={<Check className="size-4" />} label="Submitted" value={`${submitted.length}`} sub={`${ps.length - submitted.length} ran out of time`} />
          {auto > 0
            ? <Mini icon={<Target className="size-4" />} label={mixed ? 'Average multiple-choice score' : 'Average score'} value={`${avg(ps.map(p => p.correct)).toFixed(1)} / ${auto}`} />
            : <Mini icon={<PenLine className="size-4" />} label="Answers to mark" value={String(toMark)} />}
          <Mini icon={<Clock className="size-4" />} label="Average time" value={submitted.length ? formatDuration(avg(submitted.map(p => p.timeMs))) : '—'} sub="of those who submitted" />
        </div>

        {toMark > 0 && <AiMarking test={test} toMark={toMark} title={title ?? 'Self-paced test'} />}

        {/* Participants */}
        <h3 className="mt-7 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-midnight-sky-500">
          <Trophy className="size-4 text-golden-sun" /> Participants
        </h3>
        <p className="mt-1 text-xs text-midnight-sky-400">Click a name to see every answer they gave.</p>
        <div className="mt-3 overflow-hidden rounded-xl border border-midnight-sky-100">
          <table className="w-full text-left text-sm">
            <thead className="bg-midnight-sky-50 text-[11px] uppercase tracking-wider text-midnight-sky-500">
              <tr>
                {auto > 0 && <th className="px-4 py-2.5 font-semibold">Place</th>}
                <th className="px-4 py-2.5 font-semibold">Name</th>
                {auto > 0 && <th className="px-4 py-2.5 font-semibold">{mixed ? 'Multiple-choice score' : 'Score'}</th>}
                <th className="px-4 py-2.5 font-semibold">Time taken</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(p => (
                <PersonRows key={p.id} p={p} test={test} auto={auto > 0} open={openPerson === p.id} onToggle={() => setOpenPerson(openPerson === p.id ? null : p.id)} />
              ))}
            </tbody>
          </table>
        </div>
        {ps.length > 25 && (
          <button onClick={() => setShowAll(v => !v)} className="mt-2 text-sm font-medium text-sky-blue hover:underline">
            {showAll ? 'Show fewer' : `Show all ${ps.length} participants`}
          </button>
        )}

        {/* Questions */}
        <h3 className="mt-8 text-sm font-semibold uppercase tracking-wider text-midnight-sky-500">Questions</h3>
        <div className="mt-3 space-y-3">
          {test.questions.map((q, i) => isMcq(q)
            ? <TestQuestionCard key={q.id} q={q} i={i} ps={ps} />
            : <MarkedQuestionCard key={q.id} q={q} i={i} ps={ps} />)}
        </div>
      </div>
    </motion.section>
  )
}

function Mini({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-midnight-sky-100 bg-midnight-sky-50/50 px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-midnight-sky-500">{icon}{label}</p>
      <p className="mt-1.5 text-xl font-bold tabular-nums text-midnight-sky-900">{value}</p>
      {sub && <p className="text-[11px] text-midnight-sky-400">{sub}</p>}
    </div>
  )
}

function PersonRows({ p, test, auto, open, onToggle }: { p: TestResultParticipant; test: TestResult; auto: boolean; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr onClick={onToggle} className={cn('cursor-pointer border-t border-midnight-sky-100 transition hover:bg-midnight-sky-50', open && 'bg-midnight-sky-50')}>
        {auto && <td className="px-4 py-2.5 font-semibold tabular-nums text-midnight-sky-700">{p.place}</td>}
        <td className="px-4 py-2.5 font-medium text-midnight-sky-900">
          <span className="inline-flex items-center gap-1.5">{open ? <ChevronUp className="size-3.5 text-midnight-sky-400" /> : <ChevronDown className="size-3.5 text-midnight-sky-400" />}{p.name}</span>
        </td>
        {auto && <td className="px-4 py-2.5 tabular-nums text-midnight-sky-800">{p.correct}/{p.total}</td>}
        <td className="px-4 py-2.5 tabular-nums text-midnight-sky-600">{formatDuration(p.timeMs)}</td>
        <td className={cn('px-4 py-2.5 text-xs font-medium', p.status === 'submitted' ? 'text-fresh-green' : 'text-amber-600')}>{statusLabel(p)}</td>
      </tr>
      {open && (
        <tr className="border-t border-midnight-sky-100 bg-midnight-sky-50/40">
          <td colSpan={auto ? 5 : 3} className="px-4 py-3">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-midnight-sky-400">
                <tr><th className="py-1.5 pr-3">Question</th><th className="py-1.5 pr-3">Their answer</th><th className="py-1.5 pr-3">Correct answer / marking guide</th><th className="py-1.5" /></tr>
              </thead>
              <tbody>
                {test.questions.map((q, i) => {
                  const got = p.answers[q.id]
                  const mcq = isMcq(q)
                  const v = mcq ? answerVerdict(got, q) : null
                  const text = mcq ? (picks(got).length ? full(picks(got), q) : '') : answerText(q, got)
                  return (
                    <tr key={q.id} className="border-t border-midnight-sky-100 align-top">
                      <td className="max-w-xs py-1.5 pr-3 text-midnight-sky-700"><span className="font-semibold">Q{i + 1}</span> {q.question.length > 70 ? q.question.slice(0, 70) + '…' : q.question}</td>
                      <td className="max-w-md whitespace-pre-wrap py-1.5 pr-3 text-midnight-sky-800">{text || <span className="italic text-midnight-sky-400">Not answered</span>}</td>
                      <td className="max-w-xs py-1.5 pr-3 text-midnight-sky-600">{mcq ? full(q.correctAnswers, q) : (q.guide || '—')}</td>
                      {v
                        ? <td className={cn('whitespace-nowrap py-1.5 font-semibold', v.ok ? 'text-fresh-green' : 'text-hot-pink')}>{v.ok ? <Check className="inline size-3.5" /> : <><X className="inline size-3.5" /> {v.note}</>}</td>
                        : <td className="whitespace-nowrap py-1.5 font-medium text-midnight-sky-500">{text ? (isMarkable(q) ? `To mark · ${marksLabel(q)}` : 'Not marked') : ''}</td>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  )
}

function TestQuestionCard({ q, i, ps }: { q: TestResultQuestion; i: number; ps: TestResultParticipant[] }) {
  const [open, setOpen] = useState(false)
  const answered = ps.filter(p => picks(p.answers[q.id]).length > 0)
  const right = answered.filter(p => sameAnswer(p.answers[q.id], q.correctAnswers)).length
  const pct = (x: number) => (answered.length ? Math.round((x / answered.length) * 100) : 0)
  return (
    <div className="rounded-xl border border-midnight-sky-100">
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm font-semibold leading-snug text-midnight-sky-900"><span className="mr-1.5 text-[#a07800]">Q{i + 1}</span>{q.question}</p>
          <span className="shrink-0 rounded-full bg-fresh-green/10 px-2.5 py-1 text-xs font-bold text-fresh-green">{pct(right)}% correct</span>
        </div>
        <div className="mt-3 space-y-1.5">
          {q.options.map((o, k) => {
            const c = answered.filter(p => picks(p.answers[q.id]).includes(k)).length
            const isRight = q.correctAnswers.includes(k)
            return (
              <div key={k} className="flex items-center gap-2.5 text-sm">
                <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold', isRight ? 'bg-fresh-green text-white' : 'bg-midnight-sky-100 text-midnight-sky-500')}>
                  {isRight ? <Check className="size-3.5" /> : optionLabel(k, q.options.length)}
                </span>
                <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-midnight-sky-50">
                  <div className={cn('absolute inset-y-0 left-0', isRight ? 'bg-fresh-green/25' : 'bg-midnight-sky-200/60')} style={{ width: `${pct(c)}%` }} />
                  <span className={cn('relative flex h-full items-center px-2.5', isRight ? 'font-medium text-midnight-sky-900' : 'text-midnight-sky-700')}>{o}</span>
                </div>
                <span className="w-10 shrink-0 text-right text-xs tabular-nums text-midnight-sky-500">{pct(c)}%</span>
              </div>
            )
          })}
        </div>
        {q.explanation && <p className="mt-3 rounded-lg bg-golden-sun/10 px-3 py-2 text-xs leading-relaxed text-midnight-sky-700"><span className="font-semibold">Explanation: </span>{q.explanation}</p>}
      </div>
      {answered.length > 0 && (
        <>
          <button onClick={() => setOpen(v => !v)} className="flex w-full items-center justify-between border-t border-midnight-sky-100 px-5 py-2.5 text-xs font-medium text-midnight-sky-600 hover:bg-midnight-sky-50">
            <span>{open ? 'Hide' : 'Show'} {answered.length} response{answered.length !== 1 ? 's' : ''}</span>
            {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
          {open && (
            <div className="max-h-72 overflow-y-auto border-t border-midnight-sky-100 px-5 py-2">
              {answered.map(p => {
                const v = answerVerdict(p.answers[q.id], q)
                return (
                  <div key={p.id} className="flex items-center gap-3 border-b border-midnight-sky-50 py-1.5 text-xs last:border-0">
                    <span className="w-40 shrink-0 truncate font-medium text-midnight-sky-800">{p.name}</span>
                    <span className="flex-1 text-midnight-sky-600">{full(picks(p.answers[q.id]), q)}</span>
                    <span className={cn('shrink-0 font-semibold', v.ok ? 'text-fresh-green' : 'text-hot-pink')}>{v.ok ? '✓' : `✗ ${v.note}`}</span>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Open-ended, word cloud, rating and ranking questions in a test. */
function MarkedQuestionCard({ q, i, ps }: { q: TestResultQuestion; i: number; ps: TestResultParticipant[] }) {
  const [open, setOpen] = useState(false)
  const t = qTypeOf(q)
  const answered = ps.filter(p => given(q, p.answers[q.id]))
  const max = q.ratingMax ?? 5
  return (
    <div className="rounded-xl border border-midnight-sky-100">
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm font-semibold leading-snug text-midnight-sky-900"><span className="mr-1.5 text-[#a07800]">Q{i + 1}</span>{q.question}</p>
          <span className="shrink-0 rounded-full bg-midnight-sky-100 px-2.5 py-1 text-xs font-semibold text-midnight-sky-600">
            {TEST_QTYPE_LABEL[t]} · {isMarkable(q) ? marksLabel(q) : 'not marked'}
          </span>
        </div>
        <p className="mt-1 text-xs text-midnight-sky-400">{answered.length} of {ps.length} answered</p>

        {t === 'rating' && answered.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {q.options.map((o, k) => {
              const vs = answered.map(p => (p.answers[q.id] as number[])[k]).filter(v => typeof v === 'number' && v >= 0)
              const a = avg(vs)
              return (
                <div key={k} className="flex items-center gap-2.5 text-sm">
                  <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-midnight-sky-50">
                    <div className="absolute inset-y-0 left-0 bg-sky-blue/25" style={{ width: `${(a / max) * 100}%` }} />
                    <span className="relative flex h-full items-center px-2.5 text-midnight-sky-800">{o}</span>
                  </div>
                  <span className="w-14 shrink-0 text-right text-xs font-semibold tabular-nums text-midnight-sky-600">{vs.length ? a.toFixed(1) : '–'} / {max}</span>
                </div>
              )
            })}
          </div>
        )}
        {t === 'ranking' && answered.length > 0 && (() => {
          const r = aggregateRanking(answered.map(p => JSON.stringify(p.answers[q.id])), q.options.length)
          return (
            <ol className="mt-3 space-y-1">
              {rankingOrder(r, q.options.length).map((k, pos) => (
                <li key={k} className="flex items-center gap-2.5 text-sm text-midnight-sky-800">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-midnight-sky-100 text-[11px] font-bold text-midnight-sky-600">{pos + 1}</span>
                  {q.options[k]}
                  <span className="ml-auto text-xs tabular-nums text-midnight-sky-400">avg position {r.avgPos[k] ? r.avgPos[k].toFixed(1) : '–'}</span>
                </li>
              ))}
            </ol>
          )
        })()}
        {t === 'wordcloud' && answered.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {topWords(q, ps).slice(0, 20).map(([w, c]) => (
              <span key={w} className="rounded-full bg-midnight-sky-50 px-2.5 py-1 text-xs text-midnight-sky-700">{w} <span className="font-semibold text-midnight-sky-400">{c}</span></span>
            ))}
          </div>
        )}
        {q.guide && <p className="mt-3 rounded-lg bg-golden-sun/10 px-3 py-2 text-xs leading-relaxed text-midnight-sky-700"><span className="font-semibold">Marking guide: </span>{q.guide}</p>}
      </div>
      {answered.length > 0 && (
        <>
          <button onClick={() => setOpen(v => !v)} className="flex w-full items-center justify-between border-t border-midnight-sky-100 px-5 py-2.5 text-xs font-medium text-midnight-sky-600 hover:bg-midnight-sky-50">
            <span>{open ? 'Hide' : 'Show'} {answered.length} answer{answered.length !== 1 ? 's' : ''}</span>
            {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
          {open && (
            <div className="max-h-96 overflow-y-auto border-t border-midnight-sky-100 px-5 py-2">
              {answered.map(p => (
                <div key={p.id} className="flex gap-3 border-b border-midnight-sky-50 py-2 text-xs last:border-0">
                  <span className="w-40 shrink-0 truncate font-medium text-midnight-sky-800">{p.name}</span>
                  <span className="flex-1 whitespace-pre-wrap leading-relaxed text-midnight-sky-600">{answerText(q, p.answers[q.id])}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ── Marking with AI ───────────────────────────────────────────────────── */

const AI_MARKING_PROMPT = `You are marking a staff test. The attached file has one row per answer that needs marking, with the question, the person's answer, a marking guide and the marks available.

For each row:
1. Mark the answer against the marking guide (if the guide is empty, use your own judgement of a good answer to the question).
2. Give a whole-number mark from 0 up to "Marks available".
3. Write a one-sentence reason.

Return a table I can download as a CSV, with these columns: Name, Q#, Mark, Marks available, Reason.

Then a second table, one row per person: Name, Multiple-choice score, Written marks (the sum of their marks above), Total (multiple-choice score + written marks), sorted by Total, highest first.`

/** Rows for marking: one per answer to a question the host marks. */
function toMarkRows(test: TestResult): Record<string, string | number>[] {
  const auto = autoMarked(test.questions).length
  const rows: Record<string, string | number>[] = []
  for (const p of test.participants) {
    test.questions.forEach((q, i) => {
      if (!isMarkable(q) || !given(q, p.answers[q.id])) return
      rows.push({
        Name: p.name,
        ...(auto > 0 ? { 'Multiple-choice score': p.correct } : {}),
        'Q#': `Q${i + 1}`,
        Question: q.question.replace(/\s+/g, ' '),
        Type: TEST_QTYPE_LABEL[qTypeOf(q)],
        'Their answer': answerText(q, p.answers[q.id]),
        Words: qTypeOf(q) === 'openended' ? String(p.answers[q.id]).trim().split(/\s+/).length : '',
        'Marking guide': q.guide ?? '',
        'Marks available': q.marks ?? 0,
        Mark: '',
        Comment: '',
      })
    })
  }
  return rows
}

function csvOf(rows: Record<string, string | number>[]): string {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const cell = (v: string | number) => { const t = String(v ?? ''); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }
  return '﻿' + [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n')
}

function AiMarking({ test, toMark, title }: { test: TestResult; toMark: number; title: string }) {
  const [copied, setCopied] = useState(false)
  const download = () => {
    const blob = new Blob([csvOf(toMarkRows(test))], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${title.replace(/[\\/:*?"<>|]+/g, '-')} - answers to mark.csv`
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }
  const copy = () => {
    navigator.clipboard.writeText(AI_MARKING_PROMPT).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000) }).catch(() => {})
  }
  return (
    <div className="mt-6 rounded-xl border border-sky-blue/25 bg-sky-blue/5 px-5 py-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-midnight-sky-900">
        <PenLine className="size-4 text-sky-blue" /> {toMark} written answer{toMark !== 1 ? 's' : ''} to mark
      </p>
      <p className="mt-1 text-xs leading-relaxed text-midnight-sky-600">
        Mark them yourself in the Excel download (the <strong>To mark</strong> tab has an empty Mark column), or let AI do a first pass:
      </p>
      <ol className="mt-3 space-y-2 text-xs leading-relaxed text-midnight-sky-700">
        <li className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">1.</span> Download the answers to mark
          <button onClick={download} className="inline-flex items-center gap-1.5 rounded-lg bg-midnight-sky-800 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-midnight-sky-700">
            <Download className="size-3" /> Answers to mark (CSV)
          </button>
        </li>
        <li className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">2.</span> Copy the marking prompt
          <button onClick={copy} className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-semibold', copied ? 'border-fresh-green/40 text-fresh-green' : 'border-midnight-sky-200 text-midnight-sky-700 hover:border-midnight-sky-400')}>
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />} {copied ? 'Copied' : 'Copy prompt'}
          </button>
        </li>
        <li><span className="font-semibold">3.</span> In <Sparkles className="inline size-3 text-sky-blue" /> Gemini (or ChatGPT / Claude), upload the file and paste the prompt. You get a mark and a reason for every answer, plus each person’s total.</li>
        <li><span className="font-semibold">4.</span> Check the marks before you share them — AI can get things wrong.</li>
      </ol>
      <p className="mt-3 text-[11px] text-midnight-sky-400">Make sure your company’s AI policy allows staff answers to be shared with the AI tool you use.</p>
    </div>
  )
}

/* ── Excel ─────────────────────────────────────────────────────────────── */

type Row = Record<string, string | number>

/** The test tabs: overview, every answer in full, per question, and (when
 *  there are written answers) one row per answer to mark. */
export function testSheets(test: TestResult): { results: Row[]; answers: Row[]; questions: Row[]; toMark: Row[] } {
  const qs = test.questions
  const auto = autoMarked(qs).length
  const mixed = auto > 0 && auto < qs.length
  const qCol = (i: number) => `Q${i + 1}`
  const scoreCol = mixed ? 'Multiple-choice score' : 'Score'
  const correctRow: Row = { ...(auto ? { Place: '' } : {}), Name: '✓ Correct answer', ...(auto ? { [scoreCol]: '' } : {}), 'Time taken': '', 'Time (seconds)': '', Status: '' }
  qs.forEach((q, i) => {
    correctRow[qCol(i)] = isMcq(q) ? letters(q.correctAnswers, q.options.length) : (isMarkable(q) ? `To mark · ${marksLabel(q)}` : 'Not marked')
  })
  const results: Row[] = [correctRow, ...test.participants.map(p => {
    const row: Row = {
      ...(auto ? { Place: p.place } : {}), Name: p.name, ...(auto ? { [scoreCol]: `${p.correct}/${p.total}` } : {}),
      'Time taken': formatDuration(p.timeMs), 'Time (seconds)': Math.round(p.timeMs / 1000), Status: statusLabel(p),
    }
    qs.forEach((q, i) => {
      const got = p.answers[q.id]
      row[qCol(i)] = isMcq(q)
        ? (picks(got).length ? `${letters(picks(got), q.options.length)} ${answerVerdict(got, q).ok ? '✓' : '✗'}` : '—')
        : shortAnswer(q, got)
    })
    return row
  })]

  const answers: Row[] = []
  for (const p of test.participants) {
    qs.forEach((q, i) => {
      const got = p.answers[q.id]
      answers.push({
        Name: p.name,
        'Q#': `Q${i + 1}`,
        Question: q.question.replace(/\s+/g, ' '),
        Type: TEST_QTYPE_LABEL[qTypeOf(q)],
        'Their answer': (isMcq(q) ? (picks(got).length ? full(picks(got), q) : '') : answerText(q, got)) || '—',
        Result: resultLabel(q, got),
        'Correct answer / marking guide': isMcq(q) ? full(q.correctAnswers, q) : (q.guide ?? ''),
      })
    })
  }

  const questions: Row[] = qs.map((q, i) => {
    const answered = test.participants.filter(p => given(q, p.answers[q.id]))
    const mcq = isMcq(q)
    const right = mcq ? answered.filter(p => sameAnswer(p.answers[q.id], q.correctAnswers)).length : 0
    return {
      'Q#': `Q${i + 1}`,
      Question: q.question,
      Type: TEST_QTYPE_LABEL[qTypeOf(q)],
      'People who answered': answered.length,
      'Correct answer': mcq ? full(q.correctAnswers, q) : (isMarkable(q) ? 'You mark it' : 'Not marked'),
      'Got it right': mcq ? (answered.length ? `${right} of ${answered.length} (${Math.round((right / answered.length) * 100)}%)` : '—') : '',
      'What the answers show': answersShow(q, test.participants),
      'Marks available': mcq ? 1 : (isMarkable(q) ? q.marks ?? 0 : 'Not marked'),
      'Explanation / marking guide': mcq ? (q.explanation ?? '') : (q.guide ?? ''),
    }
  })
  return { results, answers, questions, toMark: toMarkRows(test) }
}

/* ── PDF ───────────────────────────────────────────────────────────────── */

/** Adds the self-paced test pages: summary, participants, then each question. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function addTestPdf(doc: any, autoTable: any, test: TestResult, title: string) {
  const pageW = doc.internal.pageSize.getWidth()
  const margin = 40
  const ps = test.participants
  const n = test.questions.length
  const auto = autoMarked(test.questions).length
  const mixed = auto > 0 && auto < n
  const submitted = ps.filter(p => p.status === 'submitted')
  const lastY = () => (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 100

  doc.addPage()
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(0, 0, 121)
  doc.text(title, margin, 60)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(120)
  doc.text(`${n} questions · ${test.timeLimit} min time limit${auto ? ' · ranked by correct multiple-choice answers, then finish time' : ''}${mixed || !auto ? ' · written answers marked by the host' : ''}`, margin, 78)
  autoTable(doc, {
    startY: 92,
    head: [['Took the test', 'Submitted', 'Ran out of time', auto ? (mixed ? 'Average MC score' : 'Average score') : 'Answers to mark', 'Average time (submitted)']],
    body: [[String(ps.length), String(submitted.length), String(ps.length - submitted.length),
      auto ? `${avg(ps.map(p => p.correct)).toFixed(1)} / ${auto}` : String(toMarkCount(test)),
      submitted.length ? formatDuration(avg(submitted.map(p => p.timeMs))) : '-']],
    theme: 'grid', headStyles: { fillColor: [255, 199, 9], textColor: [26, 22, 64] }, styles: { fontSize: 10, cellPadding: 6 },
    margin: { left: margin, right: margin },
  })
  autoTable(doc, {
    startY: lastY() + 18,
    head: [auto ? ['Place', 'Name', mixed ? 'MC score' : 'Score', 'Time taken', 'Status'] : ['Name', 'Time taken', 'Status']],
    body: ps.map(p => auto
      ? [String(p.place), p.name, `${p.correct}/${p.total}`, formatDuration(p.timeMs), statusLabel(p)]
      : [p.name, formatDuration(p.timeMs), statusLabel(p)]),
    theme: 'striped', headStyles: { fillColor: [0, 0, 121] }, styles: { fontSize: 9, cellPadding: 5 },
    columnStyles: auto ? { 0: { cellWidth: 40 }, 2: { cellWidth: 56 }, 3: { cellWidth: 80 }, 4: { cellWidth: 90 } } : {},
    margin: { left: margin, right: margin },
  })

  // Questions flow one after another (a page break only when needed)
  let y = lastY() + 28
  test.questions.forEach((q, i) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(0, 0, 121)
    const lines: string[] = doc.splitTextToSize(`Q${i + 1}. ${q.question.replace(/\s+/g, ' ')}`, pageW - margin * 2)
    if (y + lines.length * 14 + 120 > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 60 }
    doc.text(lines, margin, y)
    y += lines.length * 14 + 4
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9)

    if (isMcq(q)) {
      const answered = ps.filter(p => picks(p.answers[q.id]).length > 0)
      const right = answered.filter(p => sameAnswer(p.answers[q.id], q.correctAnswers)).length
      const pct = (x: number) => (answered.length ? Math.round((x / answered.length) * 100) : 0)
      doc.setTextColor(0, 130, 70)
      doc.text(`${pct(right)}% correct (${right} of ${answered.length})`, margin, y)
      autoTable(doc, {
        startY: y + 6,
        head: [['', 'Option', 'Picked by', '%']],
        body: q.options.map((o, k) => {
          const c = answered.filter(p => picks(p.answers[q.id]).includes(k)).length
          return [optionLabel(k, q.options.length), q.correctAnswers.includes(k) ? `${o}  (correct)` : o, String(c), `${pct(c)}%`]
        }),
        theme: 'striped', headStyles: { fillColor: [0, 0, 121] }, styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
        columnStyles: { 0: { cellWidth: 18 }, 2: { cellWidth: 56, halign: 'center' }, 3: { cellWidth: 40, halign: 'center' } },
        margin: { left: margin, right: margin },
      })
    } else {
      const answered = ps.filter(p => given(q, p.answers[q.id]))
      doc.setTextColor(110)
      doc.text(`${TEST_QTYPE_LABEL[qTypeOf(q)]} · ${isMarkable(q) ? marksLabel(q) : 'not marked'} · ${answered.length} of ${ps.length} answered`, margin, y)
      const summary = answersShow(q, ps)
      autoTable(doc, {
        startY: y + 6,
        head: [['Name', 'Answer']],
        body: [
          ...(summary ? [['Everyone', summary]] : []),
          ...answered.map(p => [p.name, answerText(q, p.answers[q.id])]),
        ],
        theme: 'striped', headStyles: { fillColor: [0, 0, 121] }, styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' },
        columnStyles: { 0: { cellWidth: 110 } },
        margin: { left: margin, right: margin },
      })
    }
    y = lastY() + 10
    const note = isMcq(q) ? (q.explanation ? `Explanation: ${q.explanation}` : '') : (q.guide ? `Marking guide: ${q.guide}` : '')
    if (note) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(90)
      const ex: string[] = doc.splitTextToSize(note, pageW - margin * 2)
      if (y + ex.length * 11 > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 60 }
      doc.text(ex, margin, y + 6)
      y += ex.length * 11 + 8
    }
    y += 18
  })
}
