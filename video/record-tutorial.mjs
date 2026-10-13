/* Throwaway script — records the full Alaya Pulse tutorial (mid-October 2026
   edition: self-paced test with the answer guide, survey, session names),
   scene by scene, against the LIVE site.
   Headless Chrome + CDP screencast, with an injected caption bar and a fake
   cursor. Scenes are named in the order they appear in the finished video,
   which isn't always the order they're recorded in (the test is built in the
   editor early on, but shown in the video as its own part). A few simulated
   colleagues join and take part through the Firebase SDK, so the lobby,
   results, dashboard and leaderboard look like a real session. */
import puppeteer from 'puppeteer-core'
import { mkdirSync, rmSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import os from 'node:os'
import { initializeApp } from 'firebase/app'
import { getFirestore, doc as fdoc, setDoc, getDoc, serverTimestamp, collection, addDoc } from 'firebase/firestore'

const APP = 'https://alaya-pulse.web.app'
const CLIPS = resolve('video/clips')
const FFMPEG = resolve('node_modules/ffmpeg-static/ffmpeg.exe')
const PROFILE = join(os.tmpdir(), 'pptr-chrome-video-' + Date.now())
const TEST_CSV = resolve('video/assets/test-demo.csv')
const SURVEY_CSV = resolve('video/assets/survey-demo.csv')
mkdirSync(CLIPS, { recursive: true })

const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]))
const fdb = getFirestore(initializeApp({ apiKey: env.VITE_FIREBASE_API_KEY, projectId: env.VITE_FIREBASE_PROJECT_ID, appId: env.VITE_FIREBASE_APP_ID }))

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []          // { scene, ok, note }

/* ── Overlay: caption bar + fake cursor ─────────────────────────────────── */
async function overlay(page) {
  await page.evaluate(() => {
    if (document.getElementById('__cap')) return
    const narrow = window.innerWidth < 600
    const cap = document.createElement('div')
    cap.id = '__cap'
    cap.style.cssText = `position:fixed;left:50%;bottom:${narrow ? 16 : 28}px;transform:translateX(-50%);
      width:max-content;max-width:${narrow ? 94 : 80}%;box-sizing:border-box;
      padding:${narrow ? '12px 16px' : '16px 34px'};border-radius:${narrow ? 16 : 22}px;
      background:rgba(6,6,34,.97);border:1.5px solid rgba(255,255,255,.14);
      color:#fff;font:600 ${narrow ? 17 : 25}px/1.38 Poppins,system-ui,sans-serif;letter-spacing:.005em;
      z-index:2147483646;opacity:0;transition:opacity .3s ease;text-align:center;text-wrap:balance;
      box-shadow:0 10px 36px rgba(0,0,0,.55);pointer-events:none;white-space:normal;`
    document.body.appendChild(cap)
    const cur = document.createElement('div')
    cur.id = '__cur'
    cur.style.cssText = `position:fixed;left:-60px;top:-60px;width:26px;height:26px;
      border-radius:50%;background:rgba(255,0,101,.55);border:2.5px solid #fff;
      box-shadow:0 2px 10px rgba(0,0,0,.5);z-index:2147483647;pointer-events:none;
      transition:left .6s cubic-bezier(.22,1,.36,1),top .6s cubic-bezier(.22,1,.36,1),transform .18s ease;`
    document.body.appendChild(cur)
  })
}

/* Every caption stays up long enough to read at an easy pace. */
const readTime = t => 1300 + t.length * 58
async function cap(page, text, hold = 2600) {
  hold = Math.max(hold, readTime(text))
  await overlay(page)
  await page.evaluate(t => {
    const el = document.getElementById('__cap')
    el.style.opacity = '0'
    setTimeout(() => { el.textContent = t; el.style.opacity = t ? '1' : '0' }, 180)
  }, text)
  await sleep(hold)
}

async function point(page, matcher, fx = 0.5) {
  await overlay(page)
  return page.evaluate((m, fx) => {
    const f = new Function('return ' + m)()
    const el = f()
    if (!el) return null
    el.scrollIntoView({ block: 'center', behavior: 'instant' })
    const r = el.getBoundingClientRect()
    const x = r.x + r.width * fx, y = r.y + r.height / 2
    const c = document.getElementById('__cur')
    c.style.left = (x - 13) + 'px'
    c.style.top = (y - 13) + 'px'
    return { x, y }
  }, matcher, fx)
}

async function click(page, matcher, { settle = 800, glide = 700, fx = 0.5 } = {}) {
  const pt = await point(page, matcher, fx)
  if (!pt) { console.log('   · click MISS', matcher.slice(0, 90)); return false }
  await sleep(glide)
  await page.evaluate(() => {
    const c = document.getElementById('__cur')
    c.style.transform = 'scale(.55)'
    setTimeout(() => { c.style.transform = 'scale(1)' }, 170)
  })
  await sleep(110)
  await page.mouse.click(pt.x, pt.y)
  await sleep(settle)
  return true
}

/* Click a field, then type into it like a person. */
async function typeInto(page, matcher, text, delay = 30) {
  const ok = await click(page, matcher, { settle: 250, glide: 500 })
  if (!ok) return false
  await page.keyboard.type(text, { delay })
  await sleep(250)
  return true
}

const byText = (t, tag = 'button') =>
  `() => [...document.querySelectorAll('${tag}')].find(e => (e.textContent||'').trim().toLowerCase().includes(${JSON.stringify(t.toLowerCase())}))`
const byExact = (t, tag = 'button') =>
  `() => [...document.querySelectorAll('${tag}')].find(e => (e.textContent||'').trim() === ${JSON.stringify(t)})`
const lastExact = (t, tag = 'button') =>
  `() => [...document.querySelectorAll('${tag}')].filter(e => (e.textContent||'').trim() === ${JSON.stringify(t)}).at(-1)`
