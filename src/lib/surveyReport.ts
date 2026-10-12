import { qTypeOf, hasAnswer, answerText, TEST_QTYPE_LABEL, type TestAnswer } from './selfPacedTest'
import { aggregateRanking, rankingOrder } from './ranking'
import type { TestResult, TestResultQuestion, TestResultParticipant } from './deckStorage'

/* ─────────────────────────────────────────────────────────────────────────
   Survey results — one summary per question, shared by the Results page,
   the printed summary, the Word report, the Excel tabs and the text copied
   for Gemini, so every one of them shows the same numbers.
   ───────────────────────────────────────────────────────────────────────── */

type Q = TestResultQuestion
type P = TestResultParticipant
type Row = Record<string, string | number>

/** Brand colours first, then lighter / darker ones for long option lists. */
export const SURVEY_COLOURS = ['#00b0ff', '#000079', '#ff0065', '#ffc709', '#42db66', '#8080bc', '#ff80b2', '#80d8ff', '#b38b00', '#1f9e47', '#4d4da1', '#ff7a00']
const DARK_INK = new Set(['#00b0ff', '#ffc709', '#42db66', '#80d8ff', '#ff80b2'])
/** Pie charts stop being readable past this many options — bars instead. */
export const PIE_MAX = 12

export const surveyTypeLabel = (q: Q) =>
  qTypeOf(q) === 'mcq' ? (q.multi ? 'Checkboxes' : 'Multiple choice') : TEST_QTYPE_LABEL[qTypeOf(q)]

const given = (q: Q, a: TestAnswer | undefined) => hasAnswer({ ...q, pick: 1 }, a)
const picks = (a: TestAnswer | undefined) => (Array.isArray(a) ? a : []) as number[]
const pctOf = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0)
const ORD = ['1st', '2nd', '3rd']
export const placeLabel = (i: number) => ORD[i] ?? `${i + 1}th`

export type QSummary =
  | { kind: 'choice'; answered: number; multi: boolean; rows: { label: string; count: number; pct: number }[] }
  | { kind: 'rating'; answered: number; max: number; rows: { label: string; avg: number | null; n: number; dist: number[]; left?: string; right?: string }[] }
  | { kind: 'ranking'; answered: number; voters: number; rows: { label: string; avgPos: number; firsts: number; points: number }[] }
  | { kind: 'words'; answered: number; rows: { label: string; count: number }[] }
  | { kind: 'text'; answered: number; texts: { name: string; text: string }[] }

/** What everyone answered to one question, ready to show. */
export function summarize(q: Q, ps: P[]): QSummary {
  const t = qTypeOf(q)
  const answered = ps.filter(p => given(q, p.answers[q.id]))
  if (t === 'mcq') {
    return {
      kind: 'choice', answered: answered.length, multi: !!q.multi,
      rows: q.options.map((label, k) => {
        const count = answered.filter(p => picks(p.answers[q.id]).includes(k)).length
        return { label, count, pct: pctOf(count, answered.length) }
      }),
    }
  }
  if (t === 'rating') {
    const max = q.ratingMax ?? 5
    return {
      kind: 'rating', answered: answered.length, max,
      rows: q.options.map((label, i) => {
        const vs = answered.map(p => (p.answers[q.id] as number[])[i]).filter(v => typeof v === 'number' && v >= 0 && v <= max)
        const dist = Array.from({ length: max + 1 }, (_, v) => vs.filter(x => x === v).length)
        return { label, n: vs.length, avg: vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null, dist, left: q.leftLabels?.[i], right: q.rightLabels?.[i] }
      }),
    }
  }
  if (t === 'ranking') {
    const r = aggregateRanking(answered.map(p => JSON.stringify(p.answers[q.id])), q.options.length)
    return {
      kind: 'ranking', answered: answered.length, voters: r.voters,
      rows: rankingOrder(r, q.options.length).map(k => ({ label: q.options[k] ?? '', avgPos: r.avgPos[k], firsts: r.firsts[k], points: r.points[k] })),
    }
  }
  if (t === 'wordcloud') {
    const freq = new Map<string, number>()
    answered.forEach(p => (p.answers[q.id] as string[]).forEach(w => { const k = String(w).trim().toLowerCase(); if (k) freq.set(k, (freq.get(k) ?? 0) + 1) }))
    return { kind: 'words', answered: answered.length, rows: [...freq].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })) }
  }
  return { kind: 'text', answered: answered.length, texts: answered.map(p => ({ name: p.name, text: String(p.answers[q.id]).trim() })) }
}

