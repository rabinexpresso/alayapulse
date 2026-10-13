import { fitColumns } from './utils'

/* ─────────────────────────────────────────────────────────────────────────
   Results Excel files, laid out for someone opening one for the first time:
     • a "Start here" tab that lists every other tab, part by part (live
       questions, self-paced test, survey) in the order of the show;
     • tab names that say which part they belong to ("Test – …");
     • one plain sentence at the top of every tab saying what it shows,
       then the table.
   ───────────────────────────────────────────────────────────────────────── */

export type Row = Record<string, string | number>

export interface BookTab {
  /** Tab name — kept under Excel's 31-character limit. */
  name:  string
  /** One line at the top of the tab: what it shows and how to read it. */
  intro: string
  /** Short description for the Start here tab. */
  about: string
  rows:  Row[]
}
export interface BookPart { heading: string; tabs: BookTab[] }

/** Excel tab names: at most 31 characters, none of : \ / ? * [ ] */
export const sheetName = (s: string) => s.replace(/[:\\/?*[\]]/g, '-').slice(0, 31)

/** "Q3. Which parts of the session did you find…" for a column header. */
export const qHeader = (i: number, question: string, max = 45) => {
  const q = question.replace(/\s+/g, ' ').trim()
  return `Q${i + 1}. ${q.length > max ? q.slice(0, max - 1).trimEnd() + '…' : q}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function introSheet(XLSX: any, tab: BookTab) {
  const rows = tab.rows.length ? tab.rows : [{ Note: 'Nothing here yet.' }]
  const ws = XLSX.utils.aoa_to_sheet([[tab.intro], []])
  XLSX.utils.sheet_add_json(ws, rows, { origin: 'A3' })
  return fitColumns(ws, rows)
}

/** Builds and downloads the file: Start here, then every part's tabs. */
export function writeResultsBook(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  XLSX: any, fileName: string, head: { title: string; sub: string }, parts: BookPart[], symbols = true,
  aiTip = 'On the Results page, “Copy for Gemini” (surveys) and the marking help (tests) give you a ready-made prompt.',
) {
  const used = new Set<string>(['Start here'])
  const unique = (n: string) => { let x = sheetName(n), k = 2; while (used.has(x)) x = sheetName(`${n.slice(0, 27)} (${k++})`); used.add(x); return x }
  const named = parts.map(p => ({ ...p, tabs: p.tabs.map(t => ({ ...t, name: unique(t.name) })) }))

  const guide: (string | number)[][] = [
    [head.title], [head.sub], [],
    ['WHAT’S IN THIS FILE — each line below is a tab along the bottom of the window, in the same order'], [],
  ]
  for (const p of named) {
    guide.push([p.heading])
    p.tabs.forEach(t => guide.push([`   ${t.name}`, t.about]))
    guide.push([])
  }
  if (symbols) {
    guide.push(['SYMBOLS'], ['   ✓', 'Right answer'], ['   ✗', 'Wrong answer'], ['   —', 'Not answered'], [])
  }
  guide.push(
    ['TIPS'],
    ['   Google Sheets', 'Upload this file to Google Drive, then open it with Google Sheets — Gemini in Sheets can summarise it for you.'],
    ['   AI summary', aiTip],
  )
  const wb = XLSX.utils.book_new()
  const start = XLSX.utils.aoa_to_sheet(guide)
  start['!cols'] = [{ wch: 34 }, { wch: 120 }]
  XLSX.utils.book_append_sheet(wb, start, 'Start here')
  for (const p of named) for (const t of p.tabs) XLSX.utils.book_append_sheet(wb, introSheet(XLSX, t), t.name)
  XLSX.writeFile(wb, fileName.replace(/[\\/:*?"<>|]+/g, '-'))
}
