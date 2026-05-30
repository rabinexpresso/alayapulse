import { openDB, type IDBPDatabase } from 'idb'
import { db, auth } from './firebase'
import {
  doc, setDoc, getDoc, getDocs, deleteDoc, collection,
} from 'firebase/firestore'
import {
  GoogleAuthProvider, signInWithPopup, signOut,
  onAuthStateChanged, type User,
} from 'firebase/auth'

/* ─────────────────────────────────────────────────────────────────────────
   Types
   ───────────────────────────────────────────────────────────────────────── */

export type StorageBackend = 'browser' | 'cloud'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Deck {
  id:        string
  title:     string
  slides:    unknown[]   // same shape as Create.tsx Slide[]
  createdAt: number      // unix ms
  updatedAt: number      // unix ms
}

/* ─────────────────────────────────────────────────────────────────────────
   Deck results — snapshot of the most recent live poll for a deck.
   Saved to its own document so the deck doc stays lean and the results
   doc gets its own 1 MB Firestore allowance.
   ───────────────────────────────────────────────────────────────────────── */

export type ResultQuestionType = 'mcq' | 'wordcloud' | 'openended' | 'rating'

export interface ResultResponse {
  /** Display name. "Anonymous" if the audience didn't enter one. */
  name:  string
  /** Raw submitted value (option index, word, text, or JSON ratings array) */
  value: string
  /** Unix ms when this response was submitted */
  time:  number
}

export interface ResultQuestion {
  slideId:   string
  question:  string
  type:      ResultQuestionType
  options:   string[]
  /** Rating slides only — max value of the 0..N scale (defaults to 5). */
  ratingMax?: number
  /** Rating slides only — PER-PARAMETER anchor labels (parallel to options). */
  leftLabels?:  string[]
  rightLabels?: string[]
  /** @deprecated slide-wide labels (older snapshots only). */
  leftLabel?:  string
  rightLabel?: string
  /** Visualization hint for MCQ — bar/pie/donut. */
  vizType?:  'bar' | 'pie' | 'donut'
  /** Individual responses. May be empty after aggregate-only trim. */
  responses: ResultResponse[]
  /** Total response count — preserved even if responses are dropped. */
  responseCount: number
}

export interface DeckResults {
  /** The 6-char session code from the live poll. */
  sessionCode:    string
  /** Unix ms when the session started. */
  conductedAt:    number
  /** Unix ms when the session ended (for "X mins" calculations). */
  endedAt?:       number
  /** Highest audience count observed during the session. */
  audienceCount:  number
  /** Question slides + responses. Other slide types are excluded. */
  questions:      ResultQuestion[]
  /** Set to true if data was trimmed to fit within the 1 MB Firestore cap. */
  trimmed?:       boolean
  /** Human-readable note about how trimming was applied. */
  trimNote?:      string
}

/* ─────────────────────────────────────────────────────────────────────────
   Storage backend preference (persisted in localStorage)
   ───────────────────────────────────────────────────────────────────────── */

const BACKEND_KEY = 'alaya-pulse-storage'

export function getStorageBackend(): StorageBackend | null {
  return localStorage.getItem(BACKEND_KEY) as StorageBackend | null
}
export function setStorageBackend(backend: StorageBackend): void {
  localStorage.setItem(BACKEND_KEY, backend)
}
export function clearStorageBackend(): void {
  localStorage.removeItem(BACKEND_KEY)
}

/* ─────────────────────────────────────────────────────────────────────────
   Browser storage — IndexedDB via idb
   PDF images are stored as base64 data URLs (already the format from Create.tsx)
   ───────────────────────────────────────────────────────────────────────── */

const IDB_NAME    = 'alaya-pulse'
const IDB_STORE   = 'decks'
const IDB_RESULTS = 'results'   // keyPath = deckId
let _idb: IDBPDatabase | null = null

async function getIDB(): Promise<IDBPDatabase> {
  if (!_idb) {
    _idb = await openDB(IDB_NAME, 2, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          database.createObjectStore(IDB_STORE, { keyPath: 'id' })
        }
        if (oldVersion < 2) {
          // v2: results store, one entry per deckId
          database.createObjectStore(IDB_RESULTS, { keyPath: 'deckId' })
        }
      },
    })
  }
  return _idb
}

