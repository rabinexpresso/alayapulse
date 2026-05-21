import {
  doc, getDoc, setDoc, addDoc, updateDoc, onSnapshot,
  collection, query, where, serverTimestamp,
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

export interface QuestionSlide {
  id:       string
  type:     QType
  question: string
  options:  string[]
}

export type StoredSlide = StoredPdfSlide | QuestionSlide

export interface Session {
  code:         string
  title:        string
  slides:       StoredSlide[]
  currentSlide: number
  currentPhase: SlidePhase
  status:       'active' | 'ended'
  createdAt:    Timestamp
}

export interface Response {
  slideId:       string
  type:          QType
  value:         string
  respondentName?: string
  submittedAt:   Timestamp
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
export async function createSession(title: string, rawSlides: any[]): Promise<string> {
  const slides: StoredSlide[] = rawSlides.map(s => {
    if (s.type === 'pdf') {
      return { id: s.id, type: 'pdf' as const, pageNum: s.pageNum ?? 1 }
    }
    return {
      id:       s.id,
      type:     s.type as QType,
      question: s.question ?? '',
      options:  s.options ?? [],
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
   endSession
   Marks the session as ended so audience devices show a "wrap" screen
   instead of the last question while the host is not presenting.
   ───────────────────────────────────────────────────────────────────────── */

export async function endSession(code: string): Promise<void> {
  await updateDoc(doc(db, 'sessions', code.toUpperCase()), { status: 'ended' })
}

/* ─────────────────────────────────────────────────────────────────────────
   submitResponse
   Audience calls addDoc (HTTP POST, no persistent WebSocket connection).
   ───────────────────────────────────────────────────────────────────────── */

export interface SubmitPayload {
  slideId:        string
  type:           QType
  value:          string
  respondentName?: string
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
