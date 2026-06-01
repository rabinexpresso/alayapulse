import {
  doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot,
  collection, query, where, serverTimestamp, deleteField, increment,
  type Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'

/* ─────────────────────────────────────────────────────────────────────────
   Shared types
   ───────────────────────────────────────────────────────────────────────── */

export type QType      = 'mcq' | 'wordcloud' | 'openended' | 'rating'
export type SlidePhase = 'question' | 'results'

/** PDF slide as stored in Firestore — no imgUrl (too large for 1 MB doc limit) */
export interface StoredPdfSlide {
  id:      string
  type:    'pdf'
  pageNum: number
}

/** Image / video slides — audience just sees the waiting state */
export interface StoredMediaSlide {
  id:       string
  type:     'image' | 'video'
  fileName: string
}

/** HTML slides — audience only sees waiting state, so we omit the heavy html
 *  payload from Firestore entirely. The presenter holds the real html locally
 *  via React Router state when navigating to /present. */
export interface StoredHtmlSlide {
  id:          string
  type:        'html'
  fileName:    string
  html?:       string   // omitted in session writes to stay under 1 MB Firestore limit
  slideIndex?: number
  slideTotal?: number
}

/** Content / presentation slides — heading, bullets, quote */
export interface StoredContentSlide {
  id:          string
  type:        'content'
  template:    'heading' | 'bullets' | 'quote'
  title:       string
  body:        string
  attribution: string
  theme:       string
  imgUrl?:     string
  imgLayout?:  string
}

export interface QuestionSlide {
  id:           string
  type:         QType
  question:     string
  options:      string[]
  vizType?:     'bar' | 'pie' | 'donut'
  ratingMax?:   5 | 10
  /** Per-parameter scale labels (parallel to options). */
  leftLabels?:  string[]
  rightLabels?: string[]
  /** @deprecated slide-wide fallback for older decks. */
  leftLabel?:   string
  rightLabel?:  string
  theme?:       string
  imgUrl?:      string
  imgLayout?:   string
  /** Word Cloud only — max submissions per person. Default 3. */
  wcMaxSubmissions?: number
  /** Open Ended only — max responses per person. Default 1. */
  oeMaxSubmissions?: number
  /** MCQ only — 0-based indices of correct options (supports multiple). Used for presenter answer reveal. */
  correctAnswers?: number[]
}

/* ─── Canvas slide types ────────────────────────────────────────────────── */

export interface CanvasBg {
  type:  'color' | 'gradient'
  value: string
}

export interface CanvasBaseEl {
  id:   string
  kind: 'text' | 'table'
  x:    number   // % of canvas width
  y:    number   // % of canvas height
  w:    number   // % of canvas width
  h:    number   // % of canvas height
}

export interface CanvasTextEl extends CanvasBaseEl {
  kind:     'text'
  html:     string
  fontSize: number
  align:    'left' | 'center' | 'right'
  color:    string
}

export interface CanvasTableEl extends CanvasBaseEl {
  kind:      'table'
  rows:      number
  cols:      number
  cells:     string[][]
  hasHeader: boolean
}

export type CanvasEl = CanvasTextEl | CanvasTableEl

export interface StoredCanvasSlide {
  id:       string
  type:     'canvas'
  bg:       CanvasBg
  elements: CanvasEl[]
}

/** Leaderboard slide — audience sees waiting state; presenter sees top-10 quiz scores */
export interface StoredLeaderboardSlide {
  id:   string
  type: 'leaderboard'
}

export type StoredSlide = StoredPdfSlide | StoredMediaSlide | StoredHtmlSlide | StoredContentSlide | QuestionSlide | StoredCanvasSlide | StoredLeaderboardSlide

export interface Session {
  code:          string
  title:         string
  slides:        StoredSlide[]
  currentSlide:  number
  currentPhase:  SlidePhase
  status:        'active' | 'ended'
  createdAt:     Timestamp
  /** Epoch ms when the timer expires. Absent / null = no active timer. */
  timerEndsAt?:   number | null
  /** Original duration in seconds — used by audience for the progress bar. */
  timerDuration?: number | null
  /** Per-slide reset counter — incremented by presenter when votes are cleared.
   *  Audience Vote.tsx tracks submitted votes as `${slideId}:r${resetCounts[slideId] ?? 0}`
   *  so incrementing this unlocks voting for that slide without clearing other slides. */
  resetCounts?:   Record<string, number>
  /** Quiz mode — when true, audience must enter a name and receives per-answer score feedback. */
  isQuiz?:        boolean
  /** Per-slide timing metadata for speed-point calculation. */
  questionMeta?:  Record<string, { openedAt: number; duration: number | null }>
}

export interface Response {
  slideId:       string
  type:          QType
  value:         string
  respondentName?: string
  submittedAt:   Timestamp
  quizPoints?:   { answer: number; speed: number }
}

/* ─────────────────────────────────────────────────────────────────────────
   Canvas element helpers — Firestore does not support nested arrays,
   so table cells (string[][]) are flattened to string[] before writing
   and reconstructed after reading.
   ───────────────────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flattenCanvasElements(elements: any[]): any[] {
  return (elements ?? []).map((el: any) => {
    if (el.kind === 'table' && Array.isArray(el.cells?.[0])) {
      return { ...el, cells: (el.cells as string[][]).flat() }
    }
    return el
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function unflattenCanvasElements(elements: any[]): any[] {
  return (elements ?? []).map((el: any) => {
    if (el.kind === 'table' && el.cols && !Array.isArray(el.cells?.[0])) {
      const flat = el.cells as string[]
      const cols = el.cols as number
      const cells: string[][] = []
      for (let i = 0; i < flat.length; i += cols) {
        cells.push(flat.slice(i, i + cols))
      }
      return { ...el, cells }
    }
    return el
  })
}

/* ─────────────────────────────────────────────────────────────────────────
   Code generation — no ambiguous characters (0/O, 1/I/L)
   ───────────────────────────────────────────────────────────────────────── */

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function makeCode(): string {
  return Array.from({ length: 6 }, () =>
    CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)],
  ).join('')
}

