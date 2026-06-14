import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Globe, Table2, Trash2, Users } from 'lucide-react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { app, db } from '@/lib/firebase'
import {
  isResponseCorrect, onAuthStateChanged, auth,
  type ResultQuestion, type ResultResponse,
} from '@/lib/deckStorage'

/* ─────────────────────────────────────────────────────────────────────────
   AdminExport — admin-only tools, rendered on the My Decks header.

   Renders nothing for non-admins. Shows two buttons:
     • "Export results from all accounts" — opens the cross-account export popup
     • "Admins" — opens the admin-allowlist manager
   The privileged cross-account read happens in the exportAllSessions Cloud
   Function; this component just calls it and builds the Excel workbook.
   ───────────────────────────────────────────────────────────────────────── */

// Permanent first admin — mirrors BOOTSTRAP_ADMIN in functions/index.js and the
// isAdmin() check in firestore.rules. Keep all three in sync.
const BOOTSTRAP_ADMIN = 'rabin.r@homeloanexperts.com.au'

const TYPE_LABELS: Record<string, string> = {
  mcq:       'Multiple Choice',
  wordcloud: 'Word Cloud',
  openended: 'Open-ended',
  rating:    'Rating',
}

interface ExportSession {
  ownerEmail: string
  deckTitle: string
  isQuiz: boolean
  id: string
  sessionCode: string
  conductedAt: number
  endedAt: number | null
  audienceCount: number
  trimmed: boolean
  questions: ResultQuestion[]
}

/** One response rendered as readable text (mirrors the per-session export). */
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

/** Overall participation % for one session — same formula as the on-screen stat. */
function sessionParticipation(s: { questions: ResultQuestion[]; audienceCount: number }): number {
  const presented = s.questions.filter(q => q.responseCount > 0)
  if (presented.length === 0) return 0
  const unique = new Set<string>()
  presented.forEach(q => q.responses.forEach(resp => unique.add(resp.name)))
  const respondentCount = unique.size > 0 ? unique.size : s.audienceCount
  return Math.round(
    presented.reduce(
      (acc, q) => acc + Math.min(100, (q.responseCount / Math.max(1, respondentCount)) * 100), 0,
    ) / presented.length,
  )
}

/** Build the cross-account workbook: Tab 1 = session index, Tab 2 = flat answers. */
async function buildAllSessionsWorkbook(sessions: ExportSession[], startDate: string, endDate: string) {
  const XLSX = await import('xlsx')

  // ── Tab 1: All Sessions (one row per session) ───────────────────────
  const sessionRows = sessions.map(s => ({
    'Date':              new Date(s.conductedAt).toISOString().slice(0, 10),
    'Owner':             s.ownerEmail,
    'Deck':              s.deckTitle,
    'Session':           s.sessionCode,
    'Duration (min)':    s.endedAt ? Math.max(1, Math.round((s.endedAt - s.conductedAt) / 60000)) : '',
    'Audience':          s.audienceCount,
    'Questions':         s.questions.length,
    'Responses':         s.questions.reduce((sum, q) => sum + q.responseCount, 0),
    'Avg Participation': `${sessionParticipation(s)}%`,
    'Quiz?':             s.isQuiz ? 'Yes' : 'No',
  }))

  // ── Tab 2: All Responses (one row per individual answer) ─────────────
  const responseRows: Record<string, string | number>[] = []
  sessions.forEach(s => {
    const date = new Date(s.conductedAt).toISOString().slice(0, 10)
    s.questions.forEach((q, qi) => {
      q.responses.forEach(r => {
        const correct = isResponseCorrect(r, q)
        responseRows.push({
          'Date':     date,
          'Owner':    s.ownerEmail,
          'Deck':     s.deckTitle,
          'Session':  s.sessionCode,
          'Q#':       qi + 1,
          'Question': q.question || '(Untitled question)',
          'Type':     TYPE_LABELS[q.type] ?? q.type,
          'Name':     r.name,
          'Answer':   formatResponseAsText(r, q),
          'Correct?': correct === null ? '' : (correct ? 'Yes' : 'No'),
          'Points':   r.quizPoints ? r.quizPoints.answer + r.quizPoints.speed : '',
        })
      })
    })
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sessionRows), 'All Sessions')
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      responseRows.length
        ? responseRows
        : [{ Note: 'No individual responses in range (large sessions may have been trimmed to aggregate counts only).' }],
    ),
    'All Responses',
  )

  const stamp = (startDate || endDate)
    ? `${startDate || 'start'} to ${endDate || 'now'}`
    : new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `Alaya Pulse - all sessions (${stamp}).xlsx`)
}

