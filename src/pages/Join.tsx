import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { getSessionByCode } from '@/lib/session'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertCircle } from 'lucide-react'
import { AlayaMark } from '@/components/AlayaMark'
import { cn } from '@/lib/utils'

/* ─────────────────────────────────────────────────────────────────────────
   Audience join screen — light theme, mobile-first.
   Audience types the 6-character session code shown on the presenter's screen.
   Optional name entry below (presenter can toggle to required per session).
   ───────────────────────────────────────────────────────────────────────── */

const CODE_LENGTH = 6

/* ── Emoji avatar picker ─────────────────────────────────────────────────── */

const EMOJI_CATEGORIES = {
  faces:      ['😎','🤩','🥳','😏','🤓','🤠','🫡','😤','🥸','😇','🤑','🤯','🥶','🤫','🫠'],
  animals:    ['🦁','🐯','🦊','🦝','🦅','🐬','🦈','🐉','🦋','🐺','🦄','🦓','🐸','🐧','🦉','🦩','🐙','🦑','🐊','🦀','🐆','🦏'],
  characters: ['🧙','🦸','🥷','🤴','👸','🧑‍🎤','🧑‍🚀','🧑‍🍳','🧑‍💻','🕵️','🧝','🧛','🤺','🧑‍🎨','🧑‍🔬','🧑‍🏫','🧑‍⚖️','🎅','🧑‍🌾','🧑‍🚒','🫅','🧑‍✈️'],
  nature:     ['🔥','🌊','⚡','🌙','⭐','🌈','☀️','💎','🌸','🍀','🌋','🫧','🌺','🌵','🍄','🪐'],
  food:       ['🍕','🍔','🌮','🍜','🍣','🍰','🍩','🍦','🍎','🥑','🌶️','🧀','🍟','🍱','🥗','🍫'],
  sports:     ['⚽','🏀','🎾','🏊','🏋️','⛷️','🤸','🎮','🎲','🏆','🎯','🚴','🏄','🥊','🏇','🧗'],
  arts:       ['🎨','🎭','🎸','🎵','🎤','🎬','📸','🎻','🥁','🎹','🖌️','✏️','📚','🎪','🎡','🎠'],
  travel:     ['✈️','🌍','🏖️','🏔️','🌴','🗺️','🚢','🏕️','🗼','🏙️','🚂','🌅','🗽','🏯','🎑','🏝️'],
} as const

type EmojiCat = keyof typeof EMOJI_CATEGORIES

const ALL_EMOJIS: string[] = (Object.values(EMOJI_CATEGORIES) as unknown as string[][]).flat()

const CATEGORY_META: { key: EmojiCat; label: string; icon: string }[] = [
  { key: 'faces',      label: 'Faces',      icon: '😎' },
  { key: 'animals',    label: 'Animals',    icon: '🦁' },
  { key: 'characters', label: 'Characters', icon: '🧙' },
  { key: 'nature',     label: 'Nature',     icon: '🔥' },
  { key: 'food',       label: 'Food',       icon: '🍕' },
  { key: 'sports',     label: 'Sports',     icon: '⚽' },
  { key: 'arts',       label: 'Arts',       icon: '🎨' },
  { key: 'travel',     label: 'Travel',     icon: '✈️' },
]