/* ─────────────────────────────────────────────────────────────────────────
   createSession
   Strips imgUrl from PDF slides before writing. Returns the 6-char code.
   ───────────────────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function createSession(title: string, rawSlides: any[], isQuiz?: boolean): Promise<string> {
  const slides: StoredSlide[] = rawSlides.map(s => {
    if (s.type === 'pdf') {
      return { id: s.id, type: 'pdf' as const, pageNum: s.pageNum ?? 1 }
    }
    if (s.type === 'image' || s.type === 'video') {
      return { id: s.id, type: s.type as 'image' | 'video', fileName: s.fileName ?? '' }
    }
    if (s.type === 'html') {
      // Audience never renders html content (shown as waiting state), so we
      // skip the html payload entirely. Saves up to ~1 MB per session for
      // split HTML decks and keeps the doc under Firestore's 1 MB ceiling.
      return {
        id:       s.id,
        type:     'html' as const,
        fileName: s.fileName ?? '',
        ...(typeof s.slideIndex === 'number' ? { slideIndex: s.slideIndex } : {}),
        ...(typeof s.slideTotal === 'number' ? { slideTotal: s.slideTotal } : {}),
      }
    }
    if (s.type === 'content') {
      return {
        id:          s.id,
        type:        'content' as const,
        template:    s.template ?? 'heading',
        title:       s.title ?? '',
        body:        s.body ?? '',
        attribution: s.attribution ?? '',
        theme:       s.theme ?? 'navy',
        // Include image so the audience phone shows the same slide picture.
        // imgUrl is a Cloudinary URL after a deck save (short, well under 1 MB).
        ...(s.imgUrl    ? { imgUrl:    String(s.imgUrl)    } : {}),
        ...(s.imgLayout ? { imgLayout: String(s.imgLayout) } : {}),
      }
    }
    if (s.type === 'canvas') {
      return {
        id:       s.id,
        type:     'canvas' as const,
        bg:       s.bg ?? { type: 'color', value: '#000079' },
        elements: flattenCanvasElements(s.elements ?? []),
      }
    }
    if (s.type === 'leaderboard') {
      return { id: s.id, type: 'leaderboard' as const }
    }
    return {
      id:       s.id,
      type:     s.type as QType,
      question: s.question ?? '',
      options:  s.options ?? [],
      ...(s.vizType ? { vizType: s.vizType as 'bar' | 'pie' | 'donut' } : {}),
      ...(s.ratingMax === 10 ? { ratingMax: 10 as const } : {}),
      ...(Array.isArray(s.leftLabels)  && s.leftLabels.length  > 0 ? { leftLabels:  (s.leftLabels  as unknown[]).map(v => String(v ?? '')) } : {}),
      ...(Array.isArray(s.rightLabels) && s.rightLabels.length > 0 ? { rightLabels: (s.rightLabels as unknown[]).map(v => String(v ?? '')) } : {}),
      ...(s.leftLabel  ? { leftLabel:  String(s.leftLabel)  } : {}),
      ...(s.rightLabel ? { rightLabel: String(s.rightLabel) } : {}),
      ...(s.theme      ? { theme:      String(s.theme)      } : {}),
      ...(s.imgUrl     ? { imgUrl:     String(s.imgUrl)     } : {}),
      ...(s.imgLayout  ? { imgLayout:  String(s.imgLayout)  } : {}),
      // Word Cloud: preserve presenter-configured submission limit
      ...(typeof s.wcMaxSubmissions === 'number' ? { wcMaxSubmissions: s.wcMaxSubmissions } : {}),
      // MCQ: preserve correct answer indices for presenter reveal
      ...(Array.isArray(s.correctAnswers) && s.correctAnswers.length > 0 ? { correctAnswers: s.correctAnswers as number[] } : {}),
      // Open Ended: preserve max submissions per person
      ...(typeof s.oeMaxSubmissions === 'number' ? { oeMaxSubmissions: s.oeMaxSubmissions } : {}),
    }
  })

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode()
    const ref  = doc(db, 'sessions', code)
    const snap = await getDoc(ref)
    if (snap.exists()) continue // collision — retry

    await setDoc(ref, {
      code,
      title:        title.trim() || 'Untitled session',
      slides,
      currentSlide: 0,
      currentPhase: 'question',
      status:       'active',
      createdAt:    serverTimestamp(),
      ...(isQuiz ? { isQuiz: true } : {}),
    })
    return code
  }

  throw new Error('Failed to generate a unique session code — please try again.')
}

/* ─────────────────────────────────────────────────────────────────────────
   getSessionByCode
   ───────────────────────────────────────────────────────────────────────── */

