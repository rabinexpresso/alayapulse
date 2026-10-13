import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ClipboardList, Printer, FileText, Table2, Sparkles, Check, ChevronLeft, ChevronRight, Lock, Unlock, Link2, ImageDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { writeResultsBook } from '@/lib/excelBook'
import { subscribeToSession, setSurveyOpen } from '@/lib/session'
import { qTypeOf, hasAnswer, surveyOpen, surveyPath, type StoredTestBlockSlide, type SurveyState } from '@/lib/selfPacedTest'
import type { TestResult, TestResultQuestion } from '@/lib/deckStorage'
import {
  summarize, surveyTypeLabel, summaryLine, pieSvg, chartCanvas, canvasPng, surveyPrintHtml, surveyDocx, surveyBookPart,
  surveyGeminiText, surveyAnswerText, downloadBlob, fmtDateTime, placeLabel, SURVEY_COLOURS, PIE_MAX, type QSummary,
} from '@/lib/surveyReport'
import { topChoiceText, RANKING_HOW_TO_READ } from '@/lib/ranking'

/* ─────────────────────────────────────────────────────────────────────────
   A survey's results on the Results page — like Google Forms' responses:
   Summary (a chart per question, written answers listed) and Individual
   (one person's whole form at a time). Print, Word, Excel and a
   copy-for-Gemini summary; the survey link and Close / Reopen.
   ───────────────────────────────────────────────────────────────────────── */

