import { optionLabel } from './utils'

/* ─────────────────────────────────────────────────────────────────────────
   Self-paced test block — everyone answers a set of questions on their own
   phone, at their own pace, within one time limit. Multiple choice marks
   itself: answers are revealed at the end and the winner has the most correct
   answers, ties going to the faster finish. Open-ended, word cloud, rating and
   ranking answers are collected for the host to mark afterwards.

   Three shapes of the same block:
     • Editor  — flat: a `testblock` header slide, its MCQs, then a `testend`
                 marker. Membership is position: an MCQ between a header and
                 its end belongs to that test. Keeps every existing editor
                 feature (edit, undo, save, drag) working on plain slides.
     • Show    — collapsed: one `testblock` slide holding its questions, with
                 correct answers, for the presenter.
     • Phone   — the show slide minus correct answers and explanations, so
                 nobody can read them from the session doc before the end.
   ───────────────────────────────────────────────────────────────────────── */

export type TestAfterOrder  = 'lb-review' | 'review-lb' | 'lb-only' | 'review-only'
export type TestScoreTiming = 'submit' | 'end'

export interface TestSettings {
  /** Minutes for the whole test. */
  timeLimit:   number
  /** When a phone shows its own score: as soon as it submits, or at the end. */
  scoreTiming: TestScoreTiming
  /** What the block shows once the test is over. */
  afterOrder:  TestAfterOrder
  /** Optional extra line shown with the rules. */
  rules?:      string
  /** Big-screen colour theme (TEST_THEMES id); navy when missing. */
  theme?:      string
}

export const DEFAULT_TEST_SETTINGS: TestSettings = {
  timeLimit:   15,
  scoreTiming: 'end',
  afterOrder:  'lb-review',
}

export const AFTER_ORDER_LABEL: Record<TestAfterOrder, string> = {
  'lb-review': 'Leaderboard, then review',
  'review-lb': 'Review, then leaderboard',
  'lb-only':   'Leaderboard only',
  'review-only': 'Review only',
}

/* Question types a test can hold. Multiple choice marks itself; the others
   are collected for the host to mark afterwards (by hand, or with AI). */
export type TestQType = 'mcq' | 'openended' | 'wordcloud' | 'rating' | 'ranking'
export const TEST_QTYPE_LABEL: Record<TestQType, string> = {
  mcq: 'Multiple choice', openended: 'Open-ended', wordcloud: 'Word cloud', rating: 'Rating', ranking: 'Ranking',
}
/** Marks a question gets when it first goes into a test (the host can change
 *  them, or choose "Not marked" = 0). Rating is usually opinion, so unmarked. */
export const DEFAULT_MARKS: Partial<Record<TestQType, number>> = { openended: 5, wordcloud: 1, ranking: 1 }
/** Open-ended answers in a test: up to this many words (about 4 A4 pages). */
export const OE_MAX_WORDS = 2000

/** One answer on a sheet, by question type:
 *   multiple choice → option indexes picked
 *   ranking         → item indexes in the person's order (#1 first)
 *   rating          → a value per item (-1 = not rated yet)
 *   open-ended      → text
 *   word cloud      → short answers */
export type TestAnswer = number[] | string | string[]

/** Editor header slide. */
export interface TestHeaderSlide extends TestSettings {
  id:         string
  type:       'testblock'
  collapsed?: boolean
}

/** Editor end marker. */
export interface TestEndSlide {
  id:      string
  type:    'testend'
  blockId: string
}

/** Type-specific settings, shared by the presenter's and the phones' copy. */
interface TestQuestionSettings {
  /** Missing on tests made before other types were allowed — those are all MCQ. */
  type?:        TestQType
  imgUrl?:      string
  /** Marks available for a question the host marks (not multiple choice). */
  marks?:       number
  /** Word cloud: how many short answers each person can give. */
  maxEntries?:  number
  /** Rating: top of the 0..N scale, and each item's end labels. */
  ratingMax?:   5 | 10
  leftLabels?:  string[]
  rightLabels?: string[]
}