export async function getSessionByCode(code: string): Promise<Session | null> {
  const snap = await getDoc(doc(db, 'sessions', code.toUpperCase()))
  if (!snap.exists()) return null
  return snap.data() as Session
}

/* ─────────────────────────────────────────────────────────────────────────
   subscribeToSession
   Audience subscribes to the session doc to track slide / phase changes.
   ───────────────────────────────────────────────────────────────────────── */

export function subscribeToSession(
  code: string,
  callback: (session: Session | null) => void,
): () => void {
  return onSnapshot(doc(db, 'sessions', code.toUpperCase()), snap => {
    callback(snap.exists() ? (snap.data() as Session) : null)
  })
}

/* ─────────────────────────────────────────────────────────────────────────
   updateSessionState
   Presenter calls this whenever they advance a slide or reveal results.
   Also ensures status is 'active' so a resumed session wakes up audience.
   ───────────────────────────────────────────────────────────────────────── */

export async function updateSessionState(
  code: string,
  currentSlide: number,
  currentPhase: SlidePhase,
): Promise<void> {
  await updateDoc(doc(db, 'sessions', code.toUpperCase()), {
    currentSlide,
    currentPhase,
    status: 'active',
  })
}

/* ─────────────────────────────────────────────────────────────────────────
   updateSessionSlides
   Called on Resume to resync the Firestore slides array with the current
   local deck. Without this, slides added/removed/reordered since the last
   "Start session" cause the audience's session.slides[currentSlide] to
   resolve to the wrong slide — making audience see "Hang tight" when the
   presenter is on a question.
   ───────────────────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function updateSessionSlides(code: string, rawSlides: any[], isQuiz?: boolean): Promise<void> {
  const slides: StoredSlide[] = rawSlides.map(s => {
    if (s.type === 'pdf')
      return { id: s.id, type: 'pdf' as const, pageNum: s.pageNum ?? 1 }
    if (s.type === 'image' || s.type === 'video')
      return { id: s.id, type: s.type as 'image' | 'video', fileName: s.fileName ?? '' }
    if (s.type === 'html')
      // html payload omitted — audience doesn't render it; presenter has it locally.
      return {
        id:       s.id,
        type:     'html' as const,
        fileName: s.fileName ?? '',
        ...(typeof s.slideIndex === 'number' ? { slideIndex: s.slideIndex } : {}),
        ...(typeof s.slideTotal === 'number' ? { slideTotal: s.slideTotal } : {}),
      }
    if (s.type === 'content')
      return {
        id: s.id, type: 'content' as const,
        template:    s.template    ?? 'heading',
        title:       s.title       ?? '',
        body:        s.body        ?? '',
        attribution: s.attribution ?? '',
        theme:       s.theme       ?? 'navy',
        // Include image so the audience phone shows the same slide picture.
        ...(s.imgUrl    ? { imgUrl:    String(s.imgUrl)    } : {}),
        ...(s.imgLayout ? { imgLayout: String(s.imgLayout) } : {}),
      }
    if (s.type === 'canvas') {
      return {
        id:       s.id,
        type:     'canvas' as const,
        bg:       s.bg ?? { type: 'color', value: '#000079' },
        elements: flattenCanvasElements(s.elements ?? []),
      }
    }
    if (s.type === 'leaderboard') {
      return { id: s.id, type: 'leaderboard' as const }
    }
    return {
      id:       s.id,
      type:     s.type as QType,
      question: s.question ?? '',
      options:  s.options ?? [],
      ...(s.vizType ? { vizType: s.vizType as 'bar' | 'pie' | 'donut' } : {}),
      ...(s.ratingMax === 10 ? { ratingMax: 10 as const } : {}),
      ...(Array.isArray(s.leftLabels)  && s.leftLabels.length  > 0 ? { leftLabels:  (s.leftLabels  as unknown[]).map(v => String(v ?? '')) } : {}),
      ...(Array.isArray(s.rightLabels) && s.rightLabels.length > 0 ? { rightLabels: (s.rightLabels as unknown[]).map(v => String(v ?? '')) } : {}),
      ...(s.leftLabel  ? { leftLabel:  String(s.leftLabel)  } : {}),
      ...(s.rightLabel ? { rightLabel: String(s.rightLabel) } : {}),
      ...(s.theme      ? { theme:      String(s.theme)      } : {}),
      ...(s.imgUrl     ? { imgUrl:     String(s.imgUrl)     } : {}),
      ...(s.imgLayout  ? { imgLayout:  String(s.imgLayout)  } : {}),
      // Word Cloud: preserve presenter-configured submission limit
      ...(typeof s.wcMaxSubmissions === 'number' ? { wcMaxSubmissions: s.wcMaxSubmissions } : {}),
      // MCQ: preserve correct answer indices for presenter reveal
      ...(Array.isArray(s.correctAnswers) && s.correctAnswers.length > 0 ? { correctAnswers: s.correctAnswers as number[] } : {}),
      // Open Ended: preserve max submissions per person
      ...(typeof s.oeMaxSubmissions === 'number' ? { oeMaxSubmissions: s.oeMaxSubmissions } : {}),
    }
  })
  await updateDoc(doc(db, 'sessions', code.toUpperCase()), {
    slides,
    ...(isQuiz ? { isQuiz: true } : { isQuiz: deleteField() }),
  })
}

/* ─────────────────────────────────────────────────────────────────────────
   endSession
   Marks the session as ended so audience devices show a "wrap" screen
   instead of the last question while the host is not presenting.
   ───────────────────────────────────────────────────────────────────────── */

