import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Monitor, Cloud, LogOut, Clock, Layers, ArrowRightLeft } from 'lucide-react'
import { AlayaMark } from '@/components/AlayaMark'
import { cn } from '@/lib/utils'
import {
  getStorageBackend, setStorageBackend, clearStorageBackend,
  browserListDecks, browserDeleteDeck,
  cloudListDecks, cloudDeleteDeck,
  signInWithGoogle, signOutUser,
  onAuthStateChanged, auth,
  type StorageBackend, type Deck, type User,
} from '@/lib/deckStorage'

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
      setDecks(list)
    } finally {
      setLoading(false)
    }
  }

  /* ── Storage choice handlers ──────────────────────────────────────────── */

  function handleChooseBrowser() {
    setStorageBackend('browser')
    setBackend('browser')
  }

  async function handleChooseCloud() {
    setSigningIn(true)
    try {
      const u = await signInWithGoogle()
      setStorageBackend('cloud')
      setBackend('cloud')
      setUser(u)
    } catch {
      // user cancelled — no-op
    } finally {
      setSigningIn(false)
    }
  }

  /* ── Sign out / switch storage ───────────────────────────────────────── */

  async function handleSignOut() {
    await signOutUser()
    clearStorageBackend()
    setBackend(null)
    setDecks([])
    setUser(null)
  }

  function handleSwitchStorage() {
    clearStorageBackend()
    setBackend(null)
    setDecks([])
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

  /* ── Open deck in editor ──────────────────────────────────────────────── */

  function handleOpen(deck: Deck) {
    navigate('/create', { state: { deck } })
  }

  /* ── Render ───────────────────────────────────────────────────────────── */

  // No backend chosen yet — show the storage choice screen
  if (!backend) {
    return (
      <StorageChoiceScreen
        signingIn={signingIn}
        onBrowser={handleChooseBrowser}
        onCloud={handleChooseCloud}
      />
    )
  }

  // Cloud chosen but not signed in (e.g. token expired)
  if (backend === 'cloud' && !user && !loading) {
    return (
      <StorageChoiceScreen
        signingIn={signingIn}
        onBrowser={handleChooseBrowser}
        onCloud={handleChooseCloud}
        reauth
      />
    )
  }

  return (
    <main className="min-h-screen" style={{ background: 'oklch(0.972 0.006 258)' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-midnight-sky-100/60 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5">
          <Link to="/"><AlayaMark /></Link>

          <div className="flex items-center gap-2">
            {/* Storage badge */}
            {backend === 'browser' ? (
              <span className="flex items-center gap-1.5 rounded-full border border-midnight-sky-100 bg-white px-3 py-1 text-xs font-medium text-midnight-sky-500">
                <Monitor className="size-3" />
                This browser
              </span>
            ) : user ? (
              <div className="flex items-center gap-2.5 rounded-full border border-midnight-sky-100 bg-white pl-1 pr-3 py-1">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName ?? ''}
                    className="size-6 rounded-full"
                  />
                ) : (
                  <div className="flex size-6 items-center justify-center rounded-full bg-hot-pink/10 text-[10px] font-bold text-hot-pink">
                    {user.displayName?.[0] ?? '?'}
                  </div>
                )}
                <span className="text-xs font-medium text-midnight-sky-700">
                  {user.displayName?.split(' ')[0]}
                </span>
              </div>
            ) : null}

            {/* Change storage option (browser) */}
            {backend === 'browser' && (
              <button
                onClick={handleSwitchStorage}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-midnight-sky-400 transition hover:bg-midnight-sky-50 hover:text-midnight-sky-700"
              >
                <ArrowRightLeft className="size-3" />
                Change
              </button>
            )}

            {/* Sign out (cloud only) */}
            {backend === 'cloud' && user && (
              <button
                onClick={handleSignOut}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-midnight-sky-400 transition hover:bg-midnight-sky-50 hover:text-midnight-sky-700"
              >
                <LogOut className="size-3" />
                Sign out
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Page body ───────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-6xl px-6 pb-16 pt-10">

        {/* Title row */}
        <div className="mb-10 flex items-end justify-between">
          <div>
            <h1 className="text-[2rem] font-bold tracking-tight text-midnight-sky-900">My Decks</h1>
            <p className="mt-1 text-sm text-midnight-sky-400">
              {loading ? 'Loading…' : decks.length > 0
                ? `${decks.length} saved ${decks.length === 1 ? 'deck' : 'decks'}`
                : 'Your saved presentations'}
            </p>
          </div>

          <motion.button
            onClick={() => navigate('/create')}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            className="flex items-center gap-2 rounded-2xl bg-hot-pink px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_24px_-4px] shadow-hot-pink/50 transition-shadow hover:shadow-[0_4px_32px_-2px] hover:shadow-hot-pink/60"
          >
            <Plus className="size-4" />
            New deck
          </motion.button>
        </div>

        {/* Deck grid / empty / loading */}
        {loading ? (
          <LoadingGrid />
        ) : decks.length === 0 ? (
          <EmptyState onNew={() => navigate('/create')} />
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          >
            {decks.map((deck, i) => (
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
                />
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      {/* ── Delete confirm modal ─────────────────────────────────────────── */}
      <AnimatePresence>
        {confirmDelete && (
          <DeleteModal
            loading={deleting}
            onConfirm={() => handleDelete(confirmDelete)}
            onCancel={() => setConfirmDelete(null)}
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
  onBrowser, onCloud, signingIn, reauth = false,
}: {
  onBrowser:  () => void
  onCloud:    () => void
  signingIn:  boolean
  reauth?:    boolean
}) {
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
                No login needed. Decks are saved instantly on this device only.
              </p>
            </div>
            <div className="mt-auto rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Clearing browser data will delete your decks
            </div>
          </motion.button>

          {/* Google option */}
          <motion.button
            onClick={onCloud}
            disabled={signingIn}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            className="group flex flex-col gap-4 rounded-3xl border-2 border-hot-pink/30 bg-hot-pink/[0.03] p-7 text-left transition-all hover:border-hot-pink/60 hover:shadow-lg disabled:opacity-70"
          >
            <div className="flex size-12 items-center justify-center rounded-2xl bg-hot-pink/10 transition group-hover:bg-hot-pink/15">
              {signingIn ? (
                <ChoiceLoadingDots />
              ) : (
                <Cloud className="size-6 text-hot-pink" />
              )}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-midnight-sky-900">Sign in with Google</h3>
              <p className="mt-1 text-sm font-light leading-relaxed text-midnight-sky-500">
                Decks are saved to your Google account. Access from any device, any time.
              </p>
            </div>
            <div className="mt-auto rounded-xl bg-green-50 px-3 py-2 text-xs text-green-700">
              Safe even if you clear your browser or change devices
            </div>
          </motion.button>
        </div>

        <p className="mt-8 text-center text-xs text-midnight-sky-400">
          Both options are free. PDF slide images are only saved in the browser option.
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

function DeckCard({ deck, onOpen, onDelete }: {
  deck:     Deck
  onOpen:   () => void
  onDelete: () => void
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slides     = deck.slides as any[]
  const pdfSlides  = slides.filter(s => s.type === 'pdf')
  const qSlides    = slides.filter(s => s.type !== 'pdf')
  const firstPdf   = pdfSlides[0]
  const qTypes     = [...new Set(qSlides.map(s => s.type as string))]
  const slideCount = slides.length

  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="group flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_2px_12px_-2px_rgba(0,0,121,0.08)] hover:shadow-[0_12px_40px_-8px_rgba(0,0,121,0.18)]"
      style={{ transition: 'box-shadow 0.2s ease' }}
    >
      {/* Thumbnail */}
      <button
        onClick={onOpen}
        className="relative aspect-video w-full overflow-hidden bg-midnight-sky-900"
      >
        {firstPdf?.imgUrl ? (
          <img
            src={firstPdf.imgUrl}
            alt="Deck preview"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4">
            <Layers className="size-8 text-white/20" />
            <div className="flex flex-wrap justify-center gap-1">
              {qTypes.slice(0, 3).map(t => (
                <span key={t} className={cn('rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide', TYPE_COLORS[t] ?? 'bg-white/10 text-white/50')}>
                  {TYPE_LABELS[t] ?? t}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-midnight-sky-900/0 transition-all duration-300 group-hover:bg-midnight-sky-900/40">
          <span className="translate-y-2 rounded-xl bg-white px-4 py-2 text-xs font-semibold text-midnight-sky-900 opacity-0 shadow-lg transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
            Open deck
          </span>
        </div>

        {/* Slide count badge */}
        <span className="absolute left-2.5 top-2.5 rounded-lg bg-black/40 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          {slideCount} {slideCount === 1 ? 'slide' : 'slides'}
        </span>

        {/* Delete button — top right, only on hover */}
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="absolute right-2.5 top-2.5 flex size-6 items-center justify-center rounded-lg bg-black/40 text-white/60 opacity-0 backdrop-blur-sm transition-all duration-200 hover:bg-red-500/80 hover:text-white group-hover:opacity-100"
        >
          <Trash2 className="size-3" />
        </button>
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
          <span className="flex items-center gap-1 text-[11px] text-midnight-sky-300">
            <Clock className="size-3" />
            {timeAgo(deck.updatedAt)}
          </span>
          <button
            onClick={onOpen}
            className="rounded-lg px-2.5 py-1 text-xs font-semibold text-midnight-sky-500 transition hover:bg-midnight-sky-50 hover:text-midnight-sky-900"
          >
            Open
          </button>
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

function DeleteModal({ onConfirm, onCancel, loading }: {
  onConfirm: () => void
  onCancel:  () => void
  loading:   boolean
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
        <h3 className="text-lg font-semibold text-midnight-sky-900">Delete this deck?</h3>
        <p className="mt-2 text-sm font-light text-midnight-sky-500">
          This cannot be undone. The deck and all its slides will be permanently removed.
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