/** A question as the presenter sees it (with the answer). */
export interface TestQuestion extends TestQuestionSettings {
  id:             string
  question:       string
  /** MCQ: options. Rating / ranking: the items. */
  options:        string[]
  /** MCQ only — empty for every other type. */
  correctAnswers: number[]
  explanation?:   string
  /** What a good answer includes. Never sent to phones. */
  guide?:         string
}

/** Collapsed block in a running show. */
export interface TestBlockShowSlide extends TestSettings {
  id:        string
  type:      'testblock'
  questions: TestQuestion[]
}

/** A question as phones receive it: no answers or marking guide; for
 *  multiple choice, just how many options to pick. */
export interface StoredTestQuestion extends TestQuestionSettings {
  id:       string
  question: string
  options:  string[]
  pick:     number
}

export interface StoredTestBlockSlide extends TestSettings {
  id:        string
  type:      'testblock'
  questions: StoredTestQuestion[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyS = any

const isHeader = (s: AnyS) => s?.type === 'testblock' && !Array.isArray(s.questions)
const isEnd    = (s: AnyS) => s?.type === 'testend'
export const isTestable = (s: AnyS) => ['mcq', 'openended', 'wordcloud', 'rating', 'ranking'].includes(s?.type)
/** A question's type (tests from before other types were allowed are all MCQ). */
export const qTypeOf = (q: { type?: string }): TestQType => (q?.type && q.type in TEST_QTYPE_LABEL ? q.type as TestQType : 'mcq')
/** Marked by the host afterwards (not multiple choice, and has marks set). */
export const isMarkable = (q: { type?: string; marks?: number }) => qTypeOf(q) !== 'mcq' && (q.marks ?? 0) > 0

/** Settings picked off a header slide (fills gaps from older decks). */
export function testSettingsOf(s: AnyS): TestSettings {
  return {
    timeLimit:   Number(s?.timeLimit) > 0 ? Number(s.timeLimit) : DEFAULT_TEST_SETTINGS.timeLimit,
    scoreTiming: s?.scoreTiming === 'submit' ? 'submit' : 'end',
    afterOrder:  ['review-lb', 'lb-only', 'review-only'].includes(s?.afterOrder) ? s.afterOrder : 'lb-review',
    ...(typeof s?.rules === 'string' && s.rules.trim() ? { rules: s.rules.trim() } : {}),
    ...(TEST_THEMES.some(t => t.id === s?.theme) && s.theme !== 'navy' ? { theme: s.theme } : {}),
  }
}

/* Big-screen colours for the test's own pages (rules, dashboard, summary,
   answer review). Same brand palette as slide themes; each set keeps the
   "good" (progress, correct answer) and "danger" (End test, last minute)
   colours visible against its background. */
export interface TestTheme {
  id: string; label: string
  bg: string; fg: string
  /** Small labels and the explanation box */
  accent: string
  /** Progress bar, correct answers, Resume */
  good: string; goodInk: string; goodText: string
  /** End test, the last minute on the clock */
  danger: string; dangerInk: string
  /** The Start test button */
  start: string; startInk: string
}
export const TEST_THEMES: TestTheme[] = [
  { id: 'navy',   label: 'Navy',   bg: '#000079', fg: '#ffffff', accent: '#ffc709', good: '#42db66', goodInk: '#000079', goodText: '#42db66', danger: '#ff0065', dangerInk: '#ffffff', start: '#ffc709', startInk: '#000079' },
  { id: 'pink',   label: 'Pink',   bg: '#ff0065', fg: '#ffffff', accent: '#ffc709', good: '#ffc709', goodInk: '#000079', goodText: '#ffffff', danger: '#000079', dangerInk: '#ffffff', start: '#ffc709', startInk: '#000079' },
  { id: 'sky',    label: 'Sky',    bg: '#00b0ff', fg: '#000079', accent: '#000079', good: '#ffc709', goodInk: '#000079', goodText: '#000079', danger: '#ff0065', dangerInk: '#ffffff', start: '#ffc709', startInk: '#000079' },
  { id: 'green',  label: 'Green',  bg: '#42db66', fg: '#000079', accent: '#000079', good: '#000079', goodInk: '#ffffff', goodText: '#000079', danger: '#ff0065', dangerInk: '#ffffff', start: '#000079', startInk: '#ffffff' },
  { id: 'golden', label: 'Golden', bg: '#ffc709', fg: '#000079', accent: '#000079', good: '#000079', goodInk: '#ffffff', goodText: '#000079', danger: '#ff0065', dangerInk: '#ffffff', start: '#000079', startInk: '#ffffff' },
  { id: 'white',  label: 'White',  bg: '#f4f4f9', fg: '#000079', accent: '#ff0065', good: '#42db66', goodInk: '#000079', goodText: '#16a34a', danger: '#ff0065', dangerInk: '#ffffff', start: '#ff0065', startInk: '#ffffff' },
]
export const testTheme = (id?: string): TestTheme => TEST_THEMES.find(t => t.id === id) ?? TEST_THEMES[0]

export interface TestRange {
  headerId: string
  start:    number   // header index
  end:      number   // end-marker index
  memberIds: string[]
}

/** Every block's header/end positions and the questions between them. */
export function testRanges(slides: AnyS[]): TestRange[] {
  const out: TestRange[] = []
  for (let i = 0; i < slides.length; i++) {
    if (!isHeader(slides[i])) continue
    const id = slides[i].id
    const end = slides.findIndex((s, j) => j > i && isEnd(s) && s.blockId === id)
    if (end < 0) continue
    out.push({ headerId: id, start: i, end, memberIds: slides.slice(i + 1, end).map(s => s.id) })
  }
  return out
}

/** Map slide id → header id, for every question inside a block. */
export function testMembership(slides: AnyS[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const r of testRanges(slides)) r.memberIds.forEach(id => m.set(id, r.headerId))
  return m
}

/**
 * Restores the block rules after any edit — drag, paste, import, undo:
 *  • every header has an end marker (added after its questions if missing);
 *    an end with no header is dropped;
 *  • anything that can't be in a test (a content slide, another block) found
 *    between a header and its end moves to just after the end, keeping its order;
 *  • a question new to a test gets its type's default marks.
 * Returns the same array when nothing needed fixing, so callers can skip a
 * state update. `movedOut` lists the slides that had to move.
 */
export function normalizeTestBlocks(slides: AnyS[]): { slides: AnyS[]; movedOut: AnyS[] } {
  let list = slides
  let changed = false

  // Drop orphan ends / duplicate ends
  const headerIds = new Set(list.filter(isHeader).map(s => s.id))
  const seenEnd = new Set<string>()
  const kept = list.filter(s => {
    if (!isEnd(s)) return true
    if (!headerIds.has(s.blockId) || seenEnd.has(s.blockId)) return false
    seenEnd.add(s.blockId); return true
  })
  if (kept.length !== list.length) { list = kept; changed = true }

  // Missing ends: close each header after the run of MCQs that follows it
  for (const h of list.filter(isHeader)) {
    if (list.some(s => isEnd(s) && s.blockId === h.id)) continue
    const i = list.indexOf(h)
    let j = i + 1
    while (j < list.length && isTestable(list[j])) j++
    list = [...list.slice(0, j), { id: Math.random().toString(36).slice(2, 10), type: 'testend', blockId: h.id }, ...list.slice(j)]
    changed = true
  }

  // An end before its header (dragged above it): put the end right after the header
  for (const h of list.filter(isHeader)) {
    const hi = list.indexOf(h)
    const ei = list.findIndex(s => isEnd(s) && s.blockId === h.id)
    if (ei < hi) {
      const end = list[ei]
      list = list.filter((_, k) => k !== ei)
      const nh = list.indexOf(h)
      list = [...list.slice(0, nh + 1), end, ...list.slice(nh + 1)]
      changed = true
    }
  }

  // Move out anything that can't be a test question
  const movedOut: AnyS[] = []
  let guard = 0
  for (;;) {
    if (guard++ > 50) break
    let fixed = false
    for (const r of testRanges(list)) {
      const k = list.findIndex((s, idx) => idx > r.start && idx < r.end && !isTestable(s))
      if (k < 0) continue
      // A whole inner block moves as one unit; anything else moves alone
      const s = list[k]
      let unit: AnyS[] = [s]
      if (isHeader(s)) {
        const innerEnd = list.findIndex((x, idx) => idx > k && isEnd(x) && x.blockId === s.id)
        unit = innerEnd > k ? list.slice(k, innerEnd + 1) : [s]
      }
      const ids = new Set(unit.map(u => u.id))
      const rest = list.filter(x => !ids.has(x.id))
      const endIdx = rest.findIndex(x => isEnd(x) && x.blockId === r.headerId)
      list = [...rest.slice(0, endIdx + 1), ...unit, ...rest.slice(endIdx + 1)]
      movedOut.push(...unit.filter(u => !isEnd(u)))
      fixed = changed = true
      break
    }
    if (!fixed) break
  }

  // Questions new to a test get default marks (undefined = never set; 0 = "Not marked")
  for (const r of testRanges(list)) {
    for (let k = r.start + 1; k < r.end; k++) {
      const q = list[k]
      const d = DEFAULT_MARKS[qTypeOf(q)]
      if (d !== undefined && q.marks === undefined) {
        if (list === slides) list = [...list]
        list[k] = { ...q, marks: d }
        changed = true
      }
    }
  }

  return { slides: changed ? list : slides, movedOut }
}

/** Editor slides → show slides: each block becomes one `testblock` slide. */
export function collapseTestBlocks(slides: AnyS[]): AnyS[] {
  const out: AnyS[] = []
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i]
    if (isEnd(s)) continue
    if (!isHeader(s)) { out.push(s); continue }
    const end = slides.findIndex((x, j) => j > i && isEnd(x) && x.blockId === s.id)
    const members = end > i ? slides.slice(i + 1, end) : []
    const block: TestBlockShowSlide = {
      id: s.id,
      type: 'testblock',
      ...testSettingsOf(s),
      questions: members.filter(isTestable).map(toTestQuestion),
    }
    out.push({ ...block, _members: members, _header: s, ...(end > i ? { _end: slides[end] } : {}) })
    if (end > i) i = end
  }
  return out
}

