import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, ClipboardList, Lock, WifiOff, Loader2, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { finishTestSheet, writeTestSheetRest } from '@/lib/session'
import { OpenAnswer, ShortAnswers, RateItems, RankItems } from '@/components/TestRunner'
import {
  answerState, qTypeOf, surveyOpen, surveyMinutes,
  type StoredTestBlockSlide, type StoredTestQuestion, type SurveyState, type TestAnswer,
} from '@/lib/selfPacedTest'

/* ─────────────────────────────────────────────────────────────────────────
   A survey on someone's phone (or computer, through the survey link).
   Every question on one page, like a Google Form. Answers are kept on this
   device as they're typed and sent once, on Submit; each device answers
   once. An anonymous survey uses a random id made for this survey only, so
   nothing links the answers to the name the person joined with.
   ───────────────────────────────────────────────────────────────────────── */

type Draft = { id: string; name: string; answers: Record<string, TestAnswer>; submitted?: boolean }

const STUCK_MS = 8000
const withTimeout = <T,>(p: Promise<T>, ms: number) => new Promise<T>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('timeout')), ms)
  p.then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
})
const newId = () => 'sv' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6)

function readDraft(key: string): Draft {
  try {
    const d = JSON.parse(localStorage.getItem(key) || 'null') as Draft | null
    if (d && typeof d.id === 'string') return { id: d.id, name: d.name ?? '', answers: d.answers ?? {}, submitted: d.submitted }
  } catch { /* private mode — start fresh */ }
  return { id: newId(), name: '', answers: {} }
}

/** Nothing left that only looks like an answer (empty boxes, unrated rows). */
function cleanAnswers(qs: StoredTestQuestion[], answers: Record<string, TestAnswer>): Record<string, TestAnswer> {
  const out: Record<string, TestAnswer> = {}
  for (const q of qs) {
    const a = answers[q.id]
    if (answerState(q, a) === 'none') continue
    out[q.id] = qTypeOf(q) === 'wordcloud' ? (a as string[]).map(w => String(w).trim()).filter(Boolean) : qTypeOf(q) === 'openended' ? String(a).trim() : a
  }
  return out
}