/** One person's answer as plain text (multiple choice by option name, like Google Forms). */
export function surveyAnswerText(q: Q, a: TestAnswer | undefined): string {
  if (!given(q, a)) return ''
  if (qTypeOf(q) === 'mcq') return [...picks(a)].sort((x, y) => x - y).map(k => q.options[k] ?? '').join(', ')
  return answerText(q, a)
}

/** One sentence per question for quick reading. */
export function summaryLine(_q: Q, s: QSummary): string {
  if (!s.answered) return 'Nobody answered'
  if (s.kind === 'choice') {
    const top = Math.max(...s.rows.map(r => r.count))
    const leaders = s.rows.filter(r => r.count === top && top > 0).map(r => r.label)
    return s.multi
      ? `Ticked most: ${leaders.join(' and ')} (${top} of ${s.answered} people)`
      : `Most common answer: ${leaders.join(' and ')} (${top} ${top === 1 ? 'person' : 'people'}${leaders.length > 1 ? ' each' : ''})`
  }
  if (s.kind === 'rating') return `Average out of ${s.max}: ` + s.rows.map(r => `${r.label} ${r.avg === null ? '–' : r.avg.toFixed(1)}`).join(', ')
  if (s.kind === 'ranking') return 'Everyone’s rankings combined: ' + s.rows.map((r, i) => `${placeLabel(i)} ${r.label}`).join(', ')
  if (s.kind === 'words') return 'Most common: ' + s.rows.slice(0, 8).map(r => `${r.label} (${r.count})`).join(', ')
  return `${s.answered} written answer${s.answered !== 1 ? 's' : ''}`
}

export const fmtDateTime = (ms: number) => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/* ── Excel ─────────────────────────────────────────────────────────────── */

/** Survey tabs: one row per person (like a Google Forms sheet), and a summary per question. */
export function surveySheets(survey: TestResult): { responses: Row[]; summary: Row[] } {
  const qs = survey.questions
  const head = (q: Q, i: number) => `Q${i + 1}. ${q.question.replace(/\s+/g, ' ').trim()}`.slice(0, 250)
  const responses: Row[] = survey.participants.map(p => {
    const row: Row = { Submitted: p.submittedAt ? fmtDateTime(p.submittedAt) : '' }
    if (survey.askNames) row.Name = p.name
    qs.forEach((q, i) => { row[head(q, i)] = surveyAnswerText(q, p.answers[q.id]) || '—' })
    return row
  })
  const summary: Row[] = []
  qs.forEach((q, i) => {
    const s = summarize(q, survey.participants)
    const base = { 'Q#': `Q${i + 1}`, Question: q.question.replace(/\s+/g, ' ').trim(), Type: surveyTypeLabel(q), Answered: s.answered }
    const push = (answer: string, people: string | number, extra: string | number) => summary.push({ ...base, 'Answer / item': answer, People: people, '% / average': extra })
    if (s.kind === 'choice') s.rows.forEach(r => push(r.label, r.count, `${r.pct}%`))
    else if (s.kind === 'rating') s.rows.forEach(r => push(r.label, r.n, r.avg === null ? '—' : `${r.avg.toFixed(1)} out of ${s.max}`))
    else if (s.kind === 'ranking') s.rows.forEach((r, k) => push(`${placeLabel(k)}: ${r.label}`, r.firsts, r.avgPos ? `average place ${r.avgPos.toFixed(1)}` : '—'))
    else if (s.kind === 'words') s.rows.slice(0, 40).forEach(r => push(r.label, r.count, `${pctOf(r.count, s.answered)}%`))
    else push('Written answers — see the Survey responses tab', s.answered, '')
    if (!s.answered && s.kind !== 'text') push('Nobody answered', 0, '')
  })
  return { responses, summary }
}

/* ── Text for Gemini ───────────────────────────────────────────────────── */

export const GEMINI_SURVEY_PROMPT = `Below are the results of a feedback survey. Please write a short summary report in plain English with:
1. The 3–5 main themes, with roughly how many people mentioned each
2. What people liked most
3. What people want improved, as clear action points
4. Anything surprising or worth following up
5. 3–5 short quotes that capture the mood (no names)
Base everything only on the answers below.`

