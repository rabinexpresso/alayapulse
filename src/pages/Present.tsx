import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { PersistentHtmlIframe } from '@/components/PersistentHtmlIframe'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, ChevronRight, X,
  BarChart2, ChevronDown, ChevronUp, Clock,
  Eye, EyeOff, Pin, Check, RotateCcw, Trophy, Crown,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { cn } from '@/lib/utils'
import {
  updateSessionState, endSession, subscribeToSlideResponses, subscribeToViewerCount, subscribeToViewers,
  fetchAllSessionResponses, getSessionByCode, startTimer, clearTimer, resetSlideAndTimer, updateQuestionMeta,
  subscribeToReactions, deleteReaction,
  type Response as FirestoreResponse, type Reaction, type ReactionType,
} from '@/lib/session'

/* ── Shared reaction config (icons + brand colours) ──────────────────── */
const REACTION_CONFIG: { type: ReactionType; emoji: string }[] = [
  { type: 'heart',    emoji: '❤️'  },
  { type: 'mindblown',emoji: '🤯'  },
  { type: 'haha',     emoji: '😂'  },
  { type: 'wow',      emoji: '😮'  },
  { type: 'thinking', emoji: '🤔'  },
]
import type {
  DeckResults, ResultQuestion, ResultQuestionType, ResultResponse,
} from '@/lib/deckStorage'

/* ─────────────────────────────────────────────────────────────────────────
   Presenter full-screen slideshow mode.

   Flow per question slide:
     ① Question phase  — question text + options visible, votes collecting
     ② Results phase   — live animated results (Space / → to advance)

   Keyboard nav:
     → / Space   = next (or reveal results)
     ←           = prev (or hide results)
     Escape       = exit to /create
   ───────────────────────────────────────────────────────────────────────── */

// ── Types ─────────────────────────────────────────────────────────────────

type QType      = 'mcq' | 'wordcloud' | 'openended' | 'rating'
type SlidePhase = 'question' | 'results'

interface PdfSlide {
  id:        string
  type:      'pdf'
  pageNum?:  number
  imgUrl?:   string   // real slides (passed via router state)
  title?:    string   // demo fallback
  subtitle?: string   // demo fallback
}

interface ContentSlide {
  id:          string
  type:        'content'
  template:    'heading' | 'bullets' | 'quote'
  title:       string
  body:        string
  attribution: string
  theme:       string
  imgUrl?:     string
  imgLayout?:  'top' | 'right' | 'background' | 'reference'
}

interface ImageSlide {
  id:       string
  type:     'image'
  imgUrl:   string
  fileName: string
}

interface VideoSlide {
  id:        string
  type:      'video'
  videoUrl:  string
  videoType: string
  fileName:  string
}

interface HtmlSlide {
  id:          string
  type:        'html'
  html:        string
  fileName:    string
  /** 0-based index of which internal slide to jump to via hash navigation (#/N). */
  slideIndex?: number
  slideTotal?: number
}

interface QSlide {
  id:           string
  type:         QType
  question:     string
  options:      string[]
  vizType?:     'bar' | 'pie' | 'donut'
  ratingMax?:   5 | 10
  /** Per-parameter scale labels (parallel to options). */
  leftLabels?:  string[]
  rightLabels?: string[]
  /** @deprecated slide-wide fallback. */
  leftLabel?:   string
  rightLabel?:  string
  theme?:       string
  imgUrl?:      string
  imgLayout?:   'top' | 'right' | 'background' | 'reference'
  /** MCQ only — 0-based indices of correct options (supports multiple). */
  correctAnswers?: number[]
  /** MCQ only — countdown timer in seconds; auto-starts when presenter reaches this slide. */
  timer?: number
  /** MCQ only — optional plain-text explanation shown on the big screen when the answer is revealed. */
  explanation?: string
  /** Word Cloud only — max submissions per person. */
  wcMaxSubmissions?: number
  /** Open Ended only — max responses per person. Default 1. */
  oeMaxSubmissions?: number
}

interface CanvasBg     { type: 'color' | 'gradient' | 'image'; value: string }
interface CanvasBaseEl { id: string; kind: 'text' | 'table' | 'image'; x: number; y: number; w: number; h: number }
interface CanvasTextEl extends CanvasBaseEl { kind: 'text'; html: string; fontSize: number; align: 'left' | 'center' | 'right'; color: string }
interface CanvasTableEl extends CanvasBaseEl {
  kind: 'table'; rows: number; cols: number
  cells: string[]          // flat: index = ri * cols + ci (may arrive as string[][] from old data)
  hasHeader: boolean
  cellColors?: (string | null)[]
  borderColor?: string
  borderStyle?: 'solid' | 'dashed' | 'none'
}
interface CanvasImageEl extends CanvasBaseEl { kind: 'image'; imgUrl: string; objectFit: 'cover' | 'contain' }
type CanvasEl = CanvasTextEl | CanvasTableEl | CanvasImageEl
interface CanvasSlide  { id: string; type: 'canvas'; bg: CanvasBg; elements: CanvasEl[] }
interface LeaderboardSlide { id: string; type: 'leaderboard'; bg?: { type: 'color' | 'gradient' | 'image'; value: string } }

type AnySlide = PdfSlide | ContentSlide | ImageSlide | VideoSlide | HtmlSlide | QSlide | CanvasSlide | LeaderboardSlide

// ── Demo deck — used when navigating directly to /present ─────────────────

const DEMO_DECK: AnySlide[] = [
  { id: 's1', type: 'pdf',       title: 'Leadership Pulse Check',             subtitle: 'Q3 All-Hands · Alaya' },
  { id: 's2', type: 'mcq',       question: 'What is your biggest leadership challenge right now?',
    options: ['Giving honest feedback', 'Managing team conflict', 'Building trust quickly', 'Motivating others'] },
  { id: 's3', type: 'pdf',       title: "Let's check in on culture",           subtitle: 'One word from everyone in the room' },
  { id: 's4', type: 'wordcloud', question: 'In one word — how would you describe our team culture right now?', options: [] },
  { id: 's5', type: 'openended', question: 'What one change would make the biggest difference to your team in the next 90 days?', options: [] },
  { id: 's6', type: 'rating',    question: 'Rate your confidence in these leadership areas:',
    options: ['Giving feedback', 'Decision making', 'Coaching others'] },
]

// ── Demo results data ──────────────────────────────────────────────────────

const DEMO_MCQ_VOTES   = [19, 12, 10, 6]
const DEMO_CLOUD_WORDS = [
  { text: 'collaborative', count: 18 }, { text: 'innovative',  count: 12 },
  { text: 'challenging',   count: 14 }, { text: 'growth',      count: 10 },
  { text: 'busy',          count: 15 }, { text: 'focused',     count:  9 },
  { text: 'exciting',      count:  7 }, { text: 'trust',       count: 13 },
  { text: 'creative',      count:  8 }, { text: 'driven',      count:  6 },
  { text: 'dynamic',       count: 11 }, { text: 'supportive',  count:  7 },
]
const DEMO_OPEN_ANSWERS = [
  { name: 'Sarah M.',   text: 'More time for strategic thinking instead of back-to-back meetings.' },
  { name: 'Anonymous',  text: "A clear framework for giving feedback that doesn't feel personal." },
  { name: 'James T.',   text: 'Better tools for async communication across time zones.' },
  { name: 'Anonymous',  text: 'Regular 1:1s with clear agendas so nothing falls through the cracks.' },
  { name: 'Priya K.',   text: 'Psychological safety to try new ideas without fear of failure.' },
]
const DEMO_RATING_AVGS = [4.2, 3.8, 4.6]
// Distribution per parameter: [1★ count, 2★ count, 3★ count, 4★ count, 5★ count]
const DEMO_RATING_DIST = [
  [0, 1, 3, 8,  9],  // Giving feedback   — skews high
  [1, 2, 5, 6,  6],  // Decision making   — spread
  [0, 0, 1, 5, 14],  // Coaching others   — mostly 5★
]

// ── Response aggregators ───────────────────────────────────────────────────

function aggregateMCQ(responses: FirestoreResponse[], count: number): number[] {
  const votes = Array(count).fill(0)
  responses.forEach(r => {
    // Multi-select responses are stored as JSON arrays "[0,2]"; legacy single-select as "2"
    let indices: number[]
    try {
      const parsed = JSON.parse(r.value)
      indices = Array.isArray(parsed) ? parsed as number[] : [parseInt(r.value, 10)]
    } catch {
      indices = [parseInt(r.value, 10)]
    }
    indices.forEach(i => {
      if (!isNaN(i) && i >= 0 && i < count) votes[i]++
    })
  })
  return votes
}

function aggregateCloud(responses: FirestoreResponse[]): { text: string; count: number }[] {
  const freq = new Map<string, number>()
  responses.forEach(r => {
    const w = r.value.trim().toLowerCase()
    if (w) freq.set(w, (freq.get(w) ?? 0) + 1)
  })
  return Array.from(freq.entries())
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count)
}

function aggregateOpen(responses: FirestoreResponse[]): { name: string; text: string }[] {
  return [...responses]
    .reverse()
    .map(r => ({ name: r.respondentName || 'Anonymous', text: r.value }))
}

function aggregateRating(responses: FirestoreResponse[], count: number): number[] {
  const sums = Array(count).fill(0)
  const cnts = Array(count).fill(0)
  responses.forEach(r => {
    try {
      const arr = JSON.parse(r.value) as number[]
      arr.forEach((v, i) => {
        if (i < count && typeof v === 'number') { sums[i] += v; cnts[i]++ }
      })
    } catch { /* skip invalid */ }
  })
  return sums.map((s, i) => (cnts[i] > 0 ? s / cnts[i] : 0))
}

/** Returns dist[paramIdx][bucket] where bucket 0..N maps to value 0..N
 *  (scale is now 0..ratingMax inclusive, so bucket count = ratingMax + 1). */
function aggregateRatingDistribution(responses: FirestoreResponse[], paramCount: number, ratingMax: number = 5): number[][] {
  const buckets = ratingMax + 1
  const dist = Array.from({ length: paramCount }, () => Array(buckets).fill(0))
  responses.forEach(r => {
    try {
      const arr = JSON.parse(r.value) as number[]
      arr.forEach((v, i) => {
        if (i < paramCount && v >= 0 && v <= ratingMax) {
          dist[i][v]++
        }
      })
    } catch { /* skip invalid */ }
  })
  return dist
}

// ── Transition variants ────────────────────────────────────────────────────

