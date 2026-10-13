/* Builds the User Guide walkthrough video from the scene clips.
   Run from the project root:  node video/build-video.mjs

   1 · every clip in video/clips (in name order) is resized to 1280x720,
       phone clips letterboxed on brand navy
   2 · the clips are joined with short crossfades
   3 · the background music (video/assets/music.m4a) is looped smoothly to
       the video's length and laid underneath
   4 · the narrator reads each caption as it appears (voice.mjs; caption
       times are in video/clips/captions.json), and the music dips under it
       — NARRATOR=off builds without the voice
   Writes public/alaya-pulse-tutorial.mp4 and prints where every scene
   starts — those times are the "Watch this part" links in src/pages/Guide.tsx. */
import { spawnSync } from 'node:child_process'
import { readdirSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import os from 'node:os'
import { makeVoice, voiceFile, VOICE } from './voice.mjs'

const FF = resolve('node_modules/ffmpeg-static/ffmpeg.exe')
const CLIPS = resolve('video/clips')
const MUSIC = resolve('video/assets/music.m4a')
const OUT = resolve(process.env.OUT || 'public/alaya-pulse-tutorial.mp4')   // OUT=… to write somewhere else
const WORK = join(os.tmpdir(), 'alaya-video-build')
const T = 0.5            // crossfade seconds
const LEAD = 0.25        // the voice starts just after its caption appears
const SR = 48000         // narration sample rate
const BG = '0x0d1033'    // brand dark for letterboxing the phone scenes

try { rmSync(WORK, { recursive: true, force: true }) } catch {}
mkdirSync(WORK, { recursive: true })
const W = f => join(WORK, f)

function run(args, label) {
  const r = spawnSync(FF, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`ffmpeg failed (${label})\n` + String(r.stderr || '').trim().split('\n').slice(-8).join('\n'))
  return String(r.stderr || '')
}
function duration(file) {
  const m = [...run(['-i', file, '-f', 'null', '-'], 'duration').matchAll(/time=(\d+):(\d+):([\d.]+)/g)].pop()
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0
}
const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

const scenes = readdirSync(CLIPS).filter(f => /^s\d+.*\.webm$/.test(f)).sort()
console.log('scenes:', scenes.length)

/* 1 · Normalise */
const normed = scenes.map(f => {
  const out = W(f.replace('.webm', '.mp4'))
  run(['-y', '-i', join(CLIPS, f),
    '-vf', `scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=${BG},fps=30,format=yuv420p`,
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', out], f)
  return { name: f, file: out, d: duration(out) }
})

/* 2 · Crossfade chain, noting where each scene starts */
let filter = '', running = normed[0].d, last = '0:v'
const starts = [{ name: normed[0].name, at: 0 }]
for (let i = 1; i < normed.length; i++) {
  const offset = running - T
  starts.push({ name: normed[i].name, at: offset })
  const label = i === normed.length - 1 ? 'vout' : `v${i}`
  filter += `[${last}][${i}:v]xfade=transition=fade:duration=${T}:offset=${offset.toFixed(3)}[${label}];`
  last = label
  running += normed[i].d - T
}
filter += `[vout]fade=t=in:st=0:d=0.6,fade=t=out:st=${(running - 0.8).toFixed(2)}:d=0.8[final]`
console.log(`encoding ${clock(running)} of video…`)
run(['-y', ...normed.flatMap(n => ['-i', n.file]), '-filter_complex', filter, '-map', '[final]',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', W('silent.mp4')], 'crossfade')
const V = duration(W('silent.mp4'))

/* 3 · Music: the track minus its own fades, looped with 4 s crossfades until
       it's long enough, then trimmed, faded in/out and mixed in */
const M = duration(MUSIC)
run(['-y', '-i', MUSIC, '-af', `atrim=3:${(M - 9).toFixed(3)},asetpts=PTS-STARTPTS`, '-c:a', 'pcm_s16le', W('body.wav')], 'music body')
let loop = 'body.wav', n = 1
while (duration(W(loop)) < V + 2) {
  const next = `loop${++n}.wav`
  run(['-y', '-i', W(loop), '-i', W('body.wav'), '-filter_complex', '[0:a][1:a]acrossfade=d=4:c1=tri:c2=tri[a]',
    '-map', '[a]', '-c:a', 'pcm_s16le', W(next)], 'music loop')
  loop = next
}
const music = `[1:a]atrim=0:${V.toFixed(3)},aresample=${SR},afade=t=in:st=0:d=2,afade=t=out:st=${(V - 8).toFixed(3)}:d=8`

/* 4 · Narrator: every caption's line goes on one voice track at the moment
       the caption appears. A line that would run into the next caption is
       sped up a little (never more than 15%). */
let mix = `${music}[a]`, voiceIn = []
if (process.env.NARRATOR !== 'off') {
  const CAPS = JSON.parse(readFileSync(join(CLIPS, 'captions.json'), 'utf8'))
  const lines = starts.flatMap(s => (CAPS[s.name.replace('.webm', '')]?.captions || []).map(c => ({ text: c.text, at: s.at + c.at + LEAD })))
  const made = await makeVoice(lines.map(l => l.text))
  console.log(`narrator ${VOICE}: ${lines.length} lines (${made} new from Google)`)
  const pcm = (file, af = 'anull') => spawnSync(FF, ['-v', 'error', '-i', file, '-af', af, '-f', 's16le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 28 }).stdout
  const track = Buffer.alloc(Math.ceil(V * SR) * 2)
  lines.forEach((l, i) => {
    const room = Math.min(lines[i + 1]?.at ?? V, V - 1) - 0.15 - l.at
    let a = pcm(voiceFile(l.text))
    const len = a.length / 2 / SR
    if (len > room) {
      const tempo = Math.min(1.15, len / room)
      a = pcm(voiceFile(l.text), `atempo=${tempo.toFixed(3)}`)
      console.log(`  sped up ${Math.round((tempo - 1) * 100)}%: "${l.text}"${len / tempo > room + 0.05 ? ' — still runs on by ' + (len / tempo - room).toFixed(1) + ' s' : ''}`)
    }
    const at = Math.round(l.at * SR) * 2
    a.copy(track, at, 0, Math.max(0, Math.min(a.length, track.length - at)))
  })
  writeFileSync(W('voice.raw'), track)
  voiceIn = ['-f', 's16le', '-ar', String(SR), '-ac', '1', '-i', W('voice.raw')]
  // music well under the voice, dipping further while it speaks; a limiter catches peaks
  mix = `${music},volume=0.35[m];[2:a]volume=1.6,aformat=channel_layouts=stereo,asplit=2[key][voice];` +
    `[m][key]sidechaincompress=threshold=0.02:ratio=6:attack=40:release=600[bed];` +
    `[bed][voice]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95[a]`
}
run(['-y', '-i', W('silent.mp4'), '-i', W(loop), ...voiceIn, '-filter_complex', mix,
  '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', OUT], 'mix')

console.log(`\nwritten ${OUT} — ${clock(duration(OUT))}\n\nScene start times (for the Guide's "Watch this part" links):`)
starts.forEach(s => console.log(`  ${clock(s.at).padStart(5)}  (${Math.floor(s.at)} s)  ${s.name}`))
try { rmSync(WORK, { recursive: true, force: true }) } catch {}