/** An editor question slide → the test's copy of it. */
function toTestQuestion(q: AnyS): TestQuestion {
  const type = qTypeOf(q)
  const options: string[] = Array.isArray(q.options) ? q.options.map((o: unknown) => String(o ?? '')) : []
  const base: TestQuestion = {
    id: q.id, type, question: q.question ?? '', options,
    correctAnswers: type === 'mcq' && Array.isArray(q.correctAnswers) ? q.correctAnswers : [],
    ...(q.imgUrl ? { imgUrl: String(q.imgUrl) } : {}),
  }
  if (type === 'mcq') {
    return { ...base, ...(typeof q.explanation === 'string' && q.explanation.trim() ? { explanation: q.explanation.trim() } : {}) }
  }
  const marks = Math.round(Number(q.marks))
  return {
    ...base,
    ...(marks > 0 ? { marks } : {}),
    ...(typeof q.markingGuide === 'string' && q.markingGuide.trim() ? { guide: q.markingGuide.trim() } : {}),
    ...(type === 'wordcloud' ? { maxEntries: Math.min(10, Math.max(1, Number(q.wcMaxSubmissions) || 3)) } : {}),
    ...(type === 'rating' ? {
      ratingMax: q.ratingMax === 10 ? 10 : 5,
      leftLabels:  options.map((_, i) => String(q.leftLabels?.[i]  ?? q.leftLabel  ?? '')),
      rightLabels: options.map((_, i) => String(q.rightLabels?.[i] ?? q.rightLabel ?? '')),
    } : {}),
  }
}