const slideVariants = {
  enter: ({ dir, type }: { dir: number; type: 'slide' | 'phase' }) => ({
    opacity: 0,
    x: type === 'slide' ? (dir > 0 ? 60 : -60) : 0,
    y: type === 'phase' ? (dir > 0 ? 24 : -24) : 0,
    scale: type === 'phase' ? 0.97 : 1,
  }),
  center: { opacity: 1, x: 0, y: 0, scale: 1 },
  exit: ({ dir, type }: { dir: number; type: 'slide' | 'phase' }) => ({
    opacity: 0,
    x: type === 'slide' ? (dir > 0 ? -60 : 60) : 0,
    y: type === 'phase' ? (dir > 0 ? -24 : 24) : 0,
    scale: type === 'phase' ? 0.97 : 1,
  }),
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function Present() {
  const { sessionId } = useParams()
  const navigate      = useNavigate()
  const location      = useLocation()

  // Real slides come from Create.tsx via router state (includes imgUrls).
  // Falls back to DEMO_DECK if opened directly (e.g. /present/ABCDEF refresh).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const locationState  = (location.state as any) ?? {}
  const stateSlides: AnySlide[] | undefined = locationState.slides
  const stateDeckTitle: string | undefined  = locationState.deckTitle
  const stateDeckId: string | undefined     = locationState.deckId
  const isRealSession = !!stateSlides
  const isQuiz: boolean = locationState.isQuiz ?? false
  const deck          = stateSlides ?? DEMO_DECK
  // Honour the slide selected in the editor when session starts
  const startSlide: number = Math.min(locationState.startSlide ?? 0, (stateSlides ?? DEMO_DECK).length - 1)

  const [current,   setCurrent]   = useState(startSlide)
  const [direction, setDirection] = useState(1)
  const [transType, setTransType] = useState<'slide' | 'phase'>('slide')
  const [phase,     setPhase]     = useState<SlidePhase>('question')
  const [responses,       setResponses]       = useState<FirestoreResponse[]>([])
  const [viewerCount,     setViewerCount]     = useState(0)
  const [showExitConfirm,   setShowExitConfirm]   = useState(false)
  const [showQRModal,       setShowQRModal]       = useState(false)
  const [showHUD,           setShowHUD]           = useState(true)
  const [showingWaitingRoom, setShowingWaitingRoom] = useState(isRealSession && startSlide === 0)
  const [hasStarted,         setHasStarted]         = useState(startSlide > 0)
  const [viewers,            setViewers]            = useState<{ id: string; name: string; emoji: string }[]>([])
  // Results capture — track peak viewer count + session start time so we
  // can build a complete DeckResults snapshot when the presenter ends
  // the session and hands it back to the editor for save.
  const peakViewerRef     = useRef(0)
  const sessionStartedAt  = useRef<number>(Date.now())
  const questionMetaRef   = useRef<Record<string, { openedAt: number; duration: number | null }>>({})
  // Ref to current slide so handleStartTimer can scope questionMeta updates to the active slide only
  const slideRef          = useRef<AnySlide | null>(null)

  // ── Question timer ─────────────────────────────────────────────────────
  const [timerEndsAt,   setTimerEndsAt]   = useState<number | null>(null)
  const [timerDuration, setTimerDuration] = useState<number | null>(null)
  const [showTimerMenu,    setShowTimerMenu]    = useState(false)
  // ── Re-vote / Reset ────────────────────────────────────────────────────
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [isResetting,      setIsResetting]      = useState(false)
  // ── Reactions ──────────────────────────────────────────────────────────
  const [particles,        setParticles]        = useState<Reaction[]>([])
  const mountTimeRef       = useRef(Date.now())
  // Refs so callbacks always read current values without stale closures.
  // isQuestion/code are not yet computed at this point — initialised with dummies,
  // then kept in sync via useEffects further down (after those values are computed).
  const phaseRef               = useRef(phase)
  const isQuestionRef          = useRef(false)           // dummy init — synced below
  const isRealSessionRef       = useRef(isRealSession)
  const codeRef                = useRef('')              // dummy init — synced below
  const showingWaitingRoomRef  = useRef(isRealSession && startSlide === 0)  // synced below

  const slide      = deck[current] as AnySlide
  const isQuestion = slide.type !== 'pdf' && slide.type !== 'image' && slide.type !== 'video' && slide.type !== 'content' && slide.type !== 'canvas' && slide.type !== 'html' && slide.type !== 'leaderboard'
  const code       = (sessionId ?? 'DEMO').slice(0, 6).toUpperCase()
  const joinUrl    = `${window.location.origin}/join?code=${code}`

  // Keep timer refs in sync (these must come after isQuestion / code are computed)
  useEffect(() => { phaseRef.current = phase },                           [phase])
  useEffect(() => { isQuestionRef.current = isQuestion },                 [isQuestion])
  useEffect(() => { isRealSessionRef.current = isRealSession },           [isRealSession])
  useEffect(() => { codeRef.current = code },                             [code])
  useEffect(() => { slideRef.current = slide },                           [slide])
  useEffect(() => { showingWaitingRoomRef.current = showingWaitingRoom }, [showingWaitingRoom])

  // ── Sync presenter state to Firestore so audience knows current slide ──
  useEffect(() => {
    if (!isRealSession) return
    // inLobby is true only before the show has ever started (not when going back)
    const inLobby = showingWaitingRoom && !hasStarted
    updateSessionState(code, current, phase, inLobby).catch(console.error)
    // Record when each quiz question opens so audience can calculate speed points
    if (isQuiz && isQuestion && phase === 'question') {
      const slideId  = (slide as QSlide).id
      const openedAt = Date.now()
      questionMetaRef.current[slideId] = { openedAt, duration: null }
      updateQuestionMeta(code, slideId, openedAt, null).catch(console.error)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRealSession, code, current, phase, showingWaitingRoom, hasStarted])

  // ── Auto-start timer when navigating FORWARD to an MCQ slide with a timer ──
  // Skips the initial mount (presenter might still be setting up) and back-navigation.
  const autoTimerMountedRef = useRef(false)
  useEffect(() => {
    if (!autoTimerMountedRef.current) { autoTimerMountedRef.current = true; return }
    if (!isRealSession || direction !== 1 || slide?.type !== 'mcq') return
    const timerSecs = (slide as QSlide).timer
    if (!timerSecs) return
    handleStartTimer(timerSecs)
  // direction + slide both update in the same batch as current, so watching current is enough
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current])

  // ── Subscribe to live viewer count ────────────────────────────────────
  // Skip only for the hard-coded DEMO fallback, always subscribe for real sessions.
  // Also track the PEAK viewer count for the participation % calculation
  // on the Results page.
  useEffect(() => {
    if (code === 'DEMO') return
    return subscribeToViewerCount(code, n => {
      setViewerCount(n)
      if (n > peakViewerRef.current) peakViewerRef.current = n
    })
  }, [code])

  // ── Subscribe to live viewers list (name + emoji) for waiting room ────
  useEffect(() => {
    if (code === 'DEMO') return
    return subscribeToViewers(code, setViewers)
  }, [code])

  // ── Subscribe to live responses for the current question slide ─────────
  useEffect(() => {
    if (!isRealSession || !slide || !isQuestion) {
      setResponses([])
      return
    }
    setResponses([]) // clear stale responses on slide change
    const unsub = subscribeToSlideResponses(code, slide.id, setResponses)
    return unsub
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRealSession, code, current]) // re-subscribe each time slide changes

  // ── Timer helpers (defined before goNext/goPrev so they can reference stopTimer) ──

  // Stop the running timer locally (and optionally in Firestore).
  // The interval lives inside TimerCount — we just clear the state.
  const stopTimer = useCallback((syncFirestore = true) => {
    setTimerEndsAt(null)
    setTimerDuration(null)
    if (syncFirestore && isRealSessionRef.current) {
      clearTimer(codeRef.current).catch(console.error)
    }
  }, [])

  // Called by TimerCount when the countdown hits zero.
  // We intentionally do NOT call clearTimer here — leaving timerEndsAt in
  // Firestore (past timestamp) keeps audience phones locked at "Time's up!".
  // clearTimer is called when the presenter manually stops or navigates away.
  const handleTimerExpire = useCallback(() => {
    setTimerEndsAt(null)
    setTimerDuration(null)
    // Timer expired — audience is locked from new submissions (timerEndsAt stays in
    // Firestore as a past timestamp). Presenter decides when to advance to results.
  }, [])

  // Start a countdown for `seconds` — the interval runs inside TimerCount
  const handleStartTimer = useCallback((seconds: number) => {
    const endsAt = Date.now() + seconds * 1000
    setTimerEndsAt(endsAt)
    setTimerDuration(seconds)
    setShowTimerMenu(false)
    if (isRealSessionRef.current) {
      startTimer(codeRef.current, seconds).catch(console.error)
      if (isQuestionRef.current && slideRef.current) {
        // Update questionMeta for the current slide only — scoped so that manual
        // timer overrides (e.g. changing from 30 s to 60 s after a reset) correctly
        // update the active slide's duration without touching other slides.
        const sid  = (slideRef.current as { id: string }).id
        const meta = questionMetaRef.current[sid]
        if (meta) {
          questionMetaRef.current[sid] = { ...meta, duration: seconds }
          updateQuestionMeta(codeRef.current, sid, meta.openedAt, seconds).catch(console.error)
        }
      }
    }
  }, [])

  // Clear all votes for the current slide and return to question phase so audience can vote again.
  // Uses resetSlideAndTimer which bumps the reset counter AND updates timerEndsAt in a single
  // Firestore write — the audience receives both changes in one snapshot so there is no race
  // window where alreadySubmitted=false but timerExpired=true (which would lock them on "Time's up!").
  const handleResetVotes = useCallback(async () => {
    if (!isRealSession || !isQuestion) return
    setIsResetting(true)
    try {
      const qSlide    = slide as QSlide
      const timerSecs = qSlide.timer  // configured timer (undefined = no timer)

      // Atomic: delete responses + bump resetCount + restart/clear timer in one write
      await resetSlideAndTimer(code, qSlide.id, timerSecs)

      // Sync presenter's local timer state
      if (timerSecs) {
        setTimerEndsAt(Date.now() + timerSecs * 1000)
        setTimerDuration(timerSecs)
      } else {
        setTimerEndsAt(null)
        setTimerDuration(null)
      }
      setShowTimerMenu(false)
      setShowResetConfirm(false)

      // Return to question phase so audience sees the voting form again
      if (phase === 'results') {
        setTransType('phase')
        setDirection(-1)
        setPhase('question')
      }

      // Refresh questionMeta for this slide so round-2 speed scoring uses the
      // correct openedAt + duration rather than stale values from round 1.
      if (isQuiz) {
        const openedAt = Date.now()
        questionMetaRef.current[qSlide.id] = { openedAt, duration: timerSecs ?? null }
        updateQuestionMeta(code, qSlide.id, openedAt, timerSecs ?? null).catch(console.error)
      }
    } catch (e) {
      console.error('[alaya-pulse] resetSlideVotes failed:', e)
    } finally {
      setIsResetting(false)
    }
  }, [isRealSession, isQuestion, code, slide, phase, isQuiz])

  // ── Reactions subscription ────────────────────────────────────────────
  useEffect(() => {
    if (!isRealSession) return
    const since = mountTimeRef.current
    return subscribeToReactions(code, since, reaction => {
      setParticles(prev => prev.length >= 15 ? prev : [...prev, reaction])
      // Clean up Firestore doc after animation finishes
      setTimeout(() => {
        deleteReaction(code, reaction.id).catch(() => {})
      }, 3000)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, isRealSession])

  const removeParticle = useCallback((id: string) => {
    setParticles(prev => prev.filter(p => p.id !== id))
  }, [])

  // ── Navigation ────────────────────────────────────────────────────────
  const goNext = useCallback(() => {
    if (isQuestion && phase === 'question') {
      // Reveal results — keep timer running so it stays visible on results page
      setTransType('phase'); setDirection(1); setPhase('results')
      return
    }
    // Navigating to a different slide — stop any running timer
    stopTimer()
    if (current >= deck.length - 1) return
    setTransType('slide'); setDirection(1); setPhase('question')
    setCurrent(prev => prev + 1)
  }, [isQuestion, phase, current, deck.length, stopTimer])

  const goPrev = useCallback(() => {
    if (isQuestion && phase === 'results') {
      // Go back to collection — stop timer (will be reset if needed)
      stopTimer()
      setTransType('phase'); setDirection(-1); setPhase('question')
      return
    }
    // Navigating to a different slide — stop any running timer
    stopTimer()
    if (current <= 0) {
      // On slide 1 in a real session: go back to the lobby instead of dead-ending
      if (isRealSession) setShowingWaitingRoom(true)
      return
    }
    setTransType('slide'); setDirection(-1); setPhase('question')
    setCurrent(prev => prev - 1)
  }, [isQuestion, phase, current, stopTimer, isRealSession])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (showingWaitingRoomRef.current) {
        // In the lobby: → / Space advances to slide 1; Escape shows exit confirm
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
          e.preventDefault()
          setHasStarted(true)
          setShowingWaitingRoom(false)
        } else if (e.key === 'Escape') {
          setShowExitConfirm(true)
        }
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); goNext() }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')                { e.preventDefault(); goPrev() }
      else if (e.key === 'Escape')                                           { setShowExitConfirm(true) }
      else if (e.key === 'i' || e.key === 'I')                               { setShowHUD(h => !h) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [goNext, goPrev, navigate])


  const canGoPrev = current > 0 || (isQuestion && phase === 'results') || (current === 0 && isRealSession && !showingWaitingRoom)
  const canGoNext     = !(current === deck.length - 1 && (!isQuestion || phase === 'results'))
  const responseCount = responses.length

  // ── Compute aggregated results (real or demo fallback) ─────────────────
  const qSlide     = isQuestion ? (slide as QSlide) : null
  const optCount   = qSlide?.options.length ?? 0
  const mcqVotes   = isRealSession ? aggregateMCQ(responses, optCount)                   : DEMO_MCQ_VOTES
  const cloudWords = isRealSession ? aggregateCloud(responses)                            : DEMO_CLOUD_WORDS
  const openAns    = isRealSession ? aggregateOpen(responses)                             : DEMO_OPEN_ANSWERS
  const ratingMax  = (qSlide?.ratingMax === 10 ? 10 : 5)
  const ratingAvgs = isRealSession ? aggregateRating(responses, optCount)                            : DEMO_RATING_AVGS
  const ratingDist = isRealSession ? aggregateRatingDistribution(responses, optCount, ratingMax)     : DEMO_RATING_DIST

  // ── Persistent HTML iframe groups ─────────────────────────────────────
  // Each unique HTML source file (split or whole) gets its own iframe that
  // stays alive across Pulse slide changes. Navigation within an iframe is
  // a single postMessage — no remount, no re-catchup.
  const htmlGroupMap = useMemo(() => {
    const map = new Map<string, HtmlSlide>()
    for (const s of deck) {
      if (s.type === 'html' && (s as HtmlSlide).html) {
        const hs  = s as HtmlSlide
        const key = `${hs.fileName}::${hs.slideTotal ?? 0}`
        if (!map.has(key)) map.set(key, hs)
      }
    }
    return map
  }, [deck])

  const currentHtmlGroupKey = slide.type === 'html'
    ? `${(slide as HtmlSlide).fileName}::${(slide as HtmlSlide).slideTotal ?? 0}`
    : null

  // Lazy-mount: only spin up iframes for HTML groups that have been visited
  const [mountedHtmlGroups, setMountedHtmlGroups] = useState<Set<string>>(
    () => currentHtmlGroupKey ? new Set([currentHtmlGroupKey]) : new Set(),
  )
  useEffect(() => {
    if (currentHtmlGroupKey && !mountedHtmlGroups.has(currentHtmlGroupKey)) {
      setMountedHtmlGroups(prev => new Set([...prev, currentHtmlGroupKey]))
    }
  }, [currentHtmlGroupKey, mountedHtmlGroups])

  return (
    <div className="fixed inset-0 overflow-hidden bg-midnight-sky-900 text-white">

      {/* Gradient orbs */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -bottom-40 -left-40 size-[600px] rounded-full bg-hot-pink/10 blur-[130px]" />
        <div className="absolute -right-40 -top-40 size-[500px] rounded-full bg-sky-blue/10 blur-[110px]" />
      </div>

      {/* ── Persistent HTML iframe layer ──────────────────────────────────
          Lives outside the slide carousel so navigating between internal
          slides of the same HTML deck is a single postMessage (no remount).
          interactive=true for UNSPLIT HTML decks so the presenter can use
          the HTML's own nav buttons; interactive=false for SPLIT decks
          where Pulse owns navigation between internal slides. */}
      {Array.from(htmlGroupMap.entries()).map(([key, htmlSlide]) => {
        if (!mountedHtmlGroups.has(key)) return null
        const isCurrent = currentHtmlGroupKey === key
        const targetIdx = isCurrent ? ((slide as HtmlSlide).slideIndex ?? 0) : null
        const isSplit   = (htmlSlide.slideTotal ?? 0) >= 2
        return (
          <PersistentHtmlIframe
            key={key}
            html={htmlSlide.html ?? ''}
            fileName={htmlSlide.fileName}
            visible={isCurrent}
            targetIndex={targetIdx}
            interactive={!isSplit}
          />
        )
      })}

      {/* ── Full-screen slide ──────────────────────────────────────────── */}
      <div className="absolute inset-0 z-10">
        <AnimatePresence custom={{ dir: direction, type: transType }} mode="wait">
          <motion.div
            key={`${current}-${phase}`}
            custom={{ dir: direction, type: transType }}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="h-full w-full"
          >
            <SlideContent
              slide={slide}
              phase={phase}
              responseCount={responseCount}
              mcqVotes={mcqVotes}
              cloudWords={cloudWords}
              openAnswers={openAns}
              ratingAvgs={ratingAvgs}
              ratingDist={ratingDist}
              onReveal={() => { setTransType('phase'); setDirection(1); setPhase('results') }}
              sessionCode={code}
              deck={deck}
              questionMeta={questionMetaRef.current}
              timerActive={!!(timerEndsAt && timerDuration && isQuestion)}
            />
          </motion.div>
        </AnimatePresence>

        {/* Left nav hover zone */}
        {canGoPrev && (
          <button
            onClick={goPrev}
            className="absolute left-0 top-0 z-20 flex h-full w-20 items-center justify-start pl-4 opacity-0 transition-opacity hover:opacity-100 [will-change:opacity]"
          >
            <div className="rounded-full bg-black/30 p-3 transition hover:bg-black/50">
              <ChevronLeft className="size-6 text-white" />
            </div>
          </button>
        )}

        {/* Right nav hover zone */}
        {canGoNext && (
          <button
            onClick={goNext}
            className="absolute right-0 top-0 z-20 flex h-full w-20 items-center justify-end pr-4 opacity-0 transition-opacity hover:opacity-100 [will-change:opacity]"
          >
            <div className="rounded-full bg-black/30 p-3 transition hover:bg-black/50">
              <ChevronRight className="size-6 text-white" />
            </div>
          </button>
        )}

        {/* Timer overlay — self-contained so only it re-renders on each tick */}
        {timerEndsAt && timerDuration && isQuestion && (
          <TimerCount
            timerEndsAt={timerEndsAt}
            timerDuration={timerDuration}
            slideTheme={(slide as QSlide).theme}
            onExpire={handleTimerExpire}
          />
        )}
      </div>

      {/* ── Reaction particles — float up from bottom, above lobby overlay ── */}
      <div className="pointer-events-none fixed inset-0 z-[45] overflow-hidden">
        {particles.map(p => (
          <ReactionParticle key={p.id} reaction={p} onComplete={() => removeParticle(p.id)} />
        ))}
      </div>

      {/* ── HUD — floating info overlay at bottom ───────────────────── */}
      <AnimatePresence>
        {showHUD ? (
          <motion.div
            key="hud"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/70 to-transparent pb-3 pt-10"
          >
            <div className="flex items-center gap-3 px-4">

              {/* QR thumbnail — tap to enlarge */}
              <button
                onClick={() => setShowQRModal(true)}
                className="shrink-0 rounded-md bg-white p-1 shadow-lg transition hover:scale-105"
                title="Click to enlarge QR code"
              >
                <QRCodeSVG value={joinUrl} size={32} bgColor="#ffffff" fgColor="#000079" level="M" />
              </button>

              {/* Brand — logo only */}
              <div className="flex flex-col leading-none">
                <span className="text-[10px] font-bold tracking-tight text-white">
                  alaya <span className="text-hot-pink">pulse</span>
                </span>
              </div>

              <div className="h-5 w-px shrink-0 bg-white/15" />

              {/* Session code */}
              <span className="font-mono text-lg font-bold tracking-[0.18em] text-white">{code}</span>

              <div className="h-5 w-px shrink-0 bg-white/15" />

              {/* Join URL — large + white so late joiners can see it without asking */}
              <span className="text-sm font-semibold text-white">{window.location.host}/join</span>

              {/* Quiz mode indicator — lets the presenter confirm scoring is on */}
              {isQuiz && (
                <>
                  <div className="h-5 w-px shrink-0 bg-white/15" />
                  <div className="flex items-center gap-1.5 rounded-full bg-golden-sun/15 px-2.5 py-1 text-xs font-semibold text-golden-sun">
                    <Trophy className="size-3.5" />
                    Quiz mode
                  </div>
                </>
              )}

              <div className="flex-1" />

              {/* Audience count */}
              <div className="flex items-center gap-1.5 text-xs text-white/50">
                <motion.span
                  key={viewerCount}
                  animate={viewerCount > 0 ? { scale: [1, 1.15, 1] } : {}}
                  transition={{ duration: 0.2 }}
                  className="tabular-nums font-semibold text-white/70"
                >
                  {viewerCount}
                </motion.span>
                <span>audience</span>
              </div>

              {/* Live response count */}
              {isQuestion && (
                <>
                  <div className="h-3.5 w-px shrink-0 bg-white/15" />
                  <div className="flex items-center gap-1.5 text-xs text-white/50">
                    <BarChart2 className="size-3.5" />
                    <motion.span
                      key={responseCount}
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ duration: 0.2 }}
                      className="tabular-nums font-semibold text-white/70"
                    >
                      {responseCount}
                    </motion.span>
                    <span>responses</span>
                  </div>
                </>
              )}

              {/* Re-vote / Reset — shown on question slides in real sessions */}
              {isQuestion && isRealSession && (
                <>
                  <div className="h-3.5 w-px shrink-0 bg-white/15" />
                  <div className="relative">
                    <button
                      onClick={() => setShowResetConfirm(v => !v)}
                      className={cn(
                        'rounded-lg p-1.5 transition hover:bg-white/10',
                        showResetConfirm ? 'text-white' : 'text-white/40 hover:text-white',
                      )}
                      title="Reset votes — let audience vote again"
                    >
                      <RotateCcw className="size-3.5" />
                    </button>
                    <AnimatePresence>
                      {showResetConfirm && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.92, y: 4 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.92, y: 4 }}
                          transition={{ duration: 0.15 }}
                          className="absolute bottom-full right-0 mb-2 w-44 overflow-hidden rounded-xl border border-white/15 bg-midnight-sky-800 p-3 shadow-xl"
                        >
                          <p className="mb-1 text-xs font-semibold text-white/80">Reset all votes?</p>
                          <p className="mb-3 text-[11px] leading-relaxed text-white/40">Audience can vote again from scratch.</p>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setShowResetConfirm(false)}
                              className="flex-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-white/50 transition hover:bg-white/10 hover:text-white"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleResetVotes}
                              disabled={isResetting}
                              className="flex-1 rounded-lg bg-hot-pink px-2 py-1.5 text-[11px] font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                            >
                              {isResetting ? '…' : 'Reset'}
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </>
              )}

              {/* Timer controls — shown when on a question slide */}
              {isQuestion && (
                <>
                  <div className="h-5 w-px shrink-0 bg-white/15" />
                  {timerEndsAt ? (
                    /* Timer running: live countdown (self-contained) + stop button */
                    <div className="flex items-center gap-1.5">
                      <HudTimerCount timerEndsAt={timerEndsAt} />
                      <button
                        onClick={() => stopTimer()}
                        className="rounded-lg p-1 text-white/35 transition hover:bg-white/10 hover:text-white"
                        title="Stop timer"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ) : phase === 'question' ? (
                    /* No timer, still collecting: show clock button with preset dropdown */
                    <div className="relative">
                      <button
                        onClick={() => setShowTimerMenu(v => !v)}
                        className={cn(
                          'rounded-lg p-1.5 transition hover:bg-white/10',
                          showTimerMenu ? 'text-white' : 'text-white/40 hover:text-white',
                        )}
                        title="Set question timer"
                      >
                        <Clock className="size-4" />
                      </button>
                      <AnimatePresence>
                        {showTimerMenu && (
                          <motion.div
                            initial={{ opacity: 0, scale: 0.92, y: 4 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.92, y: 4 }}
                            transition={{ duration: 0.15 }}
                            className="absolute bottom-full right-0 mb-2 flex flex-col gap-0.5 overflow-hidden rounded-xl border border-white/15 bg-midnight-sky-800 p-1.5 shadow-xl"
                          >
                            <p className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/35">
                              Timer
                            </p>
                            {[15, 30, 45, 60, 90, 120].map(s => (
                              <button
                                key={s}
                                onClick={() => handleStartTimer(s)}
                                className="rounded-lg px-4 py-1.5 text-left text-sm font-medium text-white/70 transition hover:bg-white/10 hover:text-white"
                              >
                                {s}s
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ) : null}
                </>
              )}

              <div className="h-5 w-px shrink-0 bg-white/15" />

              {/* Slide nav + counter */}
              <div className="flex items-center gap-0.5">
                <button
                  onClick={goPrev} disabled={!canGoPrev}
                  className="rounded-lg p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-20"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span className="min-w-[44px] text-center text-xs font-medium text-white/50">
                  <span className="text-white/80">{current + 1}</span>{'/'}{deck.length}
                </span>
                <button
                  onClick={goNext} disabled={!canGoNext}
                  className="rounded-lg p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-20"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>

              <div className="h-5 w-px shrink-0 bg-white/15" />

              {/* Exit */}
              <button
                onClick={() => setShowExitConfirm(true)}
                className="rounded-lg p-1.5 text-white/40 transition hover:bg-white/10 hover:text-white"
                title="Exit (Esc)"
              >
                <X className="size-4" />
              </button>

              {/* Hide HUD */}
              <button
                onClick={() => setShowHUD(false)}
                className="rounded-lg p-1.5 text-white/25 transition hover:text-white/60"
                title="Hide info bar (press I)"
              >
                <ChevronDown className="size-3.5" />
              </button>
            </div>
          </motion.div>
        ) : (
          /* Minimal restore tab when HUD is hidden */
          <motion.button
            key="hud-hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowHUD(true)}
            title="Show info bar (press I)"
            className="absolute bottom-2 right-3 z-30 flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-[10px] font-medium text-white/40 backdrop-blur-sm transition hover:text-white/80"
          >
            <ChevronUp className="size-3" />
            <span className="font-mono tracking-widest">{code}</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── QR code enlarged modal ──────────────────────────────────── */}
      <AnimatePresence>
        {showQRModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={() => setShowQRModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              onClick={e => e.stopPropagation()}
              className="flex flex-col items-center gap-6 rounded-3xl bg-white p-10 shadow-2xl"
            >
              <QRCodeSVG
                value={joinUrl}
                size={260}
                bgColor="#ffffff"
                fgColor="#000079"
                level="M"
              />
              <div className="text-center">
                <p className="text-sm font-medium text-midnight-sky-500">Join at</p>
                <p className="mt-0.5 text-base font-semibold text-midnight-sky-800">
                  {window.location.host}/join
                </p>
              </div>
              <div className="flex flex-col items-center gap-1">
                <p className="text-xs font-medium uppercase tracking-wider text-midnight-sky-400">Session code</p>
                <p className="font-mono text-4xl font-bold tracking-[0.2em] text-midnight-sky-900">{code}</p>
              </div>
              <button
                onClick={() => setShowQRModal(false)}
                className="mt-1 rounded-xl bg-midnight-sky-100 px-6 py-2.5 text-sm font-medium text-midnight-sky-700 transition hover:bg-midnight-sky-200"
              >
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Lobby overlay — slides in over the deck, z-40 so exit confirm (z-50) still works ── */}
      <AnimatePresence>
        {showingWaitingRoom && isRealSession && (
          <motion.div
            key="lobby"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-40"
          >
            <WaitingRoom
              code={code}
              joinUrl={joinUrl}
              viewers={viewers}
              isQuiz={isQuiz}
              onStart={() => { setHasStarted(true); setShowingWaitingRoom(false) }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── End session confirmation ─────────────────────────────────── */}
      <AnimatePresence>
        {showExitConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setShowExitConfirm(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 12 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl border border-white/10 bg-midnight-sky-800 p-8 text-center shadow-2xl"
            >
              <h3 className="text-xl font-semibold text-white">End this session?</h3>
              <p className="mt-2 text-sm font-light text-white/50">
                If you end the session, you can resume it anytime — just click the Resume button on the Create page. Your audience won't need to re-enter the room code.
              </p>
              <div className="mt-7 flex gap-3">
                <button
                  onClick={() => setShowExitConfirm(false)}
                  className="flex-1 rounded-xl border border-white/15 bg-white/5 py-3 text-sm font-medium text-white transition hover:bg-white/10"
                >
                  Keep presenting
                </button>
                <button
                  onClick={async () => {
                    // Snapshot results from this session so the editor can
                    // save them with the deck for later analysis.
                    let lastResults: DeckResults | undefined
                    if (isRealSession) {
                      try {
                        const all = await fetchAllSessionResponses(code)
                        lastResults = buildResultsSnapshot(
                          deck, all, code,
                          sessionStartedAt.current,
                          peakViewerRef.current,
                        )
                      } catch (e) {
                        console.error('Failed to capture session results:', e)
                      }
                      endSession(code).catch(console.error)
                    }
                    navigate('/create', { state: {
                      slides: stateSlides,
                      deckTitle: stateDeckTitle,
                      sessionCode: isRealSession ? code : undefined,
                      deckId: stateDeckId,
                      lastResults,
                      selectedSlideId: deck[current]?.id,
                      isQuiz,
                    } })
                  }}
                  className="flex-1 rounded-xl bg-hot-pink py-3 text-sm font-medium text-white shadow-[0_0_20px_-4px] shadow-hot-pink/50 transition hover:shadow-[0_0_28px_-2px] hover:shadow-hot-pink/70"
                >
                  End session
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Lobby — full-screen overlay shown to the presenter before the show starts.
   Press → (or click the right hover zone) to advance to slide 1.
   Press ← from slide 1 to come back here. Escape → exit confirm modal.
   ───────────────────────────────────────────────────────────────────────── */

function WaitingRoom({
  code, joinUrl, viewers, isQuiz, onStart,
}: {
  code:    string
  joinUrl: string
  viewers: { id: string; name: string; emoji: string }[]
  isQuiz:  boolean
  onStart: () => void
}) {
  const count = viewers.length

  // Tiles shrink as room fills; scroll kicks in when tiles hit ≤48 px
  const tileMin =
    count <= 30  ? 110 :
    count <= 60  ? 88  :
    count <= 120 ? 70  :
    count <= 200 ? 56  : 48

  return (
    <div className="flex h-full w-full flex-col bg-midnight-sky-900 text-white">
      {/* Ambient orbs */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -bottom-40 -left-40 size-[600px] rounded-full bg-hot-pink/10 blur-[130px]" />
        <div className="absolute -right-40 -top-40 size-[500px] rounded-full bg-sky-blue/10 blur-[110px]" />
      </div>

      {/* Compact one-row header */}
      <header className="relative z-10 flex items-center gap-4 px-8 py-4">
        <div>
          <p className="text-[10px] font-bold tracking-tight text-white/35">
            alaya <span className="text-hot-pink">pulse</span>
          </p>
          <h1 className="text-xl font-bold leading-tight text-white">Lobby</h1>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1">
          <span className="size-1.5 animate-pulse rounded-full bg-fresh-green" />
          <motion.span
            key={count}
            initial={{ scale: 1.3 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.2 }}
            className="tabular-nums text-sm font-bold text-white/80"
          >
            {count}
          </motion.span>
          <span className="text-sm text-white/40">
            {count === 1 ? 'person' : 'people'}
          </span>
        </div>
        {isQuiz && (
          <div className="flex items-center gap-1.5 rounded-full border border-golden-sun/30 bg-golden-sun/10 px-3 py-1">
            <Trophy className="size-3.5 text-golden-sun" />
            <span className="text-sm font-semibold text-golden-sun">Quiz mode</span>
          </div>
        )}
      </header>

      {/* Viewer grid — right-padded to avoid QR overlap */}
      <main className="relative z-10 flex-1 overflow-y-auto pl-8 pr-52 pb-8 [scrollbar-width:thin]">
        {count === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-center text-base font-light text-white/25">
              Waiting for people to scan and join…
            </p>
          </div>
        ) : (
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tileMin}px, 1fr))` }}
          >
            <AnimatePresence initial={false}>
              {viewers.map(v => (
                <motion.div
                  key={v.id}
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={{ duration: 0.3, ease: [0.34, 1.56, 0.64, 1] }}
                  className="flex flex-col items-center justify-center gap-0.5 rounded-xl border border-white/10 bg-white/5 px-1.5 py-2"
                >
                  <span style={{ fontSize: tileMin >= 88 ? '1.5rem' : tileMin >= 65 ? '1.2rem' : '1rem', lineHeight: 1 }}>
                    {v.emoji}
                  </span>
                  {v.name && (
                    <span className="w-full truncate text-center font-medium text-white/65" style={{ fontSize: '10px' }}>
                      {v.name}
                    </span>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>

      {/* Right hover zone — click or hover to advance to slide 1 */}
      <button
        onClick={onStart}
        className="absolute right-0 top-0 z-50 flex h-full w-20 items-center justify-end pr-4 opacity-0 transition-opacity hover:opacity-100 [will-change:opacity]"
        aria-label="Start show"
      >
        <div className="rounded-full bg-black/30 p-3 transition hover:bg-black/50">
          <ChevronRight className="size-6 text-white" />
        </div>
      </button>

      {/* Bottom-right: QR code + session code + join URL */}
      <div className="absolute bottom-6 right-8 z-20 flex flex-col items-end gap-3">
        <div className="rounded-2xl bg-white p-3 shadow-2xl">
          <QRCodeSVG value={joinUrl} size={120} bgColor="#ffffff" fgColor="#000079" level="M" />
        </div>
        <div className="text-right">
          <p className="font-mono text-xl font-bold tracking-[0.22em] text-white">{code}</p>
          <p className="text-sm font-semibold text-white/70">{window.location.host}/join</p>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Reaction particle — floats up from the bottom of the presenter screen,
   drifts slightly, and fades out before reaching the slide content area.
   ───────────────────────────────────────────────────────────────────────── */

function ReactionParticle({ reaction, onComplete }: { reaction: Reaction; onComplete: () => void }) {
  const config = REACTION_CONFIG.find(r => r.type === reaction.type) ?? REACTION_CONFIG[0]
  const drift  = useMemo(() => (Math.random() - 0.5) * 50, [])

  return (
    <motion.div
      className="absolute bottom-0 select-none"
      style={{ left: `${reaction.x * 100}%` }}
      initial={{ y: 0, x: 0, opacity: 1, scale: 0.2 }}
      animate={{
        y:       [0, -60, -120, -200, -window.innerHeight * 0.42],
        x:       [0, drift * 0.3, drift * 0.7, drift, drift * 1.1],
        opacity: [0, 1,  1,      1,    0],
        scale:   [0.2, 1.3, 1.1, 1.0,  0.85],
      }}
      transition={{ duration: 2.4, ease: 'easeOut', times: [0, 0.08, 0.25, 0.7, 1] }}
      onAnimationComplete={onComplete}
    >
      <span style={{ fontSize: '2.2rem', lineHeight: 1, filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.3))' }}>
        {config.emoji}
      </span>
    </motion.div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Slide content router
   ───────────────────────────────────────────────────────────────────────── */

function SlideContent({
  slide, phase, responseCount,
  mcqVotes, cloudWords, openAnswers, ratingAvgs, ratingDist,
  onReveal, sessionCode, deck, questionMeta, timerActive,
}: {
  slide:          AnySlide
  phase:          SlidePhase
  responseCount:  number
  mcqVotes:       number[]
  cloudWords:     { text: string; count: number }[]
  openAnswers:    { name: string; text: string }[]
  ratingAvgs:     number[]
  ratingDist:     number[][]
  onReveal:       () => void
  sessionCode:    string
  deck:           AnySlide[]
  questionMeta:   Record<string, { openedAt: number; duration: number | null }>
  timerActive:    boolean
}) {
  if (slide.type === 'pdf')          return <PdfSlideView slide={slide} />
  if (slide.type === 'image')        return <ImageSlideView slide={slide} />
  if (slide.type === 'video')        return <VideoSlideView slide={slide} />
  if (slide.type === 'html')         return null   // rendered by PersistentHtmlIframe layer
  if (slide.type === 'content')      return <ContentSlideView slide={slide as ContentSlide} />
  if (slide.type === 'canvas')       return <CanvasSlideView slide={slide as CanvasSlide} />
  if (slide.type === 'leaderboard')  return <LeaderboardSlideView sessionCode={sessionCode} deck={deck} questionMeta={questionMeta} slide={slide as LeaderboardSlide} />
  if (phase === 'results')  return (
    <ResultsSlideView
      slide={slide}
      mcqVotes={mcqVotes}
      respondentCount={responseCount}
      cloudWords={cloudWords}
      openAnswers={openAnswers}
      ratingAvgs={ratingAvgs}
      ratingDist={ratingDist}
      timerActive={timerActive}
    />
  )
  return (
    <QuestionSlideView
      slide={slide}
      responseCount={responseCount}
      onReveal={onReveal}
    />
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   PDF slide — renders real image or demo title card
   ───────────────────────────────────────────────────────────────────────── */

function PdfSlideView({ slide }: { slide: PdfSlide }) {
  if (slide.imgUrl) {
    return (
      <div className="absolute inset-0 overflow-hidden bg-midnight-sky-900">
        {/* Blurred fill for letterbox areas */}
        <img src={slide.imgUrl} alt="" aria-hidden
          className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl opacity-25" />
        {/* Sharp main image */}
        <img src={slide.imgUrl} alt={`Slide ${slide.pageNum ?? ''}`}
          className="absolute inset-0 h-full w-full object-contain" />
      </div>
    )
  }

  // Demo / fallback title card
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-gradient-to-br from-midnight-sky-800 to-midnight-sky-900">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="size-[600px] rounded-full bg-hot-pink/8 blur-[120px]" />
      </div>
      <div className="relative z-10 px-20 text-center">
        <h1 className="text-5xl font-semibold leading-tight tracking-tight text-white lg:text-6xl xl:text-7xl">
          {slide.title}
        </h1>
        {slide.subtitle && (
          <p className="mt-5 text-xl font-light text-white/45 lg:text-2xl">{slide.subtitle}</p>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Image slide — full-screen image with cinematic blur fill
   ───────────────────────────────────────────────────────────────────────── */

function ImageSlideView({ slide }: { slide: ImageSlide }) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-midnight-sky-900">
      <img src={slide.imgUrl} alt="" aria-hidden
        className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl opacity-25" />
      <img src={slide.imgUrl} alt={slide.fileName}
        className="absolute inset-0 h-full w-full object-contain" />
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Video slide — auto-plays in slideshow mode
   ───────────────────────────────────────────────────────────────────────── */

function VideoSlideView({ slide }: { slide: VideoSlide }) {
  if (!slide.videoUrl) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-midnight-sky-900">
        <p className="text-base font-semibold text-white/50">{slide.fileName}</p>
        <p className="text-sm font-light text-white/30">Video not available — re-import to restore</p>
      </div>
    )
  }
  return (
    <div className="absolute inset-0 bg-black">
      <video src={slide.videoUrl} controls autoPlay className="h-full w-full object-contain" />
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   HTML slide — imported .html file rendered in a sandboxed iframe.
   Sandbox is empty (= maximum restrictions): no scripts, no forms, no nav.
   ───────────────────────────────────────────────────────────────────────── */

/* PersistentHtmlIframe and injectPersistentHtmlNavScript are now shared in
   src/components/PersistentHtmlIframe.tsx so the Create editor can use the
   same persistent iframe pattern (no rebuild when switching split slides). */

/* ─────────────────────────────────────────────────────────────────────────
   Content slide — heading / bullets / quote templates
   ───────────────────────────────────────────────────────────────────────── */

type ThemeKey = 'navy' | 'pink' | 'sky' | 'green' | 'golden' | 'white' | 'transparent'
const CONTENT_COLORS: Record<ThemeKey, {
  bg: string; text: string; textDim: string; accent: string; quoteMark: string
}> = {
  navy:        { bg: '#000079',   text: '#ffffff', textDim: 'rgba(255,255,255,0.58)', accent: '#ff0065', quoteMark: 'rgba(255,0,101,0.18)' },
  pink:        { bg: '#ff0065',   text: '#ffffff', textDim: 'rgba(255,255,255,0.72)', accent: '#ffffff', quoteMark: 'rgba(255,255,255,0.18)' },
  sky:         { bg: '#00b0ff',   text: '#000079', textDim: 'rgba(0,0,121,0.62)',     accent: '#000079', quoteMark: 'rgba(0,0,121,0.14)' },
  green:       { bg: '#42db66',   text: '#000079', textDim: 'rgba(0,0,121,0.62)',     accent: '#000079', quoteMark: 'rgba(0,0,121,0.14)' },
  golden:      { bg: '#ffc709',   text: '#000079', textDim: 'rgba(0,0,121,0.62)',     accent: '#000079', quoteMark: 'rgba(0,0,121,0.14)' },
  white:       { bg: '#f4f4f9',   text: '#000079', textDim: 'rgba(0,0,121,0.52)',     accent: '#ff0065', quoteMark: 'rgba(255,0,101,0.1)'  },
  // Transparent: no bg colour — image shows through completely unshaded.
  // White text since the outer presentation container is dark.
  transparent: { bg: 'transparent', text: '#ffffff', textDim: 'rgba(255,255,255,0.58)', accent: '#ff0065', quoteMark: 'rgba(255,0,101,0.18)' },
}
function contentColors(theme: string) { return CONTENT_COLORS[theme as ThemeKey] ?? CONTENT_COLORS.navy }

/* Question-slide theme colours — same palette as content slides */
type QColorSet = {
  bg:         string
  fg:         string
  fgDim:      string
  fgFaint:    string
  cardBorder: string
  cardBg:     string
  isDark:     boolean
}
const QSLIDE_COLORS: Record<string, QColorSet> = {
  navy:        { bg: '#000079', fg: '#ffffff', fgDim: 'rgba(255,255,255,0.60)', fgFaint: 'rgba(255,255,255,0.25)', cardBorder: 'rgba(255,255,255,0.10)', cardBg: 'rgba(255,255,255,0.05)', isDark: true  },
  pink:        { bg: '#ff0065', fg: '#ffffff', fgDim: 'rgba(255,255,255,0.72)', fgFaint: 'rgba(255,255,255,0.30)', cardBorder: 'rgba(255,255,255,0.15)', cardBg: 'rgba(255,255,255,0.08)', isDark: true  },
  sky:         { bg: '#00b0ff', fg: '#000079', fgDim: 'rgba(0,0,121,0.65)',     fgFaint: 'rgba(0,0,121,0.30)',     cardBorder: 'rgba(0,0,121,0.12)',      cardBg: 'rgba(0,0,121,0.06)',    isDark: false },
  green:       { bg: '#42db66', fg: '#000079', fgDim: 'rgba(0,0,121,0.65)',     fgFaint: 'rgba(0,0,121,0.30)',     cardBorder: 'rgba(0,0,121,0.12)',      cardBg: 'rgba(0,0,121,0.06)',    isDark: false },
  golden:      { bg: '#ffc709', fg: '#000079', fgDim: 'rgba(0,0,121,0.65)',     fgFaint: 'rgba(0,0,121,0.30)',     cardBorder: 'rgba(0,0,121,0.12)',      cardBg: 'rgba(0,0,121,0.06)',    isDark: false },
  white:       { bg: '#f4f4f9', fg: '#000079', fgDim: 'rgba(0,0,121,0.55)',     fgFaint: 'rgba(0,0,121,0.25)',     cardBorder: 'rgba(0,0,121,0.10)',      cardBg: 'rgba(0,0,121,0.04)',    isDark: false },
  // Transparent: bg is set to '#000079' so badges use navy text on white background.
  // The actual slide container is forced to CSS transparent via a separate check.
  transparent: { bg: '#000079', fg: '#ffffff', fgDim: 'rgba(255,255,255,0.60)', fgFaint: 'rgba(255,255,255,0.25)', cardBorder: 'rgba(255,255,255,0.15)', cardBg: 'rgba(255,255,255,0.12)', isDark: true  },
}
function qColors(theme?: string): QColorSet {
  return QSLIDE_COLORS[theme ?? 'navy'] ?? QSLIDE_COLORS.navy
}

/* Theme-aware accent colours for MCQ results bars.
   Each pair is chosen so neither colour blends into the slide background. */
type MCQAccents = { selected: string; correct: string }
const MCQ_ACCENTS: Record<string, MCQAccents> = {
  navy:        { selected: '#ff0065', correct: '#42db66' },  // hot-pink / fresh-green
  pink:        { selected: '#00b0ff', correct: '#ffc709' },  // sky-blue  / golden-sun
  sky:         { selected: '#ff0065', correct: '#ffc709' },  // hot-pink  / golden-sun
  green:       { selected: '#ff0065', correct: '#000079' },  // hot-pink  / midnight-sky (navy reads better on green than golden-sun)
  golden:      { selected: '#ff0065', correct: '#00b0ff' },  // hot-pink  / sky-blue
  white:       { selected: '#ff0065', correct: '#42db66' },  // hot-pink  / fresh-green
  transparent: { selected: '#ff0065', correct: '#42db66' },
}
function mcqAccents(theme?: string): MCQAccents {
  return MCQ_ACCENTS[theme ?? 'navy'] ?? MCQ_ACCENTS.navy
}

function ContentSlideView({ slide }: { slide: ContentSlide }) {
  const c         = contentColors(slide.theme)
  const bullets   = slide.body.split('\n').filter(b => b.trim())
  // True when the reference/right image panel is visible (takes the right edge of the slide)
  const hasRefImg = !!(slide.imgUrl && (slide.imgLayout === 'reference' || slide.imgLayout === 'right'))

  // Detect the image's aspect ratio so the panel hugs the image instead of
  // leaving empty space beside a portrait image. Same trick as question slides.
  const [imgAspect, setImgAspect] = useState<number | null>(null)
  useEffect(() => {
    if (!slide.imgUrl || !hasRefImg) { setImgAspect(null); return }
    const img = new Image()
    img.onload = () => setImgAspect(img.naturalWidth / img.naturalHeight)
    img.src = slide.imgUrl
  }, [slide.imgUrl, hasRefImg])

  // Panel width tracks the image: narrow for portrait, wide for landscape.
  // Clamped to [26%, 48%]. Text fills whatever is left.
  const imgPanelPct = hasRefImg
    ? (imgAspect ? Math.min(48, Math.max(26, Math.round(52 * imgAspect))) : 42)
    : 0
  const textPct     = hasRefImg ? 100 - imgPanelPct : 100
  const textStyle   = hasRefImg ? { width: `${textPct}%` } : undefined

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ backgroundColor: c.bg }}
    >
      {/* Soft ambient glow — navy only */}
      {slide.theme === 'navy' && (
        <div
          className="pointer-events-none absolute -bottom-24 -left-24 size-[500px] rounded-full blur-[130px] opacity-25"
          style={{ backgroundColor: '#ff0065' }}
        />
      )}

      {/* Background layout — full-bleed image, with optional colour overlay */}
      {slide.imgUrl && slide.imgLayout === 'background' && (
        <>
          <img src={slide.imgUrl} alt="" className="absolute inset-0 z-0 h-full w-full object-cover" />
          {/* Skip overlay for transparent theme so the image shows completely unshaded */}
          {slide.theme !== 'transparent' && (
            <div className="absolute inset-0 z-0" style={{ backgroundColor: `${c.bg}cc` }} />
          )}
        </>
      )}

      {/* Reference layout — image on right, panel width tracks the image aspect
          ratio so there's no empty gap beside a portrait image. */}
      {hasRefImg && (
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="absolute right-0 top-0 z-20 h-full overflow-hidden"
          style={{ width: `${imgPanelPct}%` }}
        >
          <img
            src={slide.imgUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-contain object-right"
          />
        </motion.div>
      )}

      {/* Top layout — image floated top-right corner (legacy) */}
      {slide.imgUrl && (!slide.imgLayout || slide.imgLayout === 'top') && (
        <motion.img
          src={slide.imgUrl}
          alt=""
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, delay: 0.04 }}
          className="absolute right-10 top-10 z-20 h-44 max-w-xs rounded-2xl object-cover shadow-xl xl:h-56"
        />
      )}

      {/* ── Heading template ─────────────────────────────── */}
      {slide.template === 'heading' && (
        <div
          className={cn(
            'relative z-10 flex h-full flex-col items-center justify-center text-center',
            hasRefImg ? 'pl-16 pr-4' : 'w-full px-20',
          )}
          style={textStyle}
        >
          <h1
            className={cn(
              'w-full break-words font-bold leading-tight tracking-tight',
              (slide.title?.length ?? 0) > 100 ? 'text-3xl xl:text-4xl 2xl:text-5xl'
                : (slide.title?.length ?? 0) > 60 ? 'text-4xl xl:text-5xl 2xl:text-6xl'
                : (slide.title?.length ?? 0) > 30 ? 'text-5xl xl:text-6xl 2xl:text-7xl'
                : 'text-6xl xl:text-7xl 2xl:text-8xl',
            )}
            style={{ color: c.text }}
          >
            {slide.title || <span style={{ opacity: 0.28 }}>Untitled</span>}
          </h1>
          {slide.body && (
            <p
              className={cn(
                'mt-6 w-full break-words text-center font-light leading-relaxed',
                (slide.body?.length ?? 0) > 400 ? 'text-lg xl:text-xl'
                  : (slide.body?.length ?? 0) > 200 ? 'text-xl xl:text-2xl'
                  : (slide.body?.length ?? 0) > 80  ? 'text-2xl xl:text-3xl'
                  : 'text-3xl xl:text-4xl',
              )}
              style={{ color: c.textDim }}
            >
              {slide.body}
            </p>
          )}
        </div>
      )}

      {/* ── Bullets template ─────────────────────────────── */}
      {slide.template === 'bullets' && (() => {
        const totalLen  = slide.body.length
        const bCount    = bullets.length
        // Font + spacing tiers — same philosophy as the quote template
        const textCls =
          totalLen > 900 || bCount > 6 ? 'text-xs xl:text-sm leading-snug'
          : totalLen > 600 || bCount > 5 ? 'text-sm xl:text-base leading-snug'
          : totalLen > 350 || bCount > 3 ? 'text-base xl:text-lg leading-snug'
          : totalLen > 180 ? 'text-lg xl:text-xl leading-relaxed'
          : 'text-xl xl:text-2xl leading-relaxed'
        const spacingCls =
          totalLen > 600 || bCount > 5 ? 'space-y-1.5'
          : totalLen > 350 || bCount > 3 ? 'space-y-3'
          : 'space-y-5'
        // Title font based on title length only — short titles get big font to
        // fill horizontal space; long titles shrink to avoid wrapping
        const titleLen = slide.title?.length ?? 0
        const titleTextCls =
          titleLen > 50 ? 'text-xl xl:text-2xl'
          : titleLen > 25 ? 'text-2xl xl:text-3xl'
          : totalLen > 350 || bCount > 3 ? 'text-3xl xl:text-4xl'
          : 'text-4xl xl:text-5xl'
        const dotCls =
          totalLen > 350 || bCount > 3 ? 'mt-1.5 size-2 shrink-0 rounded-full'
          : 'mt-2.5 size-2.5 shrink-0 rounded-full'
        return (
          <div
            className={cn(
              // overflow-x-hidden clips any text that reaches the image panel edge
              'relative z-10 flex h-full flex-col justify-center overflow-x-hidden py-14',
              hasRefImg ? 'pl-16 pr-6' : 'w-full px-16',
            )}
            style={textStyle}
          >
            {slide.title && (
              <h2
                className={cn('mb-6 font-bold tracking-tight', titleTextCls)}
                style={{ color: c.text }}
              >
                {slide.title}
              </h2>
            )}
            <ul className={cn('w-full', spacingCls)}>
              {bullets.length > 0
                ? bullets.map((b, i) => (
                    <motion.li
                      key={i}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.1, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                      className="flex w-full items-start gap-4 overflow-hidden"
                    >
                      <span className={dotCls} style={{ backgroundColor: c.accent }} />
                      <span
                        className={cn('min-w-0 flex-1 font-medium', textCls)}
                        style={{ color: c.text, overflowWrap: 'anywhere' }}
                      >
                        {b}
                      </span>
                    </motion.li>
                  ))
                : (
                  <p className="text-xl" style={{ color: c.textDim }}>
                    Add bullet points in the editor…
                  </p>
                )
              }
            </ul>
          </div>
        )
      })()}

      {/* ── Quote template ────────────────────────────────── */}
      {slide.template === 'quote' && (() => {
        const bodyLen = (slide.body ?? '').length
        return (
          <div
            className={cn(
              'relative z-10 flex h-full flex-col items-center justify-center text-center',
              hasRefImg ? 'pl-20 pr-6' : 'w-full px-20',
            )}
            style={textStyle}
          >
            {/* Big decorative " */}
            <div
              className="pointer-events-none absolute left-10 top-6 select-none font-serif text-[11rem] leading-none"
              style={{ color: c.quoteMark }}
              aria-hidden
            >
              &#8220;
            </div>
            {slide.title && (
              <p
                className="mb-6 text-xs font-bold uppercase tracking-[0.2em]"
                style={{ color: c.accent }}
              >
                {slide.title}
              </p>
            )}
            {/* w-full fills the explicit w-[58%] container; overflowWrap:anywhere
                breaks long URLs; font shrinks automatically for longer quotes */}
            <blockquote
              className={cn(
                'relative z-10 w-full font-light leading-relaxed',
                !hasRefImg && 'max-w-4xl',
                bodyLen > 400 ? 'text-lg xl:text-xl'
                  : bodyLen > 200 ? 'text-xl xl:text-2xl'
                  : bodyLen > 100 ? 'text-2xl xl:text-3xl'
                  : 'text-3xl xl:text-4xl',
              )}
              style={{ color: c.text, overflowWrap: 'anywhere' }}
            >
              {slide.body || (
                <span style={{ opacity: 0.28 }}>Quote text appears here…</span>
              )}
            </blockquote>
            {slide.attribution && (
              <p className="mt-8 text-lg tracking-wide" style={{ color: c.textDim }}>
                &mdash;&nbsp;{slide.attribution}
              </p>
            )}
          </div>
        )
      })()}

      {/* Subtle branding watermark */}
      <div className="absolute bottom-4 right-5 z-10">
        <span
          className="text-[11px] font-bold tracking-tight"
          style={{ color: c.textDim, opacity: 0.45 }}
        >
          alaya{' '}
          <span style={{ color: c.accent }}>pulse</span>
        </span>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Canvas slide — free-form presenter view
   ───────────────────────────────────────────────────────────────────────── */

function CanvasSlideView({ slide }: { slide: CanvasSlide }) {
  // Defensive defaults — protect against malformed data so canvas always renders
  const bg       = slide.bg ?? { type: 'color' as const, value: '#000079' }
  const elements = slide.elements ?? []
  const bgStyle: React.CSSProperties =
    bg.type === 'color'    ? { backgroundColor: bg.value } :
    bg.type === 'gradient' ? { backgroundImage: bg.value } :
    /* image */              { backgroundImage: `url(${bg.value})`, backgroundSize: 'cover', backgroundPosition: 'center' }

  // Detect if bg is light so we know whether to use light or dark text for the empty hint
  const isLightBg = bg.type === 'color' && /^#(f|e|d|c)/i.test(bg.value)

  return (
    <div className="absolute inset-0 overflow-hidden" style={bgStyle}>
      {elements.map(el => (
        <div
          key={el.id}
          style={{
            position: 'absolute',
            left:    `${el.x}%`,
            top:     `${el.y}%`,
            width:   `${el.w}%`,
            height:  `${el.h}%`,
            overflow: 'hidden',
            boxSizing: 'border-box',
          }}
        >
          {el.kind === 'text' && (
            <div
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: (el as CanvasTextEl).html ?? '' }}
              style={{
                width: '100%', height: '100%',
                fontSize:   `${(el as CanvasTextEl).fontSize ?? 24}px`,
                textAlign:  (el as CanvasTextEl).align ?? 'left',
                color:      (el as CanvasTextEl).color ?? (isLightBg ? '#000079' : '#ffffff'),
                padding:    '6px 8px',
                lineHeight: 1.4,
                wordBreak:  'break-word',
                overflow:   'hidden',
                boxSizing:  'border-box',
              }}
            />
          )}
          {el.kind === 'image' && (
            <img
              src={(el as CanvasImageEl).imgUrl}
              alt=""
              style={{
                width: '100%', height: '100%',
                objectFit: (el as CanvasImageEl).objectFit ?? 'cover',
                borderRadius: 4,
                display: 'block',
              }}
            />
          )}
          {el.kind === 'table' && (() => {
            const tableEl  = el as CanvasTableEl
            const raw      = tableEl.cells ?? []
            // Handle both flat (new) and nested-array (legacy) formats
            const cells: string[] = raw.length > 0 && Array.isArray(raw[0])
              ? (raw as unknown as string[][]).flat()
              : raw as unknown as string[]
            const cols = tableEl.cols ?? 1
            const rows = tableEl.rows ?? 1
            const borderStr = tableEl.borderStyle === 'none'
              ? 'none'
              : `1px ${tableEl.borderStyle ?? 'solid'} ${tableEl.borderColor ?? 'rgba(255,255,255,0.22)'}`
            return (
              <table style={{ width: '100%', height: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <tbody>
                  {Array.from({ length: rows }, (_, ri) => (
                    <tr key={ri}>
                      {Array.from({ length: cols }, (_, ci) => {
                        const idx       = ri * cols + ci
                        const cellColor = tableEl.cellColors?.[idx] ?? null
                        const defaultBg = tableEl.hasHeader && ri === 0 ? 'rgba(0,0,121,0.65)' : 'rgba(255,255,255,0.05)'
                        return (
                          <td key={ci} style={{
                            border:          borderStr,
                            padding:         '4px 8px',
                            fontSize:        13,
                            color:           '#ffffff',
                            backgroundColor: cellColor != null ? cellColor : defaultBg,
                            fontWeight:      tableEl.hasHeader && ri === 0 ? 600 : 400,
                            verticalAlign:   'middle',
                            overflow:        'hidden',
                            whiteSpace:      'nowrap',
                          }}>
                            {cells[idx] ?? ''}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          })()}
        </div>
      ))}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Question slide — voting open
   ───────────────────────────────────────────────────────────────────────── */

const QTYPE_META: Record<QType, { label: string; ring: string; bg: string; text: string }> = {
  mcq:       { label: 'Multiple Choice', ring: 'border-sky-blue/40',    bg: 'bg-sky-blue/10',    text: 'text-sky-blue'    },
  wordcloud: { label: 'Word Cloud',       ring: 'border-fresh-green/40', bg: 'bg-fresh-green/10', text: 'text-fresh-green' },
  openended: { label: 'Open-ended',       ring: 'border-golden-sun/40',  bg: 'bg-golden-sun/10',  text: 'text-golden-sun'  },
  rating:    { label: 'Rating',           ring: 'border-hot-pink/40',    bg: 'bg-hot-pink/10',    text: 'text-hot-pink'    },
}

function QuestionSlideView({
  slide, responseCount, onReveal,
}: {
  slide:          QSlide
  responseCount:  number
  onReveal:       () => void
}) {
  const meta   = QTYPE_META[slide.type]
  const c      = qColors(slide.theme)
  const layout = slide.imgLayout ?? 'top'

  // 'reference', 'top', 'right' all use the smart reference layout.
  // 'background' keeps the full-bleed overlay style.
  const hasRefImg = !!(slide.imgUrl && layout !== 'background')
  const hasBgImg  = !!(slide.imgUrl && layout === 'background')

  // Detect aspect ratio to auto-pick portrait (right panel) vs landscape (top panel).
  // Defaults to portrait while loading — switches instantly when onLoad fires.
  const [imgAspect, setImgAspect] = useState<number | null>(null)
  useEffect(() => {
    if (!slide.imgUrl) { setImgAspect(null); return }
    const img = new Image()
    img.onload = () => setImgAspect(img.naturalWidth / img.naturalHeight)
    img.src = slide.imgUrl
  }, [slide.imgUrl])

  // ── JSX variables instead of inline component functions ──────────────
  // IMPORTANT: never define components inside another component — React
  // creates a new function reference each render and treats it as a
  // different component type, causing full unmount+remount which replays
  // Framer Motion enter animations → visible flash on every join/submit.
  // JSX variables are plain React elements; React reconciles them in-place.

  const mcqOptions = slide.type === 'mcq' ? (
    // 5+ options → 2-col; ≤4 → single column.
    // w-fit shrinks the container to its widest child so options never
    // bleed into empty space — max-w-[80%] caps very long option text.
    <div
      className="mt-4 gap-2 w-fit max-w-[80%]"
      style={slide.options.length >= 5
        ? { display: 'grid', gridTemplateColumns: 'auto auto' }
        : { display: 'flex', flexDirection: 'column' }}
    >
      {slide.options.map((opt, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.10 + i * 0.05, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left backdrop-blur-sm"
          style={{ border: `1px solid ${c.cardBorder}`, backgroundColor: c.cardBg }}
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold" style={{ backgroundColor: c.fg, color: c.bg }}>
            {String.fromCharCode(65 + i)}
          </span>
          <span className="min-w-0 break-words text-sm font-medium leading-snug" style={{ color: c.fg }}>{opt}</span>
        </motion.div>
      ))}
    </div>
  ) : null

  const ratingParams = slide.type === 'rating' ? (() => {
    const rmax   = slide.ratingMax === 10 ? 10 : 5
    const lefts  = slide.leftLabels  ?? slide.options.map(() => slide.leftLabel  ?? '')
    const rights = slide.rightLabels ?? slide.options.map(() => slide.rightLabel ?? '')
    const cols = slide.options.length <= 2 ? 'grid-cols-2' : 'grid-cols-3'
    return (
      <div className="mt-4">
        <p className="mb-2 text-xs font-medium" style={{ color: c.fgDim }}>Rate each on a 0–{rmax} scale</p>
        <div className={cn('grid gap-2', cols)}>
          {slide.options.map((opt, i) => {
            const left  = lefts[i]  ?? ''
            const right = rights[i] ?? ''
            const hasLabels = !!(left || right)
            return (
              <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.05, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="rounded-xl px-3 py-2 backdrop-blur-sm"
                style={{ border: `1px solid ${c.cardBorder}`, backgroundColor: c.cardBg }}
              >
                <div className="flex items-center gap-2">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold" style={{ backgroundColor: c.fg, color: c.bg }}>{i + 1}</span>
                  <span className="min-w-0 truncate text-xs font-medium" style={{ color: c.fg }}>{opt}</span>
                </div>
                {hasLabels && (
                  <div className="mt-1 flex justify-between pl-7 text-[9px] font-semibold uppercase tracking-wider" style={{ color: c.fgDim }}>
                    <span className="truncate pr-1">{left}</span>
                    <span className="truncate pl-1 text-right">{right}</span>
                  </div>
                )}
              </motion.div>
            )
          })}
        </div>
      </div>
    )
  })() : null

  const bottomBar = (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2.5 rounded-full px-5 py-2.5 backdrop-blur-sm"
        style={{ border: `1px solid ${c.cardBorder}`, backgroundColor: c.cardBg }}
      >
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-fresh-green opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-fresh-green" />
        </span>
        <span className="text-sm font-medium" style={{ color: c.fgDim }}>Collecting responses</span>
        <motion.span key={responseCount} animate={{ scale: [1, 1.3, 1] }} transition={{ duration: 0.2 }}
          className="tabular-nums font-bold" style={{ color: c.fg }}
        >
          {responseCount}
        </motion.span>
        <span className="text-sm" style={{ color: c.fgFaint }}>so far</span>
      </div>
      <motion.button onClick={onReveal} whileTap={{ scale: 0.97 }}
        className="flex items-center gap-2.5 rounded-2xl bg-hot-pink px-7 py-3.5 text-sm font-semibold text-white shadow-[0_0_28px_-6px] shadow-hot-pink/60 transition-shadow hover:shadow-[0_0_36px_-4px] hover:shadow-hot-pink/80"
      >
        <BarChart2 className="size-4" />
        Show results
      </motion.button>
    </div>
  )

  /* ── BACKGROUND layout — full image visible + theme overlay ─────── */
  if (hasBgImg) {
    const isTransparentBg = slide.theme === 'transparent'
    return (
      <div className="absolute inset-0 flex flex-col overflow-hidden pb-24" style={{ backgroundColor: isTransparentBg ? 'transparent' : c.bg }}>
        {/* Blurred ambient fill — skip for transparent theme */}
        {!isTransparentBg && (
          <img src={slide.imgUrl} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl opacity-30" />
        )}
        {/* Full image — object-cover fills edge to edge, slight crop on portrait images */}
        <img src={slide.imgUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        {/* Colour overlay for text readability — skip for transparent theme */}
        {!isTransparentBg && (
          <div className="absolute inset-0" style={{ backgroundColor: `${c.bg}cc` }} />
        )}
        {/* Scrollable content: badge + question + options */}
        <div className="relative z-10 flex flex-1 flex-col overflow-hidden px-14 pt-12">
          <div className="flex-1 overflow-y-auto overflow-x-hidden pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <motion.span initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="w-fit rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider"
              style={{ backgroundColor: c.fg, color: c.bg }}
            >
              {meta.label}
            </motion.span>
            <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
              className={cn('mt-6 font-semibold leading-snug tracking-tight', slide.question.length > 600 ? 'text-sm md:text-base' : slide.question.length > 400 ? 'text-base md:text-lg' : slide.question.length > 200 ? 'text-lg md:text-xl' : slide.question.length > 80 ? 'text-xl md:text-2xl' : 'text-2xl md:text-3xl')}
              style={{ color: c.fg }}
            >
              {slide.question}
            </motion.h1>
            {mcqOptions}
            {ratingParams}
          </div>
        </div>
        <div className="relative z-10 px-14 pb-0">{bottomBar}</div>
      </div>
    )
  }

  /* ── REFERENCE layout — image in right panel (portrait or landscape) ── */
  // Portrait: object-contain (full image visible, no crop).
  // Landscape: object-cover (fills panel, slight top/bottom crop — no empty side bars).
  // Panel width is sized from the image's aspect ratio so portrait images don't get
  // a comically wide panel, clamped to [24%, 52%].
  if (hasRefImg) {
    const imgPanelPct = imgAspect
      ? Math.min(52, Math.max(24, Math.round(50 * imgAspect)))
      : 44  // sensible fallback while aspect ratio is loading

    return (
      // Outer: no pb-24 so image panel reaches the bottom edge behind the HUD gradient.
      // Left column carries pb-24 so the BottomBar stays above the HUD.
      <div className="absolute inset-0 flex overflow-hidden" style={{ backgroundColor: slide.theme === 'transparent' ? 'transparent' : c.bg }}>
        {/* Left: question content + BottomBar — pb-24 keeps content above the HUD */}
        <div className="flex flex-1 flex-col overflow-hidden px-12 pt-12 pb-24">
          {/* Scrollable: badge + question + options */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <motion.span initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="w-fit rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider"
              style={{ backgroundColor: c.fg, color: c.bg }}
            >
              {meta.label}
            </motion.span>
            <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
              className={cn('mt-5 font-semibold leading-snug tracking-tight', slide.question.length > 600 ? 'text-xs md:text-sm' : slide.question.length > 400 ? 'text-sm md:text-base' : slide.question.length > 200 ? 'text-base md:text-lg' : slide.question.length > 80 ? 'text-lg md:text-xl' : 'text-xl md:text-2xl')}
              style={{ color: c.fg }}
            >
              {slide.question}
            </motion.h1>
            {mcqOptions}
            {ratingParams}
          </div>
          {bottomBar}
        </div>
        {/* Right: reference image — full height to HUD edge, width from aspect ratio */}
        <motion.div
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          className="relative shrink-0 overflow-hidden"
          style={{ width: `${imgPanelPct}%` }}
        >
          {/* Full image — object-contain so nothing is ever cropped.
              Letterbox areas show the slide background colour set on the outer div. */}
          <img src={slide.imgUrl} alt="Reference image"
            className="absolute inset-0 h-full w-full object-contain px-3" />
        </motion.div>
      </div>
    )
  }

  /* ── NO IMAGE — full-width layout ──────────────────────────────────── */
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden px-14 pt-12 pb-24" style={{ backgroundColor: slide.theme === 'transparent' ? 'transparent' : c.bg }}>
      {/* Scrollable: badge + question + options — grows to fill space, scrolls if needed */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <motion.span initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="w-fit rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider"
          style={{ backgroundColor: c.fg, color: c.bg }}
        >
          {meta.label}
        </motion.span>
        <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
          className={cn('mt-6 font-semibold leading-snug tracking-tight', slide.question.length > 600 ? 'text-sm md:text-base' : slide.question.length > 400 ? 'text-base md:text-lg' : slide.question.length > 200 ? 'text-lg md:text-xl' : slide.question.length > 80 ? 'text-xl md:text-2xl' : 'text-2xl md:text-3xl')}
          style={{ color: c.fg }}
        >
          {slide.question}
        </motion.h1>
        {mcqOptions}
        {ratingParams}
      </div>
      {bottomBar}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Results slide — live animated visualizations
   ───────────────────────────────────────────────────────────────────────── */

function ResultsSlideView({
  slide, mcqVotes, respondentCount, cloudWords, openAnswers, ratingAvgs, ratingDist, timerActive = false,
}: {
  slide:           QSlide
  mcqVotes:        number[]
  respondentCount: number
  timerActive?:    boolean
  cloudWords:      { text: string; count: number }[]
  openAnswers:     { name: string; text: string }[]
  ratingAvgs:      number[]
  ratingDist:      number[][]
}) {
  const c         = qColors(slide.theme)
  const ratingMax = slide.ratingMax === 10 ? 10 : 5

  const [answerRevealed, setAnswerRevealed] = useState(false)
  const hasCorrAnswer = slide.type === 'mcq' && (slide.correctAnswers ?? []).length > 0

  // Open Ended: set of pinned response texts (first 60 chars used as key).
  const [pinnedKeys, setPinnedKeys] = useState<Set<string>>(new Set())
  const togglePin = (key: string) =>
    setPinnedKeys(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  // MCQ and rating handle their own theming — no dark panel needed.
  // Word cloud floats directly on the slide bg with its own palette.
  const needsDarkPanel = (slide.theme ?? 'navy') !== 'navy'
    && slide.type !== 'wordcloud'
    && slide.type !== 'mcq'
    && slide.type !== 'rating'
    && slide.type !== 'openended'

  const vizWrap = needsDarkPanel
    ? 'mt-6 flex-1 overflow-y-auto rounded-2xl bg-midnight-sky-900/95 px-8 py-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
    : slide.type === 'wordcloud'
      ? 'mt-2 flex-1 min-h-0 overflow-hidden'
      : slide.type === 'rating'
        ? 'mt-6 flex-1 min-h-0 flex flex-col overflow-hidden'
        : 'mt-6 flex-1 overflow-hidden'

  return (
    <div
      className={cn('absolute inset-0 flex flex-col overflow-hidden px-14 pt-10', slide.type === 'mcq' ? 'pb-16' : 'pb-24')}
      style={{ backgroundColor: slide.theme === 'transparent' ? 'transparent' : c.bg }}
    >
      {/* Badge + question + optional reveal button.
          When the timer pill is showing (top-right), add right padding so the
          Reveal answer button shifts left and never sits under the pill. */}
      <div className={cn('flex items-start gap-3', timerActive && 'pr-24')}>
        <span
          className="mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ backgroundColor: c.fg, color: c.bg }}
        >
          Results live
        </span>
        <h2
          className={cn('flex-1 font-semibold', slide.question.length > 600 ? 'text-[11px] md:text-xs' : slide.question.length > 400 ? 'text-xs md:text-sm' : slide.question.length > 200 ? 'text-sm md:text-base' : slide.question.length > 80 ? 'text-base md:text-lg' : 'text-xl md:text-2xl')}
          style={{ color: c.fg }}
        >
          {slide.question}
        </h2>
        {/* Reveal Answer — MCQ only, only shown when a correct answer is set */}
        {hasCorrAnswer && (
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => setAnswerRevealed(v => !v)}
            className="mt-0.5 flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-1.5 text-sm font-semibold transition-all"
            style={answerRevealed
              ? { borderColor: `${mcqAccents(slide.theme).correct}80`, backgroundColor: `${mcqAccents(slide.theme).correct}22`, color: mcqAccents(slide.theme).correct }
              : { borderColor: `${c.fg}33`, backgroundColor: `${c.fg}18`, color: `${c.fg}b3` }
            }
          >
            {answerRevealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {answerRevealed ? 'Hide answer' : 'Reveal answer'}
          </motion.button>
        )}
      </div>

      {/* MCQ — dedicated flex-column layout: bars fill top, explanation grows from bottom */}
      {slide.type === 'mcq' && (
        <div className="mt-6 flex flex-1 flex-col overflow-hidden">
          {/* Bars — flex-1 so they naturally yield space to explanation when it appears */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <MCQResults
              options={slide.options}
              votes={mcqVotes}
              respondentCount={respondentCount}
              vizType={slide.vizType ?? 'bar'}
              correctAnswers={slide.correctAnswers}
              revealed={answerRevealed}
              explanationRevealed={answerRevealed && !!slide.explanation}
              theme={slide.theme}
            />
          </div>
          {/* Explanation — animates height 0→auto, smoothly pushing bars up */}
          <AnimatePresence>
            {answerRevealed && slide.explanation && (
              <motion.div
                key="mcq-explanation"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                style={{ overflow: 'hidden', flexShrink: 0 }}
              >
                <div
                  className={cn(
                    'mt-4 rounded-2xl border px-5 py-4 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
                    c.isDark ? 'border-teal-400/30 bg-teal-900/60' : 'border-white/15 bg-midnight-sky-900/85'
                  )}
                  style={{ maxHeight: '7rem' }}
                >
                  <p className={cn('mb-1.5 text-[10px] font-bold uppercase tracking-widest', c.isDark ? 'text-teal-300' : 'text-golden-sun')}>Explanation</p>
                  <p className="text-sm leading-relaxed text-white/90">{slide.explanation}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* All other slide types use the original vizWrap */}
      {slide.type !== 'mcq' && (
        <div className={vizWrap}>
          {slide.type === 'wordcloud' && <WordCloudResults words={cloudWords} slideTheme={slide.theme} />}
          {slide.type === 'openended' && (
            <OpenEndedResults
              answers={openAnswers}
              pinnedKeys={pinnedKeys}
              onTogglePin={togglePin}
              slideTheme={slide.theme}
            />
          )}
          {slide.type === 'rating'    && (() => {
            const lefts  = slide.leftLabels  ?? slide.options.map(() => slide.leftLabel  ?? '')
            const rights = slide.rightLabels ?? slide.options.map(() => slide.rightLabel ?? '')
            return (
              <RatingResults
                params={slide.options}
                avgs={ratingAvgs}
                distributions={ratingDist}
                ratingMax={ratingMax}
                leftLabels={lefts}
                rightLabels={rights}
                darkBg={needsDarkPanel}
                theme={slide.theme}
              />
            )
          })()}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   MCQ Results — dispatcher for bar / pie / donut
   ───────────────────────────────────────────────────────────────────────── */

// Shared palette for pie / donut segments
const VIZ_COLORS = ['#ff0065', '#00b0ff', '#42db66', '#ffc709', '#a855f7', '#f97316']

function MCQResults({ options, votes, respondentCount, vizType = 'bar', correctAnswers, revealed, explanationRevealed, theme }: {
  options:              string[]
  votes:                number[]
  respondentCount?:     number
  vizType?:             'bar' | 'pie' | 'donut'
  correctAnswers?:      number[]
  revealed?:            boolean
  /** True when the explanation box is visible — bar chart tightens its row gap to make room. */
  explanationRevealed?: boolean
  theme?:               string
}) {
  if (vizType === 'pie')   return <MCQPieChart   options={options} votes={votes} respondentCount={respondentCount} correctAnswers={correctAnswers} revealed={revealed} />
  if (vizType === 'donut') return <MCQDonutChart options={options} votes={votes} respondentCount={respondentCount} correctAnswers={correctAnswers} revealed={revealed} />
  return <MCQBarChart options={options} votes={votes} respondentCount={respondentCount} correctAnswers={correctAnswers} revealed={revealed} explanationRevealed={explanationRevealed} theme={theme} />
}

/* ── Bar chart — stacked layout: full-width label on top, bar below ───── */

function MCQBarChart({ options, votes, respondentCount, correctAnswers, revealed, explanationRevealed, theme }: {
  options: string[]; votes: number[]
  respondentCount?: number
  correctAnswers?: number[]; revealed?: boolean
  explanationRevealed?: boolean
  theme?: string
}) {
  const total   = respondentCount ?? votes.reduce((s, v) => s + v, 0)
  const maxV    = Math.max(...votes, 1)
  const corrSet = new Set(correctAnswers ?? [])
  const dense   = options.length >= 5
  const c       = qColors(theme)
  const acc     = mcqAccents(theme)

  const mountedRef = useRef(false)
  useEffect(() => { mountedRef.current = true }, [])

  const [flashReveal, setFlashReveal] = useState(false)
  const prevRevealedRef = useRef(false)
  useEffect(() => {
    if (!prevRevealedRef.current && revealed) {
      setFlashReveal(true)
      const id = setTimeout(() => setFlashReveal(false), 900)
      return () => clearTimeout(id)
    }
    prevRevealedRef.current = !!revealed
  }, [revealed])

  return (
    <motion.div
      className="flex flex-col"
      animate={{ rowGap: explanationRevealed && !dense ? 12 : dense ? 8 : 20 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
    >
      {options.map((opt, i) => {
        const v         = votes[i] ?? 0
        const pct       = total > 0 ? Math.round((v / total) * 100) : 0
        const isWinner  = v > 0 && v === maxV
        const isCorrect = revealed && corrSet.has(i)
        const isWrong   = revealed && corrSet.size > 0 && !corrSet.has(i)

        const accentColor   = isCorrect ? acc.correct : isWinner ? acc.selected : null
        const badgeBg       = accentColor ?? `${c.fg}18`
        const badgeFg       = accentColor ? '#ffffff' : `${c.fg}80`
        const labelColor    = accentColor ?? `${c.fg}a6`
        const pctColor      = accentColor ?? `${c.fg}80`
        const barFill       = accentColor ?? `${c.fg}40`
        const barTrack      = `${c.fg}18`

        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -20 }}
            animate={{
              opacity: isWrong ? 0.28 : 1,
              x: 0,
              scale: flashReveal && isCorrect ? [1, 1.03, 1] : 1,
              rowGap: explanationRevealed && !dense ? 4 : dense ? 4 : 8,
            }}
            transition={{
              opacity: { delay: flashReveal && isWrong ? 0.25 : i * 0.08, duration: 0.45 },
              x:       { delay: i * 0.08, duration: 0.45, ease: [0.16, 1, 0.3, 1] },
              scale:   flashReveal && isCorrect
                ? { duration: 0.55, times: [0, 0.3, 1], ease: 'easeOut' }
                : { duration: 0 },
              rowGap:  { duration: 0.45, ease: [0.16, 1, 0.3, 1] },
            }}
            className={cn('flex flex-col', dense ? 'gap-1' : 'gap-2')}
          >
            {/* Row 1: badge + full-width label + percentage */}
            <div className={cn('flex items-center', dense ? 'gap-3' : 'gap-4')}>
              <span
                className={cn('flex shrink-0 items-center justify-center rounded-xl font-bold', dense ? 'size-8 text-xs' : 'size-10 text-sm')}
                style={{ backgroundColor: badgeBg, color: badgeFg }}
              >
                {isCorrect ? <Check className={dense ? 'size-4' : 'size-5'} strokeWidth={2.5} /> : String.fromCharCode(65 + i)}
              </span>
              <span
                className={cn('min-w-0 flex-1 break-words font-medium leading-snug', dense ? 'text-sm' : 'text-base')}
                style={{ color: labelColor }}
              >
                {opt}
              </span>
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.45 + i * 0.18 + 0.7, duration: 0.25 }}
                className={cn('shrink-0 text-right font-bold tabular-nums', dense ? 'text-xl' : 'text-2xl')}
                style={{ color: pctColor }}
              >
                {pct}%
              </motion.span>
            </div>
            {/* Row 2: bar */}
            <div className={dense ? 'pl-11' : 'pl-14'}>
              <div className={cn('relative overflow-hidden rounded-xl', dense ? 'h-[6px]' : 'h-3.5')} style={{ backgroundColor: barTrack }}>
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-xl"
                  style={{ backgroundColor: barFill }}
                  initial={{ width: '0%' }}
                  animate={{ width: `${pct}%` }}
                  transition={mountedRef.current
                    // Live update — respond immediately, no entrance delay
                    ? { duration: 0.5, ease: [0.16, 1, 0.3, 1] }
                    // First mount — staggered entrance so bars cascade in
                    : { duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.45 + i * 0.18 }
                  }
                />
                {(isCorrect || isWinner) && !isWrong && (
                  <motion.div
                    className="absolute inset-y-0 left-0 w-full bg-gradient-to-r from-transparent via-white/20 to-transparent"
                    animate={{ x: ['-100%', '200%'] }}
                    transition={{ duration: 2.2, repeat: Infinity, repeatDelay: 1 }}
                  />
                )}
              </div>
            </div>
          </motion.div>
        )
      })}
    </motion.div>
  )
}

/* ── Shared SVG helpers for pie / donut ───────────────────────────────── */

function polarToXY(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  // Offset by -90 so 0° starts at 12 o'clock
  if (endAngle - startAngle >= 359.99) {
    const m = polarToXY(cx, cy, r, -90)
    const h = polarToXY(cx, cy, r, 90)
    return `M ${cx} ${cy} L ${m.x} ${m.y} A ${r} ${r} 0 0 1 ${h.x} ${h.y} A ${r} ${r} 0 0 1 ${m.x} ${m.y} Z`
  }
  const s = polarToXY(cx, cy, r, startAngle - 90)
  const e = polarToXY(cx, cy, r, endAngle   - 90)
  const large = endAngle - startAngle > 180 ? 1 : 0
  return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} Z`
}

/* ── Legend shared by pie / donut ─────────────────────────────────────── */

function VizLegend({ options, votes, total, legendTotal, maxV, correctAnswers, revealed }: {
  options: string[]; votes: number[]; total: number; legendTotal?: number; maxV: number
  correctAnswers?: number[]; revealed?: boolean
}) {
  const corrSet   = new Set(correctAnswers ?? [])
  const pctDenom  = legendTotal ?? total   // use respondentCount when provided
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-3">
      {options.map((opt, i) => {
        const v         = votes[i] ?? 0
        const pct       = pctDenom > 0 ? Math.round((v / pctDenom) * 100) : 0
        const isWinner  = v > 0 && v === maxV
        const isCorrect = revealed && corrSet.has(i)
        const isWrong   = revealed && corrSet.size > 0 && !corrSet.has(i)
        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: isWrong ? 0.28 : 1, x: 0 }}
            transition={{ delay: i * 0.08, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="flex min-w-0 items-center gap-3"
          >
            <span
              className={cn('size-3 shrink-0 rounded-full', isCorrect && 'ring-2 ring-fresh-green ring-offset-1 ring-offset-midnight-sky-900')}
              style={{ backgroundColor: isCorrect ? '#42db66' : VIZ_COLORS[i % VIZ_COLORS.length] }}
            />
            <span className={cn(
              'min-w-0 flex-1 truncate text-base font-medium leading-snug',
              isCorrect ? 'text-fresh-green' : isWinner ? 'text-white' : 'text-white/60',
            )}>
              {opt}
            </span>
            <span className={cn(
              'shrink-0 text-xl font-bold tabular-nums',
              isCorrect ? 'text-fresh-green' : isWinner ? 'text-white' : 'text-white/40',
            )}>
              {pct}%
            </span>
          </motion.div>
        )
      })}
    </div>
  )
}

/* ── Donut chart ──────────────────────────────────────────────────────── */

function MCQDonutChart({ options, votes, respondentCount, correctAnswers, revealed }: {
  options: string[]; votes: number[]
  respondentCount?: number
  correctAnswers?: number[]; revealed?: boolean
}) {
  const corrSet    = new Set(correctAnswers ?? [])
  const total      = votes.reduce((s, v) => s + v, 0)
  const legendTotal = respondentCount ?? total   // % of respondents for multi-select
  const maxV   = Math.max(...votes, 1)
  const winner = votes.indexOf(Math.max(...votes))

  const R    = 42
  const CX   = 60; const CY = 60
  const circ = 2 * Math.PI * R

  let cumulative = 0
  const segments = options.map((opt, i) => {
    const v       = votes[i] ?? 0
    const dashLen = total > 0 ? (v / total) * circ : 0
    const offset  = cumulative
    cumulative   += dashLen
    return { opt, v, dashLen, offset, color: VIZ_COLORS[i % VIZ_COLORS.length] }
  })

  return (
    <div className="flex items-center gap-12">
      {/* Donut */}
      <div className="relative shrink-0">
        <svg viewBox="0 0 120 120" className="size-56" style={{ transform: 'rotate(-90deg)' }}>
          {/* Track ring */}
          <circle r={R} cx={CX} cy={CY} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={20} />
          {total === 0 ? (
            <circle r={R} cx={CX} cy={CY} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={20}
              strokeDasharray={`${circ * 0.99} ${circ * 0.01}`} />
          ) : (
            segments.map((seg, i) => {
              const isWrong = revealed && corrSet.size > 0 && !corrSet.has(i)
              return (
                <motion.circle
                  key={i}
                  r={R} cx={CX} cy={CY}
                  fill="none"
                  stroke={revealed && corrSet.has(i) ? '#42db66' : seg.color}
                  strokeWidth={20}
                  strokeDasharray={`${seg.dashLen} ${circ - seg.dashLen}`}
                  strokeDashoffset={-seg.offset}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: isWrong ? 0.2 : 1 }}
                  transition={{ duration: 0.5, delay: i * 0.12 }}
                />
              )
            })
          )}
        </svg>
        {/* Centre label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {total > 0 ? (
            <>
              <span className="text-3xl font-bold tabular-nums"
                style={{ color: revealed && corrSet.has(winner) ? '#42db66' : VIZ_COLORS[winner % VIZ_COLORS.length] }}>
                {Math.round((votes[winner] / legendTotal) * 100)}%
              </span>
              <span className="mt-0.5 max-w-[80px] text-xs font-medium leading-tight text-white/55">
                {options[winner]}
              </span>
            </>
          ) : (
            <span className="text-sm text-white/30">No votes</span>
          )}
        </div>
      </div>
      <VizLegend options={options} votes={votes} total={total} legendTotal={legendTotal} maxV={maxV} correctAnswers={correctAnswers} revealed={revealed} />
    </div>
  )
}

/* ── Pie chart ────────────────────────────────────────────────────────── */

function MCQPieChart({ options, votes, respondentCount, correctAnswers, revealed }: {
  options: string[]; votes: number[]
  respondentCount?: number
  correctAnswers?: number[]; revealed?: boolean
}) {
  const total      = votes.reduce((s, v) => s + v, 0)
  const legendTotal = respondentCount ?? total
  const maxV    = Math.max(...votes, 1)
  const corrSet = new Set(correctAnswers ?? [])

  let cumAngle = 0
  const segments = options.map((opt, i) => {
    const v     = votes[i] ?? 0
    const frac  = total > 0 ? v / total : 0
    const start = cumAngle
    cumAngle   += frac * 360
    return { opt, v, frac, startAngle: start, endAngle: cumAngle, color: VIZ_COLORS[i % VIZ_COLORS.length] }
  })

  return (
    <div className="flex min-w-0 items-center gap-6">
      <svg viewBox="0 0 120 120" className="size-36 shrink-0 lg:size-48 xl:size-56">
        {total === 0 ? (
          <circle r={54} cx={60} cy={60} fill="rgba(255,255,255,0.08)" />
        ) : (
          segments.map((seg, i) => {
            const isWrong = revealed && corrSet.size > 0 && !corrSet.has(i)
            return (
              <motion.path
                key={i}
                d={describeArc(60, 60, 54, seg.startAngle, seg.endAngle)}
                fill={revealed && corrSet.has(i) ? '#42db66' : seg.color}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: isWrong ? 0.2 : 1, scale: 1 }}
                transition={{ duration: 0.5, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                style={{ transformOrigin: '60px 60px' }}
              />
            )
          })
        )}
      </svg>
      <VizLegend options={options} votes={votes} total={total} legendTotal={legendTotal} maxV={maxV} correctAnswers={correctAnswers} revealed={revealed} />
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Word Cloud Results — Archimedean spiral placement (no external library)
   ───────────────────────────────────────────────────────────────────────── */

// Per-theme word palettes — every color vetted to contrast against that bg.
// No word will ever blend into its slide background.
const CLOUD_THEME_PALETTES: Record<string, string[]> = {
  // Dark navy (#000079): all bright vivid colors read well
  navy:        ['#ff0065','#00b0ff','#42db66','#ffc709','#c084fc','#fb923c','#22d3ee','#f472b6','#4ade80','#facc15','#a78bfa','#34d399'],
  // Hot pink (#ff0065): avoid red/magenta; white, cyan, gold, green, navy, purple
  pink:        ['#ffffff','#ffc709','#22d3ee','#000079','#4ade80','#818cf8','#a3e635','#06b6d4','#c084fc','#e0f2fe','#34d399','#60a5fa'],
  // Sky blue (#00b0ff): avoid light blue/cyan; navy, hot-pink, dark green, dark gold, dark purple
  sky:         ['#000079','#ff0065','#166534','#92400e','#6b21a8','#9f1239','#1d4ed8','#7c2d12','#14532d','#581c87','#c2410c','#1e3a5f'],
  // Fresh green (#42db66): avoid green/lime; navy, hot-pink, dark blue, dark gold, purple
  green:       ['#000079','#ff0065','#1d4ed8','#92400e','#6b21a8','#9f1239','#0c4a6e','#7c2d12','#581c87','#164e63','#c2410c','#1e1b4b'],
  // Golden (#ffc709): avoid yellow/gold/orange; navy, hot-pink, blue, forest-green, purple
  golden:      ['#000079','#ff0065','#1d4ed8','#166534','#6b21a8','#9f1239','#0c4a6e','#14532d','#581c87','#164e63','#c2410c','#1e1b4b'],
  // White (#f4f4f9): avoid light colors; navy, hot-pink, dark blue, dark green, purple, dark red
  white:       ['#000079','#ff0065','#0369a1','#166534','#6b21a8','#be185d','#1d4ed8','#9f1239','#92400e','#581c87','#134e4a','#7c2d12'],
  // Transparent: image behind — bright vivid palette like navy works on most photo backgrounds
  transparent: ['#ff0065','#00b0ff','#42db66','#ffc709','#c084fc','#fb923c','#22d3ee','#f472b6','#4ade80','#facc15','#a78bfa','#34d399'],
}

interface PlacedWord {
  text: string; x: number; y: number
  fontSize: number; fontWeight: string; color: string; isTop: boolean
}

/** Measure a word's pixel bounding box using an offscreen canvas.
 *  Large horizontal padding (1.0 × font size) compensates for two sources of error:
 *  (1) the canvas may fall back to a system font narrower than the rendered Inter, and
 *  (2) Chromium's canvas metrics under-report variable-font widths.
 *  Generous padding keeps words visually separated even at high browser zoom. */
function measureWord(text: string, size: number, weight: string): { w: number; h: number } {
  // Character-count formula — more reliable than canvas.measureText (which falls back
  // to a narrow system font). Inter avg char width ≈ 0.60–0.65× font size.
  // +1.0× size adds half-char padding on each side for breathing room.
  const wFactor = parseInt(weight, 10) >= 700 ? 0.65 : 0.60
  return {
    w: text.length * size * wFactor + size * 1.0,
    h: size * 1.5,
  }
}

/**
 * Archimedean spiral word-cloud layout.
 * Words are sorted largest-first (already true from aggregateCloud).
 * Each word spirals outward from center until it finds a collision-free slot.
 * The golden-angle offset (idx × 137.5°) distributes starting directions
 * evenly so words radiate in all directions rather than stacking on one side.
 */
function layoutWordCloud(
  words: { text: string; count: number }[],
  cw: number, ch: number,
  palette: string[],
): PlacedWord[] {
  if (!words.length || cw < 10 || ch < 10) return []

  const maxC    = Math.max(...words.map(w => w.count))
  const n       = words.length
  const minF    = 14

  // The top word (idx=0, highest count) must always fit centered.
  // If its bounding box is wider than the container, the spiral boundary check fails at
  // r=0 and the word gets pushed off-center. We cap rawMaxF so that never happens.
  // formula: w = text.length × size × wFactor + size  →  size ≤ (cw-40) / (len×wFactor+1)
  const topWordLen    = words[0]?.text.length ?? 1
  const maxFForCenter = (cw - 40) / Math.max(1, topWordLen * 0.65 + 1.0)
  const rawMaxF       = Math.min(96, ch * 0.25, Math.max(minF + 8, maxFForCenter))

  // Two-mode max-font strategy:
  //   • All words unique (maxC = 1): n-based reduction so many same-size words don't overflow.
  //   • Dominant word exists (maxC > 1): let it be large — power curve makes single-count
  //     words small so the dominant word stands out 3-4×.
  const maxF = maxC <= 1
    ? Math.min(rawMaxF, Math.max(22, rawMaxF / Math.sqrt(n * 0.35 + 0.65)))
    : Math.min(88, rawMaxF)

  const placed: Array<{ x1: number; y1: number; x2: number; y2: number }> = []
  const result: PlacedWord[] = []
  const cx = cw / 2
  const cy = ch / 2

  words.forEach((word, idx) => {
    const freqRatio = maxC > 0 ? word.count / maxC : 1
    const ratio     = Math.max(0.18, Math.pow(freqRatio, 2.5))
    const size      = Math.round(minF + ratio * (maxF - minF))
    const weight    = ratio >= 0.75 ? '800' : ratio >= 0.50 ? '700' : ratio >= 0.30 ? '600' : '500'
    const color     = palette[idx % palette.length]
    const isTop     = idx === 0

    // ── Dominant word: guaranteed dead-centre placement ────────────────────
    // Skip the spiral entirely — force to (cx, cy) and shrink font only if
    // the bounding box genuinely overflows the container edges.
    if (idx === 0) {
      let s    = size
      let dims = measureWord(word.text, s, weight)
      while (s > minF && (
        cx - dims.w / 2 < 16 || cx + dims.w / 2 > cw - 16 ||
        cy - dims.h / 2 < 16 || cy + dims.h / 2 > ch - 16
      )) { s -= 2; dims = measureWord(word.text, s, weight) }
      placed.push({ x1: cx - dims.w / 2, y1: cy - dims.h / 2, x2: cx + dims.w / 2, y2: cy + dims.h / 2 })
      result.push({ text: word.text, x: cx, y: cy, fontSize: s, fontWeight: weight, color, isTop: true })
      return
    }

    // ── All other words: Archimedean spiral from centre ────────────────────
    // Starting at r=0 (centre) for every word produces a compact cloud where
    // each word fills the nearest open slot, radiating outward — like Mentimeter.
    // Golden-angle direction offset (idx × 137.5°) distributes words evenly.
    // If placement fails at the original size, retry with progressively smaller
    // font until the word fits or drops below minF.
    const gap = 10

    for (let attempt = 0; attempt <= 4; attempt++) {
      const s = Math.max(minF, size - attempt * 6)
      const { w, h } = measureWord(word.text, s, weight)
      let placed_ = false

      for (let step = 0; step < 3000; step++) {
        const t  = step * 0.25 + idx * 2.39996   // golden-angle direction per word
        const r  = 0.30 * step                    // slow expansion → dense, compact cloud
        const x  = cx + r * Math.cos(t)
        const y  = cy + r * Math.sin(t) * 0.75   // slight vertical flatten
        const x1 = x - w / 2, y1 = y - h / 2
        const x2 = x + w / 2, y2 = y + h / 2

        if (x1 < 16 || y1 < 16 || x2 > cw - 16 || y2 > ch - 16) continue

        if (placed.some(p =>
          x2 + gap > p.x1 && x1 - gap < p.x2 &&
          y2 + gap > p.y1 && y1 - gap < p.y2,
        )) continue

        placed.push({ x1, y1, x2, y2 })
        result.push({ text: word.text, x, y, fontSize: s, fontWeight: weight, color, isTop })
        placed_ = true
        break
      }
      if (placed_) break
      if (s <= minF) break   // already at minimum — give up
    }
  })

  return result
}

/**
 * Word cloud rendered directly on the slide background — no inner box.
 *
 * Animation model (Mentimeter-style):
 *   • NEW word arriving  → pops in from scale 0 with spring bounce
 *   • EXISTING words that moved to make room → smoothly slide to new positions (Framer Motion `layout`)
 *   • REPEATED word that grew → same spring-in at new size; surrounding words slide outward
 *
 * We track which texts were in the previous layout so we can distinguish
 * "new arrival" from "repositioned existing word" on every update.
 */
function WordCloudResults({
  words,
  slideTheme,
}: {
  words: { text: string; count: number }[]
  slideTheme?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout]   = useState<PlacedWord[]>([])
  // Texts from the PREVIOUS render — used to decide which words are brand-new
  const prevTextsRef = useRef(new Set<string>())

  const palette = CLOUD_THEME_PALETTES[slideTheme ?? 'navy'] ?? CLOUD_THEME_PALETTES.navy

  useEffect(() => {
    if (!containerRef.current) return
    const compute = () => {
      const el = containerRef.current
      if (!el) return
      const { width, height } = el.getBoundingClientRect()
      setLayout(layoutWordCloud(words, width, height, palette))
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  // palette changes whenever slideTheme changes — include it in deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words, slideTheme])

  // After each layout update, remember which texts are now placed — used next render
  useEffect(() => {
    prevTextsRef.current = new Set(layout.map(w => w.text))
  }, [layout])

  // Soft elliptical mask — words near edges fade into the slide background.
  // This gives a natural cloud-like boundary without any hard rectangle.
  const maskStyle: React.CSSProperties = {
    maskImage:       'radial-gradient(ellipse 90% 86% at 50% 50%, black 42%, rgba(0,0,0,0.6) 65%, transparent 100%)',
    WebkitMaskImage: 'radial-gradient(ellipse 90% 86% at 50% 50%, black 42%, rgba(0,0,0,0.6) 65%, transparent 100%)',
  }

  return (
    <div
      ref={containerRef}
      className="relative"
      style={{ height: '100%', minHeight: 300, ...maskStyle }}
    >
      {/* Empty state — shown before any responses arrive */}
      {layout.length === 0 && (
        <div
          className="flex h-full min-h-[260px] items-center justify-center text-sm"
          style={{ color: `${palette[0]}80` }}
        >
          Waiting for responses…
        </div>
      )}

      {/* Placed words */}
      {layout.map((item) => {
        // Is this word appearing for the first time in this render?
        const isNew = !prevTextsRef.current.has(item.text)
        // Outer div handles positioning only — no Framer Motion so the centering
        // transform: translate(-50%,-50%) is never overridden by Framer's own transform.
        // Inner motion.span handles the pop-in animation (opacity + scale spring).
        return (
          <div
            key={item.text}
            className="absolute"
            style={{
              left: item.x,
              top: item.y,
              transform: 'translate(-50%, -50%)',
              // Existing words glide to new positions; new words skip transition
              // so they appear at their target spot (the pop-in handles their entrance).
              transition: isNew ? undefined : 'left 1.4s cubic-bezier(0.16,1,0.3,1), top 1.4s cubic-bezier(0.16,1,0.3,1)',
            }}
          >
            <motion.span
              initial={isNew ? { opacity: 0, scale: 0 } : { opacity: 1, scale: 1 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={isNew
                ? {
                    opacity: { duration: 0.35, delay: 0.1 },
                    scale:   { type: 'spring', stiffness: 160, damping: 20, delay: 0.08 },
                  }
                : { duration: 0 }
              }
              className="select-none leading-none whitespace-nowrap"
              style={{
                display:    'block',
                fontSize:   item.fontSize,
                fontWeight: item.fontWeight,
                color:      item.color,
                textShadow: item.isTop ? `0 0 48px ${item.color}bb` : undefined,
                // Smooth size changes when a word grows as it gets more votes
                transition: isNew ? undefined : 'font-size 1.0s cubic-bezier(0.16,1,0.3,1)',
              }}
            >
              {item.text}
            </motion.span>
          </div>
        )
      })}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Open-ended Results — live answer cards
   ───────────────────────────────────────────────────────────────────────── */

function OpenEndedResults({
  answers, pinnedKeys, onTogglePin, slideTheme,
}: {
  answers:      { name: string; text: string }[]
  pinnedKeys:   Set<string>
  onTogglePin:  (key: string) => void
  slideTheme?:  string
}) {
  const c = qColors(slideTheme)

  // Newest-first key — first 60 chars of text is unique enough per response
  const pinKey = (ans: { text: string }) => ans.text.slice(0, 60)

  // Ref on the first card — auto-scroll to it whenever a new answer arrives
  const topRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [answers.length])

  if (answers.length === 0) {
    return (
      <div className="flex min-h-[120px] items-center justify-center rounded-2xl text-sm" style={{ color: c.fgFaint }}>
        Waiting for responses…
      </div>
    )
  }

  // Pinned responses float to the top; within each group preserve arrival order
  const sorted = [
    ...answers.filter(a => pinnedKeys.has(pinKey(a))),
    ...answers.filter(a => !pinnedKeys.has(pinKey(a))),
  ]

  return (
    <div className="grid auto-rows-min gap-2 md:grid-cols-2 lg:grid-cols-3">
      <AnimatePresence>
        {sorted.map((ans, i) => {
          const key      = pinKey(ans)
          const isPinned = pinnedKeys.has(key)
          return (
            <motion.div
              ref={i === 0 ? topRef : undefined}
              key={`${ans.name}-${ans.text.slice(0, 20)}`}
              initial={{ opacity: 0, y: 12, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="relative rounded-2xl p-3.5 backdrop-blur-sm"
              style={isPinned
                ? { backgroundColor: 'rgba(255,0,101,0.12)', border: '1px solid rgba(255,0,101,0.35)' }
                : { backgroundColor: c.cardBg,               border: `1px solid ${c.cardBorder}` }
              }
            >
              {/* Pin button — always visible so it's tappable on touch screens */}
              <button
                onClick={() => onTogglePin(key)}
                title={isPinned ? 'Unpin' : 'Pin to top'}
                className="absolute right-2.5 top-2.5 rounded-lg p-1 transition-all"
                style={{ color: isPinned ? '#ff0065' : c.fgFaint }}
              >
                <Pin className={cn('size-3', isPinned && 'fill-current')} />
              </button>
              <p className="pr-5 text-sm font-light leading-relaxed" style={{ color: c.fg }}>
                "{ans.text}"
              </p>
              <p className="mt-2 text-[11px] font-medium" style={{ color: c.fgDim }}>
                — {ans.name}
              </p>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Rating Results — average score + distribution histogram per parameter
   ───────────────────────────────────────────────────────────────────────── */

// Rank badge styles: index 0 = 1st (gold), 1 = 2nd (silver), 2 = 3rd (bronze)
// All ranks use the same gold style — 1st, 2nd, 3rd, 4th, …
function rankOrdinal(rank: number): string {
  const n = rank + 1
  return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`
}
const RANK_BADGE_STYLE = { bg: 'bg-golden-sun/25', text: 'text-golden-sun', border: 'border-golden-sun/40' }

function RatingResults({ params, avgs, distributions, ratingMax = 5, leftLabels = [], rightLabels = [], darkBg = false, theme }: {
  params:        string[]
  avgs:          number[]
  distributions: number[][]
  ratingMax?:    number
  leftLabels?:   string[]
  rightLabels?:  string[]
  darkBg?:       boolean
  theme?:        string
}) {
  const dense = params.length >= 4

  // Sort by average score descending — highest rated first
  const order = params.map((_, i) => i).sort((a, b) => (avgs[b] ?? 0) - (avgs[a] ?? 0))

  return (
    <div className={cn('flex h-full flex-col', dense ? 'gap-1' : 'gap-2')}>
      {order.map((idx, rank) => (
        <RatingRow
          key={idx}
          label={params[idx]}
          avg={avgs[idx] ?? 0}
          dist={distributions[idx] ?? Array(ratingMax + 1).fill(0)}
          ratingMax={ratingMax}
          dense={dense}
          darkBg={darkBg}
          theme={theme}
          leftLabel ={leftLabels[idx]  ?? ''}
          rightLabel={rightLabels[idx] ?? ''}
          delay={rank * 0.13}
          rank={rank}
        />
      ))}
    </div>
  )
}

// Gradient from cool (0) to hot-pink (max). Computed on the fly so we
// get a smooth gradient regardless of scale (5 or 10).
function ratingBarColor(bucketIdx: number, total: number): string {
  if (total <= 1) return '#ff0065'
  const t = bucketIdx / (total - 1)          // 0 (lowest) → 1 (highest)
  if (t === 1) return '#ff0065'              // top: solid hot-pink
  if (t >= 0.75) return 'rgba(255,0,101,0.55)'
  if (t >= 0.5)  return 'rgba(255,199,9,0.65)'
  if (t >= 0.25) return 'rgba(255,199,9,0.38)'
  return 'rgba(255,255,255,0.20)'
}

function RatingRow({ label, avg, dist, ratingMax = 5, dense = false, darkBg = false, theme, leftLabel, rightLabel, delay, rank }: {
  label: string; avg: number; dist: number[]; ratingMax?: number
  dense?: boolean
  darkBg?: boolean
  theme?: string
  leftLabel?: string; rightLabel?: string
  delay: number
  rank?: number
}) {
  const displayed  = useCountUp(Math.round(avg * 10), 950) / 10
  const maxCount   = Math.max(...dist, 1)
  const hasEndLabels = !!leftLabel || !!rightLabel
  const badge = rank !== undefined ? { ...RANK_BADGE_STYLE, label: rankOrdinal(rank) } : null
  const tc = qColors(theme)

  return (
    <motion.div
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'flex min-h-0 flex-1 flex-col rounded-2xl border backdrop-blur-sm',
        darkBg
          ? (rank === 0 ? 'border-golden-sun/30 bg-midnight-sky-900/75' : 'border-midnight-sky-700/60 bg-midnight-sky-900/65')
          : (rank === 0 ? 'border-golden-sun/30 bg-golden-sun/5'        : 'border-white/10 bg-white/5'),
        dense ? 'px-3 py-1.5' : 'px-6 py-3',
      )}
    >
      {/* Top row: rank badge + parameter label + animated average */}
      <div className={cn('flex shrink-0 items-center justify-between gap-3', dense ? 'mb-1' : 'mb-2')}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {badge && (
            <span className={cn(
              'shrink-0 rounded-md border font-bold uppercase tracking-wide',
              dense ? 'px-1.5 py-px text-[10px]' : 'px-2 py-0.5 text-[11px]',
              badge.bg, badge.text, badge.border,
            )}>
              {badge.label}
            </span>
          )}
          <span className={cn('min-w-0 truncate font-semibold', dense ? 'text-sm' : 'text-xl md:text-2xl')} style={{ color: tc.fg }}>
            {label}
          </span>
        </div>
        <div className="flex items-baseline gap-0.5">
          <span className={cn(
            'font-extrabold tabular-nums text-hot-pink',
            dense ? 'text-xl' : 'text-4xl md:text-5xl',
          )}>
            {displayed.toFixed(1)}
          </span>
          <span className={cn(
            'font-semibold',
            dense ? 'text-xs' : 'text-xl md:text-2xl',
          )} style={{ color: tc.fgDim }}>/{ratingMax}</span>
        </div>
      </div>

      {/* Distribution mini-histogram — fills remaining row height */}
      <div className="flex min-h-0 flex-1 items-end gap-1">
        {dist.map((count, bucketIdx) => {
          const barPct = count > 0 ? Math.max((count / maxCount) * 100, 5) : 0
          return (
            <div key={bucketIdx} className="flex h-full flex-1 flex-col items-center justify-end gap-0.5">
              <motion.span
                key={`c-${bucketIdx}-${count}`}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: count > 0 ? 1 : 0, y: 0 }}
                transition={{ duration: 0.25, delay: delay + bucketIdx * 0.04 + 0.5 }}
                className={cn('shrink-0 font-bold tabular-nums', dense ? 'text-[9px]' : 'text-[11px]')}
                style={{ color: count > 0 ? tc.fg : 'transparent' }}
              >
                {count > 0 ? count : ''}
              </motion.span>
              <div className="flex w-full min-h-0 flex-1 items-end">
                <motion.div
                  className="w-full rounded-t-sm"
                  style={{ backgroundColor: ratingBarColor(bucketIdx, dist.length) }}
                  initial={{ height: '0%' }}
                  animate={{ height: `${barPct}%` }}
                  transition={{ duration: 0.7, delay: delay + bucketIdx * 0.04, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
              <span className={cn('shrink-0 font-medium tabular-nums', dense ? 'text-[9px]' : 'text-[10px]')} style={{ color: count > 0 ? tc.fgDim : tc.fgFaint }}>{bucketIdx}</span>
            </div>
          )
        })}
      </div>

      {/* Anchor labels at the ends of the scale (Mentimeter-style) */}
      {hasEndLabels && (
        <div className={cn('flex justify-between font-semibold uppercase tracking-wider', dense ? 'mt-0.5 text-[9px]' : 'mt-1 text-[10px]')} style={{ color: tc.fgDim }}>
          <span className="truncate pr-2">{leftLabel}</span>
          <span className="truncate pl-2 text-right">{rightLabel}</span>
        </div>
      )}
    </motion.div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Shared hook — smooth count-up animation
   ───────────────────────────────────────────────────────────────────────── */

function useCountUp(target: number, duration = 900) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    let raf: number
    const start = performance.now()
    const step  = (now: number) => {
      const p = Math.min((now - start) / duration, 1)
      setCount(Math.round((1 - Math.pow(1 - p, 3)) * target))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return count
}

/* ─────────────────────────────────────────────────────────────────────────
   buildResultsSnapshot — turns the deck + raw response docs into a clean
   DeckResults snapshot suitable for storage on the deck. Only question
   slides are included; non-question slides are skipped.
   ───────────────────────────────────────────────────────────────────────── */

function buildResultsSnapshot(
  deck: AnySlide[],
  responses: FirestoreResponse[],
  sessionCode: string,
  startedAt: number,
  peakAudience: number,
): DeckResults {
  const QTYPES = new Set<string>(['mcq', 'wordcloud', 'openended', 'rating'])
  // Group responses by slideId for fast lookup
  const byId = new Map<string, FirestoreResponse[]>()
  for (const r of responses) {
    const arr = byId.get(r.slideId) ?? []
    arr.push(r)
    byId.set(r.slideId, arr)
  }
  const questions: ResultQuestion[] = []
  for (const s of deck) {
    if (!QTYPES.has(s.type)) continue
    const q     = s as QSlide
    const raws  = byId.get(q.id) ?? []
    // Sort responses chronologically (oldest → newest)
    const responsesForSlide: ResultResponse[] = raws
      .map(r => ({
        name:  (r.respondentName && r.respondentName.trim()) || 'Anonymous',
        value: String(r.value ?? ''),
        // Firestore Timestamp → unix ms (handles plain objects too)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        time:  ((r.submittedAt as any)?.toMillis?.() ?? Date.now()) as number,
        // Quiz mode: preserve the score breakdown so the Leaderboard export
        // matches the live on-screen scores. Conditionally spread — Firestore
        // rejects `undefined`, and non-quiz responses have no points.
        ...(r.quizPoints ? { quizPoints: r.quizPoints } : {}),
      }))
      .sort((a, b) => a.time - b.time)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const qany = q as any
    const leftLabels  = Array.isArray(qany.leftLabels)  ? qany.leftLabels  : (qany.leftLabel  ? (q.options ?? []).map(() => qany.leftLabel)  : undefined)
    const rightLabels = Array.isArray(qany.rightLabels) ? qany.rightLabels : (qany.rightLabel ? (q.options ?? []).map(() => qany.rightLabel) : undefined)
    // Firestore rejects any document containing `undefined` field values, so
    // we conditionally spread only the optional fields that have a real value.
    questions.push({
      slideId:       q.id,
      question:      q.question ?? '',
      type:          q.type as ResultQuestionType,
      options:       q.options ?? [],
      responses:     responsesForSlide,
      responseCount: responsesForSlide.length,
      ...(qany.ratingMax ? { ratingMax: qany.ratingMax } : {}),
      ...(leftLabels  ? { leftLabels  } : {}),
      ...(rightLabels ? { rightLabels } : {}),
      ...(q.vizType   ? { vizType: q.vizType } : {}),
      ...(q.type === 'mcq' && q.correctAnswers?.length ? { correctAnswers: q.correctAnswers } : {}),
    })
  }
  return {
    id:            `s_${startedAt}`,
    sessionCode,
    conductedAt:   startedAt,
    endedAt:       Date.now(),
    audienceCount: peakAudience,
    questions,
  }
}

/* ─────────────────────────────────────────────────────────────────────────
   Timer overlay components — self-contained so only they re-render per tick,
   not the entire Present component tree (which would cause slide flashing).
   ───────────────────────────────────────────────────────────────────────── */

/**
 * Pick timer bar / text / pill colors that contrast against the slide background.
 * E.g. a pink slide should NOT use hot-pink for urgency (it would vanish).
 */
function getTimerColors(
  theme: string | undefined,
  secsLeft: number,
): { bar: string; text: string; pill: string; border: string } {
  const t = theme ?? 'navy'

  if (t === 'pink') {
    if (secsLeft <= 10) return { bar: '#ffffff',  text: '#ffffff',           pill: 'rgba(180,0,50,0.55)',   border: 'rgba(255,255,255,0.30)' }
    if (secsLeft <= 30) return { bar: '#ffc709',  text: '#7a3a00',           pill: 'rgba(255,199,9,0.55)',  border: 'rgba(255,199,9,0.40)'   }
    return                     { bar: '#ffffff',  text: '#ffffff',           pill: 'rgba(180,0,50,0.45)',   border: 'rgba(255,255,255,0.25)' }
  }
  if (t === 'sky' || t === 'green') {
    if (secsLeft <= 10) return { bar: '#000079',  text: '#ffffff',           pill: 'rgba(200,0,60,0.75)',   border: 'rgba(255,255,255,0.20)' }
    if (secsLeft <= 30) return { bar: '#ff0065',  text: '#ffffff',           pill: 'rgba(200,0,60,0.60)',   border: 'rgba(255,0,101,0.30)'   }
    return                     { bar: '#000079',  text: '#ffffff',           pill: 'rgba(0,0,90,0.60)',     border: 'rgba(0,0,121,0.30)'     }
  }
  if (t === 'golden') {
    if (secsLeft <= 10) return { bar: '#ff0065',  text: '#ffffff',           pill: 'rgba(200,0,60,0.75)',   border: 'rgba(255,255,255,0.20)' }
    if (secsLeft <= 30) return { bar: '#000079',  text: '#ffffff',           pill: 'rgba(0,0,90,0.60)',     border: 'rgba(0,0,121,0.30)'     }
    return                     { bar: '#000079',  text: '#ffffff',           pill: 'rgba(0,0,90,0.55)',     border: 'rgba(0,0,121,0.25)'     }
  }
  if (t === 'white') {
    if (secsLeft <= 10) return { bar: '#ff0065',  text: '#ffffff',           pill: 'rgba(200,0,60,0.80)',   border: 'rgba(255,0,101,0.30)'   }
    if (secsLeft <= 30) return { bar: '#000079',  text: '#ffffff',           pill: 'rgba(0,0,90,0.75)',     border: 'rgba(0,0,121,0.30)'     }
    return                     { bar: '#00b0ff',  text: '#ffffff',           pill: 'rgba(0,90,160,0.70)',   border: 'rgba(0,176,255,0.30)'   }
  }
  // navy (default) and anything else
  if (secsLeft <= 10) return   { bar: '#ff0065',  text: '#ffffff',           pill: 'rgba(200,0,60,0.70)',   border: 'rgba(255,0,101,0.35)'   }
  if (secsLeft <= 30) return   { bar: '#ffc709',  text: '#3a2a00',           pill: 'rgba(200,155,0,0.65)',  border: 'rgba(255,199,9,0.35)'   }
  return                       { bar: '#00b0ff',  text: '#ffffff',           pill: 'rgba(0,100,180,0.60)',  border: 'rgba(0,176,255,0.30)'   }
}

/* ─────────────────────────────────────────────────────────────────────────
   Quiz leaderboard — scoring and display
   ───────────────────────────────────────────────────────────────────────── */

function calculateQuizLeaderboard(
  responses: FirestoreResponse[],
  slides: AnySlide[],
  questionMeta: Record<string, { openedAt: number; duration: number | null }>,
): { name: string; score: number; emoji?: string }[] {
  const totals: Record<string, number> = {}
  const emojis: Record<string, string> = {}
  for (const slide of slides) {
    if (slide.type !== 'mcq') continue
    const qs = slide as QSlide
    if (!qs.correctAnswers?.length) continue
    const corrSet = new Set(qs.correctAnswers)
    const meta = questionMeta[qs.id]
    const slideResponses = responses.filter(r => r.slideId === qs.id)
    for (const r of slideResponses) {
      const name = r.respondentName || 'Anonymous'
      // Ensure every respondent appears on the leaderboard even if they score 0
      if (!(name in totals)) totals[name] = 0
      if (r.respondentEmoji) emojis[name] = r.respondentEmoji
      // Prefer stored quiz points (calculated on the audience device at submission time).
      // Fall back to recalculation from timestamps for older sessions that lack quizPoints.
      if (r.quizPoints !== undefined) {
        totals[name] += r.quizPoints.answer + r.quizPoints.speed
        continue
      }
      // Legacy fallback: recalculate from timestamps
      let selected: number[]
      try {
        const p = JSON.parse(r.value)
        selected = Array.isArray(p) ? p : [parseInt(r.value, 10)]
      } catch { selected = [parseInt(r.value, 10)] }
      // All-or-nothing: must match exactly
      const isCorrect = selected.length === corrSet.size && selected.every(i => corrSet.has(i))
      if (!isCorrect) continue
      let pts = 100
      if (meta?.duration && meta.openedAt) {
        const submittedMs = (r.submittedAt as unknown as { toMillis(): number }).toMillis?.() ?? Date.now()
        const elapsed = submittedMs - meta.openedAt
        const remaining = Math.max(0, meta.duration * 1000 - elapsed)
        pts += Math.round((remaining / (meta.duration * 1000)) * 100)
      }
      totals[name] = (totals[name] ?? 0) + pts
    }
  }
  return Object.entries(totals)
    .map(([name, score]) => ({ name, score, emoji: emojis[name] }))
    .sort((a, b) => b.score - a.score)
}

const MEDAL_COLORS = ['#ffc709', '#c0c0c0', '#cd7f32']

function LeaderboardSlideView({
  sessionCode, deck, questionMeta, slide,
}: {
  sessionCode:  string
  deck:         AnySlide[]
  questionMeta: Record<string, { openedAt: number; duration: number | null }>
  slide?:       LeaderboardSlide
}) {
  const [leaderboard, setLeaderboard] = useState<{ name: string; score: number; emoji?: string }[]>([])
  const [revealCount, setRevealCount] = useState(0)
  // Prevents the "No scores yet" placeholder flashing before data arrives
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (sessionCode === 'DEMO') {
      setLeaderboard([
        { name: 'Sarah M.',  score: 380, emoji: '🦁' },
        { name: 'James T.',  score: 340, emoji: '🧙' },
        { name: 'Priya K.',  score: 290, emoji: '🦸' },
        { name: 'Anonymous', score: 250, emoji: '🐯' },
        { name: 'Marcus L.', score: 210, emoji: '🚀' },
      ])
      setLoaded(true)
      return
    }
    Promise.all([
      fetchAllSessionResponses(sessionCode),
      getSessionByCode(sessionCode),
    ])
      .then(([responses, sessionData]) => {
        // Prefer Firestore's questionMeta (server-authoritative) over the local ref,
        // so speed-point timestamps match the Firestore response timestamps exactly.
        const meta = (sessionData?.questionMeta ?? questionMeta) as Record<string, { openedAt: number; duration: number | null }>
        const board = calculateQuizLeaderboard(responses, deck, meta)
        setLeaderboard(board.slice(0, 10))
        setLoaded(true)
      })
      .catch(() => { setLoaded(true) })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionCode])

  // Reveal entries 10th → 1st, one per 700ms
  useEffect(() => {
    if (leaderboard.length === 0) return
    const total = Math.min(leaderboard.length, 10)
    if (revealCount >= total) return
    const id = setTimeout(() => setRevealCount(c => c + 1), 700)
    return () => clearTimeout(id)
  }, [leaderboard, revealCount])

  const top10 = leaderboard.slice(0, 10)
  const maxScore = top10[0]?.score ?? 1
  // Reveal from last (10th) to first (1st)
  const revealedEntries = top10.slice(top10.length - revealCount)
  // The winner (#1) is revealed last — fire confetti the moment they appear.
  const winnerRevealed = revealCount >= top10.length && top10.length > 0

  const lbBg = slide?.bg
  const lbBgStyle: React.CSSProperties = !lbBg
    ? {}  // falls back to Tailwind bg-gradient-to-b class below
    : lbBg.type === 'color'    ? { backgroundColor: lbBg.value }
    : lbBg.type === 'gradient' ? { backgroundImage: lbBg.value }
    : { backgroundImage: `url(${lbBg.value})`, backgroundSize: 'cover', backgroundPosition: 'center' }

  // ── Responsive sizing tier based on player count ─────────────────────────
  // All class names are string literals so Tailwind picks them up at build time.
  const lbTier = top10.length <= 4 ? 0 : top10.length <= 6 ? 1 : 2
  const tc = ([
    // Tier 0 — 1–4 players: full size (current)
    {
      outerPb:     'pb-24',
      listGap:     'gap-3',
      titleText:   'text-5xl', titleTrophy: 'size-9', titleMb: 'mb-8',
      winner: { py: 'py-4',   emoji: 'text-3xl',  name: 'text-2xl',  bar: 'h-3',   pts: 'text-2xl w-28' },
      podium: { py: 'py-3',   emoji: 'text-2xl',  name: 'text-xl',   bar: 'h-2',   pts: 'text-lg  w-24' },
      other:  { py: 'py-2',   emoji: 'text-xl',   name: 'text-base', bar: 'h-2',   pts: 'text-lg  w-24' },
      badge:  { size: 'size-12', rank: 'text-xl',   crown: 'size-6', crownTop: '-top-5' },
      rankW:  'w-12 text-lg',
    },
    // Tier 1 — 5–6 players: medium
    {
      outerPb:     'pb-20',
      listGap:     'gap-2',
      titleText:   'text-4xl', titleTrophy: 'size-7', titleMb: 'mb-5',
      winner: { py: 'py-3',   emoji: 'text-2xl',  name: 'text-xl',   bar: 'h-2',   pts: 'text-xl  w-24' },
      podium: { py: 'py-2',   emoji: 'text-xl',   name: 'text-lg',   bar: 'h-2',   pts: 'text-lg  w-20' },
      other:  { py: 'py-1.5', emoji: 'text-lg',   name: 'text-sm',   bar: 'h-1.5', pts: 'text-base w-20' },
      badge:  { size: 'size-10', rank: 'text-lg',   crown: 'size-5', crownTop: '-top-4' },
      rankW:  'w-10 text-base',
    },
    // Tier 2 — 7–10 players: compact
    {
      outerPb:     'pb-16',
      listGap:     'gap-1.5',
      titleText:   'text-3xl', titleTrophy: 'size-6', titleMb: 'mb-3',
      winner: { py: 'py-2',   emoji: 'text-xl',   name: 'text-lg',   bar: 'h-2',   pts: 'text-lg  w-20' },
      podium: { py: 'py-1.5', emoji: 'text-lg',   name: 'text-base', bar: 'h-1.5', pts: 'text-base w-16' },
      other:  { py: 'py-1',   emoji: 'text-base', name: 'text-sm',   bar: 'h-1',   pts: 'text-sm  w-16' },
      badge:  { size: 'size-9',  rank: 'text-base', crown: 'size-4', crownTop: '-top-4' },
      rankW:  'w-9 text-sm',
    },
  ] as const)[lbTier]

  return (
    <div
      className={`absolute inset-0 flex flex-col overflow-hidden px-14 pt-12 ${tc.outerPb}${!lbBg ? ' bg-gradient-to-b from-midnight-sky-900 via-midnight-sky-900 to-[#1a0a3a]' : ''}`}
      style={lbBgStyle}
    >

      {/* Celebratory glow orbs behind everything */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-golden-sun/12 blur-[120px]" />
        <div className="absolute bottom-0 left-[8%] h-72 w-72 rounded-full bg-hot-pink/12 blur-[100px]" />
        <div className="absolute bottom-0 right-[8%] h-72 w-72 rounded-full bg-sky-blue/12 blur-[100px]" />
      </div>

      {/* Confetti burst — fires when the winner is revealed */}
      <AnimatePresence>{winnerRevealed && <Confetti />}</AnimatePresence>

      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className={`relative flex items-center justify-center gap-3 ${tc.titleMb}`}
      >
        <Trophy className={`${tc.titleTrophy} text-golden-sun drop-shadow-[0_0_18px_rgba(255,199,9,0.55)]`} />
        <h1 className={`${tc.titleText} font-extrabold tracking-tight text-white drop-shadow-[0_2px_20px_rgba(255,255,255,0.15)]`}>
          LEADERBOARD
        </h1>
        <Trophy className={`${tc.titleTrophy} text-golden-sun drop-shadow-[0_0_18px_rgba(255,199,9,0.55)]`} />
      </motion.div>

      {!loaded ? null : leaderboard.length === 0 ? (
        <div className="relative flex flex-1 items-center justify-center">
          <p className="text-white/30">No scores yet — no quiz questions have been answered.</p>
        </div>
      ) : (
        <div className={`relative flex flex-1 flex-col justify-center ${tc.listGap} overflow-hidden`}>
          {revealedEntries.map(entry => {
            const rank = top10.indexOf(entry) + 1
            const barPct = maxScore > 0 ? (entry.score / maxScore) * 100 : 0
            const medalColor = rank <= 3 ? MEDAL_COLORS[rank - 1] : null
            const isWinner = rank === 1
            const isPodium = rank <= 3
            const sz = isWinner ? tc.winner : isPodium ? tc.podium : tc.other
            return (
              <motion.div
                key={entry.name}
                initial={{ opacity: 0, x: -40, scale: 0.96 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 22 }}
                className={cn(
                  'flex items-center gap-4 rounded-2xl px-5 transition-colors',
                  sz.py,
                  isPodium && 'border bg-white/[0.04]',
                )}
                style={isPodium ? {
                  borderColor: `${medalColor}55`,
                  boxShadow: isWinner ? `0 0 40px -8px ${medalColor}80` : `0 0 24px -10px ${medalColor}66`,
                } : undefined}
              >
                {/* Rank badge — medal circle for top 3, plain number otherwise */}
                {isPodium ? (
                  <motion.div
                    initial={{ scale: 0, rotate: -30 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 16, delay: 0.1 }}
                    className={`relative flex ${tc.badge.size} shrink-0 items-center justify-center rounded-full ${tc.badge.rank} font-extrabold tabular-nums`}
                    style={{ backgroundColor: `${medalColor}26`, color: medalColor ?? undefined, border: `2px solid ${medalColor}` }}
                  >
                    {isWinner && (
                      <motion.div
                        initial={{ y: 6, opacity: 0, scale: 0.5 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 14, delay: 0.25 }}
                        className={`absolute ${tc.badge.crownTop} left-1/2 -translate-x-1/2`}
                      >
                        <Crown className={`${tc.badge.crown} fill-golden-sun text-golden-sun drop-shadow-[0_0_10px_rgba(255,199,9,0.8)]`} />
                      </motion.div>
                    )}
                    {rank}
                  </motion.div>
                ) : (
                  <span className={`${tc.rankW} shrink-0 text-center font-bold tabular-nums text-white/40`}>
                    {rank}
                  </span>
                )}

                {/* Emoji avatar */}
                <motion.span
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 16, delay: 0.08 }}
                  className={`shrink-0 leading-none ${sz.emoji}`}
                >
                  {entry.emoji ?? '👤'}
                </motion.span>

                <div className="flex flex-1 flex-col gap-1.5">
                  <span
                    className={`font-bold ${sz.name}`}
                    style={{ color: medalColor ?? 'rgba(255,255,255,0.9)' }}
                  >
                    {entry.name}
                  </span>
                  <div className={`relative overflow-hidden rounded-full bg-white/10 ${sz.bar}`}>
                    <motion.div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{
                        backgroundColor: medalColor ?? '#ff0065',
                        boxShadow: isPodium ? `0 0 12px ${medalColor}aa` : undefined,
                      }}
                      initial={{ width: '0%' }}
                      animate={{ width: `${barPct}%` }}
                      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
                    />
                  </div>
                </div>

                <motion.span
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.3, type: 'spring', stiffness: 300, damping: 18 }}
                  className={`shrink-0 text-right font-extrabold tabular-nums ${sz.pts}`}
                  style={{ color: medalColor ?? 'rgba(255,255,255,0.75)' }}
                >
                  {entry.score.toLocaleString()} pts
                </motion.span>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Confetti — lightweight celebratory burst rendered over the leaderboard.
   Pure framer-motion (no external lib); pieces fall + spin from the top.
   ───────────────────────────────────────────────────────────────────────── */

function Confetti() {
  const COLORS = ['#ffc709', '#ff0065', '#00b8d9', '#36b37e', '#ffffff', '#a855f7']
  // Generate piece configs once so they don't reshuffle on re-render.
  const pieces = useMemo(
    () => Array.from({ length: 90 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      duration: 2.4 + Math.random() * 1.8,
      drift: (Math.random() - 0.5) * 220,
      rotate: Math.random() * 720 - 360,
      size: 7 + Math.random() * 8,
      color: COLORS[i % COLORS.length],
      round: Math.random() > 0.5,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
      {pieces.map(p => (
        <motion.div
          key={p.id}
          initial={{ y: -40, x: 0, opacity: 1, rotate: 0 }}
          animate={{ y: '110vh', x: p.drift, opacity: [1, 1, 0.9, 0], rotate: p.rotate }}
          transition={{ duration: p.duration, delay: p.delay, ease: 'easeIn' }}
          className="absolute top-0"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.round ? p.size : p.size * 0.45,
            backgroundColor: p.color,
            borderRadius: p.round ? '9999px' : '2px',
          }}
        />
      ))}
    </div>
  )
}

/**
 * Full-slide timer overlay — depleting progress bar along the bottom edge
 * plus a floating pill showing the live countdown.
 * Has its own useState + setInterval so ONLY this component re-renders per
 * 250 ms tick. The parent Present component stays still → no slide flashing.
 */
function TimerCount({
  timerEndsAt,
  timerDuration,
  slideTheme,
  onExpire,
}: {
  timerEndsAt:  number
  timerDuration: number
  slideTheme?:  string
  onExpire:     () => void
}) {
  const [secsLeft, setSecsLeft] = useState(() =>
    Math.max(0, Math.ceil((timerEndsAt - Date.now()) / 1000)),
  )
  const onExpireRef  = useRef(onExpire)
  const expiredRef   = useRef(false)
  useEffect(() => { onExpireRef.current = onExpire }, [onExpire])

  useEffect(() => {
    expiredRef.current = false
    const tick = () => {
      const r = Math.max(0, Math.ceil((timerEndsAt - Date.now()) / 1000))
      setSecsLeft(r)
      if (r === 0 && !expiredRef.current) {
        expiredRef.current = true
        onExpireRef.current()
      }
    }
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [timerEndsAt])

  const colors = getTimerColors(slideTheme, secsLeft)
  const pct    = Math.max(0, (secsLeft / timerDuration) * 100)

  return (
    <>
      {/* Depleting bar along the very top of the slide */}
      <div className="absolute inset-x-0 top-0 z-[22] h-1.5 bg-black/20">
        <motion.div
          className="h-full"
          style={{ backgroundColor: colors.bar }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.3, ease: 'linear' }}
        />
      </div>

      {/* Floating countdown pill — top-right, below top bar */}
      <div
        className={cn(
          'absolute top-4 right-6 z-[22] flex items-center gap-1.5 rounded-full px-3.5 py-2 backdrop-blur-md shadow-lg',
          secsLeft <= 10 ? 'animate-pulse' : '',
        )}
        style={{ backgroundColor: colors.pill, color: colors.text, border: `1px solid ${colors.border}` }}
      >
        <Clock className="size-3.5 shrink-0" />
        <span className="font-mono text-sm font-bold tabular-nums">{secsLeft}</span>
        <span className="text-xs font-medium opacity-70">s</span>
      </div>
    </>
  )
}

/**
 * Compact countdown used inside the HUD bar.
 * Also self-contained so the HUD countdown doesn't re-render the whole page.
 */
function HudTimerCount({ timerEndsAt }: { timerEndsAt: number }) {
  const [secsLeft, setSecsLeft] = useState(() =>
    Math.max(0, Math.ceil((timerEndsAt - Date.now()) / 1000)),
  )
  useEffect(() => {
    const tick = () => setSecsLeft(Math.max(0, Math.ceil((timerEndsAt - Date.now()) / 1000)))
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [timerEndsAt])

  const isUrgent = secsLeft <= 10
  return (
    <div className="flex items-center gap-1.5">
      <Clock className={cn('size-3.5', isUrgent ? 'text-hot-pink' : 'text-white/50')} />
      <span className={cn(
        'min-w-[2.5rem] text-center font-mono text-sm font-bold tabular-nums',
        isUrgent ? 'animate-pulse text-hot-pink' : 'text-white/80',
      )}>
        {secsLeft}s
      </span>
    </div>
  )
}
