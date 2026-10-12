import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'
import { ClipboardList, BarChart2, Lock, Unlock, ArrowLeft, Smartphone } from 'lucide-react'
import { cn, optionLabel } from '@/lib/utils'
import { subscribeToSession, subscribeToSlideResponses, setSurveyOpen } from '@/lib/session'
import {
  testTheme, qTypeOf, hasAnswer, surveyOpen, surveyPath, TEST_QTYPE_LABEL,
  type TestBlockShowSlide, type TestAnswerDoc, type SurveyState,
} from '@/lib/selfPacedTest'
import type { TestNav } from '@/components/TestBlockShow'

/* ─────────────────────────────────────────────────────────────────────────
   A survey on the big screen. It opens the first time the presenter reaches
   it and stays open until the host closes it — through the show and after
   it, at the survey link. The screen shows how to answer and a live count;
   "Show results" steps through each question's answers (→ / ←).
   ───────────────────────────────────────────────────────────────────────── */

function themeVars(id?: string): CSSProperties {
  const t = testTheme(id)
  return {
    '--bg': t.bg, '--fg': t.fg, '--accent': t.accent,
    '--good': t.good, '--good-ink': t.goodInk, '--good-text': t.goodText,
    '--danger': t.danger, '--danger-ink': t.dangerInk,
  } as CSSProperties
}

const fmtWhen = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