export function AdminExport() {
  const [isAdmin, setIsAdmin]             = useState(false)
  const [adminEmails, setAdminEmails]     = useState<string[]>([])
  const [showExport, setShowExport]       = useState(false)
  const [showAdmins, setShowAdmins]       = useState(false)
  const [exportStart, setExportStart]     = useState('')
  const [exportEnd, setExportEnd]         = useState('')
  const [isExporting, setIsExporting]     = useState(false)
  const [newAdminEmail, setNewAdminEmail] = useState('')
  const [adminBusy, setAdminBusy]         = useState(false)

  /* Detect whether the signed-in user is an admin (controls visibility).
     The server re-checks independently on export — this is UI-only. */
  useEffect(() => {
    let cancelled = false
    async function check(email?: string | null) {
      if (!email) { if (!cancelled) setIsAdmin(false); return }
      let emails: string[] = []
      try {
        const snap = await getDoc(doc(db, 'config', 'admins'))
        const data = snap.exists() ? snap.data() : null
        emails = data && Array.isArray(data.emails) ? data.emails as string[] : []
      } catch { /* not signed in / not readable — treat as non-admin */ }
      if (cancelled) return
      setAdminEmails(emails)
      setIsAdmin(email === BOOTSTRAP_ADMIN || emails.includes(email))
    }
    const unsub = onAuthStateChanged(auth, u => check(u?.email))
    if (auth.currentUser) check(auth.currentUser.email)
    return () => { cancelled = true; unsub() }
  }, [])

  async function handleExport() {
    setIsExporting(true)
    try {
      const functions = getFunctions(app, 'asia-south2')
      const call = httpsCallable<
        { startDate?: string; endDate?: string },
        { sessions: ExportSession[]; count: number }
      >(functions, 'exportAllSessions')
      const res = await call({
        startDate: exportStart || undefined,
        endDate:   exportEnd || undefined,
      })
      const sessions = res.data?.sessions ?? []
      if (sessions.length === 0) {
        alert('No sessions found' + (exportStart || exportEnd ? ' in that date range.' : '.'))
        return
      }
      await buildAllSessionsWorkbook(sessions, exportStart, exportEnd)
      setShowExport(false)
    } catch (e) {
      console.error('Export all failed:', e)
      const msg = e instanceof Error ? e.message : String(e)
      alert(`Could not export. ${msg || 'Are you signed in as an admin?'}`)
    } finally {
      setIsExporting(false)
    }
  }

  async function handleAddAdmin() {
    const email = newAdminEmail.trim().toLowerCase()
    if (!email || email === BOOTSTRAP_ADMIN || adminEmails.includes(email)) {
      setNewAdminEmail('')
      return
    }
    setAdminBusy(true)
    try {
      const next = [...adminEmails, email]
      await setDoc(doc(db, 'config', 'admins'), { emails: next }, { merge: true })
      setAdminEmails(next)
      setNewAdminEmail('')
    } catch (e) {
      console.error('Add admin failed:', e)
      alert('Could not add admin — only existing admins can change the list.')
    } finally {
      setAdminBusy(false)
    }
  }

  async function handleRemoveAdmin(email: string) {
    setAdminBusy(true)
    try {
      const next = adminEmails.filter(e => e !== email)
      await setDoc(doc(db, 'config', 'admins'), { emails: next }, { merge: true })
      setAdminEmails(next)
    } catch (e) {
      console.error('Remove admin failed:', e)
      alert('Could not remove admin.')
    } finally {
      setAdminBusy(false)
    }
  }

  if (!isAdmin) return null

  return (
    <>
      <button
        onClick={() => setShowExport(true)}
        title="Export every session across all accounts"
        className="flex items-center gap-2 rounded-2xl border border-sky-blue/40 bg-sky-blue/15 px-4 py-2 text-sm font-semibold text-sky-blue transition hover:bg-sky-blue/25"
      >
        <Globe className="size-4" />
        Export results from all accounts
      </button>
      <button
        onClick={() => setShowAdmins(true)}
        title="Manage who can export all data"
        className="flex items-center gap-2 rounded-2xl border border-midnight-sky-200 bg-white px-3.5 py-2 text-sm font-medium text-midnight-sky-600 transition hover:border-midnight-sky-300 hover:bg-midnight-sky-50 hover:text-midnight-sky-900"
      >
        <Users className="size-4" />
        Admins
      </button>

      {/* Export popup — date range + download */}
      <AnimatePresence>
        {showExport && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-midnight-sky-900/50 px-4 backdrop-blur-sm"
            onClick={() => setShowExport(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl border border-midnight-sky-100 bg-white p-6 shadow-2xl"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-sky-blue/15">
                  <Globe className="size-4 text-sky-blue" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-midnight-sky-900">Export all sessions</h3>
                  <p className="text-xs font-medium text-midnight-sky-600">Admin · every session across all accounts</p>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-semibold text-midnight-sky-700">From</span>
                  <input
                    type="date"
                    value={exportStart}
                    onChange={e => setExportStart(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-midnight-sky-200 px-3 py-2 text-sm text-midnight-sky-800 focus:border-sky-blue focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-midnight-sky-700">To</span>
                  <input
                    type="date"
                    value={exportEnd}
                    onChange={e => setExportEnd(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-midnight-sky-200 px-3 py-2 text-sm text-midnight-sky-800 focus:border-sky-blue focus:outline-none"
                  />
                </label>
              </div>
              <p className="mt-1.5 text-xs text-midnight-sky-600">Leave both blank to export everything.</p>

              <button
                onClick={handleExport}
                disabled={isExporting}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-fresh-green px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-fresh-green/85 disabled:opacity-70"
              >
                <Table2 className="size-4" />
                {isExporting ? 'Exporting…' : 'Export to Excel'}
              </button>

              <button
                onClick={() => setShowExport(false)}
                className="mt-3 w-full rounded-xl border border-midnight-sky-200 py-2 text-sm font-medium text-midnight-sky-700 transition hover:bg-midnight-sky-50"
              >
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Admins popup — manage the allowlist */}
      <AnimatePresence>
        {showAdmins && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-midnight-sky-900/50 px-4 backdrop-blur-sm"
            onClick={() => setShowAdmins(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl border border-midnight-sky-100 bg-white p-6 shadow-2xl"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-sky-blue/15">
                  <Users className="size-4 text-sky-blue" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-midnight-sky-900">Admins</h3>
                  <p className="text-xs font-medium text-midnight-sky-600">Who can export all data and manage this list.</p>
                </div>
              </div>

              <ul className="mt-5 space-y-1.5">
                <li className="flex items-center justify-between rounded-lg bg-midnight-sky-50 px-3 py-2 text-xs text-midnight-sky-700">
                  <span className="truncate">{BOOTSTRAP_ADMIN}</span>
                  <span className="ml-2 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-midnight-sky-500">Owner</span>
                </li>
                {adminEmails.filter(e => e !== BOOTSTRAP_ADMIN).map(email => (
                  <li key={email} className="flex items-center justify-between rounded-lg bg-midnight-sky-50 px-3 py-2 text-xs text-midnight-sky-700">
                    <span className="truncate">{email}</span>
                    <button
                      onClick={() => handleRemoveAdmin(email)}
                      disabled={adminBusy}
                      title="Remove admin"
                      className="ml-2 shrink-0 text-midnight-sky-400 transition hover:text-red-500 disabled:opacity-50"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex gap-2">
                <input
                  type="email"
                  value={newAdminEmail}
                  onChange={e => setNewAdminEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddAdmin() }}
                  placeholder="add admin email"
                  className="flex-1 rounded-lg border border-midnight-sky-200 px-3 py-2 text-sm text-midnight-sky-800 placeholder:text-midnight-sky-400 focus:border-sky-blue focus:outline-none"
                />
                <button
                  onClick={handleAddAdmin}
                  disabled={adminBusy || !newAdminEmail.trim()}
                  className="rounded-lg bg-midnight-sky-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-midnight-sky-700 disabled:opacity-50"
                >
                  Add
                </button>
              </div>

              <button
                onClick={() => setShowAdmins(false)}
                className="mt-5 w-full rounded-xl border border-midnight-sky-200 py-2 text-sm font-medium text-midnight-sky-700 transition hover:bg-midnight-sky-50"
              >
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
