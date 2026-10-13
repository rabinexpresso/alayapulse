/* The narrator: reads each caption aloud with Google Text-to-Speech.
   Every spoken line is saved in video/voice/ under a name made from its words
   and the voice, so a build only asks Google for new or changed captions.
   Signs in with this PC's Firebase CLI login (the one used to deploy); if
   that has run out:  npx firebase-tools login --reauth */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import os from 'node:os'

export const VOICE = process.env.VOICE || 'en-AU-Chirp3-HD-Charon'
const PROJECT = 'alaya-pulse'
const DIR = resolve('video/voice')
const FF = resolve('node_modules/ffmpeg-static/ffmpeg.exe')
const SR = 24000
const STYLE = 3               // bump to remake every line

/* Captions are written to be read; a few words need saying differently.
   "deck" gets a more open vowel: in an Australian accent it otherwise sounds like "dick". */
const SAY = [[/\bEsc\b/g, 'Escape']]
const PRONOUNCE = [{ phrase: 'deck', phoneticEncoding: 'PHONETIC_ENCODING_X_SAMPA', pronunciation: 'd{k' }]
export const spoken = text => SAY.reduce((t, [from, to]) => t.replace(from, to), text)

export const voiceFile = (text, voice = VOICE) =>
  join(DIR, createHash('sha1').update(`${STYLE}|${voice}|${spoken(text)}`).digest('hex').slice(0, 12) + '.mp3')

/* The Firebase CLI's own sign-in details, read from its installed copy */
function cliClient() {
  const roots = [join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx'), join(os.homedir(), '.npm', '_npx')]
  for (const root of roots.filter(existsSync)) {
    for (const d of readdirSync(root)) {
      const f = join(root, d, 'node_modules', 'firebase-tools', 'lib', 'api.js')
      if (!existsSync(f)) continue
      const s = readFileSync(f, 'utf8')
      const id = s.match(/FIREBASE_CLIENT_ID", "([^"]+)"/)?.[1]
      const secret = s.match(/FIREBASE_CLIENT_SECRET", "([^"]+)"/)?.[1]
      if (id && secret) return { id, secret }
    }
  }
  throw new Error('Firebase CLI not found: run  npx firebase-tools login  once')
}

async function token() {
  const cfg = JSON.parse(readFileSync(join(os.homedir(), '.config', 'configstore', 'firebase-tools.json'), 'utf8'))
  const { id, secret } = cliClient()
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cfg.tokens.refresh_token, client_id: id, client_secret: secret }),
  })
  const j = await r.json()
  if (!j.access_token) throw new Error('Google sign-in failed: run  npx firebase-tools login --reauth')
  return j.access_token
}

/* One request to Google; returns 16-bit mono samples at 24 kHz */
async function synth(tok, text, voice) {
  const input = { text }
  const pron = PRONOUNCE.filter(p => new RegExp(`\\b${p.phrase}\\b`, 'i').test(text))
  if (pron.length) input.customPronunciations = { pronunciations: pron }
  const r = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'x-goog-user-project': PROJECT, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, voice: { languageCode: voice.slice(0, 5), name: voice }, audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: SR } }),
  })
  const j = await r.json()
  if (!j.audioContent) throw new Error(`Text-to-Speech failed for "${text}": ${JSON.stringify(j.error || j).slice(0, 300)}`)
  const wav = Buffer.from(j.audioContent, 'base64')
  const at = wav.indexOf('data') + 8
  return new Int16Array(wav.buffer.slice(wav.byteOffset + at, wav.byteOffset + at + ((wav.length - at) & ~1)))
}

/* Pitch of the voice every 10 ms (YIN); 0 where nobody's speaking */
function pitch(pcm) {
  const win = 1024, hop = 240, minL = Math.floor(SR / 400), maxL = Math.floor(SR / 60)
  let peak = 0
  for (let s = 0; s + win < pcm.length; s += hop) { let e = 0; for (let i = 0; i < win; i++) e += pcm[s + i] ** 2; peak = Math.max(peak, e) }
  const out = [], d = new Float64Array(maxL + 1)
  for (let s = 0; s + win + maxL < pcm.length; s += hop) {
    let e = 0; for (let i = 0; i < win; i++) e += pcm[s + i] ** 2
    if (e < peak * 0.02) { out.push(0); continue }
    let sum = 0, f0 = 0
    for (let L = 1; L <= maxL; L++) {
      let v = 0; for (let i = 0; i < win; i++) { const x = pcm[s + i] - pcm[s + i + L]; v += x * x }
      sum += v; d[L] = v * L / (sum || 1)
    }
    let low = minL
    for (let L = minL; L < maxL; L++) {
      if (d[L] < d[low]) low = L
      if (d[L] < 0.2) { while (L + 1 < maxL && d[L + 1] < d[L]) L++; f0 = SR / L; break }
    }
    out.push(f0 || (d[low] < 0.3 ? SR / low : 0))
  }
  return out
}
/* How far the voice climbs at the end: the last sounds against the ones before */
export function rise(pcm) {
  const v = pitch(pcm).filter(Boolean)
  if (v.length < 10) return 1
  const tail = Math.min(12, Math.max(4, Math.round(v.length / 5)))
  const med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
  return med(v.slice(-tail)) / med(v.slice(-tail - 50, -tail))
}