export async function endSession(code: string): Promise<void> {
  await updateDoc(doc(db, 'sessions', code.toUpperCase()), { status: 'ended' })
}

/* ─────────────────────────────────────────────────────────────────────────
   updateQuestionMeta
   Stores when a question slide opened and its timer duration so the
   audience can calculate speed points client-side at submission time.
   ───────────────────────────────────────────────────────────────────────── */

export async function updateQuestionMeta(
  sessionCode: string,
  slideId: string,
  openedAt: number,
  duration: number | null,
): Promise<void> {
  await updateDoc(doc(db, 'sessions', sessionCode.toUpperCase()), {
    [`questionMeta.${slideId}`]: { openedAt, duration },
  })
}

/* ─────────────────────────────────────────────────────────────────────────
   submitResponse
   Audience calls addDoc (HTTP POST, no persistent WebSocket connection).
   ───────────────────────────────────────────────────────────────────────── */

export interface SubmitPayload {
  slideId:         string
  type:            QType
  value:           string
  respondentName?: string
  quizPoints?:     { answer: number; speed: number }
}

export async function submitResponse(
  sessionCode: string,
  payload: SubmitPayload,
): Promise<void> {
  await addDoc(
    collection(db, 'sessions', sessionCode.toUpperCase(), 'responses'),
    { ...payload, submittedAt: serverTimestamp() },
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   subscribeToSlideResponses
   Presenter subscribes to all responses for a single slide.
   Only the presenter's device holds this WebSocket — audience does not.
   ───────────────────────────────────────────────────────────────────────── */

export function subscribeToSlideResponses(
  sessionCode: string,
  slideId: string,
  callback: (responses: Response[]) => void,
): () => void {
  const q = query(
    collection(db, 'sessions', sessionCode.toUpperCase(), 'responses'),
    where('slideId', '==', slideId),
  )
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => d.data() as Response))
  })
}