const bySel = s => `() => document.querySelector(${JSON.stringify(s)})`
const byPlaceholder = (p, tag = 'textarea') =>
  `() => [...document.querySelectorAll('${tag}')].find(e => (e.placeholder||'').startsWith(${JSON.stringify(p)}))`
const testOption = i =>
  `() => [...document.querySelectorAll('button')].filter(x => x.className.includes('rounded-2xl') && x.className.includes('border-2'))[${i}]`
const testBox = n => `() => document.querySelector('button[aria-label^="Question ${n}"]')`

async function until(page, jsExpr, timeout = 12000, label = '') {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const ok = await page.evaluate(e => { try { return !!eval(e) } catch { return false } }, jsExpr)
    if (ok) return true
    await sleep(250)
  }
  if (label) console.log(`   · TIMEOUT waiting: ${label}`)
  return false
}
const hasText = s => `(document.body.innerText||'').includes(${JSON.stringify(s)})`
const bodyText = p => p.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))

/* ── Recording wrapper with per-scene isolation ─────────────────────────── */
async function scene(page, name, fn) {
  const file = `${CLIPS}/${name}.webm`
  let rec
  try {
    rec = await page.screencast({ path: file, ffmpegPath: FFMPEG })
    const note = await fn()
    results.push({ scene: name, ok: true, note: note || '' })
    console.log(`✓ ${name}${note ? '  — ' + note : ''}`)
  } catch (e) {
    results.push({ scene: name, ok: false, note: String(e).slice(0, 160) })
    console.log(`✗ ${name}  — ${String(e).slice(0, 160)}`)
  } finally {
    if (rec) { try { await rec.stop() } catch {} }
  }
}

/* ── Simulated colleagues ───────────────────────────────────────────────── */
const PEOPLE = [
  ['Anita Sharma', '🌟'], ['Bikash Thapa', '🚀'], ['Chandra Lama', '🦊'], ['Deepa Gurung', '🐼'],
  ['Gita Magar', '🎯'], ['Hari Karki', '🦁'], ['Kiran Joshi', '🍀'], ['Maya Shrestha', '🐯'], ['Nabin Rai', '😎'],
].map(([name, emoji], i) => ({ id: `demo${i}-${Math.random().toString(36).slice(2, 8)}`, name, emoji }))
const TEST_KEY = [[0], [1], [0, 2], [2], [0], null]   // the 6th is a written answer
const TEST_TEXTS = [
  'People take part instead of just listening.', 'Everyone gets involved and you see what they think.', 'It keeps people paying attention.',
  'You get instant feedback on what people understood.', 'People join in rather than switch off.', 'It makes the audience part of it.',
  'Quick feedback shows the presenter what to explain again.', 'People listen more when they know a question is coming.', 'It is more fun than just slides.',
]

async function joinAll(code) {
  for (const p of PEOPLE) {
    await setDoc(fdoc(fdb, 'sessions', code, 'viewers', p.id), { joinedAt: serverTimestamp(), lastSeen: serverTimestamp(), name: p.name, emoji: p.emoji })
    await sleep(350 + Math.random() * 300)
  }
}
async function answerMcq(code, slide) {
  const picks = [0, 0, 1, 0, 0, 2, 0, 1, 0]
  for (const [i, p] of PEOPLE.entries()) {
    const ok = slide.correctAnswers?.includes(picks[i])
    await addDoc(collection(fdb, 'sessions', code, 'responses'), {
      slideId: slide.id, type: 'mcq', value: JSON.stringify([picks[i]]),
      respondentName: p.name, respondentId: p.id, respondentEmoji: p.emoji,
      quizPoints: { answer: ok ? 100 : 0, speed: 0 }, submittedAt: serverTimestamp(),
    })
    await sleep(250 + Math.random() * 350)
  }
}
/* Everyone takes the test: open their sheet, save answers as they go, submit.
   Different speeds and a few wrong answers make the leaderboard believable. */
function takeTest(code, block) {
  const plans = [
    { wrong: [], end: 34 }, { wrong: [3], end: 38 }, { wrong: [], end: 47 }, { wrong: [1, 2], end: 40 },
    { wrong: [2], end: 52 }, { wrong: [0, 3], end: 44 }, { wrong: [], end: 58 }, { wrong: [4], end: 49 }, { wrong: [1, 2, 4], end: 55 },
  ]
  return Promise.all(PEOPLE.map(async (p, i) => {
    const plan = plans[i]
    const ref = fdoc(fdb, 'sessions', code, 'responses', `${block.id}__${p.id}`)
    await sleep(1500 + Math.random() * 4000)
    await setDoc(ref, { slideId: block.id, type: 'testblock', value: '', respondentId: p.id, respondentName: p.name, respondentEmoji: p.emoji, round: 0, answers: {}, current: 0, finished: false, finishedServer: null, submittedAt: serverTimestamp() })
    const answers = {}
    const per = (plan.end * 1000 - 6000) / block.questions.length
    for (const [qi, q] of block.questions.entries()) {
      await sleep(per * (0.7 + Math.random() * 0.6))
      answers[q.id] = q.type === 'openended' ? TEST_TEXTS[i]
        : plan.wrong.includes(qi) ? [TEST_KEY[qi][0] === 3 ? 2 : 3] : TEST_KEY[qi]
      await setDoc(ref, { answers, current: qi, round: 0, submittedAt: serverTimestamp() }, { merge: true })
    }
    await setDoc(ref, { finished: true, finishedServer: serverTimestamp(), round: 0, pausedAtFinish: 0, reopened: false }, { merge: true })
  }))
}