/* Google pads each reading with silence; keep just a breath of it */
function trim(pcm, before = 0.03, after = 0.08) {
  let peak = 0
  for (const x of pcm) peak = Math.max(peak, Math.abs(x))
  const loud = peak * 0.03
  let a = 0, b = pcm.length - 1
  while (a < b && Math.abs(pcm[a]) < loud) a++
  while (b > a && Math.abs(pcm[b]) < loud) b--
  return pcm.slice(Math.max(0, a - SR * before), Math.min(pcm.length, b + SR * after))
}

const ff = (args, input) => spawnSync(FF, ['-v', 'error', ...args], { input, maxBuffer: 1 << 28 })
const raw = ['-f', 's16le', '-ar', String(SR), '-ac', '1']
const toPcm = buf => new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + (buf.length & ~1)))

/* Lift the last word smoothly by up to 30%, keeping the voice's character */
function glideUp(pcm) {
  const t0 = Math.max(0, pcm.length / SR - 0.5)
  const steps = Array.from({ length: 9 }, (_, i) => `${(t0 + i * 0.05).toFixed(2)} rubberband pitch ${(1 + 0.033 * (i + 1)).toFixed(3)}`).join(';')
  return toPcm(ff([...raw, '-i', '-', '-af', `asendcmd=c='${steps}',rubberband=pitch=1:formant=preserved:pitchq=quality`, ...raw, '-'], Buffer.from(pcm.buffer)).stdout)
}

/* A question should go up at the end. The voice doesn't always do that, so
   take a few readings, keep the one that climbs most, and lift it if needed. */
async function question(tok, q, voice) {
  const tries = [q, q.replace(/\?$/, '??'), q.replace(/\?$/, '...?'), q, q.replace(/\?$/, '??'), q.replace(/\?$/, '...?')]
  let best = null
  for (const [n, t] of tries.entries()) {
    const pcm = trim(await synth(tok, t, voice)), r = rise(pcm)
    if (!best || r > best.r) best = { pcm, r, n }
    if (r >= 1.3) break
  }
  const lift = best.r < 1.15
  console.log(`   question "${q}": climbs ${Math.round((best.r - 1) * 100)}% (reading ${best.n + 1})${lift ? ', lifted at the end' : ''}`)
  return lift ? glideUp(best.pcm) : best.pcm
}

async function line(tok, text, voice) {
  const words = spoken(text)
  if (!words.includes('?')) return trim(await synth(tok, words, voice))
  // read sentence by sentence so each question gets its own rise
  const parts = words.match(/[^.?!]+[.?!]*/g).map(s => s.trim()).filter(Boolean)
  const gap = new Int16Array(Math.round(SR * 0.3))
  const pieces = []
  for (const p of parts) pieces.push(p.endsWith('?') ? await question(tok, p, voice) : trim(await synth(tok, p, voice)), gap)
  pieces.pop()
  const all = new Int16Array(pieces.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of pieces) { all.set(p, at); at += p.length }
  return all
}

/* Makes sure every line has its voice file; returns how many were new */
export async function makeVoice(texts, voice = VOICE) {
  mkdirSync(DIR, { recursive: true })
  const todo = [...new Set(texts)].filter(t => !existsSync(voiceFile(t, voice)))
  if (!todo.length) return 0
  const tok = await token()
  for (const t of todo) {
    const pcm = await line(tok, t, voice)
    const r = ff([...raw, '-i', '-', '-b:a', '64k', '-y', voiceFile(t, voice)], Buffer.from(pcm.buffer))
    if (r.status) throw new Error('could not save the voice for ' + t + '\n' + r.stderr)
  }
  return todo.length
}