export function surveyGeminiText(survey: TestResult, deckTitle: string): string {
  const n = survey.participants.length
  const lines = [GEMINI_SURVEY_PROMPT, '', `SURVEY: ${survey.title || 'Survey'} (${deckTitle}) — ${n} response${n !== 1 ? 's' : ''}`, '']
  survey.questions.forEach((q, i) => {
    const s = summarize(q, survey.participants)
    lines.push(`Q${i + 1}. ${q.question.replace(/\s+/g, ' ').trim()} [${surveyTypeLabel(q)}, ${s.answered} answered]`)
    if (s.kind === 'choice') s.rows.forEach(r => lines.push(`- ${r.label}: ${r.count} ${r.count === 1 ? 'person' : 'people'} (${r.pct}%)`))
    else if (s.kind === 'rating') s.rows.forEach(r => lines.push(`- ${r.label}: average ${r.avg === null ? '–' : r.avg.toFixed(1)} out of ${s.max} (${r.n} ratings)`))
    else if (s.kind === 'ranking') s.rows.forEach((r, k) => lines.push(`- ${placeLabel(k)}: ${r.label} (average place ${r.avgPos ? r.avgPos.toFixed(1) : '–'})`))
    else if (s.kind === 'words') s.rows.slice(0, 40).forEach(r => lines.push(`- ${r.label}: ${r.count}`))
    else s.texts.forEach(t => lines.push(`- ${t.text.replace(/\s*\n\s*/g, ' ')}`))
    lines.push('')
  })
  return lines.join('\n')
}

/* ── Charts ────────────────────────────────────────────────────────────── */