/** Show slides coming back from a show → editor slides again. */
export function expandTestBlocks(slides: AnyS[]): AnyS[] {
  const out: AnyS[] = []
  for (const s of slides) {
    if (!(s?.type === 'testblock' && Array.isArray(s.questions))) { out.push(s); continue }
    const header = s._header ?? { id: s.id, type: 'testblock', ...testSettingsOf(s) }
    const members = Array.isArray(s._members) ? s._members : s.questions.map((q: TestQuestion) => ({
      id: q.id, type: qTypeOf(q), question: q.question, options: q.options,
      ...(q.correctAnswers?.length ? { correctAnswers: q.correctAnswers } : {}),
      ...(q.explanation ? { explanation: q.explanation } : {}),
      ...(q.imgUrl ? { imgUrl: q.imgUrl } : {}),
      ...(q.marks ? { marks: q.marks } : {}),
      ...(q.guide ? { markingGuide: q.guide } : {}),
      ...(q.maxEntries ? { wcMaxSubmissions: q.maxEntries } : {}),
      ...(q.ratingMax === 10 ? { ratingMax: 10 } : {}),
      ...(q.leftLabels ? { leftLabels: q.leftLabels } : {}),
      ...(q.rightLabels ? { rightLabels: q.rightLabels } : {}),
    }))
    out.push(header, ...members, s._end ?? { id: `${s.id}-end`, type: 'testend', blockId: s.id })
  }
  return out
}

