/* ─────────────────────────────────────────────────────────────────────────
   Ranking question scoring — shared by the live presenter screen, the Results
   page and both Excel exports, so all of them always agree.
   ───────────────────────────────────────────────────────────────────────── */

export type RankingResult = {
  /** Total points per item (index matches the slide's options). */
  points:  number[]
  /** Average position per item, 1 = top. 0 when nobody has ranked yet. */
  avgPos:  number[]
  /** How many people put each item first. */
  firsts:  number[]
  /** Number of complete, valid rankings counted. */
  voters:  number
}

/**
 * Parses one stored ranking — option indexes in the order the person chose
 * them, e.g. "[2,0,3,1]" means item 2 was their #1.
 *
 * Returns null unless it's a complete ranking of exactly `count` items with no
 * repeats. If the presenter adds or removes an item after people have answered,
 * those older rankings no longer line up with the list, so they're dropped
 * rather than silently scoring the wrong items.
 */
export function parseRanking(value: string, count: number): number[] | null {
  try {
    const order = JSON.parse(value) as unknown
    if (!Array.isArray(order) || order.length !== count) return null
    const seen = new Set<number>()
    for (const v of order) {
      if (!Number.isInteger(v) || v < 0 || v >= count || seen.has(v)) return null
      seen.add(v)
    }
    return order as number[]
  } catch {
    return null
  }
}

/**
 * Each position earns points — with 4 items, 1st = 4 down to 4th = 1 — and the
 * totals set the overall order. An item that's consistently near the top beats
 * one that's #1 for a few people and last for everyone else.
 */
export function aggregateRanking(values: string[], count: number): RankingResult {
  const points = Array(count).fill(0)
  const posSum = Array(count).fill(0)
  const firsts = Array(count).fill(0)
  let voters = 0
  for (const value of values) {
    const order = parseRanking(value, count)
    if (!order) continue
    voters++
    order.forEach((opt, pos) => {
      points[opt] += count - pos
      posSum[opt] += pos + 1
      if (pos === 0) firsts[opt]++
    })
  }
  return {
    points,
    avgPos: posSum.map(sum => (voters > 0 ? sum / voters : 0)),
    firsts,
    voters,
  }
}

/**
 * Item indexes from most to least important. Ties go to the better average
 * position, then to the original order so equal scores don't jitter.
 */
export function rankingOrder(result: RankingResult, count: number): number[] {
  return Array.from({ length: count }, (_, i) => i).sort((a, b) =>
    result.points[b] - result.points[a] || result.avgPos[a] - result.avgPos[b] || a - b)
}