/** A pie chart as SVG markup (percentages on slices big enough to hold them). */
export function pieSvg(values: number[], size = 150): string {
  const total = values.reduce((a, b) => a + b, 0)
  const r = size / 2, c = size / 2
  if (!total) return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${c}" cy="${c}" r="${r}" fill="#ecebf3"/></svg>`
  let a0 = -Math.PI / 2
  const parts: string[] = []
  const labels: string[] = []
  values.forEach((v, i) => {
    if (!v) return
    const colour = SURVEY_COLOURS[i % SURVEY_COLOURS.length]
    const frac = v / total
    if (frac >= 0.9999) parts.push(`<circle cx="${c}" cy="${c}" r="${r}" fill="${colour}"/>`)
    else {
      const a1 = a0 + frac * Math.PI * 2
      const large = frac > 0.5 ? 1 : 0
      parts.push(`<path d="M${c},${c} L${(c + r * Math.cos(a0)).toFixed(2)},${(c + r * Math.sin(a0)).toFixed(2)} A${r},${r} 0 ${large} 1 ${(c + r * Math.cos(a1)).toFixed(2)},${(c + r * Math.sin(a1)).toFixed(2)} Z" fill="${colour}" stroke="#fff" stroke-width="1.5"/>`)
    }
    if (frac >= 0.07) {
      const mid = a0 + frac * Math.PI
      const lr = frac >= 0.9999 ? 0 : r * 0.62
      labels.push(`<text x="${(c + lr * Math.cos(mid)).toFixed(1)}" y="${(c + lr * Math.sin(mid)).toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="${Math.round(size / 12)}" font-weight="700" fill="${DARK_INK.has(colour) ? '#000079' : '#ffffff'}" font-family="Poppins, Arial, sans-serif">${Math.round(frac * 100)}%</text>`)
    }
    a0 += frac * Math.PI * 2
  })
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}${labels.join('')}</svg>`
}

/** Fits text into a width on a canvas, with "…" when it won't. */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > width) t = t.slice(0, -1)
  return t + '…'
}

/** A chart picture for one question (pie + key, or labelled bars) — for "Copy
 *  chart" and the Word report. Written answers have no chart (null). */
export function chartCanvas(_q: Q, s: QSummary): HTMLCanvasElement | null {
  if (s.kind === 'text' || !s.answered) return null
  const W = 900
  const font = (px: number, weight = 500) => `${weight} ${px}px Poppins, Arial, sans-serif`
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  // Pie + key: single-answer multiple choice with a readable number of options
  if (s.kind === 'choice' && !s.multi && s.rows.length <= PIE_MAX) {
    const rowH = 38
    const H = Math.max(340, s.rows.length * rowH + 60)
    canvas.width = W; canvas.height = H
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
    const total = s.rows.reduce((a, r) => a + r.count, 0)
    const cx = 170, cy = H / 2, R = 140
    let a0 = -Math.PI / 2
    s.rows.forEach((r, i) => {
      if (!r.count) return
      const frac = r.count / total
      const a1 = a0 + frac * Math.PI * 2
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0, a1); ctx.closePath()
      ctx.fillStyle = SURVEY_COLOURS[i % SURVEY_COLOURS.length]; ctx.fill()
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.stroke()
      if (frac >= 0.07) {
        const mid = a0 + frac * Math.PI, lr = frac >= 0.9999 ? 0 : R * 0.62
        ctx.fillStyle = DARK_INK.has(SURVEY_COLOURS[i % SURVEY_COLOURS.length]) ? '#000079' : '#ffffff'
        ctx.font = font(22, 700); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(`${Math.round(frac * 100)}%`, cx + lr * Math.cos(mid), cy + lr * Math.sin(mid))
      }
      a0 = a1
    })
    const top = cy - (s.rows.length * rowH) / 2 + rowH / 2
    s.rows.forEach((r, i) => {
      const y = top + i * rowH
      ctx.fillStyle = SURVEY_COLOURS[i % SURVEY_COLOURS.length]
      ctx.beginPath(); ctx.arc(360, y, 9, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = '#000079'; ctx.font = font(20); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
      ctx.fillText(fit(ctx, r.label, 400), 382, y)
      ctx.fillStyle = '#4d4da1'; ctx.font = font(20, 600); ctx.textAlign = 'right'
      ctx.fillText(`${r.count} · ${r.pct}%`, W - 24, y)
    })
    return canvas
  }

  // Bars for everything else
  const rows: { label: string; value: number; max: number; right: string; colour: string }[] =
    s.kind === 'choice' ? s.rows.map((r, i) => ({ label: r.label, value: r.count, max: s.answered, right: `${r.count} · ${r.pct}%`, colour: s.multi ? '#00b0ff' : SURVEY_COLOURS[i % SURVEY_COLOURS.length] }))
    : s.kind === 'rating' ? s.rows.map(r => ({ label: r.label, value: r.avg ?? 0, max: s.max, right: r.avg === null ? '–' : `${r.avg.toFixed(1)} / ${s.max}`, colour: '#ff0065' }))
    : s.kind === 'ranking' ? s.rows.map((r, i) => ({ label: `${i + 1}. ${r.label}`, value: r.points, max: Math.max(...s.rows.map(x => x.points), 1), right: r.avgPos ? `avg place ${r.avgPos.toFixed(1)}` : '–', colour: '#00b0ff' }))
    : s.rows.slice(0, 15).map(r => ({ label: r.label, value: r.count, max: Math.max(s.rows[0]?.count ?? 1, 1), right: String(r.count), colour: '#42db66' }))
  const rowH = 44
  const H = rows.length * rowH + 30
  canvas.width = W; canvas.height = H
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
  const labelW = 300, barX = labelW + 20, barW = W - barX - 170
  rows.forEach((r, i) => {
    const y = 15 + i * rowH
    ctx.fillStyle = '#000079'; ctx.font = font(19); ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    ctx.fillText(fit(ctx, r.label, labelW), labelW, y + rowH / 2)
    ctx.fillStyle = '#f0f0f5'; ctx.fillRect(barX, y + 8, barW, rowH - 16)
    ctx.fillStyle = r.colour; ctx.fillRect(barX, y + 8, Math.max(0, Math.min(1, r.max ? r.value / r.max : 0)) * barW, rowH - 16)
    ctx.fillStyle = '#4d4da1'; ctx.font = font(19, 600); ctx.textAlign = 'left'
    ctx.fillText(r.right, barX + barW + 14, y + rowH / 2)
  })
  return canvas
}

export const canvasPng = (c: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => c.toBlob(b => (b ? resolve(b) : reject(new Error('no image'))), 'image/png'))

/* ── Printed summary ───────────────────────────────────────────────────── */

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The Summary tab as a clean, printable page (white, no buttons; a question never splits). */
export function surveyPrintHtml(survey: TestResult, deckTitle: string, when: number): string {
  const n = survey.participants.length
  const cards = survey.questions.map((q, i) => {
    const s = summarize(q, survey.participants)
    let body = ''
    if (!s.answered) body = '<p class="muted">Nobody answered this question.</p>'
    else if (s.kind === 'choice' && !s.multi && s.rows.length <= PIE_MAX) {
      body = `<div class="pie">${pieSvg(s.rows.map(r => r.count), 130)}<ul class="key">${s.rows.map((r, k) =>
        `<li${r.count ? '' : ' class="zero"'}><span class="dot" style="background:${SURVEY_COLOURS[k % SURVEY_COLOURS.length]}"></span>${esc(r.label)} <b>${r.count} · ${r.pct}%</b></li>`).join('')}</ul></div>`
    } else if (s.kind === 'choice' || s.kind === 'words' || s.kind === 'rating' || s.kind === 'ranking') {
      const rows = s.kind === 'choice' ? s.rows.map(r => ({ l: r.label, f: r.pct / 100, v: `${r.count} · ${r.pct}%` }))
        : s.kind === 'rating' ? s.rows.map(r => ({ l: r.label, f: (r.avg ?? 0) / s.max, v: r.avg === null ? '–' : `${r.avg.toFixed(1)} / ${s.max}` }))
        : s.kind === 'ranking' ? s.rows.map((r, k) => ({ l: `${k + 1}. ${r.label}`, f: r.points / Math.max(...s.rows.map(x => x.points), 1), v: r.avgPos ? `avg place ${r.avgPos.toFixed(1)}` : '–' }))
        : s.rows.slice(0, 20).map(r => ({ l: r.label, f: r.count / Math.max(s.rows[0].count, 1), v: String(r.count) }))
      body = `<table class="bars">${rows.map(r => `<tr><td class="l">${esc(r.l)}</td><td class="b"><div><span style="width:${Math.round(r.f * 100)}%"></span></div></td><td class="v">${r.v}</td></tr>`).join('')}</table>`
      if (s.kind === 'choice' && s.multi) body += '<p class="muted">People could tick several — % of everyone who answered.</p>'
    } else {
      body = `<ul class="texts">${s.texts.map(t => `<li>${esc(t.text)}${survey.askNames ? ` <span class="who">— ${esc(t.name)}</span>` : ''}</li>`).join('')}</ul>`
    }
    return `<section class="q${s.kind === 'text' ? ' long' : ''}"><h3>${i + 1}. ${esc(q.question)}</h3><p class="meta">${surveyTypeLabel(q)} · ${s.answered} of ${n} answered</p>${body}</section>`
  }).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(survey.title || 'Survey')} — summary</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
@page { size: A4; margin: 16mm 14mm 18mm; @bottom-center { content: "Page " counter(page) " of " counter(pages); font: 9px Poppins, Arial, sans-serif; color: #8080bc; } }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: Poppins, Arial, sans-serif; color: #1a1a4a; margin: 0; font-size: 12px; }
header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #ff0065; padding-bottom: 6px; margin-bottom: 14px; }
.brand { font-weight: 700; color: #000079; } .brand b { color: #ff0065; }
h1 { font-size: 22px; color: #000079; margin: 0 0 2px; } .sub { color: #6666af; margin: 0 0 16px; }
.q { border: 1px solid #e8e8f1; border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; break-inside: avoid; }
.q.long { break-inside: auto; }
h3 { font-size: 13px; color: #000079; margin: 0 0 2px; break-after: avoid; } .meta { color: #8080bc; font-size: 10px; margin: 0 0 10px; }
.pie { display: flex; align-items: center; gap: 22px; } .key { list-style: none; margin: 0; padding: 0; }
.key li { margin: 3px 0; display: flex; align-items: center; gap: 7px; } .key li.zero { color: #a0a0c8; } .key b { margin-left: 6px; color: #4d4da1; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex: none; }
.bars { width: 100%; border-collapse: collapse; } .bars td { padding: 3px 0; vertical-align: middle; }
.bars .l { width: 34%; padding-right: 10px; } .bars .v { width: 18%; text-align: right; color: #4d4da1; font-weight: 600; white-space: nowrap; }
.bars .b div { background: #f0f0f5; height: 12px; border-radius: 3px; } .bars .b span { display: block; height: 12px; background: #00b0ff; border-radius: 3px; }
.texts { margin: 0; padding-left: 16px; } .texts li { margin: 4px 0; line-height: 1.45; break-inside: avoid; } .who { color: #8080bc; }
.muted { color: #8080bc; font-size: 10px; margin: 6px 0 0; }
</style></head><body>
<header><span class="brand">alaya <b>pulse</b></span><span class="sub" style="margin:0">Survey summary</span></header>
<h1>${esc(survey.title || 'Survey')}</h1>
<p class="sub">${esc(deckTitle)} · ${n} response${n !== 1 ? 's' : ''} · ${survey.askNames ? 'names recorded' : 'anonymous'} · printed ${esc(fmtDateTime(when))}</p>
${cards}
</body></html>`
}