/** Show slide → what phones get: correct answers, explanations and marking guides removed. */
export function toStoredTestBlock(s: TestBlockShowSlide): StoredTestBlockSlide {
  return {
    id: s.id, type: 'testblock', ...testSettingsOf(s),
    questions: s.questions.map(q => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { correctAnswers, explanation, guide, ...rest } = q
      return { ...rest, type: qTypeOf(q), pick: qTypeOf(q) === 'mcq' ? Math.max(1, correctAnswers.length) : 1 }
    }),
  }
}

/** Blocks a show can't start with, with a reason the host can act on. */
export function testProblems(slides: AnyS[]): { slideId: string; message: string }[] {
  const out: { slideId: string; message: string }[] = []
  for (const r of testRanges(slides)) {
    const qs = slides.slice(r.start + 1, r.end)
    if (qs.length === 0) { out.push({ slideId: r.headerId, message: 'Your self-paced test block has no questions yet.' }); continue }
    qs.forEach((q, i) => {
      const filled = (q.options ?? []).filter((o: string) => String(o).trim()).length
      const t = qTypeOf(q)
      if (t === 'mcq' && !(q.correctAnswers?.length > 0)) out.push({ slideId: q.id, message: `Question ${i + 1} in your self-paced test has no correct answer ticked.` })
      else if (t === 'mcq' && filled < 2) out.push({ slideId: q.id, message: `Question ${i + 1} in your self-paced test needs at least two options.` })
      else if (t === 'ranking' && filled < 2) out.push({ slideId: q.id, message: `Question ${i + 1} in your self-paced test needs at least two items to rank.` })
      else if (t === 'rating' && filled < 1) out.push({ slideId: q.id, message: `Question ${i + 1} in your self-paced test needs at least one item to rate.` })
    })
  }
  return out
}

/* ─────────────────────────────────────────────────────────────────────────
   Live state — session doc field `tests.<blockId>`
   Clock: `endsAt` and `pausedAt` are presenter Date.now() values (phones
   count down against them, like the existing question timer). Ranking time
   uses server timestamps so a phone's clock can't help or hurt anyone.
   ───────────────────────────────────────────────────────────────────────── */

export type TestStatus = 'ready' | 'running' | 'paused' | 'ended'
export type TestStage  = 'test' | 'leaderboard' | 'review'

export interface TestState {
  status:        TestStatus
  /** Bumped by "Restart test" — answers from an older round don't count. */
  round:         number
  /** Full time limit, for "Restart timer". */
  durationMs:    number
  endsAt:        number | null
  remainingMs:   number | null
  pausedAt:      number | null
  pausedTotalMs: number
  /** Server time the clock (re)started — finish times count from here. */
  startedServer?: { seconds: number; nanoseconds: number } | null
  endedServer?:   { seconds: number; nanoseconds: number } | null
  /** Where the presenter is after the test (phones follow along). */
  stage:         TestStage
  reviewIndex:   number
  /** Correct answers + explanations, published once the test ends. */
  reveal?:       Record<string, { correct: number[]; explanation?: string }>
  /** Everyone's result, published once the winner is shown:
   *  person id → [place, correct, time in ms, 1 if they ran out of time]. */
  ranks?:        { total: number; questions: number; at: number; entries: Record<string, [number, number, number, number?]> }
}

