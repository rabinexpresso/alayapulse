import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Download, Clock, Users, BarChart2, Cloud as CloudIcon,
  TrendingUp, ChevronDown, ChevronUp, Star, AlertCircle, FileSpreadsheet,
} from 'lucide-react'
import { AlayaMark } from '@/components/AlayaMark'
import { cn } from '@/lib/utils'
import {
  loadResults, getStorageBackend, onAuthStateChanged, auth,
  browserListDecks, cloudListDecks,
  type Deck, type DeckResults, type ResultQuestion, type ResultResponse,
  type StorageBackend,
} from '@/lib/deckStorage'

/* ─────────────────────────────────────────────────────────────────────────
   Results page — saved-poll analysis for one deck.
   URL: /results/:deckId
   Loads from browser or cloud based on the storage backend preference.
   ───────────────────────────────────────────────────────────────────────── */

export default function Results() {
  const { deckId } = useParams<{ deckId: string }>()
  const navigate   = useNavigate()

  const backend = getStorageBackend()
  const [results, setResults]   = useState<DeckResults | null | undefined>(undefined)
  const [deck,    setDeck]      = useState<Deck | null>(null)
  const [isDownloading, setDownloading]      = useState(false)
  const [isDownloadingCsv, setDownloadingCsv] = useState(false)

  /* Wait for auth before loading cloud data — Firebase restores auth
     asynchronously on page load. */
  useEffect(() => {
    if (!deckId) { setResults(null); return }
    let cancelled = false
    async function load(activeBackend: StorageBackend) {
      try {
        const [r, decks] = await Promise.all([
          loadResults(activeBackend, deckId!),
          activeBackend === 'browser' ? browserListDecks() : cloudListDecks(),
        ])
        if (cancelled) return
        setResults(r)
        setDeck(decks.find(d => d.id === deckId) ?? null)
      } catch (e) {
        console.error('Failed to load results:', e)
        if (!cancelled) setResults(null)
      }
    }

    if (backend === 'cloud') {
      if (auth.currentUser) {
        load('cloud')
      } else {
        const unsub = onAuthStateChanged(auth, u => {
          if (u) { unsub(); load('cloud') }
        })
        const timer = setTimeout(() => { unsub(); if (!cancelled) load('cloud') }, 4000)
        return () => { cancelled = true; unsub(); clearTimeout(timer) }
      }
    } else {
      load(backend ?? 'browser')
    }
    return () => { cancelled = true }
  }, [deckId, backend])

  /* ── Loading state ───────────────────────────────────────────────── */
  if (results === undefined) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-white">
        <AlayaMark className="mb-8" />
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map(i => (
            <motion.span
              key={i}
              className="inline-block size-1.5 rounded-full bg-hot-pink"
              animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
              transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
            />
          ))}
        </div>
      </main>
    )
  }

  /* ── Empty state ─────────────────────────────────────────────────── */
  if (!results || results.questions.length === 0) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-white px-6 text-center">
        <AlayaMark className="mb-8" />
        <div className="mb-6 flex size-16 items-center justify-center rounded-2xl bg-midnight-sky-50">
          <BarChart2 className="size-7 text-midnight-sky-300" />
        </div>
        <h2 className="text-2xl font-semibold text-midnight-sky-900">No results yet</h2>
        <p className="mt-2 max-w-md text-sm font-light text-midnight-sky-500">
          {deck
            ? `"${deck.title}" hasn't been presented yet. Start a live session to collect responses, then come back here.`
            : 'This deck has no saved poll results. Run a session first to see audience responses here.'}
        </p>
        <button
          onClick={() => navigate(-1)}
          className="mt-8 rounded-xl border border-hot-pink/35 bg-hot-pink/8 px-5 py-2.5 text-sm font-medium text-hot-pink transition hover:border-hot-pink/60 hover:bg-hot-pink/15"
        >
          Go back
        </button>
      </main>
    )
  }

  /* ── Real results ────────────────────────────────────────────────── */
  const deckTitle    = deck?.title ?? 'Untitled session'
  const totalResponses = results.questions.reduce((s, q) => s + q.responseCount, 0)
  // Overall participation: average per-question participation across all questions
  const avgParticipation = results.audienceCount > 0
    ? Math.round(
        (results.questions.reduce(
          (s, q) => s + Math.min(100, (q.responseCount / Math.max(1, results.audienceCount)) * 100), 0
        ) / Math.max(1, results.questions.length))
      )
    : 0

  async function handleDownload() {
    if (!results || !deck) return
    setDownloading(true)
    try {
      // Lazy-load jsPDF only when needed — keeps initial bundle small
      const [{ jsPDF }, autoTableMod] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable'),
      ])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const autoTable: any = (autoTableMod as any).default ?? (autoTableMod as any).autoTable ?? autoTableMod
      const doc = new jsPDF({ unit: 'pt', format: 'a4' })
      buildResultsPdf(doc, autoTable, deck.title, results, totalResponses, avgParticipation)
      const safeTitle = deck.title.replace(/[^a-z0-9\-_ ]/gi, '').trim() || 'results'
      const date = new Date(results.conductedAt).toISOString().slice(0, 10)
      doc.save(`${safeTitle} - ${date} results.pdf`)
    } catch (e) {
      console.error('PDF generation failed:', e)
      alert('Could not generate PDF. Try again or take a screenshot of this page.')
    } finally {
      setDownloading(false)
    }
  }

  function handleDownloadCSV() {
    if (!results || !deck) return
    setDownloadingCsv(true)
    try {
      // Collapse newlines + extra whitespace to a single space so multi-paragraph
      // question text doesn't break Excel/Sheets CSV row parsing.
      const cleanCell = (s: string) => String(s).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
      const csvRow = (...cells: string[]) =>
        cells.map(c => `"${cleanCell(c).replace(/"/g, '""')}"`).join(',')

      const lines: string[] = []

      // ── Metadata header ──────────────────────────────────────────────
      lines.push(csvRow('Alaya Pulse Check — Results Export'))
      lines.push(csvRow('Deck', deck.title))
      lines.push(csvRow('Session code', results.sessionCode))
      lines.push(csvRow('Date', formatTimestamp(results.conductedAt)))
      lines.push(csvRow('Peak audience', String(results.audienceCount)))
      lines.push(csvRow('Total responses', String(totalResponses)))
      lines.push(csvRow('Avg participation', `${avgParticipation}%`))
      lines.push('') // blank separator

      // ── Column headers ───────────────────────────────────────────────
      lines.push(csvRow('Question #', 'Question', 'Type', 'Respondent', 'Response', 'Time'))

      // ── One row per individual response ─────────────────────────────
      results.questions.forEach((q, qIdx) => {
        const typeLabel = TYPE_LABELS[q.type] ?? q.type
        if (q.responses.length === 0) {
          lines.push(csvRow(
            String(qIdx + 1),
            q.question || '(Untitled question)',
            typeLabel,
            '—', '(no responses)', '',
          ))
        } else {
          q.responses.forEach(r => {
            lines.push(csvRow(
              String(qIdx + 1),
              q.question || '(Untitled question)',
              typeLabel,
              r.name,
              formatResponseAsText(r, q),
              formatTime(r.time),
            ))
          })
        }
      })

      const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      const safeTitle = deck.title.replace(/[^a-z0-9\-_ ]/gi, '').trim() || 'results'
      const date = new Date(results.conductedAt).toISOString().slice(0, 10)
      a.href     = url
      a.download = `${safeTitle} - ${date} results.csv`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      console.error('CSV generation failed:', e)
      alert('Could not generate CSV. Try again.')
    } finally {
      setDownloadingCsv(false)
    }
  }

  return (
    <main className="min-h-screen bg-midnight-sky-50/40">
      {/* Top bar — dark navy brand header */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-midnight-sky-900/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-3">
          <button
            onClick={() => navigate(-1)}
            className="rounded-lg bg-fresh-green px-3 py-1.5 text-sm font-medium text-white transition hover:bg-fresh-green/85"
          >
            Back
          </button>
          <div className="h-5 w-px bg-white/15" />
          <AlayaMark className="text-white" />
          <div className="flex-1" />
          <button
            onClick={handleDownloadCSV}
            disabled={isDownloadingCsv}
            className="flex items-center gap-1.5 rounded-xl bg-sky-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-blue/85 disabled:opacity-70"
          >
            <FileSpreadsheet className="size-3.5" />
            {isDownloadingCsv ? 'Exporting…' : 'Download CSV'}
          </button>
          <button
            onClick={handleDownload}
            disabled={isDownloading}
            className="flex items-center gap-1.5 rounded-xl bg-hot-pink px-4 py-2 text-sm font-semibold text-white shadow-[0_0_20px_-4px] shadow-hot-pink/40 transition hover:shadow-[0_0_28px_-2px] hover:shadow-hot-pink/60 disabled:opacity-70"
          >
            <Download className="size-3.5" />
            {isDownloading ? 'Generating…' : 'Download PDF'}
          </button>
        </div>
      </header>

      {/* Headline section */}
      <section className="mx-auto max-w-6xl px-6 pb-8 pt-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-hot-pink">
            <span className="flex size-2 animate-pulse rounded-full bg-hot-pink" />
            Live poll results
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-midnight-sky-900 sm:text-5xl">
            {deckTitle}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-midnight-sky-500">
            <span className="flex items-center gap-1.5">
              <Clock className="size-3.5" />
              {formatTimestamp(results.conductedAt)}
            </span>
            <span className="flex items-center gap-1.5">
              <CloudIcon className="size-3.5" />
              Session <span className="font-mono font-semibold text-midnight-sky-700">{results.sessionCode}</span>
            </span>
          </div>
        </motion.div>

        {/* Stat cards */}
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            icon={<Users className="size-4" />}
            label="Peak audience"
            value={String(results.audienceCount)}
            tint="sky"
          />
          <StatCard
            icon={<BarChart2 className="size-4" />}
            label="Total responses"
            value={String(totalResponses)}
            tint="green"
          />
          <StatCard
            icon={<TrendingUp className="size-4" />}
            label="Avg participation"
            value={`${avgParticipation}%`}
            tint="pink"
            sub="responses ÷ audience"
          />
        </div>

        {/* Trim warning */}
        {results.trimmed && results.trimNote && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div>
              <p className="font-semibold text-amber-900">Some data was trimmed</p>
              <p className="mt-0.5 text-xs leading-snug text-amber-800">{results.trimNote}</p>
            </div>
          </motion.div>
        )}
      </section>

      {/* Per-question results */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="space-y-4">
          {results.questions.map((q, idx) => (
            <QuestionResult
              key={q.slideId}
              index={idx}
              question={q}
              audienceCount={results.audienceCount}
            />
          ))}
        </div>
      </section>
    </main>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Stat card — small KPI tile
   ───────────────────────────────────────────────────────────────────────── */

function StatCard({
  icon, label, value, sub, tint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
  tint: 'pink' | 'sky' | 'green'
}) {
  const tintBg = {
    pink:  'bg-hot-pink/10 text-hot-pink',
    sky:   'bg-sky-blue/10 text-sky-blue',
    green: 'bg-fresh-green/10 text-fresh-green',
  }[tint]

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-2xl border border-midnight-sky-100 bg-white p-5 shadow-[0_2px_12px_-4px_rgba(0,0,121,0.06)]"
    >
      <div className="flex items-center gap-2">
        <span className={cn('flex size-7 items-center justify-center rounded-lg', tintBg)}>
          {icon}
        </span>
        <span className="text-xs font-medium uppercase tracking-wider text-midnight-sky-500">{label}</span>
      </div>
      <p className="mt-3 text-3xl font-bold tabular-nums text-midnight-sky-900">{value}</p>
      {sub && <p className="mt-1 text-[11px] font-light text-midnight-sky-400">{sub}</p>}
    </motion.div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Per-question result block
   ───────────────────────────────────────────────────────────────────────── */

const TYPE_LABELS: Record<string, string> = {
  mcq:       'Multiple Choice',
  wordcloud: 'Word Cloud',
  openended: 'Open-ended',
  rating:    'Rating',
}
const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  mcq:       { bg: 'bg-sky-blue/10',    text: 'text-sky-blue'    },
  wordcloud: { bg: 'bg-fresh-green/10', text: 'text-fresh-green' },
  openended: { bg: 'bg-golden-sun/10',  text: 'text-golden-sun'  },
  rating:    { bg: 'bg-hot-pink/10',    text: 'text-hot-pink'    },
}

function QuestionResult({ index, question, audienceCount }: {
  index: number
  question: ResultQuestion
  audienceCount: number
}) {
  const [expanded, setExpanded] = useState(false)
  const meta = TYPE_COLORS[question.type] ?? TYPE_COLORS.mcq
  const participation = audienceCount > 0
    ? Math.min(100, Math.round((question.responseCount / audienceCount) * 100))
    : 0
  // For visualization we only need responses
  const responses = question.responses

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
      className="overflow-hidden rounded-2xl border border-midnight-sky-100 bg-white shadow-[0_2px_12px_-4px_rgba(0,0,121,0.06)]"
    >
      {/* Question header */}
      <div className="border-b border-midnight-sky-100 px-6 py-5">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-midnight-sky-400">
            Q{index + 1}
          </span>
          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider', meta.bg, meta.text)}>
            {TYPE_LABELS[question.type] ?? question.type}
          </span>
        </div>
        <h3 className="text-xl font-semibold text-midnight-sky-900">{question.question || '(Untitled question)'}</h3>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-midnight-sky-500">
          <span className="flex items-center gap-1.5">
            <BarChart2 className="size-3" />
            <span className="font-semibold text-midnight-sky-700">{question.responseCount}</span>
            <span>responses</span>
          </span>
          <span className="flex items-center gap-1.5">
            <TrendingUp className="size-3" />
            <span className="font-semibold text-midnight-sky-700">{participation}%</span>
            <span>participation</span>
          </span>
        </div>
      </div>

      {/* Visualization */}
      <div className="px-6 py-5">
        {question.type === 'mcq'       && <MCQVisual q={question} />}
        {question.type === 'wordcloud' && <WordCloudVisual q={question} />}
        {question.type === 'openended' && <OpenEndedVisual q={question} />}
        {question.type === 'rating'    && <RatingVisual q={question} />}
      </div>

      {/* Expandable per-respondent list */}
      {responses.length > 0 && (
        <div className="border-t border-midnight-sky-100">
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex w-full items-center justify-between px-6 py-3 text-sm font-medium text-midnight-sky-600 transition hover:bg-midnight-sky-50"
          >
            <span>
              {expanded ? 'Hide' : 'Show'} {responses.length} {responses.length === 1 ? 'response' : 'responses'}
            </span>
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <RespondentList q={question} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Visualizations
   ───────────────────────────────────────────────────────────────────────── */

function MCQVisual({ q }: { q: ResultQuestion }) {
  // Tally votes per option — handles multi-select JSON arrays "[0,2]" and legacy "2"
  const votes = Array(q.options.length).fill(0)
  q.responses.forEach(r => {
    let indices: number[]
    try { const p = JSON.parse(r.value); indices = Array.isArray(p) ? p as number[] : [parseInt(r.value, 10)] }
    catch { indices = [parseInt(r.value, 10)] }
    indices.forEach(i => { if (!isNaN(i) && i >= 0 && i < q.options.length) votes[i]++ })
  })
  const total = votes.reduce((s, v) => s + v, 0) || q.responseCount
  const maxV  = Math.max(...votes, 1)

  return (
    <div className="space-y-3">
      {q.options.map((opt, i) => {
        const v   = votes[i]
        const pct = total > 0 ? Math.round((v / total) * 100) : 0
        const isWinner = v > 0 && v === maxV
        return (
          <div key={i} className="flex items-center gap-3">
            <span className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold',
              isWinner ? 'bg-hot-pink text-white' : 'bg-midnight-sky-100 text-midnight-sky-600',
            )}>
              {String.fromCharCode(65 + i)}
            </span>
            <span className={cn(
              'w-32 shrink-0 truncate text-sm font-medium sm:w-48',
              isWinner ? 'text-midnight-sky-900' : 'text-midnight-sky-700',
            )}>
              {opt || `Option ${String.fromCharCode(65 + i)}`}
            </span>
            <div className="relative h-7 min-w-0 flex-1 overflow-hidden rounded-lg bg-midnight-sky-100">
              <motion.div
                className={cn('absolute inset-y-0 left-0 rounded-lg', isWinner ? 'bg-hot-pink' : 'bg-midnight-sky-300')}
                initial={{ width: '0%' }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
            <span className={cn('w-12 shrink-0 text-right text-base font-bold tabular-nums', isWinner ? 'text-hot-pink' : 'text-midnight-sky-500')}>
              {pct}%
            </span>
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-midnight-sky-400">
              ({v})
            </span>
          </div>
        )
      })}
    </div>
  )
}

function WordCloudVisual({ q }: { q: ResultQuestion }) {
  // Frequency tally
  const freq = new Map<string, number>()
  q.responses.forEach(r => {
    const w = r.value.trim().toLowerCase()
    if (w) freq.set(w, (freq.get(w) ?? 0) + 1)
  })
  const sorted = Array.from(freq.entries()).map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count)
  if (sorted.length === 0) {
    return <p className="text-sm font-light text-midnight-sky-400">No responses yet.</p>
  }
  const top = sorted[0].text

  function sizeClass(count: number) {
    if (count >= 17) return 'text-4xl font-bold'
    if (count >= 13) return 'text-3xl font-bold'
    if (count >= 10) return 'text-2xl font-semibold'
    if (count >= 7)  return 'text-xl font-semibold'
    if (count >= 5)  return 'text-lg font-medium'
    return                  'text-base font-medium'
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3 py-4">
      {sorted.map(w => (
        <span
          key={w.text}
          className={cn(
            sizeClass(w.count),
            w.text === top ? 'text-hot-pink' : 'text-midnight-sky-700',
          )}
          title={`${w.count} response${w.count === 1 ? '' : 's'}`}
        >
          {w.text}
        </span>
      ))}
    </div>
  )
}

function OpenEndedVisual({ q }: { q: ResultQuestion }) {
  if (q.responses.length === 0) {
    return <p className="text-sm font-light text-midnight-sky-400">No responses yet.</p>
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {q.responses.slice(0, 6).map((r, i) => (
        <div key={i} className="rounded-xl border border-midnight-sky-100 bg-midnight-sky-50/30 p-4">
          <p className="text-sm font-light leading-relaxed text-midnight-sky-700">"{r.value}"</p>
          <p className="mt-2 text-[11px] font-medium text-midnight-sky-400">— {r.name}</p>
        </div>
      ))}
      {q.responses.length > 6 && (
        <p className="col-span-full text-center text-xs font-light text-midnight-sky-400">
          + {q.responses.length - 6} more — expand below to see all
        </p>
      )}
    </div>
  )
}

// Rank badge styles for the Results page (light theme)
// All ranks use the same gold style
function rankOrdinal(rank: number): string {
  const n = rank + 1
  return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`
}
const RESULTS_RANK_BADGE_STYLE = { bg: 'bg-golden-sun/15', text: 'text-amber-700', border: 'border-amber-400/40' }

function RatingVisual({ q }: { q: ResultQuestion }) {
  const ratingMax = q.ratingMax === 10 ? 10 : 5
  const buckets   = ratingMax + 1
  const sums  = Array(q.options.length).fill(0)
  const cnts  = Array(q.options.length).fill(0)
  const dist  = Array.from({ length: q.options.length }, () => Array(buckets).fill(0))
  q.responses.forEach(r => {
    try {
      const arr = JSON.parse(r.value) as number[]
      arr.forEach((v, i) => {
        if (i < q.options.length && typeof v === 'number' && v >= 0 && v <= ratingMax) {
          sums[i] += v
          cnts[i]++
          dist[i][v]++
        }
      })
    } catch { /* skip */ }
  })
  const avgs = sums.map((s, i) => cnts[i] > 0 ? s / cnts[i] : 0)

  // Sort parameters by average score descending
  const order = q.options.map((_, i) => i).sort((a, b) => avgs[b] - avgs[a])

  function bucketColor(bucketIdx: number, total: number): string {
    if (total <= 1) return '#ff0065'
    const t = bucketIdx / (total - 1)
    if (t === 1)   return '#ff0065'
    if (t >= 0.75) return 'rgba(255,0,101,0.55)'
    if (t >= 0.5)  return 'rgba(255,199,9,0.65)'
    if (t >= 0.25) return 'rgba(255,199,9,0.38)'
    return 'rgba(0,0,121,0.22)'
  }

  const lefts  = q.leftLabels  ?? q.options.map(() => q.leftLabel  ?? '')
  const rights = q.rightLabels ?? q.options.map(() => q.rightLabel ?? '')

  return (
    <div className="space-y-3">
      {order.map((i, rank) => {
        const label     = q.options[i]
        const avg       = avgs[i]
        const pct       = (avg / ratingMax) * 100
        const paramDist = dist[i]
        const maxBucket = Math.max(...paramDist, 1)
        const left      = lefts[i]  ?? ''
        const right     = rights[i] ?? ''
        const badge     = { ...RESULTS_RANK_BADGE_STYLE, label: rankOrdinal(rank) }
        return (
          <div key={i} className={cn(
            'rounded-xl border p-4',
            rank === 0 ? 'border-amber-200 bg-amber-50/60' : 'border-midnight-sky-100 bg-midnight-sky-50/40',
          )}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                {badge && (
                  <span className={cn(
                    'shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                    badge.bg, badge.text, badge.border,
                  )}>
                    {badge.label}
                  </span>
                )}
                <span className="min-w-0 truncate text-sm font-semibold text-midnight-sky-800">{label || `Parameter ${i + 1}`}</span>
              </div>
              <div className="flex items-baseline gap-0.5">
                <span className="text-2xl font-extrabold tabular-nums text-hot-pink">{avg.toFixed(1)}</span>
                <span className="text-base font-semibold text-midnight-sky-500">/{ratingMax}</span>
              </div>
            </div>

            {/* Average progress bar */}
            <div className="relative h-2 overflow-hidden rounded-full bg-midnight-sky-100">
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full bg-hot-pink"
                initial={{ width: '0%' }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>

            {/* Per-bucket distribution — how many people chose each score */}
            <div className="mt-3 flex items-end gap-1" style={{ height: 56 }}>
              {paramDist.map((count, b) => {
                const barH = count > 0 ? Math.max((count / maxBucket) * 32, 3) : 0
                return (
                  <div key={b} className="flex flex-1 flex-col items-center gap-0.5">
                    <span className={cn(
                      'text-[10px] font-bold tabular-nums',
                      count > 0 ? 'text-midnight-sky-700' : 'text-transparent',
                    )}>
                      {count > 0 ? `${count}×` : ''}
                    </span>
                    <div className="flex w-full items-end" style={{ height: 32 }}>
                      <motion.div
                        className="w-full rounded-t-sm"
                        style={{ backgroundColor: bucketColor(b, buckets) }}
                        initial={{ height: 0 }}
                        animate={{ height: barH }}
                        transition={{ duration: 0.6, delay: b * 0.03 }}
                      />
                    </div>
                    <span className={cn(
                      'text-[9px] font-medium tabular-nums',
                      count > 0 ? 'text-midnight-sky-600' : 'text-midnight-sky-300',
                    )}>{b}</span>
                  </div>
                )
              })}
            </div>

            {/* Scale end labels (left/right anchor text) or default score labels */}
            <div className="mt-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-midnight-sky-400">
              <span className="truncate pr-2">{left || '0 (low)'}</span>
              <span className="truncate pl-2 text-right">{right || `${ratingMax} (high)`}</span>
            </div>

            <p className="mt-2 text-[11px] font-light text-midnight-sky-400">
              Based on {cnts[i]} {cnts[i] === 1 ? 'response' : 'responses'} · numbers above bars = votes at that score
            </p>
          </div>
        )
      })}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Per-respondent list — shown inside the expandable section per question
   ───────────────────────────────────────────────────────────────────────── */

function RespondentList({ q }: { q: ResultQuestion }) {
  return (
    <div className="max-h-96 overflow-y-auto bg-midnight-sky-50/30 px-6 py-3">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-midnight-sky-50/95 backdrop-blur-sm">
          <tr className="text-[10px] font-semibold uppercase tracking-wider text-midnight-sky-400">
            <th className="py-2 text-left">Name</th>
            <th className="py-2 text-left">Response</th>
            <th className="py-2 text-right">Time</th>
          </tr>
        </thead>
        <tbody>
          {q.responses.map((r, i) => (
            <tr key={i} className="border-t border-midnight-sky-100/60">
              <td className="py-2 pr-3 align-top">
                <span className={cn('font-medium', r.name === 'Anonymous' ? 'text-midnight-sky-400 italic' : 'text-midnight-sky-700')}>
                  {r.name}
                </span>
              </td>
              <td className="py-2 pr-3 align-top text-midnight-sky-700">
                {formatResponseValue(r, q)}
              </td>
              <td className="py-2 text-right align-top text-xs tabular-nums text-midnight-sky-400">
                {formatTime(r.time)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function formatResponseValue(r: ResultResponse, q: ResultQuestion): React.ReactNode {
  if (q.type === 'mcq') {
    // Multi-select: "[0,2]" → multiple chips; legacy single: "2" → one chip
    let indices: number[]
    try { const p = JSON.parse(r.value); indices = Array.isArray(p) ? p as number[] : [parseInt(r.value, 10)] }
    catch { indices = [parseInt(r.value, 10)] }
    return (
      <span className="inline-flex flex-wrap gap-1.5">
        {indices.map(idx => (
          <span key={idx} className="inline-flex items-center gap-1">
            <span className="flex size-5 items-center justify-center rounded-md bg-hot-pink/10 text-[10px] font-bold text-hot-pink">
              {String.fromCharCode(65 + idx)}
            </span>
            {q.options[idx] || `Option ${String.fromCharCode(65 + idx)}`}
          </span>
        ))}
      </span>
    )
  }
  if (q.type === 'rating') {
    const ratingMax = q.ratingMax === 10 ? 10 : 5
    try {
      const arr = JSON.parse(r.value) as number[]
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {arr.map((v, i) => (
            <span key={i} className="inline-flex items-baseline gap-1 text-xs">
              <span className="text-midnight-sky-500">{q.options[i] || `P${i + 1}`}:</span>
              <span className="font-bold text-hot-pink">{v}</span>
              <span className="text-midnight-sky-400">/{ratingMax}</span>
              <Star className="size-3 fill-hot-pink/40 text-hot-pink/60" />
            </span>
          ))}
        </div>
      )
    } catch {
      return <span className="text-midnight-sky-400 italic">invalid</span>
    }
  }
  // wordcloud / openended
  return <span className="break-words">{r.value}</span>
}

/* ─────────────────────────────────────────────────────────────────────────
   Date helpers
   ───────────────────────────────────────────────────────────────────────── */

function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/* ─────────────────────────────────────────────────────────────────────────
   PDF generation
   ───────────────────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildResultsPdf(doc: any, autoTable: any, deckTitle: string, r: DeckResults, totalResponses: number, avgParticipation: number) {
  const pageW = doc.internal.pageSize.getWidth()
  const margin = 40

  // Cover
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text(deckTitle, margin, 70)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(120)
  doc.text(`Live poll results — session ${r.sessionCode}`, margin, 92)
  doc.text(formatTimestamp(r.conductedAt), margin, 108)

  // Summary stats
  doc.setFontSize(10)
  doc.setTextColor(60)
  const summary = [
    ['Peak audience',    String(r.audienceCount)],
    ['Total responses',  String(totalResponses)],
    ['Avg participation', `${avgParticipation}%`],
  ]
  autoTable(doc, {
    startY: 130,
    head:   [['Metric', 'Value']],
    body:   summary,
    theme:  'grid',
    headStyles: { fillColor: [0, 0, 121], textColor: 255, fontStyle: 'bold' },
    styles: { fontSize: 10, cellPadding: 6 },
    margin: { left: margin, right: margin },
  })
  if (r.trimmed && r.trimNote) {
    let y = (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 200
    y += 12
    doc.setFont('helvetica', 'italic')
    doc.setTextColor(150, 100, 0)
    doc.setFontSize(9)
    doc.text('Note: ' + r.trimNote, margin, y, { maxWidth: pageW - margin * 2 })
  }

  // Per-question sections
  r.questions.forEach((q, idx) => {
    doc.addPage()
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(0, 0, 121)

    // Full question text — strip internal newlines so it wraps cleanly.
    // Adaptive font: 13pt for short questions, steps down to 9pt for very long ones
    // so the full text always fits without truncation.
    const cleanQuestion = (q.question || '(Untitled question)').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
    const titlePrefix   = `Q${idx + 1}. `

    let titleFontSize = 13
    doc.setFontSize(13)
    let titleLines: string[] = doc.splitTextToSize(titlePrefix + cleanQuestion, pageW - margin * 2)
    if (titleLines.length > 5) { titleFontSize = 11; doc.setFontSize(11); titleLines = doc.splitTextToSize(titlePrefix + cleanQuestion, pageW - margin * 2) }
    if (titleLines.length > 9) { titleFontSize = 9;  doc.setFontSize(9);  titleLines = doc.splitTextToSize(titlePrefix + cleanQuestion, pageW - margin * 2) }
    void titleFontSize   // used for font selection above

    doc.text(titleLines, margin, 60)

    // Position subtitle BELOW the last wrapped title line — no more overlap
    const lineH    = doc.getFontSize() >= 12 ? 17 : doc.getFontSize() >= 10 ? 14 : 12
    const subtitleY = 60 + titleLines.length * lineH + 8

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(120)
    doc.text(
      `${TYPE_LABELS[q.type] ?? q.type}   ·   ${q.responseCount} responses`,
      margin, subtitleY,
    )
    let cursorY = subtitleY + 22

    if (q.type === 'mcq') {
      const votes = Array(q.options.length).fill(0)
      q.responses.forEach(r => {
        let indices: number[]
        try { const p = JSON.parse(r.value); indices = Array.isArray(p) ? p as number[] : [parseInt(r.value, 10)] }
        catch { indices = [parseInt(r.value, 10)] }
        indices.forEach(i => { if (!isNaN(i) && i >= 0 && i < q.options.length) votes[i]++ })
      })
      const total = votes.reduce((s, v) => s + v, 0) || q.responseCount
      // Normalise option text — strip newlines so long options wrap cleanly in the table cell
      const body = q.options.map((opt, i) => {
        const pct = total > 0 ? Math.round((votes[i] / total) * 100) : 0
        const cleanOpt = (opt || '-').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
        return [String.fromCharCode(65 + i), cleanOpt, String(votes[i]), `${pct}%`]
      })
      autoTable(doc, {
        startY: cursorY,
        head:   [['', 'Option', 'Votes', '%']],
        body,
        theme:  'striped',
        headStyles:   { fillColor: [0, 0, 121] },
        styles:       { fontSize: 10, cellPadding: 6, overflow: 'linebreak' },
        // Col 0 = letter (A/B…), Col 2 = Votes (needs ≥44pt so header doesn't wrap), Col 3 = %
        columnStyles: { 0: { cellWidth: 18 }, 2: { cellWidth: 44, halign: 'center' }, 3: { cellWidth: 36, halign: 'center' } },
        margin: { left: margin, right: margin },
      })
      cursorY = (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY + 50
    } else if (q.type === 'rating') {
      const ratingMax = q.ratingMax === 10 ? 10 : 5
      const sums = Array(q.options.length).fill(0)
      const cnts = Array(q.options.length).fill(0)
      q.responses.forEach(r => {
        try {
          const arr = JSON.parse(r.value) as number[]
          arr.forEach((v, i) => {
            if (i < q.options.length && typeof v === 'number' && v >= 0 && v <= ratingMax) {
              sums[i] += v; cnts[i]++
            }
          })
        } catch { /* skip */ }
      })
      const body = q.options.map((opt, i) => [
        opt || `Parameter ${i + 1}`,
        cnts[i] > 0 ? (sums[i] / cnts[i]).toFixed(1) : '-',
        `/${ratingMax}`,
        String(cnts[i]),
      ])
      autoTable(doc, {
        startY: cursorY,
        head:   [['Parameter', 'Average', 'Scale', 'Ratings']],
        body,
        theme:  'striped',
        headStyles: { fillColor: [0, 0, 121] },
        styles: { fontSize: 10, cellPadding: 6 },
        margin: { left: margin, right: margin },
      })
      cursorY = (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY + 50
    } else if (q.type === 'wordcloud') {
      const freq = new Map<string, number>()
      q.responses.forEach(r => {
        const w = r.value.trim().toLowerCase()
        if (w) freq.set(w, (freq.get(w) ?? 0) + 1)
      })
      const body = Array.from(freq.entries())
        .map(([word, count]) => [word, String(count)])
        .sort((a, b) => parseInt(b[1], 10) - parseInt(a[1], 10))
      if (body.length > 0) {
        autoTable(doc, {
          startY: cursorY,
          head:   [['Word', 'Mentions']],
          body,
          theme:  'striped',
          headStyles: { fillColor: [0, 0, 121] },
          styles: { fontSize: 10, cellPadding: 6 },
          margin: { left: margin, right: margin },
        })
        cursorY = (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY + 50
      }
    }

    // Individual responses table (if any)
    if (q.responses.length > 0) {
      const body = q.responses.map(r => [
        r.name,
        formatResponseAsText(r, q),
        formatTime(r.time),
      ])
      autoTable(doc, {
        startY: cursorY + 20,
        head:   [['Respondent', 'Response', 'Time']],
        body,
        theme:  'grid',
        headStyles: { fillColor: [60, 60, 80] },
        styles: { fontSize: 9, cellPadding: 5 },
        columnStyles: { 1: { cellWidth: 'auto' } },
        margin: { left: margin, right: margin },
      })
    }
  })
}

function formatResponseAsText(r: ResultResponse, q: ResultQuestion): string {
  if (q.type === 'mcq') {
    let indices: number[]
    try { const p = JSON.parse(r.value); indices = Array.isArray(p) ? p as number[] : [parseInt(r.value, 10)] }
    catch { indices = [parseInt(r.value, 10)] }
    return indices.map(idx => `${String.fromCharCode(65 + idx)}. ${q.options[idx] || `Option ${String.fromCharCode(65 + idx)}`}`).join(', ')
  }
  if (q.type === 'rating') {
    const ratingMax = q.ratingMax === 10 ? 10 : 5
    try {
      const arr = JSON.parse(r.value) as number[]
      return arr.map((v, i) => `${q.options[i] || `P${i + 1}`}: ${v}/${ratingMax}`).join('  |  ')
    } catch { return r.value }
  }
  return r.value
}