/* ── Word report ───────────────────────────────────────────────────────── */

/** The summary as a Word document: each question with its chart, the numbers and every written answer. */
export async function surveyDocx(survey: TestResult, deckTitle: string): Promise<Blob> {
  const d = await import('docx')
  const { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, LevelFormat, AlignmentType } = d
  const n = survey.participants.length
  const FULL = 9026 // A4 width minus 1-inch margins, in twentieths of a point
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'E8E8F1' }
  const borders = { top: border, bottom: border, left: border, right: border }
  const cell = (text: string, width: number, head = false, align?: (typeof AlignmentType)[keyof typeof AlignmentType]) => new TableCell({
    width: { size: width, type: WidthType.DXA }, borders,
    shading: head ? { fill: '000079', type: ShadingType.CLEAR, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ alignment: align, children: [new TextRun({ text, bold: head, color: head ? 'FFFFFF' : '1A1A4A', size: 19, font: 'Arial' })] })],
  })
  const table = (head: string[], rows: string[][], widths: number[]) => new Table({
    width: { size: FULL, type: WidthType.DXA }, columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, widths[i], true)) }),
      ...rows.map(r => new TableRow({ children: r.map((t, i) => cell(t, widths[i], false, i > 0 && widths[i] < 2000 ? AlignmentType.CENTER : undefined)) })),
    ],
  })
  const text = (t: string, opts: { size?: number; bold?: boolean; color?: string; after?: number; before?: number } = {}) =>
    new Paragraph({ spacing: { after: opts.after ?? 80, before: opts.before ?? 0 }, children: [new TextRun({ text: t, size: opts.size ?? 20, bold: opts.bold, color: opts.color ?? '1A1A4A', font: 'Arial' })] })

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [
    text('alaya pulse · Survey report', { size: 18, color: 'FF0065', bold: true }),
    text(survey.title || 'Survey', { size: 40, bold: true, color: '000079', after: 60 }),
    text(`${deckTitle} · ${n} response${n !== 1 ? 's' : ''} · ${survey.askNames ? 'names recorded' : 'anonymous'} · ${fmtDateTime(Date.now())}`, { size: 18, color: '6666AF', after: 240 }),
  ]
  for (const [i, q] of survey.questions.entries()) {
    const s = summarize(q, survey.participants)
    children.push(text(`${i + 1}. ${q.question.replace(/\s+/g, ' ').trim()}`, { size: 26, bold: true, color: '000079', before: 280, after: 40 }))
    children.push(text(`${surveyTypeLabel(q)} · ${s.answered} of ${n} answered${s.answered ? ` · ${summaryLine(q, s)}` : ''}`, { size: 18, color: '6666AF', after: 120 }))
    if (!s.answered) continue
    const canvas = chartCanvas(q, s)
    if (canvas) {
      const png = new Uint8Array(await (await canvasPng(canvas)).arrayBuffer())
      const w = 560, h = Math.round(canvas.height * (w / canvas.width))
      children.push(new Paragraph({ spacing: { after: 120 }, children: [new ImageRun({ type: 'png', data: png, transformation: { width: w, height: h } })] }))
    }
    if (s.kind === 'choice') children.push(table(['Answer', 'People', '%'], s.rows.map(r => [r.label, String(r.count), `${r.pct}%`]), [6226, 1400, 1400]))
    else if (s.kind === 'rating') children.push(table(['Item', 'Average', 'Ratings'], s.rows.map(r => [r.label, r.avg === null ? '–' : `${r.avg.toFixed(1)} / ${s.max}`, String(r.n)]), [6226, 1400, 1400]))
    else if (s.kind === 'ranking') children.push(table(['Place', 'Item', 'Average place', '#1 for'], s.rows.map((r, k) => [placeLabel(k), r.label, r.avgPos ? r.avgPos.toFixed(1) : '–', String(r.firsts)]), [1000, 5226, 1500, 1300]))
    else if (s.kind === 'words') children.push(table(['Answer', 'People'], s.rows.slice(0, 40).map(r => [r.label, String(r.count)]), [7426, 1600]))
    else s.texts.forEach(t => children.push(new Paragraph({
      numbering: { reference: 'answers', level: 0 }, spacing: { after: 60 },
      children: [new TextRun({ text: t.text, size: 20, font: 'Arial', color: '1A1A4A' }), ...(survey.askNames ? [new TextRun({ text: ` — ${t.name}`, size: 18, font: 'Arial', color: '8080BC' })] : [])],
    })))
  }
  const doc = new Document({
    numbering: { config: [{ reference: 'answers', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 260 } } } }] }] },
    sections: [{ properties: { page: { margin: { top: 1200, bottom: 1200, left: 1440, right: 1440 } } }, children }],
  })
  return Packer.toBlob(doc)
}