/** One person's test sheet — a doc in `responses`, id `${blockId}__${personId}`. */
export interface TestAnswerDoc {
  slideId:          string          // the block id
  type:             'testblock'
  value:            string          // '' — keeps the shared Response shape
  respondentId:     string
  respondentName:   string
  respondentEmoji?: string
  round:            number
  answers:          Record<string, TestAnswer>
  current:          number
  finished:         boolean
  finishedServer?:  { seconds: number; nanoseconds: number; toMillis?: () => number } | null
  /** Paused time so far when this person submitted — later pauses aren't theirs. */
  pausedAtFinish?:  number
  /** Written by the presenter when the block shows scores on submit. */
  score?:           number
  /** Set when the host restarted the timer after this person submitted. */
  reopened?:        boolean
  submittedAt?:     unknown
}

export const testAnswerDocId = (blockId: string, personId: string) => `${blockId}__${personId}`

const tsMs = (t: AnyS): number | null => {
  if (!t) return null
  if (typeof t.toMillis === 'function') return t.toMillis()
  if (typeof t.seconds === 'number') return t.seconds * 1000 + Math.round((t.nanoseconds ?? 0) / 1e6)
  return null
}

export const sameAnswer = (a: TestAnswer | undefined, b: number[]) =>
  Array.isArray(a) && a.length === b.length && [...a as number[]].sort((x, y) => x - y).every((v, i) => v === [...b].sort((x, y) => x - y)[i])

/** Multiple-choice questions only — the ones that mark themselves. */
export const autoMarked = <T extends { type?: string }>(questions: T[]) => questions.filter(q => qTypeOf(q) === 'mcq')

export function countCorrect(answers: Record<string, TestAnswer>, questions: TestQuestion[]): number {
  return autoMarked(questions).reduce((n, q) => n + (q.correctAnswers.length && sameAnswer(answers[q.id], q.correctAnswers) ? 1 : 0), 0)
}

export const wordCount = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0)

/** Has the person given an answer at all (`full` = completely, e.g. every item rated)? */
export function answerState(
  q: { type?: string; options: string[]; pick?: number }, a: TestAnswer | undefined,
): 'none' | 'part' | 'full' {
  const t = qTypeOf(q)
  if (a === undefined || a === null) return 'none'
  if (t === 'openended') return typeof a === 'string' && a.trim() ? 'full' : 'none'
  if (t === 'wordcloud') return Array.isArray(a) && (a as string[]).some(w => String(w).trim()) ? 'full' : 'none'
  if (!Array.isArray(a) || a.length === 0) return 'none'
  const nums = a as number[]
  if (t === 'rating') {
    const rated = nums.filter(v => typeof v === 'number' && v >= 0).length
    return rated === 0 ? 'none' : rated >= q.options.length ? 'full' : 'part'
  }
  if (t === 'ranking') return nums.length >= q.options.length ? 'full' : 'part'
  return nums.length >= (q.pick ?? 1) ? 'full' : 'part'
}
export const hasAnswer = (q: { type?: string; options: string[]; pick?: number }, a: TestAnswer | undefined) => answerState(q, a) !== 'none'

/** An answer as plain text, for results, exports and AI marking. */
export function answerText(q: { type?: string; options: string[]; ratingMax?: number }, a: TestAnswer | undefined): string {
  const t = qTypeOf(q)
  if (!hasAnswer({ ...q, pick: 1 }, a)) return ''
  if (t === 'openended') return String(a).trim()
  if (t === 'wordcloud') return (a as string[]).map(w => String(w).trim()).filter(Boolean).join('; ')
  const nums = a as number[]
  if (t === 'rating') return q.options.map((o, i) => `${o}: ${nums[i] >= 0 ? `${nums[i]}/${q.ratingMax ?? 5}` : 'not rated'}`).join('; ')
  if (t === 'ranking') return nums.map((k, i) => `${i + 1}. ${q.options[k] ?? ''}`).join('; ')
  return [...nums].sort((x, y) => x - y).map(i => `${optionLabel(i, q.options.length)}. ${q.options[i] ?? ''}`).join(', ')
}