/* ─────────────────────────────────────────────────────────────────────────
   fetchAllSessionResponses
   One-shot fetch of every response across every slide in a session.
   Used when the presenter ends the session and we want to snapshot
   results for storage / the Results page.
   ───────────────────────────────────────────────────────────────────────── */

export async function fetchAllSessionResponses(sessionCode: string): Promise<Response[]> {
  const snap = await getDocs(collection(db, 'sessions', sessionCode.toUpperCase(), 'responses'))
  return snap.docs.map(d => d.data() as Response)
}

/* ─────────────────────────────────────────────────────────────────────────
   Viewer presence — tracks how many audience members are watching.
   Each viewer writes a doc to sessions/{code}/viewers/{viewerId}.
   Returns an unsubscribe/cleanup function.
   ───────────────────────────────────────────────────────────────────────── */

export function joinAsViewer(sessionCode: string): () => void {
  // Reuse the same ID across refreshes so we don't double-count
  let viewerId = sessionStorage.getItem('alaya-viewer-id')
  if (!viewerId) {
    viewerId = Math.random().toString(36).slice(2, 10)
    sessionStorage.setItem('alaya-viewer-id', viewerId)
  }

  const ref = doc(db, 'sessions', sessionCode.toUpperCase(), 'viewers', viewerId)
  setDoc(ref, { joinedAt: serverTimestamp(), lastSeen: serverTimestamp() })
    .catch(err => console.error('[alaya-pulse] joinAsViewer: failed to register presence', err))

  // Heartbeat every 30 s keeps the presence alive on slow browsers
  const heartbeat = setInterval(() => {
    updateDoc(ref, { lastSeen: serverTimestamp() }).catch(() => {})
  }, 30_000)

  const cleanup = () => {
    clearInterval(heartbeat)
    deleteDoc(ref).catch(() => {})
  }

  window.addEventListener('beforeunload', cleanup)
  return () => {
    cleanup()
    window.removeEventListener('beforeunload', cleanup)
  }
}

export function subscribeToViewerCount(
  sessionCode: string,
  callback: (count: number) => void,
): () => void {
  return onSnapshot(
    collection(db, 'sessions', sessionCode.toUpperCase(), 'viewers'),
    snap => callback(snap.size),
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Question timer — presenter starts/clears; all clients read timerEndsAt
   to count down independently (no polling).
   ───────────────────────────────────────────────────────────────────────── */

export async function startTimer(code: string, seconds: number): Promise<void> {
  await updateDoc(doc(db, 'sessions', code.toUpperCase()), {
    timerEndsAt:   Date.now() + seconds * 1000,
    timerDuration: seconds,
  })
}

export async function clearTimer(code: string): Promise<void> {
  await updateDoc(doc(db, 'sessions', code.toUpperCase()), {
    timerEndsAt:   deleteField(),
    timerDuration: deleteField(),
  })
}

/* ─────────────────────────────────────────────────────────────────────────
   resetSlideVotes
   Presenter clears all responses for one slide so the audience can vote
   again. Increments resetCounts[slideId] so every audience device sees the
   new round and automatically unlocks their voting form.
   ───────────────────────────────────────────────────────────────────────── */

export async function resetSlideVotes(
  sessionCode: string,
  slideId: string,
): Promise<void> {
  // 1. Delete all responses for this slide
  const q = query(
    collection(db, 'sessions', sessionCode.toUpperCase(), 'responses'),
    where('slideId', '==', slideId),
  )
  const snap = await getDocs(q)
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)))

  // 2. Bump reset counter — audience Vote.tsx reads this to re-enable voting
  await updateDoc(doc(db, 'sessions', sessionCode.toUpperCase()), {
    [`resetCounts.${slideId}`]: increment(1),
  })
}