/** Save a file the browser made. */
export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name.replace(/[\\/:*?"<>|]+/g, '-')
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

/* ── PDF (part of the Results page's PDF download) ─────────────────────── */

/** Adds a survey's summary pages: each question with its numbers and every written answer. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function addSurveyPdf(doc: any, autoTable: any, survey: TestResult) {
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 40
  const n = survey.participants.length
  const lastY = () => (doc as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 100
  const table = (startY: number, head: string[], body: string[][], widths: Record<number, { cellWidth: number; halign?: string }> = {}) => autoTable(doc, {
    startY, head: [head], body, theme: 'striped', headStyles: { fillColor: [255, 0, 101] },
    styles: { fontSize: 9, cellPadding: 4, overflow: 'linebreak' }, columnStyles: widths, margin: { left: margin, right: margin },
  })

  doc.addPage()
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(0, 0, 121)
  doc.text(`Survey: ${survey.title || 'Survey'}`, margin, 60)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(120)
  doc.text(`${n} response${n !== 1 ? 's' : ''} · ${survey.questions.length} questions · ${survey.askNames ? 'names recorded' : 'anonymous'}`, margin, 78)

  let y = 104
  survey.questions.forEach((q, i) => {
    const s = summarize(q, survey.participants)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(0, 0, 121)
    const lines: string[] = doc.splitTextToSize(`Q${i + 1}. ${q.question.replace(/\s+/g, ' ')}`, pageW - margin * 2)
    if (y + lines.length * 14 + 80 > pageH - 40) { doc.addPage(); y = 60 }
    doc.text(lines, margin, y)
    y += lines.length * 14 + 2
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110)
    doc.text(`${surveyTypeLabel(q)} · ${s.answered} of ${n} answered`, margin, y)
    const start = y + 6
    if (!s.answered) { y += 22; return }
    if (s.kind === 'choice') table(start, ['Answer', 'People', '%'], s.rows.map(r => [r.label, String(r.count), `${r.pct}%`]), { 1: { cellWidth: 56, halign: 'center' }, 2: { cellWidth: 44, halign: 'center' } })
    else if (s.kind === 'rating') table(start, ['Item', `Average (out of ${s.max})`, 'Ratings'], s.rows.map(r => [r.label, r.avg === null ? '-' : r.avg.toFixed(1), String(r.n)]), { 1: { cellWidth: 100, halign: 'center' }, 2: { cellWidth: 56, halign: 'center' } })
    else if (s.kind === 'ranking') table(start, ['Place', 'Item', 'Average place'], s.rows.map((r, k) => [placeLabel(k), r.label, r.avgPos ? r.avgPos.toFixed(1) : '-']), { 0: { cellWidth: 44 }, 2: { cellWidth: 80, halign: 'center' } })
    else if (s.kind === 'words') table(start, ['Answer', 'People'], s.rows.slice(0, 40).map(r => [r.label, String(r.count)]), { 1: { cellWidth: 56, halign: 'center' } })
    else table(start, survey.askNames ? ['Name', 'Answer'] : ['Answer'], s.texts.map(t => survey.askNames ? [t.name, t.text] : [t.text]), survey.askNames ? { 0: { cellWidth: 110 } } : {})
    y = lastY() + 24
  })
}