export function SurveyResultSection({ survey, deckTitle: deckName, sessionCode, conductedAt, sessionName }: {
  survey:      TestResult
  deckTitle:   string
  sessionCode: string
  conductedAt: number
  /** Who the session was with ("Sydney team"), when it was named. */
  sessionName?: string
}) {
  // The deck plus the session's name, on every report
  const deckTitle = sessionName ? `${deckName} · ${sessionName}` : deckName
  const [tab, setTab] = useState<'summary' | 'individual'>('summary')
  const [person, setPerson] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [live, setLive] = useState<{ state?: SurveyState; block?: StoredTestBlockSlide; only: boolean } | null>(null)
  const ps = survey.participants
  const n = ps.length
  const title = survey.title || 'Survey'
  const fileBase = `${title} - ${new Date(conductedAt).toISOString().slice(0, 10)}${sessionName ? ` - ${sessionName.replace(/[\\/:*?"<>|]+/g, '-')}` : ''}`

  // Open / closed, straight from the session — it can change after the show
  useEffect(() => subscribeToSession(sessionCode, s => {
    if (!s) { setLive(null); return }
    const surveys = s.slides.filter(x => x.type === 'testblock' && (x as StoredTestBlockSlide).kind === 'survey') as StoredTestBlockSlide[]
    setLive({ state: s.surveys?.[survey.blockId], block: surveys.find(x => x.id === survey.blockId), only: surveys.length <= 1 })
  }), [sessionCode, survey.blockId])
  useEffect(() => { if (person >= n) setPerson(Math.max(0, n - 1)) }, [n, person])

  const open = !!live?.block && surveyOpen(live.state, live.block)
  const link = `${window.location.origin}${surveyPath(sessionCode, survey.blockId, live?.only ?? true)}`
  const flash = (k: string) => { setCopied(k); window.setTimeout(() => setCopied(c => (c === k ? null : c)), 2200) }

  const print = () => {
    const w = window.open('', '_blank')
    if (!w) { alert('Allow pop-ups for this site to print the summary.'); return }
    w.document.write(surveyPrintHtml(survey, deckTitle, Date.now()))
    w.document.close()
    w.addEventListener('load', () => window.setTimeout(() => { w.focus(); w.print() }, 400))
  }
  const word = async () => {
    setBusy('word')
    try { downloadBlob(await surveyDocx(survey, deckTitle), `${fileBase} survey report.docx`) }
    catch (e) { console.error(e); alert('Could not make the Word report. Refresh the page and try again.') }
    finally { setBusy(null) }
  }
  const excel = async () => {
    setBusy('excel')
    try {
      const XLSX = await import('xlsx')
      writeResultsBook(XLSX, `${fileBase} survey.xlsx`, {
        title: `Alaya Pulse survey results — ${title}`,
        sub: `${deckTitle} · session ${sessionCode} · ${fmtDateTime(conductedAt)} · ${n} response${n !== 1 ? 's' : ''}`,
      }, [surveyBookPart(survey)], false, 'On the Results page, “Copy for Gemini” copies every answer with a ready-made prompt — paste it into Gemini for the main themes, what people liked and what to improve.')
    } catch (e) { console.error(e); alert('Could not make the Excel file. Refresh the page and try again.') }
    finally { setBusy(null) }
  }
  const gemini = () => {
    navigator.clipboard.writeText(surveyGeminiText(survey, deckTitle)).then(() => flash('gemini')).catch(() => alert('Your browser blocked copying — try again.'))
  }
  const copyLink = () => { navigator.clipboard.writeText(link).then(() => flash('link')).catch(() => {}) }

  return (
    <div className="overflow-hidden rounded-2xl border border-midnight-sky-100 bg-white shadow-[0_2px_16px_-4px_rgba(0,0,121,0.08)]">
      <div className="h-1 w-full bg-hot-pink" />
      <div className="px-6 py-5">
        {/* Title, counts and actions */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-hot-pink/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-hot-pink">
              <ClipboardList className="size-3" /> Survey
            </span>
            <h2 className="mt-2 text-2xl font-bold text-midnight-sky-900">{title}</h2>
            <p className="mt-1 text-sm text-midnight-sky-500">
              <span className="font-semibold text-midnight-sky-800">{n}</span> response{n !== 1 ? 's' : ''} · {survey.questions.length} questions · {survey.askNames ? 'names recorded' : 'anonymous'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ActionButton onClick={print} icon={<Printer className="size-3.5" />} label="Print summary" />
            <ActionButton onClick={word} icon={<FileText className="size-3.5" />} label={busy === 'word' ? 'Making…' : 'Word report'} />
            <ActionButton onClick={excel} icon={<Table2 className="size-3.5" />} label={busy === 'excel' ? 'Exporting…' : 'Excel'} />
            <button
              onClick={gemini}
              className={cn('flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition',
                copied === 'gemini' ? 'bg-fresh-green text-white' : 'bg-hot-pink text-white hover:brightness-105')}
            >
              {copied === 'gemini' ? <Check className="size-3.5" /> : <Sparkles className="size-3.5" />}
              {copied === 'gemini' ? 'Copied — paste into Gemini' : 'Copy for Gemini'}
            </button>
          </div>
        </div>

        {copied === 'gemini' && (
          <p className="mt-3 rounded-xl bg-sky-blue/8 px-4 py-2.5 text-xs leading-relaxed text-midnight-sky-700">
            The answers and a ready-made prompt are copied. Open <a href="https://gemini.google.com" target="_blank" rel="noreferrer" className="font-semibold text-sky-blue underline">Gemini</a>, paste, and you get the main themes, what people liked, what to improve and a few quotes. {survey.askNames ? 'Names are left out. ' : ''}Check what it says before you share it, and follow your company’s AI policy.
          </p>
        )}

        {/* Link + open / closed */}
        {live?.block && (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-midnight-sky-50 px-3.5 py-2.5 text-xs">
            <span className={cn('rounded-full px-2.5 py-0.5 font-bold', open ? 'bg-fresh-green/20 text-[#178a3a]' : 'bg-midnight-sky-200 text-midnight-sky-600')}>
              {open ? 'Open' : live.state ? 'Closed' : 'Not opened yet'}
            </span>
            <span className="min-w-0 truncate font-mono text-midnight-sky-600">{link.replace(/^https?:\/\//, '')}</span>
            <button onClick={copyLink} className="flex items-center gap-1 rounded-lg border border-midnight-sky-200 bg-white px-2 py-1 font-semibold text-midnight-sky-700 hover:border-midnight-sky-400">
              {copied === 'link' ? <Check className="size-3 text-fresh-green" /> : <Link2 className="size-3" />} {copied === 'link' ? 'Copied' : 'Copy link'}
            </button>
            <div className="flex-1" />
            <span className="text-midnight-sky-500">
              {open ? (live.block.closeAt ? `Closes ${fmtDateTime(live.block.closeAt)}` : 'People can still answer at this link') : live.state ? 'Not taking answers' : 'Opens when the show reaches it'}
            </span>
            <button
              onClick={() => setSurveyOpen(sessionCode, survey.blockId, !open).catch(e => { console.error(e); alert('Could not change it — check you’re signed in.') })}
              className={cn('flex items-center gap-1 rounded-lg px-2.5 py-1 font-semibold', open ? 'border border-midnight-sky-200 bg-white text-midnight-sky-700 hover:border-midnight-sky-400' : 'bg-hot-pink text-white')}
            >
              {open ? <><Lock className="size-3" /> Close survey</> : <><Unlock className="size-3" /> {live.state ? 'Reopen survey' : 'Open survey'}</>}
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="mt-5 flex gap-6 border-b border-midnight-sky-100 text-sm">
          {(['summary', 'individual'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn('-mb-px border-b-2 px-1 pb-2 font-medium capitalize transition', tab === t ? 'border-hot-pink text-midnight-sky-900' : 'border-transparent text-midnight-sky-500 hover:text-midnight-sky-700')}
            >
              {t}
            </button>
          ))}
        </div>

        {n === 0 ? (
          <p className="mt-6 rounded-xl bg-midnight-sky-50 px-4 py-8 text-center text-sm text-midnight-sky-500">
            No responses yet.{open ? ' Share the link above — answers show up here as they come in.' : ''}
          </p>
        ) : tab === 'summary' ? (
          <div className="mt-5 flex flex-col gap-4">
            {survey.questions.map((q, i) => <SummaryCard key={q.id} q={q} i={i} survey={survey} />)}
          </div>
        ) : (
          <Individual survey={survey} index={Math.min(person, n - 1)} onIndex={setPerson} />
        )}
      </div>
    </div>
  )
}

function ActionButton({ onClick, icon, label }: { onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 rounded-xl border border-midnight-sky-200 px-3.5 py-2 text-xs font-semibold text-midnight-sky-700 transition hover:border-midnight-sky-400 hover:text-midnight-sky-900">
      {icon}{label}
    </button>
  )
}

/* ── Summary ───────────────────────────────────────────────────────────── */

function SummaryCard({ q, i, survey }: { q: TestResultQuestion; i: number; survey: TestResult }) {
  const s = useMemo(() => summarize(q, survey.participants), [q, survey.participants])
  const [showAll, setShowAll] = useState(false)
  const [chartNote, setChartNote] = useState<string | null>(null)
  const n = survey.participants.length

  const copyChart = async () => {
    const canvas = chartCanvas(q, s)
    if (!canvas) return
    const blob = await canvasPng(canvas)
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setChartNote('Chart copied — paste it into your slides or email')
    } catch {
      downloadBlob(blob, `Q${i + 1} chart.png`)
      setChartNote('Chart saved as a picture')
    }
    window.setTimeout(() => setChartNote(null), 2600)
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-midnight-sky-100 px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold leading-snug text-midnight-sky-900">{i + 1}. {q.question}</p>
          <p className="mt-0.5 text-xs text-midnight-sky-500">{surveyTypeLabel(q)} · {s.answered} of {n} answered{q.required === false ? ' · optional' : ''}</p>
        </div>
        {s.kind !== 'text' && s.answered > 0 && (
          <button onClick={copyChart} title="Copy this chart as a picture" className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-midnight-sky-500 hover:bg-midnight-sky-50 hover:text-midnight-sky-800">
            <ImageDown className="size-3.5" /> Copy chart
          </button>
        )}
      </div>
      {chartNote && <p className="mt-1 text-[11px] font-medium text-[#178a3a]">{chartNote}</p>}
      <div className="mt-4">
        {s.answered === 0 ? <p className="text-sm text-midnight-sky-500">Nobody answered this question.</p> : <SummaryBody s={s} askNames={!!survey.askNames} showAll={showAll} />}
      </div>
      {s.kind === 'text' && s.texts.length > 8 && (
        <button onClick={() => setShowAll(v => !v)} className="mt-2 text-xs font-semibold text-sky-blue hover:underline">
          {showAll ? 'Show fewer' : `Show all ${s.texts.length} answers`}
        </button>
      )}
      {s.kind !== 'text' && s.kind !== 'ranking' && s.answered > 0 && <p className="mt-3 text-xs text-midnight-sky-500">{summaryLine(q, s)}</p>}
    </motion.div>
  )
}

function Bars({ rows }: { rows: { label: string; frac: number; value: string; colour?: string }[] }) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, k) => (
        <div key={k} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-3 text-sm">
          <span className="truncate text-midnight-sky-800" title={r.label}>{r.label}</span>
          <div className="h-3 overflow-hidden rounded-full bg-midnight-sky-100">
            <motion.div className="h-full rounded-full" style={{ backgroundColor: r.colour ?? '#00b0ff' }} initial={{ width: 0 }} animate={{ width: `${Math.round(r.frac * 100)}%` }} transition={{ duration: 0.6 }} />
          </div>
          <span className="whitespace-nowrap text-right text-xs font-semibold tabular-nums text-midnight-sky-600">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

function SummaryBody({ s, askNames, showAll }: { s: QSummary; askNames: boolean; showAll: boolean }) {
  if (s.kind === 'choice' && !s.multi && s.rows.length <= PIE_MAX) {
    return (
      <div className="flex flex-wrap items-center gap-8">
        <div className="shrink-0" dangerouslySetInnerHTML={{ __html: pieSvg(s.rows.map(r => r.count), 170) }} />
        <ul className="flex min-w-0 flex-col gap-1.5 text-sm">
          {s.rows.map((r, k) => (
            <li key={k} className={cn('flex items-center gap-2', r.count === 0 && 'text-midnight-sky-400')}>
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: SURVEY_COLOURS[k % SURVEY_COLOURS.length] }} />
              <span className={r.count ? 'text-midnight-sky-800' : ''}>{r.label}</span>
              <span className="ml-1 text-xs font-semibold tabular-nums text-midnight-sky-500">{r.count} · {r.pct}%</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  if (s.kind === 'choice') {
    return (
      <>
        <Bars rows={s.rows.map((r, k) => ({ label: r.label, frac: r.pct / 100, value: `${r.count} · ${r.pct}%`, colour: s.multi ? '#00b0ff' : SURVEY_COLOURS[k % SURVEY_COLOURS.length] }))} />
        {s.multi && <p className="mt-2 text-[11px] text-midnight-sky-500">People could tick several — % of everyone who answered.</p>}
      </>
    )
  }
  if (s.kind === 'rating') {
    return (
      <div className="flex flex-col gap-3">
        {s.rows.map((r, k) => (
          <div key={k}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-midnight-sky-800">{r.label}</span>
              <span className="font-bold tabular-nums text-hot-pink">{r.avg === null ? '–' : r.avg.toFixed(1)}<span className="text-xs font-semibold text-midnight-sky-500"> / {s.max}</span></span>
            </div>
            <div className="mt-1 flex h-8 items-end gap-1">
              {r.dist.map((c, v) => {
                const top = Math.max(...r.dist, 1)
                return (
                  <div key={v} className="flex flex-1 flex-col items-center gap-0.5" title={`${v}: ${c} ${c === 1 ? 'person' : 'people'}`}>
                    <div className="w-full rounded-t bg-hot-pink/70" style={{ height: `${Math.max(2, (c / top) * 22)}px`, opacity: c ? 1 : 0.15 }} />
                    <span className="text-[9px] tabular-nums text-midnight-sky-500">{v}</span>
                  </div>
                )
              })}
            </div>
            {(r.left || r.right) && <p className="mt-0.5 flex justify-between text-[10px] text-midnight-sky-500"><span>{r.left}</span><span>{r.right}</span></p>}
          </div>
        ))}
      </div>
    )
  }
  if (s.kind === 'ranking') {
    const top = Math.max(...s.rows.map(r => r.points), 1)
    return (
      <>
        <div className="flex flex-col gap-2.5">
          {s.rows.map((r, k) => (
            <div key={k} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate text-midnight-sky-800" title={r.label}>
                  <span className="font-semibold">{r.tied ? 'Joint ' : ''}{placeLabel(r.place - 1)}</span> · {r.label}
                </span>
                <span className="block truncate text-[11px] text-midnight-sky-500">{topChoiceText(r.firsts, s.voters)}</span>
              </span>
              <div className="h-3 overflow-hidden rounded-full bg-midnight-sky-100">
                <motion.div className="h-full rounded-full bg-sky-blue" initial={{ width: 0 }} animate={{ width: `${Math.round((r.points / top) * 100)}%` }} transition={{ duration: 0.6 }} />
              </div>
              <span className="whitespace-nowrap text-right leading-tight">
                <span className="block text-xs font-semibold tabular-nums text-midnight-sky-700">{r.avgPos ? r.avgPos.toFixed(1) : '–'}</span>
                <span className="block text-[10px] text-midnight-sky-500">average position</span>
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-midnight-sky-500">
          {s.voters < s.answered ? `${s.answered - s.voters} unfinished ranking${s.answered - s.voters !== 1 ? 's' : ''} not counted. ` : ''}{RANKING_HOW_TO_READ}
        </p>
      </>
    )
  }
  if (s.kind === 'words') {
    const top = s.rows[0]?.count ?? 1
    return (
      <div className="flex flex-wrap gap-2">
        {s.rows.slice(0, 40).map(r => (
          <span key={r.label} className="rounded-full bg-fresh-green/12 px-3 py-1 text-midnight-sky-800" style={{ fontSize: `${12 + Math.round((r.count / top) * 8)}px` }}>
            {r.label} <span className="text-xs font-semibold text-[#178a3a]">{r.count}</span>
          </span>
        ))}
      </div>
    )
  }
  const texts = showAll ? s.texts : s.texts.slice(0, 8)
  return (
    <ul className="flex flex-col gap-1.5">
      {texts.map((t, k) => (
        <li key={k} className="whitespace-pre-wrap rounded-lg bg-midnight-sky-50 px-3.5 py-2 text-sm leading-relaxed text-midnight-sky-800">
          {t.text}{askNames && <span className="ml-1.5 text-xs text-midnight-sky-500">— {t.name}</span>}
        </li>
      ))}
    </ul>
  )
}

/* ── Individual ────────────────────────────────────────────────────────── */

function Individual({ survey, index, onIndex }: { survey: TestResult; index: number; onIndex: (i: number) => void }) {
  const p = survey.participants[index]
  const n = survey.participants.length
  if (!p) return null
  return (
    <div className="mt-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-midnight-sky-500">
          {survey.askNames ? <span className="font-semibold text-midnight-sky-900">{p.name}</span> : <span className="font-semibold text-midnight-sky-900">Anonymous</span>}
          {p.submittedAt ? <> · sent {fmtDateTime(p.submittedAt)}</> : null}
        </p>
        <div className="flex items-center gap-1.5 text-sm text-midnight-sky-600">
          <button onClick={() => onIndex(Math.max(0, index - 1))} disabled={index === 0} aria-label="Previous response" className="rounded-lg p-1.5 hover:bg-midnight-sky-50 disabled:opacity-30"><ChevronLeft className="size-4" /></button>
          Response <span className="font-semibold text-midnight-sky-900">{index + 1}</span> of {n}
          <button onClick={() => onIndex(Math.min(n - 1, index + 1))} disabled={index >= n - 1} aria-label="Next response" className="rounded-lg p-1.5 hover:bg-midnight-sky-50 disabled:opacity-30"><ChevronRight className="size-4" /></button>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-3 rounded-xl border-t-4 border-hot-pink bg-midnight-sky-50/50 p-4">
        {survey.questions.map((q, i) => {
          const a = p.answers[q.id]
          const t = qTypeOf(q)
          const answered = hasAnswer({ ...q, pick: 1 }, a)
          return (
            <div key={q.id} className="rounded-xl bg-white px-4 py-3">
              <p className="text-sm font-semibold text-midnight-sky-900">{i + 1}. {q.question}</p>
              <div className="mt-2 text-sm">
                {!answered ? <span className="text-midnight-sky-400">— no answer</span>
                  : t === 'mcq' ? (
                    <div className="flex flex-col gap-1">
                      {q.options.map((o, k) => {
                        const on = (a as number[]).includes(k)
                        return (
                          <span key={k} className={cn('flex items-center gap-2', on ? 'font-medium text-midnight-sky-900' : 'text-midnight-sky-400')}>
                            <span className={cn('flex size-4 shrink-0 items-center justify-center border-2', q.multi ? 'rounded' : 'rounded-full', on ? 'border-sky-blue bg-sky-blue' : 'border-midnight-sky-200')}>
                              {on && (q.multi ? <Check className="size-2.5 text-white" strokeWidth={3} /> : <span className="size-1.5 rounded-full bg-white" />)}
                            </span>
                            {o}
                          </span>
                        )
                      })}
                    </div>
                  )
                  : t === 'openended' ? <p className="whitespace-pre-wrap leading-relaxed text-midnight-sky-800">{String(a)}</p>
                  : <p className="text-midnight-sky-800">{surveyAnswerText(q, a)}</p>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