export function SurveyBlockView({ slide, code, onlySurvey, navRef, renderAnswers }: {
  slide:      TestBlockShowSlide
  code:       string
  /** The deck has just this one survey (keeps its link short). */
  onlySurvey: boolean
  navRef:     React.MutableRefObject<TestNav | null>
  /** Everyone's answers to a written / word cloud / rating / ranking question. */
  renderAnswers: (question: TestBlockShowSlide['questions'][number], sheets: TestAnswerDoc[]) => ReactNode
}) {
  const [state, setState] = useState<SurveyState | undefined>(undefined)
  const [loaded, setLoaded] = useState(false)
  const [docs, setDocs] = useState<TestAnswerDoc[]>([])
  /** -1 = the "how to answer" page; otherwise the question whose results are showing */
  const [shown, setShown] = useState(-1)
  const questions = slide.questions

  useEffect(() => subscribeToSession(code, s => { setState(s?.surveys?.[slide.id]); setLoaded(true) }), [code, slide.id])
  useEffect(() => subscribeToSlideResponses(code, slide.id, rs => {
    setDocs((rs as unknown as TestAnswerDoc[]).filter(d => d.type === 'testblock' && d.finished))
  }), [code, slide.id])

  // First time the show reaches it: open it
  useEffect(() => {
    if (loaded && !state) setSurveyOpen(code, slide.id, true).catch(console.error)
  }, [loaded, state, code, slide.id])

  navRef.current = {
    next: () => {
      if (shown >= 0 && shown + 1 < questions.length) { setShown(shown + 1); return true }
      return false
    },
    prev: () => {
      if (shown >= 0) { setShown(shown - 1); return true }
      return false
    },
  }

  const open = surveyOpen(state, slide)
  const link = `${window.location.origin}${surveyPath(code, slide.id, onlySurvey)}`
  const shortLink = link.replace(/^https?:\/\//, '')
  const count = docs.length

  let body: ReactNode
  if (shown >= 0 && questions[shown]) {
    const q = questions[shown]
    const answered = docs.filter(d => hasAnswer({ ...q, pick: 1 }, d.answers?.[q.id]))
    body = (
      <motion.div key={q.id} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35 }} className="flex h-full w-full flex-col px-14 pb-24 pt-10">
        <div className="flex items-start justify-between gap-8">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-(--accent)">Survey results · {shown + 1} of {questions.length} · {TEST_QTYPE_LABEL[qTypeOf(q)]}</p>
            <h2 className="mt-3 text-2xl font-semibold leading-snug text-(--fg)/95 xl:text-3xl">{q.question}</h2>
          </div>
          <div className="shrink-0 rounded-2xl border border-(--fg)/15 bg-(--fg)/5 px-6 py-4 text-center">
            <p className="text-5xl font-extrabold tabular-nums">{answered.length}</p>
            <p className="mt-1 text-xs uppercase tracking-wider text-(--fg)/55">answered</p>
          </div>
        </div>
        <div className="relative mt-6 flex min-h-0 flex-1 flex-col">
          {qTypeOf(q) === 'mcq' ? <ChoiceBars question={q} sheets={answered} /> : renderAnswers(q, answered)}
        </div>
        <button onClick={() => setShown(-1)} className="mt-4 flex items-center gap-1.5 self-start text-sm text-(--fg)/45 hover:text-(--fg)">
          <ArrowLeft className="size-4" /> Back to the survey page
        </button>
      </motion.div>
    )
  } else {
    body = (
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="flex h-full w-full items-center justify-center gap-16 px-14 pb-24 pt-10">
        <div className="min-w-0 max-w-2xl flex-1">
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-(--accent)">
            <ClipboardList className="size-4" /> Survey
          </p>
          <h1 className="mt-3 text-5xl font-extrabold leading-tight tracking-tight">{slide.title?.trim() || 'Survey'}</h1>
          <p className="mt-4 text-xl text-(--fg)/70">
            {questions.length} question{questions.length !== 1 ? 's' : ''} · {slide.askNames ? 'names are recorded' : 'anonymous'}
          </p>
          <div className="mt-8 flex items-center gap-3 text-xl text-(--fg)/85">
            <Smartphone className="size-6 shrink-0" />
            <span>Already joined? It’s on your phone now.</span>
          </div>
          <p className="mt-2 pl-9 text-lg text-(--fg)/60">Not joined, or want to answer later? Scan the code or go to</p>
          <p className="mt-1 pl-9 font-mono text-2xl font-bold tracking-tight">{shortLink}</p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <span className={cn('rounded-full px-4 py-1.5 text-sm font-bold', open ? 'bg-(--good) text-(--good-ink)' : 'bg-(--fg)/15 text-(--fg)/80')}>
              {open ? 'Open' : state ? 'Closed' : 'Opening…'}
            </span>
            <span className="text-sm text-(--fg)/55">
              {open ? (slide.closeAt ? `Closes ${fmtWhen(slide.closeAt)}` : 'Open until you close it — people can answer after the show') : state ? 'Not taking answers' : ''}
            </span>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              onClick={() => setShown(0)}
              disabled={questions.length === 0}
              className="flex items-center gap-2 rounded-xl bg-(--fg)/10 px-5 py-2.5 text-sm font-semibold transition hover:bg-(--fg)/18 disabled:opacity-40"
            >
              <BarChart2 className="size-4" /> Show results
            </button>
            {state && (
              <button
                onClick={() => setSurveyOpen(code, slide.id, !open).catch(console.error)}
                className={cn('flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition',
                  open ? 'border border-(--fg)/15 bg-(--fg)/5 hover:bg-(--fg)/12' : 'bg-(--good) text-(--good-ink) hover:brightness-105')}
              >
                {open ? <><Lock className="size-4" /> Close survey</> : <><Unlock className="size-4" /> Reopen survey</>}
              </button>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-center gap-6">
          <div className="rounded-3xl bg-white p-5 shadow-2xl">
            <QRCodeSVG value={link} size={230} bgColor="#ffffff" fgColor="#000079" level="M" />
          </div>
          <div className="text-center">
            <p className="text-7xl font-extrabold tabular-nums leading-none">{count}</p>
            <p className="mt-2 text-sm uppercase tracking-widest text-(--fg)/55">response{count !== 1 ? 's' : ''}</p>
          </div>
        </div>
      </motion.div>
    )
  }

  return (
    <div className="relative h-full w-full bg-(--bg) text-(--fg) transition-colors duration-500"
      style={themeVars(shown >= 0 ? (questions[shown]?.theme ?? slide.theme) : slide.theme)}>
      {body}
    </div>
  )
}

/** Multiple choice in a survey: how many picked each option (no right answer). */
function ChoiceBars({ question, sheets }: { question: TestBlockShowSlide['questions'][number]; sheets: TestAnswerDoc[] }) {
  const counts = useMemo(() => question.options.map((_, i) =>
    sheets.filter(d => Array.isArray(d.answers?.[question.id]) && (d.answers[question.id] as number[]).includes(i)).length), [question, sheets])
  const pct = (n: number) => (sheets.length ? Math.round((n / sheets.length) * 100) : 0)
  const top = Math.max(...counts, 0)
  return (
    <div className="flex flex-col gap-3 overflow-y-auto">
      {question.options.map((o, i) => (
        <div key={i} className="flex items-center gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-(--fg)/10 text-base font-bold text-(--fg)/70">{optionLabel(i, question.options.length)}</span>
          <div className="relative h-12 flex-1 overflow-hidden rounded-xl bg-(--fg)/5">
            <motion.div
              className={cn('absolute inset-y-0 left-0 rounded-xl', counts[i] === top && top > 0 ? 'bg-(--good)/40' : 'bg-(--fg)/12')}
              initial={{ width: 0 }} animate={{ width: `${pct(counts[i])}%` }} transition={{ duration: 0.7, delay: 0.1 + i * 0.05 }}
            />
            <span className="relative flex h-full items-center px-4 text-lg text-(--fg)/90">{o}</span>
          </div>
          <span className="w-28 shrink-0 text-right text-lg font-semibold tabular-nums text-(--fg)/80">{counts[i]} · {pct(counts[i])}%</span>
        </div>
      ))}
      {question.multi && <p className="mt-1 text-sm text-(--fg)/45">People could tick several — percentages are of everyone who answered.</p>}
    </div>
  )
}
