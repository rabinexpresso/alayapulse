import { openDB, type IDBPDatabase } from 'idb'
import { db, auth } from './firebase'
import {
  doc, setDoc, getDocs, deleteDoc, collection,
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

const IDB_NAME  = 'alaya-pulse'
const IDB_STORE = 'decks'
let _idb: IDBPDatabase | null = null

async function getIDB(): Promise<IDBPDatabase> {
  if (!_idb) {
    _idb = await openDB(IDB_NAME, 1, {
      upgrade(database) {
        database.createObjectStore(IDB_STORE, { keyPath: 'id' })
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

export async function cloudListDecks(): Promise<Deck[]> {
  const user = auth.currentUser
  if (!user) return []
  const snap = await getDocs(decksRef(user.uid))
  return snap.docs
    .map(d => d.data() as Deck)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function cloudSaveDeck(deck: Deck): Promise<void> {
  const user = auth.currentUser
  if (!user) throw new Error('Not signed in')
  // Keep Cloudinary URLs (https://...) — they're tiny text, fine for Firestore.
  // Strip base64 data URLs — they're massive and exceed Firestore's 1 MB limit.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slides = deck.slides.map((s: any) =>
    s.type === 'pdf'
      ? {
          id:      s.id,
          type:    'pdf' as const,
          pageNum: s.pageNum,
          ...(s.imgUrl?.startsWith('https://') ? { imgUrl: s.imgUrl } : {}),
        }
      : s,
  )
  await setDoc(doc(decksRef(user.uid), deck.id), {
    ...deck,
    slides,
    updatedAt: Date.now(),
  })
}

export async function cloudDeleteDeck(id: string): Promise<void> {
  const user = auth.currentUser
  if (!user) throw new Error('Not signed in')
  await deleteDoc(doc(decksRef(user.uid), id))
}

/* ─────────────────────────────────────────────────────────────────────────
   Google Auth helpers
   ───────────────────────────────────────────────────────────────────────── */

export async function signInWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider()
  const result   = await signInWithPopup(auth, provider)
  return result.user
}

export async function signOutUser(): Promise<void> {
  await signOut(auth)
}

export { onAuthStateChanged, auth, type User }