export function SurveyRunner({ code, block, state, defaultName = '', onBack, standalone = false }: {
  code:         string
  block:        StoredTestBlockSlide
  state:        SurveyState | undefined
  /** The name they joined with — filled in when the survey asks for names. */
  defaultName?: string
  /** Back to the live session (shown when the survey was opened from it). */
  onBack?:      () => void
  /** Opened from the survey link, outside a live session. */
  standalone?:  boolean
}) {
  const key = `alaya-survey:${code.toUpperCase()}:${block.id}`
  const qs = block.questions
  const [draft, setDraft] = useState<Draft>(() => {
    const d = readDraft(key)
    return d.name || !defaultName ? d : { ...d, name: defaultName }
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [nameError, setNameError] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const cards = useRef<Record<string, HTMLDivElement | null>>({})
  const nameRef = useRef<HTMLInputElement>(null)

  const save = (d: Draft) => {
    setDraft(d)
    try { localStorage.setItem(key, JSON.stringify(d.submitted ? { id: d.id, name: '', answers: {}, submitted: true } : d)) } catch { /* storage full */ }
  }
  const setAnswer = (qid: string, a: TestAnswer) => {
    save({ ...draft, answers: { ...draft.answers, [qid]: a } })
    if (errors[qid]) setErrors(e => { const n = { ...e }; delete n[qid]; return n })
  }

  // A closing time passes while the page is open
  useEffect(() => {
    if (!block.closeAt) return
    const id = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(id)
  }, [block.closeAt])

  const open = surveyOpen(state, block, now)

  const problems = () => {
    const out: Record<string, string> = {}
    for (const q of qs) {
      const st = answerState(q, draft.answers[q.id])
      const t = qTypeOf(q)
      if (q.required !== false && st !== 'full') {
        out[q.id] = st === 'part'
          ? (t === 'rating' ? 'Rate every item' : t === 'ranking' ? 'Rank every item' : 'Finish this answer')
          : 'This question needs an answer'
      } else if (t === 'ranking' && st === 'part') {
        out[q.id] = 'Rank every item — or tap Start over to leave it blank'
      }
    }
    return out
  }

  const send = async () => {
    if (sending) return
    const found = problems()
    const noName = !!block.askNames && !draft.name.trim()
    setErrors(found)
    setNameError(noName)
    if (noName) { nameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); nameRef.current?.focus(); return }
    const first = qs.find(q => found[q.id])
    if (first) { cards.current[first.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return }
    if (!open) return
    setSending(true); setSendError(null)
    const fields = {
      respondentId: draft.id,
      respondentName: block.askNames ? draft.name.trim() : 'Anonymous',
      round: 0, current: 0, rev: 1,
      answers: cleanAnswers(qs, draft.answers),
    }
    try {
      try {
        await withTimeout(finishTestSheet(code, block.id, draft.id, fields), STUCK_MS)
      } catch (e1) {
        // The usual connection didn't confirm in time — try a plain web request
        console.warn('Survey: usual connection did not confirm —', e1)
        await writeTestSheetRest(code, block.id, draft.id, fields, true)
      }
      save({ ...draft, submitted: true })
    } catch (e2) {
      console.error('Survey: could not send —', e2)
      setSendError(navigator.onLine
        ? "Couldn't reach the server. Your answers are kept on this device — tap Try again."
        : "You're offline. Your answers are kept on this device — reconnect to Wi-Fi or mobile data, then tap Try again.")
    } finally {
      setSending(false)
    }
  }
  // Back online after a failed send: try again by itself
  useEffect(() => {
    const retry = () => { if (sendError) send() }
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendError, draft])

  const pick = (q: StoredTestQuestion, i: number) => {
    const cur = (Array.isArray(draft.answers[q.id]) ? draft.answers[q.id] : []) as number[]
    let next: number[]
    if (!q.multi) next = cur[0] === i ? [] : [i]
    else if (cur.includes(i)) next = cur.filter(x => x !== i)
    else if (q.maxPicks && cur.length >= q.maxPicks) {
      setNote(`You can tick up to ${q.maxPicks} — untick one first`)
      window.setTimeout(() => setNote(null), 2600)
      return
    } else next = [...cur, i]
    setAnswer(q.id, next)
  }

  const title = block.title?.trim() || 'Survey'
  const back = onBack && (
    <button onClick={onBack} className="mb-3 flex items-center gap-1.5 self-start text-sm font-medium text-midnight-sky-500 hover:text-midnight-sky-800">
      <ArrowLeft className="size-4" /> Back to the session
    </button>
  )

  /* ── Already sent ─────────────────────────────────────────────────── */
  if (draft.submitted) {
    return (
      <Centered>
        {back}
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }}
          className="mx-auto flex size-20 items-center justify-center rounded-full bg-hot-pink shadow-[0_0_40px_-4px] shadow-hot-pink/50">
          <Check className="size-10 text-white" strokeWidth={3} />
        </motion.div>
        <h2 className="mt-5 text-2xl font-bold text-midnight-sky-900">Thank you!</h2>
        <p className="mt-2 text-midnight-sky-500">Your answers to “{title}” have been sent.</p>
        {standalone && <p className="mt-6 text-xs text-midnight-sky-500">You can close this page.</p>}
        {onBack && (
          <button onClick={onBack} className="mx-auto mt-6 rounded-xl border border-midnight-sky-200 px-5 py-2.5 text-sm font-medium text-midnight-sky-700">
            Back to the session
          </button>
        )}
      </Centered>
    )
  }

  /* ── Not open (yet / any more) ────────────────────────────────────── */
  if (!open) {
    return (
      <Centered>
        {back}
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-midnight-sky-50">
          <Lock className="size-7 text-midnight-sky-500" />
        </div>
        <Badge className="mt-4" />
        <h2 className="mt-2 text-2xl font-bold text-midnight-sky-900">{title}</h2>
        <p className="mt-2 text-midnight-sky-500">
          {!state ? 'This survey isn’t open yet — it opens during the session.' : 'This survey is closed and isn’t taking answers any more.'}
        </p>
      </Centered>
    )
  }

  /* ── The form ─────────────────────────────────────────────────────── */
  const needed = qs.filter(q => q.required !== false).length
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3 pb-6">
      {back}
      <div className="rounded-2xl border-t-4 border-hot-pink bg-white px-5 py-4 shadow-[0_2px_16px_-4px_rgba(0,0,121,0.12)]">
        <Badge />
        <h1 className="mt-2 text-xl font-bold leading-snug text-midnight-sky-900">{title}</h1>
        <p className="mt-1 text-sm text-midnight-sky-500">
          {qs.length} question{qs.length !== 1 ? 's' : ''} · about {surveyMinutes(qs)} minute{surveyMinutes(qs) !== 1 ? 's' : ''}
        </p>
        <p className="mt-1 text-sm text-midnight-sky-500">
          {block.askNames ? 'Your name is recorded with your answers.' : 'Anonymous — your name isn’t recorded.'}
        </p>
        {needed > 0 && <p className="mt-2 text-xs text-midnight-sky-500"><span className="text-hot-pink">*</span> must be answered</p>}
      </div>

      {block.askNames && (
        <div className={cn('rounded-2xl border bg-white px-5 py-4', nameError ? 'border-hot-pink/60' : 'border-midnight-sky-100')}>
          <label htmlFor="survey-name" className="text-base font-semibold text-midnight-sky-900">Your name <span className="text-hot-pink">*</span></label>
          <input
            id="survey-name"
            ref={nameRef}
            value={draft.name}
            onChange={e => { save({ ...draft, name: e.target.value }); if (nameError) setNameError(false) }}
            placeholder="Ram Shrestha"
            className="mt-2 w-full rounded-xl border-2 border-midnight-sky-100 px-4 py-3 text-base text-midnight-sky-900 outline-none placeholder:text-midnight-sky-300 focus:border-sky-blue"
          />
          {nameError && <p className="mt-1.5 text-sm font-medium text-hot-pink">Enter your name</p>}
        </div>
      )}

      {qs.map((q, i) => {
        const t = qTypeOf(q)
        const a = draft.answers[q.id]
        const err = errors[q.id]
        const mine = (Array.isArray(a) ? a : []) as number[]
        return (
          <div
            key={q.id}
            ref={el => { cards.current[q.id] = el }}
            className={cn('rounded-2xl border bg-white px-5 py-4 transition-colors', err ? 'border-hot-pink/60 bg-hot-pink/[0.02]' : 'border-midnight-sky-100')}
          >
            {q.imgUrl && <img src={q.imgUrl} alt="" className="mb-3 max-h-48 w-full rounded-xl object-contain" />}
            <p className="text-base font-semibold leading-snug text-midnight-sky-900">
              {i + 1}. {q.question}
              {q.required !== false
                ? <span className="ml-1 text-hot-pink">*</span>
                : <span className="ml-1.5 text-xs font-normal text-midnight-sky-500">optional</span>}
            </p>

            {t === 'mcq' && (
              <>
                <p className="mt-1 text-xs font-medium text-sky-blue">
                  {!q.multi ? 'Choose one' : q.maxPicks ? `Tick up to ${q.maxPicks}` : 'Tick all that apply'}
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  {q.options.map((o, k) => {
                    const on = mine.includes(k)
                    return (
                      <button
                        key={k}
                        onClick={() => pick(q, k)}
                        className={cn('flex items-center gap-3 rounded-xl border-2 px-3.5 py-3 text-left transition active:scale-[0.99]',
                          on ? 'border-sky-blue bg-sky-blue/10' : 'border-midnight-sky-100 bg-white')}
                      >
                        <span className={cn('flex size-5 shrink-0 items-center justify-center border-2',
                          q.multi ? 'rounded-md' : 'rounded-full',
                          on ? 'border-sky-blue bg-sky-blue' : 'border-midnight-sky-300 bg-white')}>
                          {on && (q.multi ? <Check className="size-3.5 text-white" strokeWidth={3} /> : <span className="size-2 rounded-full bg-white" />)}
                        </span>
                        <span className="text-base text-midnight-sky-900">{o}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
            {t === 'openended' && <OpenAnswer compact q={q} value={typeof a === 'string' ? a : ''} onChange={v => setAnswer(q.id, v)} />}
            {t === 'wordcloud' && <ShortAnswers q={q} value={Array.isArray(a) ? a as string[] : []} onChange={v => setAnswer(q.id, v)} />}
            {t === 'rating' && <RateItems q={q} value={Array.isArray(a) ? a as number[] : []} onChange={v => setAnswer(q.id, v)} />}
            {t === 'ranking' && <RankItems q={q} value={Array.isArray(a) ? a as number[] : []} onChange={v => setAnswer(q.id, v)} />}

            {err && <p className="mt-2 text-sm font-medium text-hot-pink">{err}</p>}
          </div>
        )
      })}

      {Object.keys(errors).length > 0 && (
        <p className="text-center text-sm font-medium text-hot-pink">
          {Object.keys(errors).length === 1 ? '1 question still needs an answer' : `${Object.keys(errors).length} questions still need an answer`} — they’re marked in pink above.
        </p>
      )}
      {sendError && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-hot-pink/30 bg-hot-pink/[0.06] p-4">
          <WifiOff className="mt-0.5 size-4 shrink-0 text-hot-pink" />
          <p className="text-sm leading-snug text-midnight-sky-800">{sendError}</p>
        </div>
      )}
      <button
        onClick={send}
        disabled={sending}
        className="mt-1 flex items-center justify-center gap-2 rounded-2xl bg-hot-pink py-4 text-base font-semibold text-white shadow-[0_0_24px_-6px] shadow-hot-pink/50 disabled:opacity-70"
      >
        {sending ? <><Loader2 className="size-4 animate-spin" /> Sending…</> : sendError ? 'Try again' : 'Submit'}
      </button>
      <p className="text-center text-xs text-midnight-sky-500">Your answers are kept on this device until you submit.</p>

      <AnimatePresence>
        {note && (
          <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="fixed inset-x-4 bottom-24 z-40 rounded-xl bg-midnight-sky-900 px-4 py-3 text-center text-sm text-white shadow-xl">
            {note}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center py-10 text-center">
      {children}
    </motion.div>
  )
}

export function Badge({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full bg-hot-pink/10 px-3 py-1 text-xs font-bold text-hot-pink', className)}>
      <ClipboardList className="size-3.5" /> Survey
    </span>
  )
}
