import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Monitor, Cloud, LogOut, Clock, Layers, ArrowRightLeft, FileText, Download, Upload, Copy, Search, X as XIcon, ChevronDown, Check } from 'lucide-react'
import { AlayaMark } from '@/components/AlayaMark'
import { cn } from '@/lib/utils'
import {
  getStorageBackend, setStorageBackend, clearStorageBackend,
  browserListDecks, browserSaveDeck, browserDeleteDeck,
  cloudListDecks, cloudSaveDeck, cloudDeleteDeck,
  signInWithGoogle, signOutUser,
  onAuthStateChanged, auth,
  loadResults,
  getRememberMe, setRememberMe, getCachedUser, saveCachedUser, clearCachedUser,
  type StorageBackend, type Deck, type User, type CachedUser,
} from '@/lib/deckStorage'

/* ─────────────────────────────────────────────────────────────────────────
   Deck JSON export helper (mirrors Create.tsx)
   ───────────────────────────────────────────────────────────────────────── */

function downloadDeckJSON(title: string, slides: unknown[]) {
  const payload = JSON.stringify({ version: 1, title, exportedAt: new Date().toISOString(), slides }, null, 2)
  const blob    = new Blob([payload], { type: 'application/json' })
  const url     = URL.createObjectURL(blob)
  const a       = document.createElement('a')
  a.href        = url
  a.download    = `${title.replace(/[^a-z0-9]/gi, '_') || 'deck'}.apulse.json`
  a.click()
  URL.revokeObjectURL(url)
}

/* ─────────────────────────────────────────────────────────────────────────
   Onboarding — demo deck auto-created for first-time users
   ───────────────────────────────────────────────────────────────────────── */

const LS_ONBOARDING        = 'alaya_onboarding_done'
const LS_WELCOME_DISMISSED = 'alaya_welcome_dismissed'