export interface TestResultRow {
  id:       string
  name:     string
  emoji?:   string
  correct:  number
  total:    number
  /** Start → submit (or → end for those who ran out), minus pauses. */
  timeMs:   number
  status:   'submitted' | 'timeout'
  answers:  Record<string, TestAnswer>
  place:    number
}

/** Rank everyone: most correct first, then those who submitted before time
 *  ran out, then the faster finish, then name for a stable order. */
export function rankTest(docs: TestAnswerDoc[], questions: TestQuestion[], state: TestState): TestResultRow[] {
  const start = tsMs(state.startedServer)
  const end   = tsMs(state.endedServer)
  const paused = state.pausedTotalMs ?? 0
  const rows = docs
    .filter(d => d.round === state.round)
    .map(d => {
      const fin = d.finished ? tsMs(d.finishedServer) : null
      const stop = fin ?? end
      // Only pauses that happened before this person finished come off their time
      const off = fin !== null && typeof d.pausedAtFinish === 'number' ? d.pausedAtFinish : paused
      const timeMs = start !== null && stop !== null ? Math.max(0, stop - start - off) : state.durationMs
      return {
        id: d.respondentId,
        name: (d.respondentName || 'Anonymous').trim() || 'Anonymous',
        ...(d.respondentEmoji ? { emoji: d.respondentEmoji } : {}),
        correct: countCorrect(d.answers ?? {}, questions),
        total: autoMarked(questions).length,
        timeMs: Math.min(timeMs, state.durationMs + 24 * 3600_000),
        status: (d.finished ? 'submitted' : 'timeout') as 'submitted' | 'timeout',
        answers: d.answers ?? {},
        place: 0,
      }
    })
    .sort((a, b) =>
      b.correct - a.correct ||
      (a.status === b.status ? 0 : a.status === 'submitted' ? -1 : 1) ||
      a.timeMs - b.timeMs ||
      a.name.localeCompare(b.name))
  // Same score, same status and same time (to the second) share a place
  rows.forEach((r, i) => {
    const prev = rows[i - 1]
    r.place = prev && prev.correct === r.correct && prev.status === r.status && Math.round(prev.timeMs / 1000) === Math.round(r.timeMs / 1000)
      ? prev.place : i + 1
  })
  return rows
}

/** "9 min 12 s", "48 s" */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(s / 60)
  return m > 0 ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`
}

/** "08:42" for countdowns */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/** Time left right now for a live state. */
export function remainingOf(state: TestState | undefined, now = Date.now()): number {
  if (!state) return 0
  if (state.status === 'paused') return Math.max(0, state.remainingMs ?? 0)
  if (state.status === 'running') return Math.max(0, (state.endsAt ?? now) - now)
  if (state.status === 'ready') return state.durationMs
  return 0
}

export function freshTestState(durationMs: number, round = 0): TestState {
  return {
    status: 'ready', round, durationMs,
    endsAt: null, remainingMs: durationMs, pausedAt: null, pausedTotalMs: 0,
    startedServer: null, endedServer: null,
    stage: 'test', reviewIndex: 0,
  }
}

/** The steps the block plays after the test, in the host's chosen order.
 *  No multiple-choice questions means nothing to rank, so no leaderboard. */
export function afterSteps(order: TestAfterOrder, questionCount: number, hasLeaderboard = true): ({ stage: 'leaderboard' } | { stage: 'review'; index: number })[] {
  const review = Array.from({ length: questionCount }, (_, index) => ({ stage: 'review' as const, index }))
  const lb = hasLeaderboard ? [{ stage: 'leaderboard' as const }] : []
  if (order === 'review-only') return review
  if (order === 'lb-only') return lb.length ? lb : review
  return order === 'review-lb' ? [...review, ...lb] : [...lb, ...review]
}