/* Colleagues answer the survey — anonymously, one by one, like a real room. */
async function answerSurvey(code, block) {
  const ONE = [0, 0, 1, 0, 0, 1, 0, 0, 2]
  const SOME = [[0, 2], [0], [1, 2], [0, 1], [2], [0, 2], [0, 1, 2], [1], [0, 3]]
  const RATE = [5, 4, 4, 5, 3, 4, 5]
  const TEXTS = ['More time for questions', '', 'Share the slides afterwards', '', 'A shorter break in the middle', '', 'More examples from real cases', '', '']
  for (const [i] of PEOPLE.entries()) {
    const id = 'sv' + Math.random().toString(36).slice(2, 12)
    const answers = {}
    for (const q of block.questions) {
      const t = q.type ?? 'mcq'
      if (t === 'mcq') answers[q.id] = q.multi ? SOME[i].filter(k => k < q.options.length) : [ONE[i] % q.options.length]
      else if (t === 'rating') answers[q.id] = q.options.map((_, k) => Math.min(q.ratingMax ?? 5, RATE[(i + k) % RATE.length]))
      else if (t === 'openended' && TEXTS[i]) answers[q.id] = TEXTS[i]
    }
    await setDoc(fdoc(fdb, 'sessions', code, 'responses', `${block.id}__${id}`), {
      slideId: block.id, type: 'testblock', value: '', respondentId: id, respondentName: 'Anonymous',
      round: 0, current: 0, rev: 1, answers, finished: true, finishedServer: serverTimestamp(), submittedAt: serverTimestamp(),
    })
    await sleep(900 + Math.random() * 900)
  }
}

/* A survey question's card on the phone, and things inside it */
const surveyCard = n => `[...document.querySelectorAll('div')].find(d => d.className.includes('px-5 py-4') && (d.querySelector('p')?.textContent || '').startsWith('${n}. '))`
const inSurveyCard = (n, pick) => `() => { const c = ${surveyCard(n)}; return c && ${pick} }`