export async function browserListDecks(): Promise<Deck[]> {
  const idb = await getIDB()
  const all = await idb.getAll(IDB_STORE) as Deck[]
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function browserSaveDeck(deck: Deck): Promise<void> {
  const idb = await getIDB()
  await idb.put(IDB_STORE, { ...deck, updatedAt: Date.now() })
}

/**
 * Returns a title that doesn't collide with any other deck on the chosen backend.
 * Appends " (1)", " (2)" etc. until unique. Pass `currentId` so renaming an existing
 * deck to its own current title doesn't count as a collision.
 */
export async function getUniqueDeckTitle(
  desiredTitle: string,
  backend: StorageBackend,
  currentId?: string,
): Promise<string> {
  const all = backend === 'browser' ? await browserListDecks() : await cloudListDecks()
  const others = all.filter(d => d.id !== currentId)
  const taken = new Set(others.map(d => d.title))

  if (!taken.has(desiredTitle)) return desiredTitle

  // Strip an existing " (n)" suffix so "Untitled (1)" doesn't become "Untitled (1) (1)"
  const base = desiredTitle.replace(/\s*\(\d+\)\s*$/, '')
  let n = 1
  while (taken.has(`${base} (${n})`)) n++
  return `${base} (${n})`
}

export async function browserDeleteDeck(id: string): Promise<void> {
  const idb = await getIDB()
  await idb.delete(IDB_STORE, id)
}

/* ─────────────────────────────────────────────────────────────────────────
   Cloud storage — Firestore under users/{uid}/decks/{deckId}
   Cloudinary URLs (https://...) are small text — safe to store in Firestore.
   Base64 data URLs are stripped as a safety fallback (too large for 1 MB limit).
   ───────────────────────────────────────────────────────────────────────── */

function decksRef(uid: string) {
  return collection(db, 'users', uid, 'decks')
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
function unflattenCanvasElements(elements: any[]): any[] {
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

export async function cloudListDecks(): Promise<Deck[]> {
  const user = auth.currentUser
  if (!user) return []
  const snap = await getDocs(decksRef(user.uid))
  return snap.docs
    .map(d => {
      const deck = d.data() as Deck
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawSlides = deck.slides as any[]

      // Build a map of html groups: { fileName::slideTotal -> html }
      // Only the first split slide stores the html — the rest get it from here.
      const htmlByGroup = new Map<string, string>()
      for (const s of rawSlides) {
        if (s.type === 'html' && s.html) {
          const key = `${s.fileName}::${s.slideTotal ?? 0}`
          if (!htmlByGroup.has(key)) htmlByGroup.set(key, s.html)
        }
      }

      return {
        ...deck,
        slides: rawSlides.map(s => {
          if (s.type === 'canvas') {
            return { ...s, elements: unflattenCanvasElements(s.elements ?? []) }
          }
          if (s.type === 'html' && !s.html) {
            const key = `${s.fileName}::${s.slideTotal ?? 0}`
            const html = htmlByGroup.get(key)
            if (html) return { ...s, html }
          }
          return s
        }),
      }
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * Firestore rejects any field whose value is `undefined`.
 * JSON round-trip removes `undefined` fields automatically (JSON.stringify
 * omits them), giving us a clean object safe to pass to setDoc/updateDoc.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stripUndefined<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

export async function cloudSaveDeck(deck: Deck): Promise<void> {
  const user = auth.currentUser
  if (!user) throw new Error('Not signed in')
  // Keep Cloudinary URLs (https://...) — they're tiny text, fine for Firestore.
  // Strip base64 data URLs — they're massive and exceed Firestore's 1 MB limit.
  // Flatten canvas table cells (string[][]) — Firestore bans nested arrays.
  // Dedupe split HTML slides — only the first slide in each group keeps the
  // html payload, the rest reference it by group key (fileName + slideTotal).
  // This keeps a 30-slide split HTML deck well under the 1 MB document limit.
  const seenHtmlGroups = new Set<string>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slides = deck.slides.map((s: any) => {
    if (s.type === 'pdf') {
      return {
        id:      s.id,
        type:    'pdf' as const,
        pageNum: s.pageNum,
        ...(s.imgUrl?.startsWith('https://') ? { imgUrl: s.imgUrl } : {}),
      }
    }
    if (s.type === 'canvas') {
      return { ...s, elements: flattenCanvasElements(s.elements ?? []) }
    }
    if (s.type === 'html') {
      const groupKey = `${s.fileName}::${s.slideTotal ?? 0}`
      if (seenHtmlGroups.has(groupKey)) {
        // Subsequent slide in the same split group — drop html, restored on read
        return { ...s, html: '' }
      }
      seenHtmlGroups.add(groupKey)
      return s
    }
    return s
  })
  await setDoc(doc(decksRef(user.uid), deck.id), stripUndefined({
    ...deck,
    slides,
    updatedAt: Date.now(),
  }))
}

export async function cloudDeleteDeck(id: string): Promise<void> {
  const user = auth.currentUser
  if (!user) throw new Error('Not signed in')
  await deleteDoc(doc(decksRef(user.uid), id))
}

/* ─────────────────────────────────────────────────────────────────────────
   Results storage — separate sub-doc at users/{uid}/decks/{deckId}/results/latest
   so the deck doc stays small and the results doc gets its own 1 MB
   Firestore allowance. Browser users keep a parallel store in IndexedDB.
   ───────────────────────────────────────────────────────────────────────── */

// 1 MB Firestore per-doc hard limit; we aim to stay under FIRESTORE_DOC_SAFE_BUDGET
// to leave headroom for envelope/overhead.
const FIRESTORE_DOC_SAFE_BUDGET = 900_000
const MAX_TEXT_RESPONSE_LENGTH  = 300         // chars per text value after step 2 trim

/**
 * Returns the byte size of an object once JSON-stringified.
 * (Firestore's billing/limit are based on the stored representation, but
 * this is a close-enough proxy for our purposes.)
 */
function jsonByteSize(obj: unknown): number {
  try { return new Blob([JSON.stringify(obj)]).size } catch { return 0 }
}

/**
 * Progressively trim a DeckResults snapshot until it fits in Firestore's
 * per-document budget. Order is chosen to preserve the data that matters
 * most for the presenter's analysis:
 *
 *   Step 1: Drop all individual responses, keep only aggregates
 *           (vote counts / word frequencies / rating averages).
 *           Aggregates are what the presenter actually needs.
 *   Step 2: Truncate any remaining text values longer than 300 chars.
 *           (Only relevant if we somehow re-introduce text — kept as a
 *           safety net for future schemas.)
 *   Step 3: As a last resort, limit per-question response count.
 *
 * Returns the (possibly trimmed) snapshot with `trimmed:true` set and
 * a human-readable `trimNote` describing what was dropped.
 */
export function trimResultsForFirestore(results: DeckResults): DeckResults {
  const initialSize = jsonByteSize(results)
  if (initialSize <= FIRESTORE_DOC_SAFE_BUDGET) return results

  // ── Step 1: drop individual responses, keep only counts ─────────────
  const stripped: DeckResults = {
    ...results,
    questions: results.questions.map(q => ({
      ...q,
      responses: [],
      responseCount: q.responses.length || q.responseCount || 0,
    })),
    trimmed:  true,
    trimNote: 'Individual responses removed — too many to store. Showing aggregates only.',
  }
  if (jsonByteSize(stripped) <= FIRESTORE_DOC_SAFE_BUDGET) return stripped

  // ── Step 2: truncate long text values (safety net) ──────────────────
  const truncated: DeckResults = {
    ...stripped,
    questions: stripped.questions.map(q => ({
      ...q,
      question: q.question.slice(0, MAX_TEXT_RESPONSE_LENGTH),
      options:  q.options.map(o => o.slice(0, MAX_TEXT_RESPONSE_LENGTH)),
    })),
    trimNote: 'Individual responses removed and long text truncated — too many to store. Showing aggregates only.',
  }
  if (jsonByteSize(truncated) <= FIRESTORE_DOC_SAFE_BUDGET) return truncated

  // ── Step 3: limit per-question response count ───────────────────────
  // At this point we've already stripped responses — there shouldn't be
  // any to limit. But if a future schema re-adds them, this kicks in.
  const limited: DeckResults = {
    ...truncated,
    questions: truncated.questions.map(q => ({
      ...q,
      responses: (q.responses ?? []).slice(-500),
    })),
    trimNote: 'Aggregates only — data was too large to fully save.',
  }
  return limited
}

function resultsDoc(uid: string, deckId: string) {
  return doc(db, 'users', uid, 'decks', deckId, 'results', 'latest')
}

export async function cloudSaveResults(deckId: string, results: DeckResults): Promise<void> {
  const user = auth.currentUser
  if (!user) throw new Error('Not signed in')
  const trimmed = trimResultsForFirestore(results)
  await setDoc(resultsDoc(user.uid, deckId), stripUndefined(trimmed))
}

export async function cloudLoadResults(deckId: string): Promise<DeckResults | null> {
  const user = auth.currentUser
  if (!user) return null
  const snap = await getDoc(resultsDoc(user.uid, deckId))
  if (!snap.exists()) return null
  return snap.data() as DeckResults
}

export async function cloudDeleteResults(deckId: string): Promise<void> {
  const user = auth.currentUser
  if (!user) return
  try { await deleteDoc(resultsDoc(user.uid, deckId)) } catch { /* ignore */ }
}

export async function browserSaveResults(deckId: string, results: DeckResults): Promise<void> {
  const idb = await getIDB()
  // IndexedDB has no per-doc cap — store the full results.
  await idb.put(IDB_RESULTS, { deckId, ...results })
}

export async function browserLoadResults(deckId: string): Promise<DeckResults | null> {
  const idb = await getIDB()
  const row = await idb.get(IDB_RESULTS, deckId) as (DeckResults & { deckId: string }) | undefined
  if (!row) return null
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { deckId: _drop, ...rest } = row
  return rest as DeckResults
}

export async function browserDeleteResults(deckId: string): Promise<void> {
  const idb = await getIDB()
  try { await idb.delete(IDB_RESULTS, deckId) } catch { /* ignore */ }
}

/** Backend-agnostic save/load — picks the right backend based on storage preference. */
export async function saveResults(
  backend: StorageBackend, deckId: string, results: DeckResults,
): Promise<void> {
  return backend === 'cloud'
    ? cloudSaveResults(deckId, results)
    : browserSaveResults(deckId, results)
}
export async function loadResults(
  backend: StorageBackend, deckId: string,
): Promise<DeckResults | null> {
  return backend === 'cloud'
    ? cloudLoadResults(deckId)
    : browserLoadResults(deckId)
}
export async function deleteResults(
  backend: StorageBackend, deckId: string,
): Promise<void> {
  return backend === 'cloud'
    ? cloudDeleteResults(deckId)
    : browserDeleteResults(deckId)
}

/* ─────────────────────────────────────────────────────────────────────────
   Google Auth helpers
   ───────────────────────────────────────────────────────────────────────── */

/* ── "Remember me" localStorage helpers ──────────────────────────────── */

const LS_REMEMBER = 'alaya_remember_me'
const LS_USER     = 'alaya_cached_user'

export function getRememberMe(): boolean | null {
  const v = localStorage.getItem(LS_REMEMBER)
  if (v === 'true')  return true
  if (v === 'false') return false
  return null   // never set
}

export function setRememberMe(val: boolean): void {
  localStorage.setItem(LS_REMEMBER, String(val))
}

export interface CachedUser {
  displayName: string | null
  email:       string | null
  photoURL:    string | null
}

export function getCachedUser(): CachedUser | null {
  try {
    const raw = localStorage.getItem(LS_USER)
    return raw ? (JSON.parse(raw) as CachedUser) : null
  } catch { return null }
}

export function saveCachedUser(user: User): void {
  localStorage.setItem(LS_USER, JSON.stringify({
    displayName: user.displayName,
    email:       user.email,
    photoURL:    user.photoURL,
  }))
}

/** Clears both the remember preference and the cached user profile.
 *  Call this on "Remove from this device" so the next visitor must
 *  authenticate from scratch. */
export function clearCachedUser(): void {
  localStorage.removeItem(LS_REMEMBER)
  localStorage.removeItem(LS_USER)
}

/**
 * Sign in with Google.
 * @param forceLogin  When true, Google ignores any saved browser session and
 *                    requires the user to actively enter their password —
 *                    important for shared-device security.
 */
export async function signInWithGoogle(forceLogin = false): Promise<User> {
  const provider = new GoogleAuthProvider()
  // forceLogin: send both `prompt=login` AND `max_age=0` — the two strongest
  // available signals asking Google to demand fresh credentials. Note that
  // Google may still skip the password step on trusted devices or SSO accounts;
  // this is a Google-session-level behaviour outside our control.
  provider.setCustomParameters(
    forceLogin
      ? { prompt: 'login', max_age: '0' }
      : { prompt: 'select_account' },
  )
  const result = await signInWithPopup(auth, provider)
  return result.user
}

export async function signOutUser(): Promise<void> {
  await signOut(auth)
}

export { onAuthStateChanged, auth, type User }