export default function Join() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [code, setCode] = useState<string[]>(Array(CODE_LENGTH).fill(''))
  const [name, setName] = useState('')
  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(null)
  const [activeCat, setActiveCat] = useState<EmojiCat>('animals')
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const inputRefs   = useRef<(HTMLInputElement | null)[]>(Array(CODE_LENGTH).fill(null))
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  // Track whether this is the first render so we don't steal focus on prefill
  const mountedRef  = useRef(false)

  // Pre-fill code from URL query param e.g. /join?code=ABC123
  useEffect(() => {
    const prefill = searchParams.get('code')?.toUpperCase().replace(/[^A-Z0-9]/g, '') ?? ''
    if (prefill.length > 0) {
      const chars = prefill.slice(0, CODE_LENGTH).split('')
      const filled = [...chars, ...Array(CODE_LENGTH - chars.length).fill('')]
      setCode(filled)
      // Focus the first empty box or the last one if all filled
      const focusIdx = Math.min(chars.length, CODE_LENGTH - 1)
      setTimeout(() => inputRefs.current[focusIdx]?.focus(), 80)
    } else {
      // Auto-focus first box on mount
      setTimeout(() => inputRefs.current[0]?.focus(), 80)
    }
  }, [searchParams])

  const updateCode = useCallback((idx: number, val: string) => {
    setCode(prev => {
      const next = [...prev]
      next[idx] = val.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-1)
      return next
    })
    setStatus('idle')
    setErrorMsg('')
  }, [])

  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (code[idx]) {
        updateCode(idx, '')
      } else if (idx > 0) {
        inputRefs.current[idx - 1]?.focus()
        updateCode(idx - 1, '')
      }
      return
    }
    if (e.key === 'ArrowLeft' && idx > 0) {
      inputRefs.current[idx - 1]?.focus()
      return
    }
    if (e.key === 'ArrowRight' && idx < CODE_LENGTH - 1) {
      inputRefs.current[idx + 1]?.focus()
    }
  }

  const handleChange = (idx: number, val: string) => {
    const cleaned = val.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!cleaned) { updateCode(idx, ''); return }
    updateCode(idx, cleaned)
    // Advance focus
    if (cleaned && idx < CODE_LENGTH - 1) {
      inputRefs.current[idx + 1]?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pasted = e.clipboardData
      .getData('text')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, CODE_LENGTH)
    const chars = pasted.split('')
    const filled = [...chars, ...Array(CODE_LENGTH - chars.length).fill('')]
    setCode(filled)
    setStatus('idle')
    setErrorMsg('')
    const focusIdx = Math.min(chars.length, CODE_LENGTH - 1)
    inputRefs.current[focusIdx]?.focus()
  }

  const codeComplete = code.every(c => c !== '')

  // When user finishes typing all 6 chars, move focus to the name field
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return }
    if (codeComplete) nameInputRef.current?.focus()
  }, [codeComplete])

  const handleJoin = async () => {
    if (!codeComplete) return
    setStatus('loading')
    const sessionCode = code.join('')
    const emoji = selectedEmoji ?? ALL_EMOJIS[Math.floor(Math.random() * ALL_EMOJIS.length)]
    // Persist the assigned emoji so Vote.tsx can recover it even if the URL param is lost
    try { sessionStorage.setItem('alaya-viewer-emoji', emoji) } catch {}

    try {
      const session = await getSessionByCode(sessionCode)
      if (!session) {
        setStatus('error')
        setErrorMsg("Session not found. Double-check the code on the presenter's screen.")
        return
      }
      if (session.status === 'ended') {
        setStatus('error')
        setErrorMsg('This session has already ended.')
        return
      }
      setStatus('idle')
      const params = new URLSearchParams({ emoji })
      if (name) params.set('name', name)
      navigate(`/vote/${session.code}?${params}`)
    } catch {
      setStatus('error')
      setErrorMsg('Something went wrong — please try again.')
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-white">
      {/* Nav */}
      <header className="shrink-0 px-6 py-5 sm:px-10">
        <Link to="/">
          <AlayaMark />
        </Link>
      </header>

      {/* Form area — centred, takes remaining height */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-16 sm:px-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-sm"
        >
          {/* Heading */}
          <div className="mb-10 text-center">
            <h1 className="text-3xl font-semibold tracking-tight text-midnight-sky-900 sm:text-4xl">
              Join the show
            </h1>
            <p className="mt-2 text-base font-light text-midnight-sky-600">
              Enter the code shown on the screen
            </p>
          </div>

          {/* 6-box code input */}
          <CodeInput
            code={code}
            inputRefs={inputRefs}
            onKeyDown={handleKeyDown}
            onChange={handleChange}
            onPaste={handlePaste}
            disabled={status === 'loading'}
          />

          {/* Error message */}
          <AnimatePresence>
            {status === 'error' && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25 }}
                className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{errorMsg}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Name field */}
          <div className="mt-6">
            <label
              htmlFor="join-name"
              className="mb-1.5 block text-sm font-medium text-midnight-sky-800"
            >
              Your name
            </label>
            <input
              id="join-name"
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && codeComplete && handleJoin()}
              placeholder="Leave blank to stay anonymous"
              maxLength={40}
              disabled={status === 'loading'}
              className={cn(
                'w-full rounded-2xl border border-midnight-sky-300 bg-white px-4 py-3.5 text-base text-midnight-sky-900 placeholder:text-midnight-sky-500',
                'outline-none transition-all duration-150',
                'focus:border-hot-pink focus:ring-2 focus:ring-hot-pink/20',
                'disabled:opacity-50',
              )}
            />
          </div>

          {/* Emoji avatar picker */}
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-midnight-sky-800">
                Pick your avatar
                <span className="ml-1 font-light text-midnight-sky-500">(optional)</span>
              </label>
              {selectedEmoji && (
                <span className="flex size-9 items-center justify-center rounded-full border border-hot-pink/40 bg-hot-pink/5 text-lg leading-none">
                  {selectedEmoji}
                </span>
              )}
            </div>

            {/* Category tabs — 2 rows × 4 columns grid, no scrolling */}
            <div className="mb-2 grid grid-cols-4 gap-1.5">
              {CATEGORY_META.map(cat => (
                <button
                  key={cat.key}
                  onClick={() => setActiveCat(cat.key)}
                  className={cn(
                    'flex flex-col items-center justify-center gap-0.5 rounded-xl border py-2 text-xs font-semibold transition-all',
                    activeCat === cat.key
                      ? 'border-hot-pink bg-hot-pink/8 text-hot-pink'
                      : 'border-midnight-sky-200 bg-midnight-sky-50 text-midnight-sky-500 hover:border-midnight-sky-300 hover:text-midnight-sky-700',
                  )}
                >
                  <span className="text-base leading-none">{cat.icon}</span>
                  <span className="text-[10px] leading-tight">{cat.label}</span>
                </button>
              ))}
            </div>

            {/* Emoji grid */}
            <div className="max-h-[180px] overflow-y-auto rounded-2xl border border-midnight-sky-200 bg-midnight-sky-50 p-2.5 [scrollbar-width:thin]">
              <div className="grid grid-cols-7 gap-1">
                {EMOJI_CATEGORIES[activeCat].map(emoji => (
                  <motion.button
                    key={emoji}
                    onClick={() => setSelectedEmoji(emoji === selectedEmoji ? null : emoji)}
                    whileTap={{ scale: 0.85 }}
                    animate={selectedEmoji === emoji ? { scale: [1, 1.15, 1] } : {}}
                    transition={{ duration: 0.2, ease: [0.34, 1.56, 0.64, 1] }}
                    className={cn(
                      'flex aspect-square items-center justify-center rounded-xl border-2 text-2xl leading-none transition-all',
                      selectedEmoji === emoji
                        ? 'border-hot-pink bg-hot-pink/8'
                        : 'border-transparent hover:bg-midnight-sky-100',
                    )}
                  >
                    {emoji}
                  </motion.button>
                ))}
              </div>
            </div>
            <p className="mt-1.5 text-center text-[11px] text-midnight-sky-600">
              No preference? We'll pick one for you.
            </p>
          </div>

          {/* Join button */}
          <motion.button
            onClick={handleJoin}
            disabled={!codeComplete || status === 'loading'}
            whileTap={codeComplete ? { scale: 0.97 } : {}}
            className={cn(
              'mt-5 flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-4 text-base font-medium text-white transition-all duration-200',
              codeComplete
                ? 'bg-hot-pink shadow-[0_0_24px_-6px] shadow-hot-pink/50 hover:shadow-[0_0_32px_-4px] hover:shadow-hot-pink/70'
                : 'bg-midnight-sky-300 cursor-not-allowed',
            )}
          >
            {status === 'loading' ? (
              <LoadingDots />
            ) : (
              'Join session'
            )}
          </motion.button>

          {/* Hint */}
          <p className="mt-6 text-center text-xs text-midnight-sky-600">
            No account needed · Your responses can be anonymous
          </p>
        </motion.div>
      </div>
    </main>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Code input — 6 individual boxes
   ───────────────────────────────────────────────────────────────────────── */

