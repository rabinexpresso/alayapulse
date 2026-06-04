import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BarChart2, Cloud, MessageSquare, Star, Trophy, FileText,
  Check, LogIn, Copy, AlertCircle, Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getSharedDeck, cloudSaveDeck, signInWithGoogle, setStorageBackend,
  auth, onAuthStateChanged,
  type SharedDeck, type Deck, type User,
} from '@/lib/deckStorage'

/* ── Slide type display config ─────────────────────────────────────────── */

const SLIDE_CONFIG: Record<string, {
  Icon:  React.FC<{ className?: string }>
  label: string
  color: string
}> = {
  mcq:         { Icon: BarChart2,    label: 'MCQ',          color: 'text-sky-blue'     },
  wordcloud:   { Icon: Cloud,        label: 'Word Cloud',   color: 'text-fresh-green'  },
  openended:   { Icon: MessageSquare,label: 'Open Ended',   color: 'text-golden-sun'   },
  rating:      { Icon: Star,         label: 'Rating',       color: 'text-hot-pink'     },
  content:     { Icon: FileText,     label: 'Content',      color: 'text-midnight-sky-400' },
  leaderboard: { Icon: Trophy,       label: 'Leaderboard',  color: 'text-golden-sun'   },
}

const CHIP_COLORS: Record<string, string> = {
  mcq:         'bg-sky-blue/10 text-sky-blue',
  wordcloud:   'bg-fresh-green/10 text-fresh-green',
  openended:   'bg-golden-sun/10 text-golden-sun',
  rating:      'bg-hot-pink/10 text-hot-pink',
  content:     'bg-midnight-sky-100 text-midnight-sky-500',
  leaderboard: 'bg-golden-sun/10 text-golden-sun',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSlideText(slide: any): string {
  if (slide.question) return slide.question as string
  if (slide.title)    return slide.title    as string
  return ''
}

/* ─────────────────────────────────────────────────────────────────────────
   Shared deck preview page — /shared/:shareId
   Publicly accessible. Sign-in required to copy.
   ───────────────────────────────────────────────────────────────────────── */

export default function Shared() {
  const { shareId }  = useParams<{ shareId: string }>()
  const navigate     = useNavigate()

  // undefined = still loading | null = not found | SharedDeck = loaded
  const [shared,     setShared]     = useState<SharedDeck | null | undefined>(undefined)
  // undefined = checking auth | null = signed out | User = signed in
  const [user,       setUser]       = useState<User | null | undefined>(undefined)
  const [copyState,  setCopyState]  = useState<'idle' | 'copying' | 'done'>('idle')
  const [copyError,  setCopyError]  = useState<string | null>(null)
  const [signingIn,  setSigningIn]  = useState(false)

  /* Load shared deck */
  useEffect(() => {
    if (!shareId) { setShared(null); return }
    getSharedDeck(shareId)
      .then(s => setShared(s ?? null))
      .catch(() => setShared(null))
  }, [shareId])

  /* Watch auth state */
  useEffect(() => onAuthStateChanged(auth, u => setUser(u)), [])

  /* Sign in */
  const handleSignIn = async () => {
    setSigningIn(true)
    try { await signInWithGoogle() }
    catch { /* user dismissed popup */ }
    finally { setSigningIn(false) }
  }

  /* Copy deck to user's library */
  const handleCopy = async () => {
    if (!shared || !user || copyState !== 'idle') return
    setCopyState('copying')
    setCopyError(null)
    try {
      const uid = () => Math.random().toString(36).slice(2, 10)
      const now = Date.now()
      const newDeck: Deck = {
        id:        uid(),
        title:     shared.title,
        slides:    shared.slides,
        createdAt: now,
        updatedAt: now,
        ...(shared.isQuiz ? { isQuiz: true } : {}),
      }
      await cloudSaveDeck(newDeck)
      setStorageBackend('cloud')   // ensure Decks page shows cloud decks
      setCopyState('done')
      setTimeout(() => navigate('/decks'), 1600)
    } catch (e) {
      console.error('[alaya-pulse] copy shared deck failed:', e)
      setCopyError('Something went wrong — please try again.')
      setCopyState('idle')
    }
  }

  /* ── Loading ──────────────────────────────────────────────────────────── */
  if (shared === undefined || user === undefined) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-white">
        <span className="text-sm font-bold tracking-tight text-midnight-sky-900">
          alaya <span className="text-hot-pink">pulse</span>
        </span>
        <div className="mt-6 flex items-center gap-1.5">
          {[0, 1, 2].map(i => (
            <motion.span
              key={i}
              className="inline-block size-2 rounded-full bg-hot-pink"
              animate={{ opacity: [0.3, 1, 0.3], y: [0, -4, 0] }}
              transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
            />
          ))}
        </div>
      </div>
    )
  }

  /* ── Not found ────────────────────────────────────────────────────────── */
  if (shared === null) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-white px-6 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-midnight-sky-100">
          <AlertCircle className="size-8 text-midnight-sky-400" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold text-midnight-sky-900">Deck not found</h2>
          <p className="mt-2 font-light text-midnight-sky-500">
            This link may have been removed or is no longer available.
          </p>
        </div>
        <a
          href="/"
          className="rounded-xl bg-midnight-sky-100 px-5 py-2.5 text-sm font-medium text-midnight-sky-700 transition hover:bg-midnight-sky-200"
        >
          Go home
        </a>
      </div>
    )
  }

  /* ── Slide list helpers ───────────────────────────────────────────────── */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slides      = shared.slides as any[]
  const PREVIEW_MAX = 6
  const previewSlides = slides.slice(0, PREVIEW_MAX)
  const remaining     = Math.max(0, slides.length - PREVIEW_MAX)

  // Unique interactive types for the chips row
  const INTERACTIVE = new Set(['mcq', 'wordcloud', 'openended', 'rating'])
  const typeSet = [...new Set(slides.map((s: any) => s.type as string).filter(t => INTERACTIVE.has(t)))]

  /* ── Preview page ─────────────────────────────────────────────────────── */
  return (
    <div className="flex min-h-screen flex-col bg-white">

      {/* Header */}
      <header className="flex h-14 shrink-0 items-center border-b border-midnight-sky-100 px-6">
        <span className="text-sm font-bold tracking-tight text-midnight-sky-900">
          alaya <span className="text-hot-pink">pulse</span>
        </span>
      </header>

      {/* Main */}
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-6 py-12">

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col gap-8"
        >
          {/* Shared by */}
          <div className="flex items-center gap-2 text-sm font-light text-midnight-sky-500">
            <span className="flex size-6 items-center justify-center rounded-full bg-midnight-sky-100">
              <Users className="size-3.5 text-midnight-sky-400" />
            </span>
            Shared by <span className="font-medium text-midnight-sky-700">{shared.createdBy}</span>
          </div>

          {/* Deck title + chips */}
          <div>
            <h1 className="text-3xl font-bold leading-tight text-midnight-sky-900 sm:text-4xl">
              {shared.title}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-sm text-midnight-sky-400">{slides.length} slide{slides.length !== 1 ? 's' : ''}</span>
              {typeSet.map(t => (
                <span key={t} className={cn('rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', CHIP_COLORS[t] ?? 'bg-midnight-sky-100 text-midnight-sky-500')}>
                  {SLIDE_CONFIG[t]?.label ?? t}
                </span>
              ))}
            </div>
          </div>

          {/* Slide preview list */}
          <div className="overflow-hidden rounded-2xl border border-midnight-sky-100 bg-midnight-sky-50/50">
            {previewSlides.map((slide: any, i: number) => {
              const cfg  = SLIDE_CONFIG[slide.type as string]
              const Icon = cfg?.Icon ?? FileText
              const text = getSlideText(slide)
              return (
                <div
                  key={i}
                  className={cn(
                    'flex items-start gap-3 px-4 py-3',
                    i !== 0 && 'border-t border-midnight-sky-100',
                  )}
                >
                  <span className={cn('mt-0.5 shrink-0', cfg?.color ?? 'text-midnight-sky-400')}>
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    {text ? (
                      <p className="line-clamp-2 text-sm font-medium text-midnight-sky-800">{text}</p>
                    ) : (
                      <p className="text-sm font-medium text-midnight-sky-400">{cfg?.label ?? slide.type}</p>
                    )}
                  </div>
                  <span className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                    CHIP_COLORS[slide.type as string] ?? 'bg-midnight-sky-100 text-midnight-sky-500',
                  )}>
                    {SLIDE_CONFIG[slide.type as string]?.label ?? slide.type}
                  </span>
                </div>
              )
            })}
            {remaining > 0 && (
              <div className="border-t border-midnight-sky-100 px-4 py-3 text-sm font-light text-midnight-sky-400">
                …and {remaining} more slide{remaining !== 1 ? 's' : ''}
              </div>
            )}
          </div>

          {/* CTA */}
          <div className="flex flex-col gap-3">

            <AnimatePresence mode="wait">

              {/* Done state */}
              {copyState === 'done' && (
                <motion.div
                  key="done"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center justify-center gap-2.5 rounded-2xl bg-fresh-green/10 px-6 py-4 text-sm font-medium text-fresh-green"
                >
                  <Check className="size-4" strokeWidth={2.5} />
                  Deck copied! Taking you to your decks…
                </motion.div>
              )}

              {/* Not signed in */}
              {copyState !== 'done' && !user && (
                <motion.div key="signin" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-3">
                  <p className="text-center text-sm font-light text-midnight-sky-500">
                    Sign in with your Google account to copy this deck to your library.
                  </p>
                  <button
                    onClick={handleSignIn}
                    disabled={signingIn}
                    className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-midnight-sky-900 py-4 text-sm font-semibold text-white transition-all hover:bg-midnight-sky-800 active:scale-[0.98] disabled:opacity-60"
                  >
                    {signingIn ? (
                      <span className="flex items-center gap-1.5">
                        {[0, 1, 2].map(i => (
                          <motion.span key={i} className="inline-block size-1.5 rounded-full bg-white"
                            animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                            transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
                          />
                        ))}
                      </span>
                    ) : (
                      <>
                        <LogIn className="size-4" />
                        Sign in with Google
                      </>
                    )}
                  </button>
                </motion.div>
              )}

              {/* Signed in — copy button */}
              {copyState !== 'done' && user && (
                <motion.div key="copy" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <button
                    onClick={handleCopy}
                    disabled={copyState === 'copying'}
                    className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-hot-pink py-4 text-sm font-semibold text-white shadow-[0_0_24px_-6px] shadow-hot-pink/50 transition-all hover:shadow-[0_0_36px_-4px] hover:shadow-hot-pink/70 active:scale-[0.98] disabled:opacity-70"
                  >
                    {copyState === 'copying' ? (
                      <span className="flex items-center gap-1.5">
                        {[0, 1, 2].map(i => (
                          <motion.span key={i} className="inline-block size-1.5 rounded-full bg-white"
                            animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
                            transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
                          />
                        ))}
                      </span>
                    ) : (
                      <>
                        <Copy className="size-4" />
                        Copy to my decks
                      </>
                    )}
                  </button>
                  <p className="mt-2 text-center text-xs font-light text-midnight-sky-400">
                    You'll get your own editable copy — changes won't affect the original
                  </p>
                </motion.div>
              )}

            </AnimatePresence>

            {/* Error */}
            <AnimatePresence>
              {copyError && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-1.5 text-center text-sm text-red-500"
                >
                  <AlertCircle className="size-4 shrink-0" />
                  {copyError}
                </motion.p>
              )}
            </AnimatePresence>

          </div>
        </motion.div>
      </main>
    </div>
  )
}