/* ══ Main ═══════════════════════════════════════════════════════════════ */
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  userDataDir: PROFILE,
  args: ['--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1300,760',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
})

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 720 })
  await page.evaluateOnNewDocument(() => localStorage.setItem('alaya-pulse-storage', 'browser'))
  page.on('pageerror', e => console.log('   · PAGE ERROR', String(e).slice(0, 160)))

  /* ── 01 · Intro ─────────────────────────────────────────────────── */
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await sleep(2200)
  await scene(page, 's01-intro', async () => {
    await cap(page, 'Alaya Pulse: live polls, quizzes and tests for your presentations', 4000)
    await cap(page, 'Here’s how to run your first session, step by step', 3400)
  })

  /* ── 02 · Import slides ─────────────────────────────────────────── */
  await page.goto(`${APP}/create`, { waitUntil: 'domcontentloaded' })
  await sleep(2400)
  await scene(page, 's02-import', async () => {
    await cap(page, 'Step 1: build your deck. Click Import to bring in your slides', 2600)
    await click(page, byExact('Import'), { settle: 900 })
    await cap(page, 'Use a PDF or HTML file. From PowerPoint or Google Slides? Save it as a PDF first', 3000)
    const inputs = await page.$$('input[accept*="html"]')
    if (!inputs.length) throw new Error('no html file input')
    await inputs[0].uploadFile(resolve('video/assets/demo-deck.html'))
    const ok = await until(page, hasText('Auto-split into'), 20000, 'auto-split toast')
    if (!ok) throw new Error('auto-split toast never appeared')
    await cap(page, 'An HTML file is cut into separate slides for you', 2000)
    const undone = await click(page, byText('Undo split'), { settle: 1400 })
    if (!undone) throw new Error('Undo split toast gone before we reached it')
    const back = await until(page, hasText('Split into'), 8000, 'manual split button')
    if (!back) throw new Error('manual split control not visible')
    await cap(page, 'Wrong number of slides? You can fix it yourself', 2600)
    await cap(page, 'Open the file, find the last slide number, and type it in', 3400)
    await click(page, byText('Split into'), { settle: 1600 })
    await cap(page, 'Now every slide is separate, so you can add questions in between', 3000)
    return 'manual split shown'
  })

  /* ── 04 · Question slide types ──────────────────────────────────── */
  await scene(page, 's04-question-types', async () => {
    await cap(page, 'Add a question anywhere in your deck', 2600)
    let opened = false
    for (let i = 0; i < 3 && !opened; i++) {
      await click(page, `() => { const b=[...document.querySelectorAll('button')].filter(e=>(e.textContent||'').includes('Insert slide here')); return b[2]||b[0] }`, { settle: 900 })
      opened = await page.evaluate(() => !!([...document.querySelectorAll('button')].find(e => (e.textContent || '').trim() === 'MCQ')))
    }
    if (!opened) throw new Error('slide-type menu did not open')
    await cap(page, 'Pick a type: multiple choice, word cloud, open-ended, rating or ranking', 3400)
    await click(page, byExact('MCQ'), { settle: 1400 })
    const added = await until(page, `!!document.querySelector('textarea[placeholder="Option A"]')`, 8000, 'MCQ editor')
    if (!added) throw new Error('MCQ slide did not open')
    await cap(page, 'Type your question, then the answers', 1600)
    if (!await typeInto(page, byPlaceholder('e.g. What is your biggest leadership'), 'What makes a presentation engaging?', 32)) throw new Error('question box not found')
    const opts = ['Audience participation', 'More bullet points', 'Longer slides', 'Reading every word']
    for (const [i, val] of opts.entries()) {
      if (!await typeInto(page, byPlaceholder(`Option ${'ABCD'[i]}`), val, 24)) throw new Error(`option ${'ABCD'[i]} not found`)
    }
    const q = await page.evaluate(() => [...document.querySelectorAll('textarea')].map(t => t.value).filter(Boolean))
    if (q[0] !== 'What makes a presentation engaging?' || q.length < 5) throw new Error('typed text landed in the wrong place: ' + JSON.stringify(q))
    await point(page, byText('Slide preview', 'p'))
    await cap(page, 'The preview beside it shows how it looks on the big screen', 2600)
    await point(page, byText('No limit'))
    await cap(page, 'Add a timer to make it a race: faster answers score more', 3000)
    const coloured = await click(page, byExact('Midnight'), { settle: 1200 })
    await cap(page, 'Pick a colour or a gradient. The text colour is set for you', 3000)
    return 'MCQ authored: ' + q.join(' | ') + (coloured ? ' · Midnight' : ' · (no gradient picker)')
  })

  /* ── 05 · Bulk CSV import ───────────────────────────────────────── */
  await scene(page, 's05-csv-import', async () => {
    await cap(page, 'Already have lots of questions? Add them all at once', 2600)
    await click(page, byExact('Import'), { settle: 800 })
    await click(page, byText('Import questions in CSV'), { settle: 1200 })
    const open = await until(page, hasText('Download template'), 8000, 'CSV modal')
    if (!open) throw new Error('CSV modal did not open')
    await point(page, byText('Download template', 'a'))
    await cap(page, 'Download the template. Ask ChatGPT or Gemini to fill it in from your Word document', 3800)
    const input = await page.$('input[type=file][accept=".csv"]')
    if (!input) throw new Error('CSV file input missing')
    await input.uploadFile(TEST_CSV)
    const asked = await until(page, hasText('Where should these'), 8000, 'destination choice')
    if (!asked) throw new Error('destination choice not shown')
    await cap(page, 'Upload the file, then choose where they go: live questions, a test or a survey', 3600)
    await click(page, byText('As live questions'), { settle: 900 })
    await point(page, byText('as live questions'))
    await cap(page, 'Each question becomes its own slide', 2400)
    await click(page, byExact('Cancel'), { settle: 900 })
    const gone = await until(page, `!${hasText('Where should these')}`, 6000, 'CSV modal close')
    if (!gone) throw new Error('CSV modal stayed open')
    return 'CSV modal shown + closed'
  })

  /* ── 06 · Slide Overview / reorder ──────────────────────────────── */
  await scene(page, 's06-overview', async () => {
    await cap(page, 'Slide Overview shows your whole deck', 2600)
    const ok = await click(page, bySel('[title="Slide overview"]'), { settle: 1600 })
    if (!ok) throw new Error('Slide overview button not found')
    const shown = await until(page, hasText('Slide Overview'), 8000, 'overview panel')
    if (!shown) throw new Error('overview did not open')
    await cap(page, 'Drag a slide to move it', 3200)
    await click(page, bySel('[title="Close (Esc)"]'), { settle: 900 })
    const closed = await until(page, `!document.querySelector('[title="Close (Esc)"]')`, 6000, 'overview close')
    if (!closed) throw new Error('Slide Overview stayed open')
    return 'overview shown + closed'
  })

  /* ── 07 · Save / undo / redo ────────────────────────────────────── */
  await scene(page, 's07-save', async () => {
    await cap(page, 'Made a mistake? Use Undo and Redo', 2600)
    await click(page, bySel('[title="Undo (Ctrl+Z)"]'), { settle: 900 })
    await click(page, bySel('[title="Redo (Ctrl+Shift+Z)"]'), { settle: 900 })
    await point(page, byText('Save'))
    await cap(page, 'Click Save to keep your deck', 3000)
    return 'save location shown'
  })

  /* ── 08 · Live quiz ─────────────────────────────────────────────── */
  await scene(page, 's08-live-quiz', async () => {
    // Back on the question — the tick next to the right answer
    await click(page, `() => [...document.querySelectorAll('[data-slide-id]')].find(e => /What makes a presentation/.test(e.textContent||''))`, { settle: 1000 })
    await cap(page, 'Tick the right answer, and quiz scoring turns on by itself', 2200)
    await click(page, `() => document.querySelector('button[title="Mark as correct answer"]')`, { settle: 1400 })
    const on = await until(page, hasText('Live quiz On'), 6000, 'live quiz on')
    if (!on) throw new Error('Live quiz did not turn on')
    await point(page, byText('Live quiz On'))
    await cap(page, 'Right answers score points. Faster answers score more', 3000)
    await cap(page, 'A leaderboard is added to the end of your deck for you', 3200)
    return 'live quiz on'
  })

  /* ── 14–16 · Self-paced test, built in the editor (shown later in the video) ── */
  await scene(page, 's14-test-add', async () => {
    await cap(page, 'Want everyone to answer a set of questions at their own pace, like an exam?', 3000)
    await click(page, byExact('Self-paced test'), { settle: 1400 })
    const added = await until(page, hasText('Self-paced test block'), 8000, 'test block')
    if (!added) throw new Error('test block not added')
    await cap(page, 'Add a Self-paced test. The questions inside the gold box are the test', 3400)
    return 'block added'
  })

  await scene(page, 's15-test-import', async () => {
    await click(page, `() => [...document.querySelectorAll('button')].filter(e => (e.textContent||'').trim() === 'Import CSV').at(-1)`, { settle: 1200 })
    const open = await until(page, hasText('Import questions into your self-paced test'), 8000, 'test CSV modal')
    if (!open) throw new Error('test CSV modal did not open')
    await cap(page, 'Import your test questions, or add them one by one', 2600)
    const input = await page.$('input[type=file][accept=".csv"]')
    await input.uploadFile(TEST_CSV)
    await until(page, hasText('to self-paced test'), 8000, 'add button')
    await click(page, `() => [...document.querySelectorAll('button')].find(e => /^Add \\d+ to self-paced test$/.test((e.textContent||'').trim()))`, { settle: 1600 })
    await cap(page, 'The right answers are already marked, so the test scores itself', 3200)
    return 'imported'
  })

  await scene(page, 's16-test-settings', async () => {
    await click(page, `() => [...document.querySelectorAll('[role=button]')].find(x => /Self-paced test block/.test(x.textContent || ''))`, { settle: 1200, fx: 0.62 })
    const open = await until(page, hasText('Time limit for the whole test'), 8000, 'test settings')
    if (!open) throw new Error('test settings not shown')
    await cap(page, 'Set one time limit for the whole test', 2000)
    await click(page, byExact('5 min'), { settle: 900 })
    await point(page, byText('When the test ends'))
    await cap(page, 'Choose when people see their score, and what happens after the test', 3200)
    await click(page, byExact('Ocean'), { settle: 900 })
    await point(page, byText('What everyone sees on the big screen', 'p'))
    await cap(page, 'And pick a colour or gradient for the big screen', 3400)
    return 'settings shown'
  })

  /* ── 22c–d · A survey, built in the editor (shown later in the video) ── */
  await scene(page, 's22c-survey-add', async () => {
    await cap(page, 'Want feedback? Add a survey. It works like a Google Form inside your deck', 3400)
    await click(page, byExact('Survey'), { settle: 1400 })
    const added = await until(page, hasText('Survey title'), 8000, 'survey block')
    if (!added) throw new Error('survey not added')
    await cap(page, 'Questions inside the pink frame are the survey. Give it a title', 2600)
    if (!await typeInto(page, byPlaceholder('Workshop feedback', 'input'), 'Session feedback', 40)) throw new Error('survey title box not found')
    await click(page, `() => [...document.querySelectorAll('button')].filter(e => (e.textContent||'').trim() === 'Import CSV').at(-1)`, { settle: 1200 })
    const open = await until(page, hasText('Import questions into your survey'), 8000, 'survey CSV modal')
    if (!open) throw new Error('survey CSV modal did not open')
    await cap(page, 'Import the questions, or add them one by one', 2400)
    await (await page.$('input[type=file][accept=".csv"]')).uploadFile(SURVEY_CSV)
    await until(page, hasText('to survey'), 8000, 'add to survey button')
    await click(page, `() => [...document.querySelectorAll('button')].find(e => /^Add \\d+ to survey$/.test((e.textContent||'').trim()))`, { settle: 1600 })
    // The editor opens the first imported question — back to the survey's own page
    await click(page, `() => [...document.querySelectorAll('span,p,div')].filter(x => /^\\d+ questions · anonymous$/.test((x.textContent || '').trim())).pop()`, { settle: 1400 })
    const imported = await until(page, `/Questions \\([1-9]/.test(document.body.innerText)`, 8000, 'survey questions')
    if (!imported) throw new Error('survey questions were not imported')
    await sleep(1200)
    return (await bodyText(page)).match(/Questions \(\d+\)/)?.[0]
  })

  await scene(page, 's22d-survey-settings', async () => {
    await point(page, byText('must answer', 'span'))
    await cap(page, 'Each question can be Must answer or Optional', 2600)
    await point(page, byExact('Anonymous'))
    await cap(page, 'It’s anonymous, unless you choose Ask for names', 2800)
    await point(page, byExact('Until I close it'))
    await cap(page, 'It stays open until you close it, so people can answer after the show too', 3600)
    return 'survey settings shown'
  })

  /* ── 09 · Start show + lobby ────────────────────────────────────── */
  // Start from the first slide so the show opens on the lobby
  await page.evaluate(() => { const c = document.getElementById('__cur'); if (c) { c.style.left = '-60px'; c.style.top = '-60px' } })
  await (await page.$('[data-slide-id]')).click()
  await sleep(900)
  let code = ''
  await scene(page, 's09-lobby', async () => {
    await cap(page, 'Step 2: present. Click Start Show', 2400)
    await click(page, byText('Start Show'), { settle: 800 })
    const live = await until(page, `window.location.pathname.startsWith('/present')`, 25000, 'present route')
    if (!live) throw new Error('did not enter the show')
    code = await page.evaluate(() => location.pathname.split('/').pop())
    await sleep(2000)
    joinAll(code).catch(e => console.log('   · join failed', e))
    await cap(page, 'Your audience scans the QR code with their phone camera. No app or sign-up needed', 5200)
    return 'lobby reached, code ' + code
  })

  /* ── 10 · Audience joins (phone) ────────────────────────────────── */
  const phone = await browser.newPage()
  await phone.setViewport({ width: 390, height: 720, isMobile: true, hasTouch: true })
  phone.on('pageerror', e => console.log('   · PHONE ERROR', String(e).slice(0, 160)))
  if (code) {
    await phone.goto(`${APP}/join`, { waitUntil: 'domcontentloaded' })
    await sleep(1800)
    await scene(phone, 's10-audience', async () => {
      await cap(phone, 'This is what your audience sees on their phone', 2600)
      await phone.evaluate(() => { const b = document.querySelector('input'); if (b) b.focus() })
      await phone.keyboard.type(code, { delay: 200 })
      await sleep(700)
      await phone.evaluate(() => { const i = document.getElementById('join-name'); if (i) i.focus() })
      await phone.keyboard.type('Alex Tamang', { delay: 90 })
      await sleep(500)
      await click(phone, byText('Join session'), { settle: 2600 })
      const joined = await until(phone, `window.location.pathname.startsWith('/vote')`, 12000, 'vote route')
      if (!joined) throw new Error('audience did not join')
      await cap(phone, 'They’re in. Questions will appear on their phone', 3000)
      return 'joined'
    })
  }

  /* ── 11 · Navigating the show ───────────────────────────────────── */
  await page.bringToFront()
  await scene(page, 's11-navigate', async () => {
    await cap(page, 'Press the arrow keys to move between slides', 2600)
    await page.keyboard.press('ArrowRight')
    await sleep(2000)
    await page.keyboard.press('ArrowRight')
    await sleep(1800)
    await page.mouse.move(1250, 400)
    await sleep(900)
    await cap(page, 'Or move your mouse to the edge of the screen for arrow buttons', 3000)
    await cap(page, 'Tip: for HTML slides, use these arrows, not the arrows inside your slides', 4000)
    return 'navigation shown'
  })

  /* ── 12 · Live question + results ───────────────────────────────── */
  const sess = async () => (await getDoc(fdoc(fdb, 'sessions', code))).data()
  await scene(page, 's12-live-question', async () => {
    const onQuestion = () => page.evaluate(() => !!document.querySelector('[title="Reset votes — let audience vote again"]'))
    let reached = await onQuestion()
    for (let i = 0; i < 10 && !reached; i++) {
      await page.keyboard.press('ArrowRight')
      await sleep(1600)
      reached = await onQuestion()
    }
    if (!reached) throw new Error('never reached the question slide')
    await sleep(1000)
    await cap(page, 'On a question slide, answers come in live', 1200)
    const mcq = (await sess()).slides.find(s => s.type === 'mcq')
    answerMcq(code, mcq).catch(e => console.log('   · mcq answers failed', e))
    try {
      await phone.evaluate(() => {
        const o = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes('Audience participation'))
        if (o) o.click()
      })
      await sleep(600)
      await phone.evaluate(() => {
        const s = [...document.querySelectorAll('button')].find(b => /submit/i.test(b.textContent || ''))
        if (s) s.click()
      })
    } catch {}
    await page.bringToFront()
    await sleep(3000)
    await cap(page, 'When you’re ready, show the results', 2400)
    const clicked = await click(page, byText('Show results'), { settle: 3200 })
    await sleep(1800)
    return clicked ? 'clicked Show results' : 'results auto-revealed'
  })

  /* ── 13 · Reset a question ──────────────────────────────────────── */
  await scene(page, 's13-reset', async () => {
    await cap(page, 'Want to ask again? Reset the votes so everyone can answer again', 3000)
    const hit = await click(page, bySel('[title="Reset votes — let audience vote again"]'), { settle: 1000 })
    if (!hit) throw new Error('reset control not present')
    await click(page, byExact('Reset'), { settle: 1600 })
    await cap(page, 'The timer starts again too', 2400)
    return 'reset shown'
  })

  /* ── 17 · The test on the big screen ────────────────────────────── */
  let testRun = null
  // Walk forward to the test (not filmed — the video cuts straight to it)
  await page.evaluate(() => { const c = document.getElementById('__cur'); if (c) { c.style.left = '-60px'; c.style.top = '-60px' } })
  for (let i = 0; i < 10 && !(await page.evaluate(() => /Start test/.test(document.body.innerText))); i++) {
    await page.keyboard.press('ArrowRight')
    await sleep(1500)
  }
  await sleep(1200)
  await scene(page, 's17-test-start', async () => {
    const rules = await until(page, hasText('Start test'), 4000, 'test rules')
    if (!rules) throw new Error('test rules not shown')
    await sleep(800)
    await cap(page, 'A self-paced test starts with the rules, while people get ready', 3600)
    await cap(page, 'Press Start test. The clock starts for everyone', 1800)
    await click(page, byText('Start test'), { settle: 1500 })
    const block = (await sess()).slides.find(s => s.type === 'testblock')
    testRun = takeTest(code, block).catch(e => console.log('   · test bots failed', e))
    const going = await until(page, hasText('Test in progress'), 8000, 'dashboard')
    if (!going) throw new Error('test did not start')
    await sleep(1500)
    return 'test started'
  })

  /* ── 18 · Taking the test (phone) ───────────────────────────────── */
  await phone.bringToFront()
  await scene(phone, 's18-test-phone', async () => {
    const ready = await until(phone, hasText('Question 1 of 6'), 10000, 'phone test')
    if (!ready) throw new Error('phone never showed the test')
    await cap(phone, 'Everyone gets all the questions on their own phone', 2400)
    await click(phone, testOption(0), { settle: 500, glide: 450 })
    await click(phone, byText('Next'), { settle: 700, glide: 450 })
    await click(phone, testOption(1), { settle: 500, glide: 450 })
    await click(phone, byText('Next'), { settle: 700, glide: 450 })
    await cap(phone, 'Some questions have more than one right answer', 1600)
    await click(phone, testOption(0), { settle: 400, glide: 450 })
    await click(phone, testOption(2), { settle: 500, glide: 450 })
    await click(phone, byText('Next'), { settle: 700, glide: 450 })
    await cap(phone, 'Tap any number to go back to a question', 1400)
    await click(phone, testBox(1), { settle: 1000, glide: 500 })
    await click(phone, testBox(4), { settle: 700, glide: 500 })
    await click(phone, testOption(2), { settle: 500, glide: 450 })
    await click(phone, byText('Next'), { settle: 700, glide: 450 })
    await click(phone, testOption(0), { settle: 500, glide: 450 })
    // Exact match: this question's answer "Clear next steps" contains "next" too
    await click(phone, byExact('Next'), { settle: 700, glide: 450 })
    await cap(phone, 'Some questions want a written answer', 1600)
    await typeInto(phone, bySel('textarea'), 'Everyone takes part, so nobody switches off.', 35)
    await sleep(2600)
    await click(phone, byText('Review & submit'), { settle: 900, glide: 450 })
    await cap(phone, 'Check your answers, then submit', 2000)
    await click(phone, byText('Submit test'), { settle: 1800, glide: 450 })
    const done = await until(phone, hasText('Submitted'), 8000, 'submitted')
    if (!done) throw new Error('phone did not submit')
    await cap(phone, 'Done! Your score shows when the test ends', 2600)
    return 'phone submitted'
  })

  /* ── 19 · Live dashboard ────────────────────────────────────────── */
  await page.bringToFront()
  await scene(page, 's19-test-dashboard', async () => {
    await cap(page, 'See live who is still answering and who has finished', 3600)
    await point(page, byExact('+1 min'))
    await cap(page, 'You can add time, pause, or end the test early', 3200)
    await until(page, hasText('10 of 10 completed'), 45000, 'everyone finished')
    await sleep(1200)
    await click(page, byExact('End test'), { settle: 900 })
    await click(page, lastExact('End test'), { settle: 2600 })
    const fin = await until(page, hasText('Test finished'), 8000, 'summary')
    if (!fin) throw new Error('test did not end')
    await sleep(1600)
    return (await bodyText(page)).match(/\d+ of \d+ submitted|Average score [\d.]+ \/ \d+/g)?.join(' · ')
  })
  await testRun

  /* ── 20 · Leaderboard ───────────────────────────────────────────── */
  await scene(page, 's20-test-leaderboard', async () => {
    await page.keyboard.press('ArrowRight')
    await sleep(1200)
    await cap(page, 'Then the leaderboard. Most right answers wins. If it’s a tie, the faster finish wins', 15500)
    return (await bodyText(page)).match(/[A-Z][a-z]+ [A-Z][a-z]+ \d\/5 · \d+ s/g)?.slice(0, 3).join(' | ')
  })

  /* ── 21 · Their place, on the phone ─────────────────────────────── */
  await phone.bringToFront()
  await scene(phone, 's21-test-phone-place', async () => {
    await sleep(800)
    await cap(phone, 'Everyone sees their place and the right answers', 2600)
    await phone.evaluate(() => window.scrollBy({ top: 420, behavior: 'smooth' }))
    await sleep(2200)
    return (await bodyText(phone)).match(/You placed \d+\w+ of \d+|\d+(?:st|nd|rd|th) place!|You won!|\d \/ 5/g)?.join(' · ')
  })

  /* ── 22 · Answer review ─────────────────────────────────────────── */
  await page.bringToFront()
  await scene(page, 's22-test-review', async () => {
    await page.keyboard.press('ArrowRight')
    await sleep(1600)
    await cap(page, 'Then go through the answers together, one question at a time', 3400)
    await page.keyboard.press('ArrowRight')
    await sleep(3000)
    return (await bodyText(page)).match(/ANSWER REVIEW · \d OF \d|\d+% got it right/gi)?.join(' · ')
  })

  // Forward to the written-answer question (not filmed)
  for (let i = 0; i < 6 && !(await page.evaluate(() => /Show answer guide/.test(document.body.innerText))); i++) {
    await page.keyboard.press('ArrowRight')
    await sleep(1400)
  }
  await sleep(800)

  /* ── 22b · The answer guide ─────────────────────────────────────── */
  await scene(page, 's22b-answer-guide', async () => {
    const there = await until(page, hasText('Show answer guide'), 4000, 'written-answer review')
    if (!there) throw new Error('written-answer review not reached')
    await cap(page, 'For written answers, everyone’s answers fill the screen first', 2800)
    await click(page, byText('Show answer guide'), { settle: 1400 })
    await cap(page, 'Show your marking guide when you’re ready, or skip it', 3200)
    return 'answer guide shown'
  })

  // On to the survey (not filmed)
  await page.evaluate(() => { const c = document.getElementById('__cur'); if (c) { c.style.left = '-60px'; c.style.top = '-60px' } })
  for (let i = 0; i < 6 && !(await page.evaluate(() => /Session feedback/.test(document.body.innerText))); i++) {
    await page.keyboard.press('ArrowRight')
    await sleep(1500)
  }
  await sleep(1200)

  /* ── 22e · The survey on the big screen ─────────────────────────── */
  let surveyRun = null
  await scene(page, 's22e-survey-screen', async () => {
    const shown = await until(page, hasText('Session feedback'), 5000, 'survey screen')
    if (!shown) throw new Error('survey screen not reached')
    await cap(page, 'The survey opens on everyone’s phone. Anyone else can scan the code', 3200)
    const block = (await sess()).slides.find(s => s.type === 'testblock' && s.kind === 'survey')
    surveyRun = answerSurvey(code, block).catch(e => console.log('   · survey bots failed', e))
    await sleep(1500)
    await cap(page, 'Watch the responses come in', 4200)
    return (await bodyText(page)).match(/\d+ responses?/i)?.[0]
  })

  /* ── 22f · Answering on the phone ───────────────────────────────── */
  await phone.bringToFront()
  await scene(phone, 's22f-survey-phone', async () => {
    const ready = await until(phone, hasText('Session feedback'), 10000, 'phone survey')
    if (!ready) throw new Error('phone never showed the survey')
    await cap(phone, 'Everyone gets all the questions at once', 2200)
    await click(phone, inSurveyCard(1, `[...c.querySelectorAll('button')][0]`), { settle: 500, glide: 450 })
    await cap(phone, 'Some let you tick more than one', 1500)
    await click(phone, inSurveyCard(2, `[...c.querySelectorAll('button')][0]`), { settle: 400, glide: 450 })
    await click(phone, inSurveyCard(2, `[...c.querySelectorAll('button')][2]`), { settle: 500, glide: 450 })
    await click(phone, inSurveyCard(3, `[...c.querySelectorAll('button')].filter(b => (b.textContent||'').trim() === '5')[0]`), { settle: 400, glide: 450 })
    await click(phone, inSurveyCard(3, `[...c.querySelectorAll('button')].filter(b => (b.textContent||'').trim() === '4')[1]`), { settle: 500, glide: 450 })
    await typeInto(phone, inSurveyCard(4, `c.querySelector('textarea')`), 'More real examples, please', 40)
    await click(phone, byExact('Submit'), { settle: 1800, glide: 500 })
    const done = await until(phone, hasText('Thank you'), 10000, 'thank you')
    if (!done) throw new Error('survey not sent')
    await cap(phone, 'Sent. That’s it', 2400)
    return 'survey sent'
  })
  await surveyRun

  /* ── 22g · Survey results on the big screen ─────────────────────── */
  await page.bringToFront()
  await scene(page, 's22g-survey-results', async () => {
    await sleep(800)
    await cap(page, 'Show results steps through each question', 2000)
    await click(page, byText('Show results'), { settle: 2600 })
    await page.keyboard.press('ArrowRight')
    await sleep(2800)
    await page.keyboard.press('ArrowRight')
    await sleep(2400)
    await cap(page, 'The survey link keeps working after the show, until you close it', 3600)
    return (await bodyText(page)).match(/\d+ responses?|\d+ answered/i)?.[0]
  })

  /* ── 22h · End the session, and name it ─────────────────────────── */
  await scene(page, 's22h-end-session', async () => {
    await cap(page, 'Finished? Press Esc, then End session', 2400)
    await page.keyboard.press('Escape')
    await sleep(900)
    const box = await until(page, `!!document.getElementById('end-label')`, 5000, 'end dialog')
    if (!box) throw new Error('end session window did not open')
    await typeInto(page, bySel('#end-label'), 'Sydney team', 60)
    await cap(page, 'Type who it was with, so you can find this session later', 3000)
    await click(page, lastExact('End session'), { settle: 1200 })
    const back = await until(page, `window.location.pathname.startsWith('/create')`, 20000, 'back in editor')
    if (!back) throw new Error('did not get back to the editor')
    await sleep(3500)
    return 'ended as Sydney team'
  })

  /* ── 23 · Results ───────────────────────────────────────────────── */
  await scene(page, 's23-results', async () => {
    // The deck is still saving just after the show; Results is ready once it's done
    await until(page, `(() => { const b = document.querySelector('button[title="View saved poll results"]'); return b && !b.disabled })()`, 15000, 'Results button ready')
    await cap(page, 'Step 3: afterwards, open Results', 2000)
    await click(page, bySel('button[title="View saved poll results"]'), { settle: 2600 })
    const ok = await until(page, `/in this session/i.test(document.body.innerText)`, 12000, 'results page')
    if (!ok) throw new Error('results page did not load')
    await point(page, `() => [...document.querySelectorAll('button')].find(e => /Sydney team/.test(e.textContent || ''))`)
    await cap(page, 'Each session shows its name, so groups are easy to tell apart', 3000)
    await click(page, `() => [...document.querySelectorAll('nav button')].find(e => (e.textContent || '').startsWith('Self-paced test'))`, { settle: 2000 })
    await cap(page, 'Tabs switch between the live questions, the test and the survey', 3000)
    await click(page, `() => [...document.querySelectorAll('nav button')].find(e => (e.textContent || '').startsWith('Session feedback'))`, { settle: 2200 })
    await page.evaluate(() => window.scrollBy({ top: 360, behavior: 'smooth' }))
    await sleep(1600)
    await cap(page, 'Survey answers come as charts, ready to print, or as Word, Excel or an AI summary', 4200)
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    await sleep(900)
    await point(page, byText('Download Excel'))
    await cap(page, 'Download everything as Excel or PDF', 2600)
    return 'results: tabs + survey shown'
  })

  /* ── 23b · Share ────────────────────────────────────────────────── */
  await page.goBack({ waitUntil: 'domcontentloaded' })
  await sleep(2600)
  await scene(page, 's23b-share', async () => {
    await cap(page, 'Share gives you a link, so colleagues can use your deck', 2600)
    await click(page, byText('Share'), { settle: 1800 })
    return 'share shown'
  })

  /* ── 24 · Outro ─────────────────────────────────────────────────── */
  await scene(page, 's24-outro', async () => {
    await page.evaluate(() => {
      const o = document.createElement('div')
      o.style.cssText = `position:fixed;inset:0;z-index:2147483645;display:flex;flex-direction:column;
        align-items:center;justify-content:center;gap:18px;background:#0d1033;
        font-family:Poppins,system-ui,sans-serif;opacity:0;transition:opacity .6s ease;`
      o.innerHTML = `
        <div style="font-size:46px;font-weight:700;color:#fff;">alaya <span style="color:#ff0065">pulse</span></div>
        <div style="font-size:20px;color:rgba(255,255,255,.75);font-weight:300;">Free · No audience limits · Made for Alaya</div>
        <div style="margin-top:16px;padding:13px 30px;border-radius:999px;border:1.5px solid rgba(255,0,101,.55);
             color:#fff;font-size:19px;font-weight:600;">Full written guide → alaya-pulse.web.app/guide</div>`
      document.body.appendChild(o)
      requestAnimationFrame(() => { o.style.opacity = '1' })
    })
    await sleep(6000)
    return 'outro'
  })

  console.log('\n──────── SUMMARY ────────')
  const bad = results.filter(r => !r.ok)
  results.forEach(r => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.scene}  ${r.note}`))
  console.log(bad.length ? `\n${bad.length} SCENE(S) FAILED` : '\nALL SCENES PASSED')
} finally {
  await browser.close()
  try { rmSync(PROFILE, { recursive: true, force: true }) } catch {}
  process.exit(0)
}