function CodeInput({
  code,
  inputRefs,
  onKeyDown,
  onChange,
  onPaste,
  disabled,
}: {
  code: string[]
  inputRefs: React.MutableRefObject<(HTMLInputElement | null)[]>
  onKeyDown: (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => void
  onChange: (idx: number, val: string) => void
  onPaste: (e: React.ClipboardEvent) => void
  disabled: boolean
}) {
  return (
    <div className="flex justify-center gap-2.5 sm:gap-3" onPaste={onPaste}>
      {code.map((char, i) => (
        <CodeBox
          key={i}
          value={char}
          inputRef={el => { inputRefs.current[i] = el }}
          onKeyDown={e => onKeyDown(i, e)}
          onChange={val => onChange(i, val)}
          disabled={disabled}
        />
      ))}
    </div>
  )
}

function CodeBox({
  value,
  inputRef,
  onKeyDown,
  onChange,
  disabled,
}: {
  value: string
  inputRef: React.RefCallback<HTMLInputElement>
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onChange: (val: string) => void
  disabled: boolean
}) {
  const filled = value !== ''

  return (
    <motion.div
      animate={filled ? { scale: [1, 1.12, 1] } : { scale: 1 }}
      transition={{ duration: 0.25, ease: [0.34, 1.56, 0.64, 1] }}
      className="relative"
    >
      <input
        ref={inputRef}
        type="text"
        inputMode="text"
        autoComplete="off"
        maxLength={2}
        value={value}
        disabled={disabled}
        onKeyDown={onKeyDown}
        onChange={e => onChange(e.target.value)}
        onFocus={e => e.target.select()}
        className={cn(
          'h-14 w-11 rounded-xl border-2 text-center text-xl font-semibold uppercase tracking-widest text-midnight-sky-900 outline-none transition-all duration-150 sm:h-16 sm:w-13',
          filled
            ? 'border-hot-pink bg-hot-pink/5 text-hot-pink shadow-[0_0_12px_-3px] shadow-hot-pink/30'
            : 'border-midnight-sky-200 bg-midnight-sky-50 focus:border-hot-pink focus:bg-white focus:shadow-[0_0_0_3px] focus:shadow-hot-pink/15',
          disabled && 'opacity-60',
        )}
      />
    </motion.div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Loading indicator — three animated dots
   ───────────────────────────────────────────────────────────────────────── */

function LoadingDots() {
  return (
    <span className="flex items-center gap-1">
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          className="inline-block size-1.5 rounded-full bg-white"
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
          transition={{
            duration: 0.8,
            repeat: Infinity,
            delay: i * 0.15,
            ease: 'easeInOut',
          }}
        />
      ))}
    </span>
  )
}