function buildDemoDeck(): Deck {
  const uid = () => Math.random().toString(36).slice(2, 10)
  const now = Date.now()
  return {
    id:        uid(),
    title:     'Welcome to Alaya Pulse ✦',
    isQuiz:    true,
    createdAt: now,
    updatedAt: now,
    slides: [
      { id: uid(), type: 'content', template: 'heading',
        title: 'Welcome to Alaya Pulse ✦',
        body: 'Run this deck live with your team to see everything in action',
        attribution: '', theme: 'navy' },
      { id: uid(), type: 'mcq',
        question: 'How many hearts does an octopus have?',
        options: ['1', '2', '3', '4'], correctAnswers: [2], vizType: 'bar', timer: 30 },
      { id: uid(), type: 'mcq',
        question: 'Which of these were invented in Australia? Select all that apply.',
        options: ['Wi-Fi', 'The telephone', 'Vegemite', 'The black box flight recorder'],
        correctAnswers: [0, 2, 3], vizType: 'bar', timer: 30 },
      { id: uid(), type: 'mcq',
        question: 'A group of flamingos is officially called a…?',
        options: ['Flock', 'Colony', 'Flamboyance', 'Parade'], correctAnswers: [2], vizType: 'bar', timer: 30 },
      { id: uid(), type: 'wordcloud',
        question: 'In one word — describe your Monday morning mood', options: [] },
      { id: uid(), type: 'openended',
        question: "What's one work habit you wish everyone on your team had?", options: [] },
      { id: uid(), type: 'rating',
        question: 'Rate your confidence in these survival skills:',
        options: ['Starting a campfire', 'Reading a map', 'Building a shelter'] },
      { id: uid(), type: 'leaderboard' },
    ] as unknown[],
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   My Decks page — saved presentations library
   ───────────────────────────────────────────────────────────────────────── */

export default function Decks() {
  const navigate = useNavigate()

  const [backend,       setBackend]       = useState<StorageBackend | null>(getStorageBackend)
  const [user,          setUser]          = useState<User | null>(null)
  const [decks,         setDecks]         = useState<Deck[]>([])
  const [loading,       setLoading]       = useState(true)
  const [signingIn,     setSigningIn]     = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting,      setDeleting]      = useState(false)
  // Incrementing this forces StorageChoiceScreen to fully remount (re-reads
  // localStorage) when "Remove from device" is clicked from the sign-in screen.
  const [storageKey,    setStorageKey]    = useState(0)
  const [searchQuery,   setSearchQuery]   = useState('')
  const importRef      = useRef<HTMLInputElement>(null)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const [accountMenuOpen,       setAccountMenuOpen]       = useState(false)
  const [selectedIds,           setSelectedIds]           = useState<Set<string>>(new Set())
  const [confirmDeleteSelected, setConfirmDeleteSelected] = useState(false)
  // Welcome banner — shown after demo deck is created, dismissed once user closes it
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(
    () => !!localStorage.getItem(LS_ONBOARDING) && !localStorage.getItem(LS_WELCOME_DISMISSED)
  )

  const filteredDecks = useMemo(() =>
    searchQuery.trim()
      ? decks.filter(d => d.title.toLowerCase().includes(searchQuery.toLowerCase()))
      : decks,
  [decks, searchQuery])

  // Close account dropdown on outside click
  useEffect(() => {
    if (!accountMenuOpen) return
    function handleClick(e: MouseEvent) {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setAccountMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [accountMenuOpen])

  // Track Firebase auth state
  useEffect(() => {
    return onAuthStateChanged(auth, u => setUser(u))
  }, [])

  // Load decks whenever backend/user changes
  useEffect(() => {
    if (!backend) { setLoading(false); return }
    if (backend === 'cloud' && !user) { setLoading(false); return }
    loadDecks()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend, user])

  async function loadDecks() {
    setLoading(true)
    try {
      const list = backend === 'browser' ? await browserListDecks() : await cloudListDecks()
      // First-time user: no decks + no prior onboarding → auto-create sample deck
      if (list.length === 0 && !localStorage.getItem(LS_ONBOARDING)) {
        try {
          const demo = buildDemoDeck()
          if (backend === 'browser') await browserSaveDeck(demo)
          else await cloudSaveDeck(demo)
          localStorage.setItem(LS_ONBOARDING, '1')
          setShowWelcomeBanner(true)
          setDecks([demo])
        } catch {
          // Save failed — just show the empty state, no harm done
          setDecks([])
        }
      } else {
        setDecks(list)
      }
    } finally {
      setLoading(false)
    }
  }

  /* ── Storage choice handlers ──────────────────────────────────────────── */

  function handleChooseBrowser() {
    setStorageBackend('browser')
    setBackend('browser')
  }

  // Attempt counter — if the user clicks "Sign in with Google" again while
  // an earlier attempt is still pending (e.g. they closed the Google
  // account picker without choosing), the latest attempt supersedes the
  // older one. Only the latest attempt clears the loading state.
  const signInAttemptRef = useRef(0)

  /**
   * @param rememberMe  true  → save user info for quick re-sign-in (select_account prompt)
   *                    false → require full password each time (login prompt)
   */
  async function handleChooseCloud(rememberMe: boolean) {
    const attempt = ++signInAttemptRef.current
    setSigningIn(true)
    try {
      // forceLogin = !rememberMe so "don't remember" always demands a password
      const u = await signInWithGoogle(!rememberMe)
      if (signInAttemptRef.current !== attempt) return
      setStorageBackend('cloud')
      setBackend('cloud')
      setUser(u)
      // Persist (or clear) the remember-me preference and cached profile
      setRememberMe(rememberMe)
      if (rememberMe) saveCachedUser(u)
      else            clearCachedUser(), setRememberMe(false)
    } catch {
      // user cancelled or the popup closed — no-op
    } finally {
      if (signInAttemptRef.current === attempt) {
        setSigningIn(false)
      }
    }
  }

  /* ── Sign out / switch storage ───────────────────────────────────────── */

  async function handleSignOut() {
    await signOutUser()
    clearStorageBackend()
    setBackend(null)
    setDecks([])
    setUser(null)
    // Note: deliberately NOT clearing cached user here so personal-device
    // users get quick re-sign-in. Shared-device users should use
    // handleRemoveAccount instead.
  }

  /** Shared-device sign-out: wipes the cached Google profile + remember
   *  preference AND redirects to Google's logout page so the account is
   *  removed from the browser-level "Choose an account" popup too. */
  async function handleRemoveAccount() {
    await signOutUser()
    clearCachedUser()
    clearStorageBackend()
    // Update React state as a fallback in case the redirect is ever blocked.
    setBackend(null)
    setDecks([])
    setUser(null)
    setStorageKey(k => k + 1)
    // Open Google's logout page in a new tab — this signs the user out of Google
    // in this browser, removing their account from the "Choose an account" popup.
    // We open a new tab rather than redirecting the current page so the user
    // stays on Alaya Pulse's clean sign-in screen.
    window.open('https://accounts.google.com/Logout', '_blank', 'noopener,noreferrer')
  }

  function handleSwitchStorage() {
    clearStorageBackend()
    setBackend(null)
    setDecks([])
  }

  /* ── Duplicate ────────────────────────────────────────────────────────── */

  async function handleDuplicateDeck(deck: Deck) {
    const newId = Math.random().toString(36).slice(2, 10)
    const copy: Deck = {
      ...deck,
      id:        newId,
      title:     `${deck.title} (copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    try {
      if (backend === 'browser') await browserSaveDeck(copy)
      else await cloudSaveDeck(copy)
      setDecks(prev => [copy, ...prev])
    } catch {
      alert('Could not duplicate deck — please try again.')
    }
  }

  /* ── Delete ───────────────────────────────────────────────────────────── */

  async function handleDelete(id: string) {
    setDeleting(true)
    try {
      if (backend === 'browser') await browserDeleteDeck(id)
      else await cloudDeleteDeck(id)
      setDecks(prev => prev.filter(d => d.id !== id))
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
    }
  }

  /* ── Multi-select ─────────────────────────────────────────────────────── */

  function handleToggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  async function handleDeleteSelected() {
    setDeleting(true)
    try {
      for (const id of selectedIds) {
        if (backend === 'browser') await browserDeleteDeck(id)
        else await cloudDeleteDeck(id)
      }
      setDecks(prev => prev.filter(d => !selectedIds.has(d.id)))
      setSelectedIds(new Set())
    } finally {
      setDeleting(false)
      setConfirmDeleteSelected(false)
    }
  }

  /* ── Open deck in editor ──────────────────────────────────────────────── */

  async function handleOpen(deck: Deck) {
    // Also load any saved live-poll results so the Results button is
    // enabled when the user opens a deck that has previous results.
    let lastResults
    if (backend) {
      try { lastResults = await loadResults(backend, deck.id) } catch { /* ignore */ }
    }
    navigate('/create', { state: { deck, lastResults } })
  }

  /* ── Import deck from .apulse.json file ───────────────────────────────── */

  const handleImportDeck = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string)
        if (!Array.isArray(data.slides)) throw new Error('invalid')
        // Regenerate IDs to avoid collisions with existing slides
        const uid = () => Math.random().toString(36).slice(2, 10)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const slides = (data.slides as any[]).map(s => ({ ...s, id: uid() }))
        const title  = typeof data.title === 'string' ? data.title : 'Imported deck'
        navigate('/create', { state: { slides, deckTitle: title } })
      } catch {
        alert('Could not import deck — the file may be invalid or corrupted.')
      }
    }
    reader.readAsText(file)
  }, [navigate])

  /* ── Render ───────────────────────────────────────────────────────────── */

  // No backend chosen yet — show the storage choice screen
  if (!backend) {
    return (
      <StorageChoiceScreen
        key={storageKey}
        signingIn={signingIn}
        onBrowser={handleChooseBrowser}
        onCloud={handleChooseCloud}
        onRemoveAccount={handleRemoveAccount}
      />
    )
  }

  // Cloud chosen but not signed in (e.g. token expired)
  if (backend === 'cloud' && !user && !loading) {
    return (
      <StorageChoiceScreen
        key={storageKey}
        signingIn={signingIn}
        onBrowser={handleChooseBrowser}
        onCloud={handleChooseCloud}
        onRemoveAccount={handleRemoveAccount}
        reauth
      />
    )
  }

  return (
    <main className="min-h-screen bg-midnight-sky-50/60">

      {/* ── Slim sticky nav ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-white/10 bg-midnight-sky-900/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">

          {/* Logo */}
          <Link to="/"><AlayaMark className="shrink-0 text-white" /></Link>

          {/* Search — centred, fills available space */}
          <div className="relative mx-auto w-full max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-white/35" />
            <input
              type="text"
              placeholder="Search decks…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/8 py-2 pl-9 pr-8 text-sm text-white placeholder:text-white/50 transition focus:border-white/25 focus:bg-white/12 focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </div>

          {/* Account button + dropdown */}
          <div ref={accountMenuRef} className="relative shrink-0">
            <button
              onClick={() => setAccountMenuOpen(v => !v)}
              className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/8 px-2.5 py-1.5 text-xs font-medium text-white/70 transition hover:bg-white/15 hover:text-white"
            >
              {backend === 'cloud' && user ? (
                <>
                  {user.photoURL
                    ? <img src={user.photoURL} alt="" className="size-5 rounded-full" />
                    : <div className="flex size-5 items-center justify-center rounded-full bg-hot-pink/20 text-[9px] font-bold text-hot-pink">{user.displayName?.[0] ?? '?'}</div>
                  }
                  <span>{user.displayName?.split(' ')[0]}</span>
                </>
              ) : (
                <>
                  <Monitor className="size-3.5" />
                  <span>This browser</span>
                </>
              )}
              <ChevronDown className={cn('size-3 transition-transform duration-200', accountMenuOpen && 'rotate-180')} />
            </button>

            <AnimatePresence>
              {accountMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute right-0 top-full mt-2 w-52 overflow-hidden rounded-2xl border border-white/10 bg-midnight-sky-800 py-1 shadow-2xl"
                >
                  {backend === 'cloud' && user ? (
                    <>
                      <div className="border-b border-white/10 px-4 py-3">
                        <p className="text-xs font-semibold text-white/90">{user.displayName}</p>
                        <p className="truncate text-[11px] text-white/45">{user.email}</p>
                      </div>
                      <button
                        onClick={() => { setAccountMenuOpen(false); handleSignOut() }}
                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-xs text-white/65 transition hover:bg-white/8 hover:text-white"
                      >
                        <LogOut className="size-3.5" />
                        Sign out
                      </button>
                      <button
                        onClick={() => { setAccountMenuOpen(false); handleRemoveAccount() }}
                        title="Sign out and remove this Google account from the device — use this on shared laptops"
                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-xs text-red-400/80 transition hover:bg-red-500/10 hover:text-red-400"
                      >
                        <XIcon className="size-3.5" />
                        Remove from device
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="border-b border-white/10 px-4 py-3">
                        <p className="text-xs font-semibold text-white/90">This browser</p>
                        <p className="text-[11px] text-white/45">Saved on this device only</p>
                      </div>
                      <button
                        onClick={() => { setAccountMenuOpen(false); handleSwitchStorage() }}
                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-xs text-white/65 transition hover:bg-white/8 hover:text-white"
                      >
                        <ArrowRightLeft className="size-3.5" />
                        Change storage
                      </button>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

        </div>
      </header>

      {/* ── Page body ───────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-6xl px-6 pb-16 pt-6">

        {/* Page header row — title + count + action buttons */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-midnight-sky-900">My Decks</h1>
            <p className="mt-0.5 text-[11px] text-midnight-sky-600">
              {loading ? 'Loading…' : decks.length > 0
                ? searchQuery.trim()
                  ? `${filteredDecks.length} of ${decks.length} ${decks.length === 1 ? 'deck' : 'decks'}`
                  : `${decks.length} ${decks.length === 1 ? 'deck' : 'decks'}`
                : 'No decks yet'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={importRef}
              type="file"
              accept=".json,.apulse"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleImportDeck(f); e.target.value = '' }}
            />
            <motion.button
              onClick={() => importRef.current?.click()}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              title="Import a deck shared by a colleague (.apulse.json)"
              className="flex items-center gap-2 rounded-2xl border border-midnight-sky-200 bg-white px-4 py-2 text-sm font-semibold text-midnight-sky-600 shadow-sm transition hover:border-midnight-sky-300 hover:bg-midnight-sky-50 hover:text-midnight-sky-900"
            >
              <Upload className="size-4" />
              Import deck
            </motion.button>

            <motion.button
              onClick={() => navigate('/create')}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              className="flex items-center gap-2 rounded-2xl bg-hot-pink px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_24px_-4px] shadow-hot-pink/60 transition-shadow hover:shadow-[0_4px_32px_-2px] hover:shadow-hot-pink/80"
            >
              <Plus className="size-4" />
              New deck
            </motion.button>
          </div>
        </div>

        {/* Welcome banner — shown once after demo deck is auto-created */}
        <AnimatePresence>
          {showWelcomeBanner && (
            <motion.div
              key="welcome-banner"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="mb-6 flex items-start gap-4 rounded-2xl border border-hot-pink/20 bg-hot-pink/[0.05] px-5 py-4"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-hot-pink/15 text-sm font-bold text-hot-pink">
                ✦
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-midnight-sky-900">Your sample deck is ready</p>
                <p className="mt-0.5 text-xs leading-relaxed text-midnight-sky-500">
                  Quiz mode is on — 3 questions have correct answers marked. Open the deck, start a session, and join from your phone to see it all live. Hit{' '}
                  <span className="font-semibold text-midnight-sky-700">Results</span>{' '}
                  in the editor after to review responses.
                </p>
              </div>
              <button
                onClick={() => {
                  setShowWelcomeBanner(false)
                  localStorage.setItem(LS_WELCOME_DISMISSED, '1')
                }}
                title="Dismiss"
                className="shrink-0 rounded-lg p-1 text-midnight-sky-400 transition hover:bg-midnight-sky-100 hover:text-midnight-sky-700"
              >
                <XIcon className="size-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Deck grid / empty / loading */}
        {loading ? (
          <LoadingGrid />
        ) : decks.length === 0 ? (
          <EmptyState onNew={() => navigate('/create')} />
        ) : filteredDecks.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <Search className="mb-3 size-8 text-midnight-sky-300" />
            <p className="text-sm font-medium text-midnight-sky-500">No decks match "{searchQuery}"</p>
            <button onClick={() => setSearchQuery('')} className="mt-2 text-xs text-hot-pink hover:underline">Clear search</button>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          >
            {filteredDecks.map((deck, i) => (
              <motion.div
                key={deck.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: i * 0.07, ease: [0.16, 1, 0.3, 1] }}
              >
                <DeckCard
                  deck={deck}
                  onOpen={() => handleOpen(deck)}
                  onDelete={() => setConfirmDelete(deck.id)}
                  onExport={() => downloadDeckJSON(deck.title, deck.slides as unknown[])}
                  onDuplicate={() => handleDuplicateDeck(deck)}
                  isSelected={selectedIds.has(deck.id)}
                  onToggleSelect={() => handleToggleSelect(deck.id)}
                  inSelectionMode={selectedIds.size > 0}
                />
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      {/* ── Multi-select floating action bar ───────────────────────────── */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-white/10 bg-midnight-sky-900 px-5 py-3 shadow-2xl"
          >
            <span className="text-sm font-medium text-white/80">
              {selectedIds.size} {selectedIds.size === 1 ? 'deck' : 'decks'} selected
            </span>
            <div className="h-4 w-px bg-white/20" />
            <button
              onClick={() => setConfirmDeleteSelected(true)}
              className="flex items-center gap-1.5 rounded-xl bg-red-500/20 px-3 py-1.5 text-xs font-semibold text-red-400 transition hover:bg-red-500/30 hover:text-red-300"
            >
              <Trash2 className="size-3.5" />
              Delete {selectedIds.size === 1 ? 'deck' : 'decks'}
            </button>
            <button
              onClick={clearSelection}
              title="Cancel selection"
              className="rounded-lg p-1 text-white/40 transition hover:text-white/70"
            >
              <XIcon className="size-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Delete single deck modal ─────────────────────────────────────── */}
      <AnimatePresence>
        {confirmDelete && (
          <DeleteModal
            loading={deleting}
            onConfirm={() => handleDelete(confirmDelete)}
            onCancel={() => setConfirmDelete(null)}
          />
        )}
      </AnimatePresence>

      {/* ── Delete selected decks modal ──────────────────────────────────── */}
      <AnimatePresence>
        {confirmDeleteSelected && (
          <DeleteModal
            loading={deleting}
            title={`Delete ${selectedIds.size} ${selectedIds.size === 1 ? 'deck' : 'decks'}?`}
            description={`This cannot be undone. ${selectedIds.size === 1 ? 'The selected deck' : `All ${selectedIds.size} selected decks`} and their slides will be permanently removed.`}
            onConfirm={handleDeleteSelected}
            onCancel={() => setConfirmDeleteSelected(false)}
          />
        )}
      </AnimatePresence>
    </main>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Storage choice screen — shown on first visit or after sign-out
   ───────────────────────────────────────────────────────────────────────── */

function StorageChoiceScreen({
  onBrowser, onCloud, onRemoveAccount, signingIn, reauth = false,
}: {
  onBrowser:         () => void
  onCloud:           (rememberMe: boolean) => void
  onRemoveAccount?:  () => void
  signingIn:         boolean
  reauth?:           boolean
}) {
  // "Keep me signed in" checkbox — defaults to whatever the user last chose,
  // or false (secure default) if they've never signed in before.
  const [rememberMe, setRememberMeLocal] = useState<boolean>(() => getRememberMe() ?? false)
  // Cached user profile — shown in the "Welcome back" state
  const [cachedUser] = useState<CachedUser | null>(() => getCachedUser())
  // Whether the user clicked "Sign in differently" to override the cached profile
  const [overrideCached, setOverrideCached] = useState(false)

  const showWelcomeBack = !!(cachedUser && getRememberMe() === true && !overrideCached && !reauth)
  const firstName = cachedUser?.displayName?.split(' ')[0] ?? 'you'

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-white px-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-2xl"
      >
        <div className="mb-10 text-center">
          <Link to="/"><AlayaMark className="mx-auto mb-8 justify-center" /></Link>
          <h1 className="text-2xl font-semibold text-midnight-sky-900 sm:text-3xl">
            {reauth ? 'Sign in again to continue' : 'Where would you like to save your decks?'}
          </h1>
          {!reauth && (
            <p className="mt-2 text-base font-light text-midnight-sky-500">
              You can change this later. Choose what works best for you.
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Browser option */}
          <motion.button
            onClick={onBrowser}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            className="group flex flex-col gap-4 rounded-3xl border-2 border-midnight-sky-200 bg-white p-7 text-left transition-all hover:border-midnight-sky-400 hover:shadow-lg"
          >
            <div className="flex size-12 items-center justify-center rounded-2xl bg-midnight-sky-100 transition group-hover:bg-midnight-sky-200">
              <Monitor className="size-6 text-midnight-sky-700" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-midnight-sky-900">Save to this browser</h3>
              <p className="mt-1 text-sm font-light leading-relaxed text-midnight-sky-500">
                No login. Decks live on this device, this browser only.
              </p>
            </div>
            <ul className="mt-1 space-y-2 text-xs">
              <li className="flex items-start gap-2 leading-snug text-midnight-sky-800">
                <span className="mt-px font-bold text-fresh-green">✓</span>
                <span>No file size limits — works for huge HTML/PDF decks</span>
              </li>
              <li className="flex items-start gap-2 leading-snug text-midnight-sky-800">
                <span className="mt-px font-bold text-fresh-green">✓</span>
                <span>Works offline, no upload wait</span>
              </li>
              <li className="flex items-start gap-2 leading-snug text-midnight-sky-800">
                <span className="mt-px font-bold text-hot-pink/80">✗</span>
                <span>Decks not available on other devices</span>
              </li>
              <li className="flex items-start gap-2 leading-snug text-midnight-sky-800">
                <span className="mt-px font-bold text-hot-pink/80">✗</span>
                <span>Lost if you clear browser data</span>
              </li>
            </ul>
          </motion.button>

          {/* Google / Cloud option */}
          <div className="flex flex-col gap-4 rounded-3xl border-2 border-hot-pink/30 bg-hot-pink/[0.03] p-7">

            {showWelcomeBack ? (
              /* ── Welcome back state ─────────────────────────────────────── */
              <div className="flex flex-1 flex-col">
                {/* User avatar + name */}
                <div className="mb-5 flex items-center gap-3">
                  {cachedUser!.photoURL ? (
                    <img
                      src={cachedUser!.photoURL}
                      alt={cachedUser!.displayName ?? ''}
                      className="size-12 rounded-full shadow-sm ring-2 ring-hot-pink/20"
                    />
                  ) : (
                    <div className="flex size-12 items-center justify-center rounded-full bg-hot-pink/15 text-lg font-bold text-hot-pink">
                      {cachedUser!.displayName?.[0] ?? '?'}
                    </div>
                  )}
                  <div>
                    <p className="text-base font-semibold text-midnight-sky-900">
                      Welcome back, {firstName}!
                    </p>
                    <p className="text-xs text-midnight-sky-400">{cachedUser!.email}</p>
                  </div>
                </div>

                {/* One-tap sign in */}
                <motion.button
                  onClick={() => onCloud(true)}
                  whileTap={{ scale: 0.97 }}
                  disabled={signingIn}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-hot-pink py-3 text-sm font-semibold text-white shadow-[0_4px_20px_-4px] shadow-hot-pink/50 transition hover:shadow-[0_4px_28px_-2px] hover:shadow-hot-pink/70 disabled:opacity-60"
                >
                  {signingIn ? <ChoiceLoadingDots /> : <>
                    <Cloud className="size-4" />
                    Sign in as {firstName}
                  </>}
                </motion.button>

                {/* Alternate actions */}
                <div className="mt-4 flex items-center justify-between text-[11px]">
                  <button
                    onClick={() => setOverrideCached(true)}
                    className="text-midnight-sky-400 underline-offset-2 hover:text-midnight-sky-700 hover:underline"
                  >
                    Sign in as someone else
                  </button>
                  <button
                    onClick={onRemoveAccount}
                    className="text-red-400 underline-offset-2 hover:text-red-600 hover:underline"
                    title="Remove this Google account from the device — use on shared laptops"
                  >
                    Remove from device
                  </button>
                </div>
              </div>
            ) : (
              /* ── Fresh sign-in state ────────────────────────────────────── */
              <div className="flex flex-1 flex-col">
                <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-hot-pink/10">
                  {signingIn ? <ChoiceLoadingDots /> : <Cloud className="size-6 text-hot-pink" />}
                </div>
                <div className="mb-4">
                  <h3 className="text-lg font-semibold text-midnight-sky-900">Sign in with Google</h3>
                  <p className="mt-1 text-sm font-light leading-relaxed text-midnight-sky-500">
                    Decks saved to your Google account. Same decks on every device.
                  </p>
                </div>
                <ul className="mb-5 space-y-2 text-xs">
                  <li className="flex items-start gap-2 leading-snug text-midnight-sky-800">
                    <span className="mt-px font-bold text-fresh-green">✓</span>
                    <span>Access decks from any device or browser</span>
                  </li>
                  <li className="flex items-start gap-2 leading-snug text-midnight-sky-800">
                    <span className="mt-px font-bold text-fresh-green">✓</span>
                    <span>Survives browser data clearing</span>
                  </li>
                  <li className="flex items-start gap-2 leading-snug text-midnight-sky-800">
                    <span className="mt-px font-bold text-hot-pink/80">✗</span>
                    <span>HTML files capped at ~1 MB each</span>
                  </li>
                  <li className="flex items-start gap-2 leading-snug text-midnight-sky-800">
                    <span className="mt-px font-bold text-hot-pink/80">✗</span>
                    <span>Needs internet to save / load</span>
                  </li>
                </ul>

                {/* Remember me checkbox */}
                <label className="mb-4 flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={e => setRememberMeLocal(e.target.checked)}
                    className="mt-0.5 size-4 cursor-pointer accent-hot-pink"
                  />
                  <span className="text-xs leading-snug text-midnight-sky-600">
                    Keep me signed in on this device
                    <span className="block font-light text-midnight-sky-400">
                      Uncheck on shared or work laptops
                    </span>
                  </span>
                </label>

                {/* Sign in button */}
                <motion.button
                  onClick={() => onCloud(rememberMe)}
                  whileTap={{ scale: 0.97 }}
                  disabled={signingIn}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-hot-pink py-3 text-sm font-semibold text-white shadow-[0_4px_20px_-4px] shadow-hot-pink/50 transition hover:shadow-[0_4px_28px_-2px] hover:shadow-hot-pink/70 disabled:opacity-60"
                >
                  {signingIn ? <ChoiceLoadingDots /> : rememberMe ? (
                    <>
                      <Cloud className="size-4" />
                      Sign in with Google
                    </>
                  ) : (
                    <span className="flex flex-col items-center leading-tight">
                      <span>Sign in</span>
                      <span className="text-[11px] font-normal opacity-80">(Require password each time)</span>
                    </span>
                  )}
                </motion.button>
              </div>
            )}
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-midnight-sky-400">
          Both options are free. You can switch any time.
        </p>
      </motion.div>
    </main>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Deck card
   ───────────────────────────────────────────────────────────────────────── */

const TYPE_LABELS: Record<string, string> = {
  mcq: 'MCQ', wordcloud: 'Word Cloud', openended: 'Open-ended', rating: 'Rating',
}
const TYPE_COLORS: Record<string, string> = {
  mcq: 'bg-sky-blue/10 text-sky-blue',
  wordcloud: 'bg-fresh-green/10 text-fresh-green',
  openended: 'bg-golden-sun/10 text-golden-sun',
  rating: 'bg-hot-pink/10 text-hot-pink',
}

/* ── Slide theme palette (mirrors Create.tsx CONTENT_COLORS / QSLIDE_COLORS) */
const DECK_THEME: Record<string, { bg: string; text: string }> = {
  navy:   { bg: '#000079', text: '#ffffff' },
  pink:   { bg: '#ff0065', text: '#ffffff' },
  sky:    { bg: '#00b0ff', text: '#000079' },
  green:  { bg: '#42db66', text: '#000079' },
  golden: { bg: '#ffc709', text: '#000079' },
  white:  { bg: '#f4f4f9', text: '#000079' },
}
function deckTheme(t?: string) { return DECK_THEME[t ?? 'navy'] ?? DECK_THEME.navy }

/* ─────────────────────────────────────────────────────────────────────────
   DeckThumbnail — renders a preview of the first slide of a deck.
   Adapts based on slide type so users can recognise their decks at a
   glance instead of seeing identical navy placeholders.
   ───────────────────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DeckThumbnail({ slides }: { slides: any[] }) {
  if (slides.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-midnight-sky-900">
        <Layers className="size-8 text-white/20" />
      </div>
    )
  }

  const first = slides[0]

  if (first.type === 'pdf' && first.imgUrl) {
    return <img src={first.imgUrl} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
  }
  if (first.type === 'image' && first.imgUrl) {
    return <img src={first.imgUrl} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
  }
  if (first.type === 'html' && first.html) {
    return <HtmlDeckPreview html={first.html} slideIndex={first.slideIndex ?? 0} fileName={first.fileName} />
  }
  if (first.type === 'content') {
    const c = deckTheme(first.theme)
    return (
      <div className="flex h-full w-full items-center justify-center px-5 py-4" style={{ backgroundColor: c.bg }}>
        <p className="line-clamp-3 text-center text-sm font-bold leading-snug" style={{ color: c.text }}>
          {first.title || first.body || 'Untitled'}
        </p>
      </div>
    )
  }
  if (first.type === 'canvas') {
    const bg = first.bg ?? { type: 'color', value: '#000079' }
    const style: React.CSSProperties = bg.type === 'color'
      ? { backgroundColor: bg.value }
      : { backgroundImage: bg.value }
    return (
      <div className="flex h-full w-full items-center justify-center" style={style}>
        <Layers className="size-6 text-white/30" />
      </div>
    )
  }
  // Question slide (mcq / wordcloud / openended / rating)
  const c = deckTheme(first.theme)
  return (
    <div className="flex h-full w-full items-center justify-center px-5 py-4" style={{ backgroundColor: c.bg }}>
      <p className="line-clamp-3 text-center text-xs font-semibold leading-snug" style={{ color: c.text }}>
        {first.question || 'Question slide'}
      </p>
    </div>
  )
}

/* HTML deck preview — mini iframe of the actual HTML, scaled to fit. */
function HtmlDeckPreview({ html, slideIndex, fileName }: {
  html: string; slideIndex: number; fileName: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [shouldLoad, setShouldLoad] = useState(false)
  const [scale, setScale] = useState(0.16)
  const IFRAME_W = 1280
  const IFRAME_H = 720

  useEffect(() => {
    if (!containerRef.current || shouldLoad) return
    const el = containerRef.current
    const obs = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) { setShouldLoad(true); obs.disconnect(); break }
      }
    }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [shouldLoad])

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const recompute = () => {
      const w = el.offsetWidth
      if (w > 0) setScale(w / IFRAME_W)
    }
    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const srcDoc = useMemo(() => buildDeckPreviewHtml(html, slideIndex), [html, slideIndex])

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-white">
      {shouldLoad ? (
        <iframe
          srcDoc={srcDoc}
          sandbox="allow-scripts allow-popups allow-modals"
          title={fileName}
          className="border-0"
          style={{
            width:           `${IFRAME_W}px`,
            height:          `${IFRAME_H}px`,
            transform:       `scale(${scale})`,
            transformOrigin: 'top left',
            pointerEvents:   'none',
          }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-midnight-sky-50">
          <FileText className="size-6 text-midnight-sky-300" />
        </div>
      )}
    </div>
  )
}

function buildDeckPreviewHtml(html: string, slideIndex: number): string {
  if (slideIndex <= 0) return html
  const script = `
<script>
(function() {
  var target = ${slideIndex};
  function fireKey() {
    try {
      var ev = new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39, bubbles: true, cancelable: true });
      document.dispatchEvent(ev);
    } catch (e) {}
  }
  function init() {
    try {
      var s = document.createElement('style');
      s.textContent = '*,*::before,*::after { transition: none !important; animation-duration: 0s !important; animation-delay: 0s !important; }';
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
    try { if (window.Reveal && Reveal.slide) { Reveal.slide(target); return; } } catch (e) {}
    try { if (window.impress) { window.impress().goto(target); return; } } catch (e) {}
    try { window.location.hash = '#/' + target; } catch (e) {}
    for (var i = 0; i < target; i++) setTimeout(fireKey, i * 10);
  }
  if (document.readyState === 'complete') setTimeout(init, 30);
  else window.addEventListener('load', function() { setTimeout(init, 30); });
})();
</script>`
  if (html.includes('</body>')) return html.replace('</body>', script + '\n</body>')
  return html + script
}

function DeckCard({ deck, onOpen, onDelete, onExport, onDuplicate, isSelected, onToggleSelect, inSelectionMode }: {
  deck:            Deck
  onOpen:          () => void
  onDelete:        () => void
  onExport:        () => void
  onDuplicate:     () => void
  isSelected:      boolean
  onToggleSelect:  () => void
  inSelectionMode: boolean
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slides     = deck.slides as any[]
  const qSlides    = slides.filter(s => s.type !== 'pdf')
  const qTypes     = [...new Set(qSlides.map(s => s.type as string))]
  const slideCount = slides.length

  return (
    <motion.div
      whileHover={{ y: isSelected ? 0 : -4 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'group flex flex-col overflow-hidden rounded-2xl bg-white ring-1 transition-all duration-200',
        isSelected
          ? 'ring-2 ring-hot-pink/60 shadow-[0_0_0_4px_rgba(255,0,101,0.12)]'
          : 'ring-midnight-sky-100/80 shadow-[0_2px_12px_-2px_rgba(0,0,121,0.06)] hover:shadow-[0_16px_48px_-8px_rgba(0,0,121,0.16)] hover:ring-midnight-sky-200',
      )}
    >
      {/* Thumbnail — preview of the first slide */}
      <button
        onClick={onOpen}
        className="relative aspect-video w-full overflow-hidden bg-midnight-sky-900"
      >
        <DeckThumbnail slides={slides} />

        {/* Hover overlay — hidden in selection mode */}
        {!inSelectionMode && (
          <div className="absolute inset-0 flex items-center justify-center bg-midnight-sky-900/0 transition-all duration-300 group-hover:bg-midnight-sky-900/40">
            <span className="translate-y-2 rounded-xl bg-white px-4 py-2 text-xs font-semibold text-midnight-sky-900 opacity-0 shadow-lg transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
              Open deck
            </span>
          </div>
        )}

        {/* Selection checkbox — top left */}
        <button
          onClick={e => { e.stopPropagation(); onToggleSelect() }}
          title={isSelected ? 'Deselect' : 'Select'}
          className={cn(
            'absolute left-2 top-2 z-10 flex size-5 items-center justify-center rounded-md border-2 backdrop-blur-sm transition-all duration-200',
            isSelected
              ? 'border-hot-pink bg-hot-pink opacity-100'
              : cn(
                  'border-white/80 bg-black/25',
                  inSelectionMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                ),
          )}
        >
          {isSelected && <Check className="size-3 text-white" />}
        </button>

        {/* Slide count badge — bottom left */}
        <span className="absolute bottom-2 left-2 rounded-lg bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          {slideCount} {slideCount === 1 ? 'slide' : 'slides'}
        </span>

        {/* Duplicate button — appears on hover, hidden in selection mode */}
        {!inSelectionMode && (
          <button
            onClick={e => { e.stopPropagation(); onDuplicate() }}
            title="Duplicate deck"
            className="absolute right-[4.5rem] top-2.5 flex size-6 items-center justify-center rounded-lg bg-black/40 text-white/60 opacity-0 backdrop-blur-sm transition-all duration-200 hover:bg-sky-500/70 hover:text-white group-hover:opacity-100"
          >
            <Copy className="size-3" />
          </button>
        )}

        {/* Export button — appears on hover, hidden in selection mode */}
        {!inSelectionMode && (
          <button
            onClick={e => { e.stopPropagation(); onExport() }}
            title="Export deck for sharing"
            className="absolute right-10 top-2.5 flex size-6 items-center justify-center rounded-lg bg-black/40 text-white/60 opacity-0 backdrop-blur-sm transition-all duration-200 hover:bg-midnight-sky-700/80 hover:text-white group-hover:opacity-100"
          >
            <Download className="size-3" />
          </button>
        )}

        {/* Delete button — hidden in selection mode (use floating bar instead) */}
        {!inSelectionMode && (
          <button
            onClick={e => { e.stopPropagation(); onDelete() }}
            className="absolute right-2.5 top-2.5 flex size-6 items-center justify-center rounded-lg bg-black/40 text-white/60 opacity-0 backdrop-blur-sm transition-all duration-200 hover:bg-red-500/80 hover:text-white group-hover:opacity-100"
          >
            <Trash2 className="size-3" />
          </button>
        )}
      </button>

      {/* Info */}
      <div className="flex flex-1 flex-col px-4 py-3.5">
        <button onClick={onOpen} className="text-left">
          <h3 className="line-clamp-1 text-sm font-semibold text-midnight-sky-900">
            {deck.title}
          </h3>
        </button>

        {/* Type chips */}
        {qTypes.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {qTypes.slice(0, 4).map(t => (
              <span key={t} className={cn('rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide', TYPE_COLORS[t] ?? 'bg-midnight-sky-100 text-midnight-sky-500')}>
                {TYPE_LABELS[t] ?? t}
              </span>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-3 flex items-center justify-between border-t border-midnight-sky-50 pt-3">
          <span className="flex items-center gap-1 text-[11px] text-midnight-sky-500">
            <Clock className="size-3" />
            {timeAgo(deck.updatedAt)}
          </span>
          <span className="text-[11px] font-medium text-midnight-sky-500 transition-colors group-hover:text-midnight-sky-800">
            Open
          </span>
        </div>
      </div>
    </motion.div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Empty state
   ───────────────────────────────────────────────────────────────────────── */

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col items-center justify-center py-28 text-center"
    >
      {/* Decorative placeholder cards */}
      <div className="relative mb-10 h-24 w-72">
        {[
          'rotate-[-6deg] translate-x-[-56px] translate-y-2 scale-95',
          'rotate-[4deg] translate-x-[56px] translate-y-3 scale-95',
          'rotate-0 translate-y-0 scale-100 z-10',
        ].map((cls, i) => (
          <div
            key={i}
            className={cn(
              'absolute inset-0 rounded-2xl bg-white shadow-md',
              i < 2 ? 'opacity-50' : 'opacity-100',
              cls,
            )}
          >
            <div className="h-full overflow-hidden rounded-2xl">
              <div className="h-3/5 bg-midnight-sky-900/5" />
              <div className="p-2.5 space-y-1.5">
                <div className="h-2 w-3/4 rounded-full bg-midnight-sky-100" />
                <div className="h-2 w-1/2 rounded-full bg-midnight-sky-50" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <h3 className="text-xl font-bold text-midnight-sky-900">No saved decks yet</h3>
      <p className="mt-2.5 max-w-sm text-sm text-midnight-sky-400">
        Build your first deck with PDF slides and question cards, then save it here to reuse any time.
      </p>
      <motion.button
        onClick={onNew}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        className="mt-8 flex items-center gap-2 rounded-2xl bg-hot-pink px-6 py-3 text-sm font-semibold text-white shadow-[0_4px_24px_-4px] shadow-hot-pink/50"
      >
        <Plus className="size-4" />
        Create my first deck
      </motion.button>
    </motion.div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Loading skeleton grid
   ───────────────────────────────────────────────────────────────────────── */

function LoadingGrid() {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="overflow-hidden rounded-2xl bg-white shadow-[0_2px_12px_-2px_rgba(0,0,121,0.07)]">
          <div className="aspect-video overflow-hidden">
            <div className="h-full w-full animate-[shimmer_1.6s_ease-in-out_infinite] bg-gradient-to-r from-midnight-sky-50 via-white to-midnight-sky-50 bg-[length:400%_100%]" />
          </div>
          <div className="px-4 py-3.5 space-y-2.5">
            <div className="h-3.5 w-3/4 rounded-full bg-midnight-sky-50" />
            <div className="flex gap-1.5">
              <div className="h-2.5 w-10 rounded-full bg-midnight-sky-50" />
              <div className="h-2.5 w-14 rounded-full bg-midnight-sky-50" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Delete confirmation modal
   ───────────────────────────────────────────────────────────────────────── */

function DeleteModal({ onConfirm, onCancel, loading, title, description }: {
  onConfirm:    () => void
  onCancel:     () => void
  loading:      boolean
  title?:       string
  description?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-6"
      onClick={onCancel}
    >
      <motion.div
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.94, opacity: 0 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-3xl bg-white p-7 shadow-2xl"
      >
        <h3 className="text-lg font-semibold text-midnight-sky-900">{title ?? 'Delete this deck?'}</h3>
        <p className="mt-2 text-sm font-light text-midnight-sky-500">
          {description ?? 'This cannot be undone. The deck and all its slides will be permanently removed.'}
        </p>
        <div className="mt-6 flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 rounded-xl border border-midnight-sky-200 py-2.5 text-sm font-medium text-midnight-sky-700 transition hover:bg-midnight-sky-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-medium text-white transition hover:bg-red-600 disabled:opacity-60"
          >
            {loading ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Utilities
   ───────────────────────────────────────────────────────────────────────── */

function timeAgo(ms: number): string {
  const diff  = Date.now() - ms
  const mins  = Math.floor(diff / 60_000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days  = Math.floor(hours / 24)
  if (days < 30)  return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

function ChoiceLoadingDots() {
  return (
    <span className="flex items-center gap-1">
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          className="inline-block size-1.5 rounded-full bg-hot-pink"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
        />
      ))}
    </span>
  )
}

