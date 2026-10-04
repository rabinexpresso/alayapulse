import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge Tailwind classes intelligently — later classes override earlier
 * conflicting ones (e.g. `cn("p-2", "p-4")` → `"p-4"`).
 * Used throughout shadcn/ui components.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/* ─────────────────────────────────────────────────────────────────────────
   MCQ answer options
   ───────────────────────────────────────────────────────────────────────── */

/** Most answer options an MCQ slide can hold. */
export const MAX_MCQ_OPTIONS = 100

/**
 * Above this many options, pie and donut slices get too thin to read and the
 * six-colour palette starts repeating — so those charts are offered only up
 * to here, and anything larger falls back to bars.
 */
export const MAX_VIZ_OPTIONS = 12

/**
 * Label for answer option `i` (0-based) on a question with `total` options.
 *
 * A–Z while there are 26 or fewer, plain 1-based numbers beyond that — letters
 * run out at Z, and "option 34" is much easier to call out to a room than
 * "option AH".
 */
export function optionLabel(i: number, total: number): string {
  return total > 26 ? String(i + 1) : String.fromCharCode(65 + i)
}

/** Sizes each Excel column to fit its header and longest value (capped so long text stays readable). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function fitColumns<T extends Record<string, any>>(ws: any, rows: T[]): any {
  const keys: string[] = []
  rows.forEach(r => Object.keys(r).forEach(k => { if (!keys.includes(k)) keys.push(k) }))
  ws['!cols'] = keys.map(k => {
    const longest = rows.reduce((m, r) => Math.max(m, ...String(r[k] ?? '').split('\n').map(l => l.length)), k.length)
    return { wch: Math.min(60, Math.max(6, longest + 2)) }
  })
  return ws
}
