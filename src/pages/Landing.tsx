import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { BarChart2, QrCode, FileImage } from 'lucide-react'
import { AlayaMark } from '@/components/AlayaMark'

/* ─────────────────────────────────────────────────────────────────────────
   Landing page
   ───────────────────────────────────────────────────────────────────────── */

export default function Landing() {
  return (
    <div className="bg-midnight-sky-900 text-white">
      {/* Nav lives outside overflow-hidden so sticky works correctly */}
      <Nav />
      <main className="relative overflow-hidden">
        <GradientOrbs />

        {/* Subtle grid texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />

        <Hero />
        <HowItWorks />
        <Features />
        <FooterStrip />
      </main>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Nav
   ───────────────────────────────────────────────────────────────────────── */

function Nav() {
  return (
    <header className="sticky top-0 z-20 overflow-hidden border-b border-white/5 bg-midnight-sky-900/80 backdrop-blur-md">
      {/* Shimmer */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1/2"
        style={{ background: 'linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.13) 50%, transparent 100%)' }}
        animate={{ x: ['-100%', '200%'] }}
        transition={{ duration: 1.8, ease: [0.4, 0, 0.2, 1], repeat: Infinity, repeatDelay: 7, delay: 2 }}
      />
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 sm:px-10">
        <Link to="/">
          <AlayaMark className="text-white" />
        </Link>
        <nav className="hidden items-center gap-8 text-sm font-light text-white/70 md:flex">
          <a href="#how" className="transition hover:text-white">How it works</a>
          <a href="#features" className="transition hover:text-white">Features</a>
        </nav>
        <div className="flex items-center gap-3">
          <Link
            to="/join"
            className="hidden rounded-full bg-sky-blue px-4 py-2 text-sm font-semibold text-white shadow-[0_0_14px_-4px] shadow-sky-blue/50 transition-all hover:scale-[1.02] hover:shadow-[0_0_20px_-2px] hover:shadow-sky-blue/70 sm:inline-flex"
          >
            Join Session
          </Link>
          <Link
            to="/decks"
            className="rounded-full bg-fresh-green px-4 py-2 text-sm font-semibold text-white shadow-[0_0_14px_-4px] shadow-fresh-green/50 transition-all hover:scale-[1.02] hover:shadow-[0_0_20px_-2px] hover:shadow-fresh-green/70"
          >
            Create Session
          </Link>
        </div>
      </div>
    </header>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Hero
   ───────────────────────────────────────────────────────────────────────── */

/* ── Shader background — animated plasma lines in Alaya brand colours ──────
   Opaque dark canvas so lines have full contrast and glow like neon. */
function ShaderBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl')
    if (!gl) return

    const vsSource = `
      attribute vec4 aVertexPosition;
      void main() { gl_Position = aVertexPosition; }
    `

    const fsSource = `
      precision highp float;
      uniform vec2 iResolution;
      uniform float iTime;

      const float overallSpeed    = 0.2;
      const float gridSmoothWidth = 0.015;
      const float scale           = 5.0;
      const float minLineWidth    = 0.01;
      const float maxLineWidth    = 0.15;
      const float lineSpeed       = 1.0  * overallSpeed;
      const float lineAmplitude   = 1.0;
      const float lineFrequency   = 0.2;
      const float warpSpeed       = 0.2  * overallSpeed;
      const float warpFrequency   = 0.5;
      const float warpAmplitude   = 1.0;
      const float offsetFrequency = 0.5;
      const float offsetSpeed     = 1.33 * overallSpeed;
      const float minOffsetSpread = 0.6;
      const float maxOffsetSpread = 2.0;
      const int   linesPerGroup   = 16;

      #define drawCircle(pos,radius,coord) smoothstep(radius+gridSmoothWidth,radius,length(coord-(pos)))
      #define drawSmoothLine(pos,hw,t)     smoothstep(hw,0.0,abs(pos-(t)))
      #define drawCrispLine(pos,hw,t)      smoothstep(hw+gridSmoothWidth,hw,abs(pos-(t)))

      float random(float t) {
        return (cos(t) + cos(t*1.3+1.3) + cos(t*1.4+1.4)) / 3.0;
      }
      float plasmaY(float x, float hFade, float offset) {
        return random(x*lineFrequency + iTime*lineSpeed) * hFade * lineAmplitude + offset;
      }

      void main() {
        vec2 uv    = gl_FragCoord.xy / iResolution.xy;
        vec2 space = (gl_FragCoord.xy - iResolution.xy*0.5) / iResolution.x * 2.0 * scale;

        float hFade = 1.0 - (cos(uv.x*6.28)*0.5 + 0.5);
        float vFade = 1.0 - (cos(uv.y*6.28)*0.5 + 0.5);

        space.y += random(space.x*warpFrequency + iTime*warpSpeed)       * warpAmplitude * (0.5+hFade);
        space.x += random(space.y*warpFrequency + iTime*warpSpeed + 2.0) * warpAmplitude * hFade;

        // All lines share one colour — cycles smoothly hot-pink → sky-blue → fresh-green
        vec3 hotPink    = vec3(1.0,   0.0,   0.396);
        vec3 skyBlue    = vec3(0.0,   0.690, 1.0);
        vec3 freshGreen = vec3(0.259, 0.859, 0.400);
        float ct = iTime * 0.22;          // full cycle ≈ 28 s
        float w0 = max(0.0, cos(ct));
        float w1 = max(0.0, cos(ct - 2.094)); // 120° offset
        float w2 = max(0.0, cos(ct - 4.189)); // 240° offset
        vec3 lineColor = (hotPink*w0 + skyBlue*w1 + freshGreen*w2) / (w0+w1+w2+0.001);

        vec3 col = vec3(0.0);

        for (int l = 0; l < linesPerGroup; l++) {
          float fl   = float(l);
          float oTime = iTime * offsetSpeed;
          float oPos  = fl + space.x * offsetFrequency;
          float rand  = random(oPos + oTime) * 0.5 + 0.5;
          float hw    = mix(minLineWidth, maxLineWidth, rand*hFade) * 0.5;
          float offset= random(oPos + oTime*(1.0 + fl/float(linesPerGroup)))
                        * mix(minOffsetSpread, maxOffsetSpread, hFade);
          float lpos  = plasmaY(space.x, hFade, offset);
          float line  = drawSmoothLine(lpos, hw, space.y)*0.5
                      + drawCrispLine(lpos, hw*0.15, space.y);

          float cx = mod(fl + iTime*lineSpeed, 25.0) - 12.0;
          line += drawCircle(vec2(cx, plasmaY(cx, hFade, offset)), 0.01, space) * 4.0;

          col += line * lineColor * rand;
        }

        // Near-black base fading toward midnight-sky-900 (#000079) at the bottom
        // so the hero canvas blends seamlessly into the page below
        vec3 bgBase = mix(vec3(0.02, 0.01, 0.08), vec3(0.04, 0.02, 0.12), uv.x);
        vec3 midnight = vec3(0.0, 0.0, 0.475); // #000079
        float bottomBlend = pow(max(0.0, 1.0 - uv.y * 2.0), 2.0); // smooth in bottom half
        vec3 bg = mix(bgBase, midnight, bottomBlend);

        // Lines at full brightness — hFade naturally keeps them off the side edges
        vec3 lines = clamp(col * hFade, 0.0, 2.0);

        gl_FragColor = vec4(clamp(bg + lines, 0.0, 1.0), 1.0);
      }
    `

    const compileShader = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn('Shader error:', gl.getShaderInfoLog(s)); gl.deleteShader(s); return null
      }
      return s
    }

    const vs = compileShader(gl.VERTEX_SHADER,   vsSource)
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSource)
    if (!vs || !fs) return

    const prog = gl.createProgram()!
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return

    const posLoc = gl.getAttribLocation(prog,  'aVertexPosition')
    const resLoc = gl.getUniformLocation(prog, 'iResolution')
    const timLoc = gl.getUniformLocation(prog, 'iTime')

    const buf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW)

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width  = Math.round(canvas.offsetWidth  * dpr)
      canvas.height = Math.round(canvas.offsetHeight * dpr)
      gl.viewport(0, 0, canvas.width, canvas.height)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()

    let rafId = 0
    const t0 = Date.now()
    const render = () => {
      gl.clearColor(0.02, 0.01, 0.08, 1.0); gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(prog)
      gl.uniform2f(resLoc, canvas.width, canvas.height)
      gl.uniform1f(timLoc, (Date.now() - t0) / 1000)
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)
      gl.enableVertexAttribArray(posLoc)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      rafId = requestAnimationFrame(render)
    }
    rafId = requestAnimationFrame(render)
    return () => { cancelAnimationFrame(rafId); ro.disconnect() }
  }, [])

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full pointer-events-none" />
}

function Hero() {
  return (
    <section className="relative z-10 flex min-h-[calc(100vh-72px)] flex-col items-center justify-center">
      <ShaderBg />

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center px-6 pb-20 pt-12 text-center sm:px-10">
        <AnimatedHeadline />

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.65, ease: [0.16, 1, 0.3, 1] }}
          className="mt-8 max-w-2xl text-balance text-lg font-light text-white/70 sm:text-xl"
        >
          Every person in the room has a question or an answer. Now you can hear all of them — not just the loudest ones. Free, unlimited, and live for every Alaya team.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="mt-12 flex flex-col items-center gap-4 sm:flex-row sm:gap-5"
        >
          <PrimaryCta to="/decks">
            Start Live Poll
          </PrimaryCta>
          <a
            href="#how"
            className="group inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-7 py-4 text-base font-medium text-white backdrop-blur-md transition-all hover:scale-[1.02] hover:border-white/40 hover:bg-white/10"
          >
            See how it works
          </a>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.7, delay: 1.0 }}
          className="mt-7 text-xs font-light tracking-wide text-white/60"
        >
          No signup required · Start your first poll in 30 seconds
        </motion.p>

        <HeroMockup />
      </div>

      {/* Gradient fade — shader bottom already blends to #000079; this overlay seals the join */}
      <div aria-hidden className="pointer-events-none absolute bottom-0 inset-x-0 h-48 z-10 bg-gradient-to-b from-transparent to-[#000079]" />

      {/* Bridge — anchored to hero bottom, pushed below it via translate-y-full.
          Fades from #000079 to transparent so orbs reveal gradually below the hero. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-48 translate-y-full bg-gradient-to-b from-[#000079] to-transparent" />

      {/* Scroll hint — above the fade */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4, duration: 0.8 }}
        className="absolute bottom-10 left-1/2 z-20 -translate-x-1/2"
      >
        <motion.div
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          className="flex h-8 w-5 items-start justify-center rounded-full border border-white/20 p-1"
        >
          <div className="h-1.5 w-0.5 rounded-full bg-white/40" />
        </motion.div>
      </motion.div>
    </section>
  )
}

const ACCENT_WORDS = ['move', 'energise', 'spark', 'inspire', 'unite']

/* ── Hero mockup — fake MCQ results screen ─────────────────────────────── */
const MCQ_OPTIONS = [
  { label: 'Visionary',     pct: 42, color: 'bg-hot-pink'    },
  { label: 'Collaborative', pct: 28, color: 'bg-sky-blue'    },
  { label: 'Analytical',    pct: 18, color: 'bg-fresh-green' },
  { label: 'Adaptive',      pct: 12, color: 'bg-golden-sun'  },
]

function HeroMockup() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 36 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, delay: 1.2, ease: [0.16, 1, 0.3, 1] }}
      className="relative mx-auto mt-16 w-full max-w-xl"
      style={{ perspective: '1200px' }}
    >
      {/* Glow beneath the card */}
      <div aria-hidden className="pointer-events-none absolute inset-x-12 -bottom-6 h-24 rounded-full bg-hot-pink/20 blur-3xl" />

      {/* Tilted card */}
      <div
        className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#06060f]/85 p-6 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.6)] backdrop-blur-xl"
        style={{ transform: 'rotateX(7deg)', transformOrigin: 'bottom center' }}
      >
        {/* Top bar */}
        <div className="mb-5 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-white/40">
            <span className="size-1.5 animate-pulse rounded-full bg-fresh-green" />
            Live · 47 responses
          </span>
          <span className="text-[11px] text-white/20">Multiple Choice</span>
        </div>

        {/* Question */}
        <p className="mb-5 text-sm font-semibold leading-snug text-white/85">
          Which leadership style describes your team right now?
        </p>

        {/* Animated bars */}
        <div className="flex flex-col gap-3.5">
          {MCQ_OPTIONS.map((opt, i) => (
            <div key={opt.label}>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="text-white/60">{opt.label}</span>
                <span className="tabular-nums text-white/40">{opt.pct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${opt.pct}%` }}
                  transition={{ duration: 1.4, delay: 1.6 + i * 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className={`h-full rounded-full ${opt.color} opacity-90`}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-5 flex items-center justify-between border-t border-white/5 pt-4">
          <span className="text-[10px] text-white/25">Responses update in real time</span>
          <span className="rounded-md border border-white/10 px-3 py-1 text-[10px] text-white/25">
            Reveal
          </span>
        </div>
      </div>
    </motion.div>
  )
}

/* ── Particle word ── canvas-based particle text effect (adapted from Kain0127 / 21st.dev)
   Particles fly from random positions to form each word, float gently, then scatter
   when the word changes. Colors match the brand gradient. */
interface PWParticle {
  x: number; y: number
  tx: number; ty: number   // target (resting) position
  vx: number; vy: number
  color: string; r: number
  phase: number             // random offset for the floating idle animation
}

function ParticleWord({ wordIndex, words }: { wordIndex: number; words: string[] }) {
  const containerRef  = useRef<HTMLDivElement>(null)
  const canvasRef     = useRef<HTMLCanvasElement>(null)
  const animRef       = useRef<number>(0)
  const particlesRef  = useRef<PWParticle[]>([])
  const stateRef      = useRef<'forming' | 'floating' | 'scattering'>('forming')
  const frameRef      = useRef(0)
  const pendingRef    = useRef<string | null>(null)
  const wordIdxRef    = useRef(wordIndex)
  const sizeRef       = useRef({ w: 0, h: 0, fs: 80, dpr: 1 })

  /* Sample pixel positions from a word rendered with the brand gradient */
  const sampleWord = useCallback((word: string, w: number, h: number, fs: number): PWParticle[] => {
    if (w < 10 || h < 10) return []
    const off = document.createElement('canvas')
    off.width = w; off.height = h
    const ctx = off.getContext('2d')!
    ctx.font = `bold italic ${Math.round(fs)}px Inter, system-ui, sans-serif`
    const textW = ctx.measureText(word).width
    const x0 = w / 2 - textW / 2
    const x1 = w / 2 + textW / 2
    const grad = ctx.createLinearGradient(x0, 0, x1, 0)
    grad.addColorStop(0,   '#ff0065')
    grad.addColorStop(0.5, '#42db66')
    grad.addColorStop(1,   '#00b0ff')
    ctx.fillStyle = grad
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(word, w / 2, Math.round(h * 0.78))
    const { data } = ctx.getImageData(0, 0, w, h)
    const step = Math.max(2, Math.round(w / 350))
    const pts: PWParticle[] = []
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4
        if (data[i + 3] > 80) {
          pts.push({
            x: Math.random() * w, y: Math.random() * h,
            tx: x, ty: y,
            vx: (Math.random() - 0.5) * 4,
            vy: (Math.random() - 0.5) * 4,
            color: `rgb(${data[i]},${data[i+1]},${data[i+2]})`,
            r: Math.random() * 2.2 + 1.0,
            phase: Math.random() * Math.PI * 2,
          })
        }
      }
    }
    return pts
  }, [])

  const spawnWord = useCallback((word: string) => {
    const { w, h, fs } = sizeRef.current
    particlesRef.current = sampleWord(word, w, h, fs)
    stateRef.current = 'forming'
    frameRef.current  = 0
  }, [sampleWord])

  /* Scatter current particles when the word changes */
  useEffect(() => {
    if (wordIndex === wordIdxRef.current) return
    wordIdxRef.current = wordIndex
    pendingRef.current = words[wordIndex]
    stateRef.current   = 'scattering'
    frameRef.current   = 0
    const { w, h } = sizeRef.current
    for (const p of particlesRef.current) {
      // Snap to resting position so scatter always bursts cleanly from the text shape
      p.x = p.tx; p.y = p.ty
      const dx = p.x - w / 2, dy = p.y - h / 2
      const d  = Math.sqrt(dx * dx + dy * dy) || 1
      const spd = Math.random() * 7 + 4
      p.vx = (dx / d) * spd + (Math.random() - 0.5) * 4
      p.vy = (dy / d) * spd + (Math.random() - 0.5) * 4
    }
  }, [wordIndex, words])

  /* Animation loop */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    const loop = () => {
      const { w, h, dpr } = sizeRef.current
      // Scale context to physical pixels so all arc() coordinates stay in CSS pixel space
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      frameRef.current++
      const f = frameRef.current

      if (stateRef.current === 'forming') {
        let done = 0
        for (const p of particlesRef.current) {
          p.vx += (p.tx - p.x) * 0.1
          p.vy += (p.ty - p.y) * 0.1
          p.vx *= 0.7; p.vy *= 0.7
          p.x += p.vx; p.y += p.vy
          if (Math.abs(p.vx) < 0.25 && Math.abs(p.vy) < 0.25) done++
          ctx.fillStyle = p.color
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill()
        }
        if (done === particlesRef.current.length && f > 15) {
          stateRef.current = 'floating'; frameRef.current = 0
        }
      } else if (stateRef.current === 'floating') {
        // Draw actual gradient text so the settled word is as sharp as the rest of the heading
        const { fs } = sizeRef.current
        const word = words[wordIdxRef.current]
        ctx.font = `bold italic ${Math.round(fs)}px Inter, system-ui, sans-serif`
        const textW = ctx.measureText(word).width
        const grad = ctx.createLinearGradient(w / 2 - textW / 2, 0, w / 2 + textW / 2, 0)
        grad.addColorStop(0,   '#ff0065')
        grad.addColorStop(0.5, '#42db66')
        grad.addColorStop(1,   '#00b0ff')
        ctx.fillStyle = grad
        ctx.textAlign = 'center'
        ctx.textBaseline = 'alphabetic'
        ctx.fillText(word, w / 2, Math.round(h * 0.78))
      } else { /* scattering */
        let alive = 0
        for (const p of particlesRef.current) {
          p.vx *= 0.93; p.vy *= 0.93
          p.x  += p.vx;  p.y  += p.vy
          const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy)
          if (spd > 0.35 && p.x > -60 && p.x < w + 60 && p.y > -60 && p.y < h + 60) {
            alive++
            ctx.globalAlpha = Math.min(1, spd / 3.5)
            ctx.fillStyle = p.color
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill()
            ctx.globalAlpha = 1
          }
        }
        if (alive === 0 || f > 55) {
          if (pendingRef.current) { spawnWord(pendingRef.current); pendingRef.current = null }
        }
      }

      animRef.current = requestAnimationFrame(loop)
    }
    animRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animRef.current)
  }, [spawnWord])

  /* Resize — canvas tracks container width; inherits h1 font-size via CSS */
  useEffect(() => {
    const container = containerRef.current
    const canvas    = canvasRef.current
    if (!container || !canvas) return
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1
      const w  = Math.round(container.getBoundingClientRect().width)
      const fs = parseFloat(getComputedStyle(container).fontSize)  // inherits from h1
      if (!w || !fs) return
      const h = Math.round(fs * 1.1)
      const physW = Math.round(w * dpr)
      const physH = Math.round(h * dpr)
      if (canvas.width === physW && canvas.height === physH) return
      // Physical (retina-sharp) canvas dimensions; CSS size stays at logical pixels
      canvas.width  = physW
      canvas.height = physH
      canvas.style.height = h + 'px'  // override CSS height so it doesn't scale up with DPR
      sizeRef.current = { w, h, fs, dpr }
      spawnWord(words[wordIdxRef.current])
    })
    ro.observe(container)
    return () => ro.disconnect()
  }, [words, spawnWord])

  return (
    <div ref={containerRef} className="w-full leading-none">
      <canvas ref={canvasRef} className="block w-full" />
    </div>
  )
}

function AnimatedHeadline() {
  const [accentIndex, setAccentIndex] = useState(0)
  const [cycling, setCycling]         = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setCycling(true), 1500)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!cycling) return
    const id = setInterval(() => setAccentIndex(i => (i + 1) % ACCENT_WORDS.length), 2800)
    return () => clearInterval(id)
  }, [cycling])

  const line = {
    hidden: { opacity: 0, y: 28, filter: 'blur(8px)' },
    show:   { opacity: 1, y: 0,  filter: 'blur(0px)' },
  }

  return (
    <motion.h1
      initial="hidden"
      animate="show"
      transition={{ staggerChildren: 0.15, delayChildren: 0.1 }}
      className="font-display w-full text-5xl font-semibold leading-[1.1] tracking-[-0.04em] sm:text-7xl md:text-[5.5rem] lg:text-[6.5rem]"
    >
      {/* Line 1 — static */}
      <motion.span
        variants={line}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="block"
      >
        Live polls that
      </motion.span>

      {/* Line 2 — particle cycling word; "people." never moves */}
      <motion.span
        variants={line}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="block"
      >
        <ParticleWord wordIndex={accentIndex} words={ACCENT_WORDS} />
      </motion.span>

      {/* Line 3 — static */}
      <motion.span
        variants={line}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="block"
      >
        people.
      </motion.span>
    </motion.h1>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   How it works — 3-step section
   ───────────────────────────────────────────────────────────────────────── */

const STEPS = [
  {
    number:    '01',
    title:     'Build your session',
    body:      'Add your content — upload HTML slides, drop in a PDF or start from a blank canvas. Then sprinkle in question slides wherever you want the room to respond.',
    color:     'text-sky-blue',
    bg:        'bg-sky-blue/10',
    border:    'border-sky-blue/20',
    spotlight: 'rgba(0,176,255,0.10)',
  },
  {
    number:    '02',
    title:     'Audience scans & joins',
    body:      'Show the QR code or 6-character code on screen. Anyone with a phone can join in seconds — no app download, no account.',
    color:     'text-hot-pink',
    bg:        'bg-hot-pink/10',
    border:    'border-hot-pink/20',
    spotlight: 'rgba(255,0,101,0.10)',
  },
  {
    number:    '03',
    title:     'Results update live',
    body:      'Votes, words, and answers stream in as people respond. Reveal results whenever you\'re ready — the whole room reacts together.',
    color:     'text-fresh-green',
    bg:        'bg-fresh-green/10',
    border:    'border-fresh-green/20',
    spotlight: 'rgba(66,219,102,0.10)',
  },
]

function StepCard({ step, delay }: { step: typeof STEPS[0]; delay: number }) {
  const divRef  = useRef<HTMLDivElement>(null)
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null)

  return (
    <motion.div
      ref={divRef}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.55, delay, ease: [0.16, 1, 0.3, 1] }}
      onMouseMove={(e) => {
        const rect = divRef.current?.getBoundingClientRect()
        if (!rect) return
        setSpot({ x: e.clientX - rect.left, y: e.clientY - rect.top })
      }}
      onMouseLeave={() => setSpot(null)}
      className={`relative overflow-hidden rounded-2xl border ${step.border} ${step.bg} p-8`}
    >
      {spot && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(circle 200px at ${spot.x}px ${spot.y}px, ${step.spotlight}, transparent 80%)`,
          }}
        />
      )}
      <span className={`mb-5 block font-mono text-4xl font-bold ${step.color} opacity-40`}>
        {step.number}
      </span>
      <h3 className="mb-3 text-xl font-semibold text-white">{step.title}</h3>
      <p className="text-sm font-light leading-relaxed text-white/60">{step.body}</p>
    </motion.div>
  )
}

function HowItWorks() {
  return (
    <section id="how" className="relative z-10 mx-auto max-w-6xl px-6 py-28 sm:px-10">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="mb-16 text-center"
      >
        <span className="mb-4 inline-block rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium uppercase tracking-wider text-white/50">
          How it works
        </span>
        <h2 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          From zero to live poll<br />in under a minute
        </h2>
      </motion.div>

      <div className="grid gap-6 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <StepCard key={step.number} step={step} delay={i * 0.1} />
        ))}
      </div>
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Features — bento grid (large word cloud left, 3 small tiles right)
   ───────────────────────────────────────────────────────────────────────── */

const CLOUD_WORDS = [
  { text: 'trust',         size: 'text-3xl',  color: 'text-hot-pink',    delay: 0.0,  rotate: '-rotate-1' },
  { text: 'empathy',       size: 'text-2xl',  color: 'text-fresh-green', delay: 0.15, rotate: 'rotate-1'  },
  { text: 'vision',        size: 'text-xl',   color: 'text-sky-blue',    delay: 0.3,  rotate: '-rotate-2' },
  { text: 'courage',       size: 'text-base', color: 'text-golden-sun',  delay: 0.45, rotate: 'rotate-0'  },
  { text: 'communication', size: 'text-sm',   color: 'text-sky-blue',    delay: 0.6,  rotate: 'rotate-1'  },
  { text: 'growth',        size: 'text-xl',   color: 'text-hot-pink',    delay: 0.75, rotate: '-rotate-1' },
  { text: 'inspire',       size: 'text-2xl',  color: 'text-sky-blue',    delay: 0.9,  rotate: 'rotate-2'  },
  { text: 'listen',        size: 'text-sm',   color: 'text-fresh-green', delay: 1.05, rotate: '-rotate-2' },
  { text: 'impact',        size: 'text-lg',   color: 'text-golden-sun',  delay: 1.2,  rotate: 'rotate-1'  },
  { text: 'purpose',       size: 'text-base', color: 'text-hot-pink',    delay: 1.35, rotate: '-rotate-1' },
  { text: 'resilience',    size: 'text-xs',   color: 'text-sky-blue',    delay: 1.5,  rotate: 'rotate-0'  },
  { text: 'clarity',       size: 'text-lg',   color: 'text-fresh-green', delay: 1.65, rotate: 'rotate-2'  },
]

const SMALL_FEATURES = [
  {
    icon:   <BarChart2 className="size-5" />,
    title:  'Live results, zero lag',
    body:   'Responses appear on screen the moment the audience submits. No refresh. No delay.',
    color:  'text-hot-pink',
    bg:     'bg-hot-pink/10',
    border: 'border-hot-pink/20',
  },
  {
    icon:   <QrCode className="size-5" />,
    title:  'No audience cap, ever',
    body:   '10 people or 500 — everyone joins the same way, instantly.',
    color:  'text-sky-blue',
    bg:     'bg-sky-blue/10',
    border: 'border-sky-blue/20',
  },
  {
    icon:   <FileImage className="size-5" />,
    title:  'Any slide, any format',
    body:   'PDFs, HTML decks, videos — or build from scratch. Import once, present anywhere.',
    color:  'text-golden-sun',
    bg:     'bg-golden-sun/10',
    border: 'border-golden-sun/20',
  },
]

function Features() {
  return (
    <section id="features" className="relative z-10 mx-auto max-w-6xl px-6 pb-28 sm:px-10">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '-80px' }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="mb-16 text-center"
      >
        <span className="mb-4 inline-block rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-medium uppercase tracking-wider text-white/50">
          Features
        </span>
        <h2 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Everything you need.<br />Nothing you don't.
        </h2>
      </motion.div>

      {/* Bento grid — large left, 3 stacked right */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">

        {/* Large tile — word cloud demo */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="relative flex min-h-[380px] flex-col overflow-hidden rounded-2xl border border-fresh-green/20 bg-fresh-green/5 p-8 lg:col-span-3 lg:row-span-3"
        >
          {/* Soft glow */}
          <div aria-hidden className="pointer-events-none absolute -bottom-16 -right-16 size-56 rounded-full bg-fresh-green/10 blur-3xl" />

          {/* Live badge */}
          <span className="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-fresh-green/25 bg-fresh-green/10 px-3 py-1 text-xs font-medium text-fresh-green">
            <span className="size-1.5 animate-pulse rounded-full bg-fresh-green" />
            Live word cloud
          </span>

          {/* Fake slide prompt */}
          <p className="mb-2 text-center text-xs font-light tracking-wide text-white/30">
            "What does leadership mean to you?"
          </p>

          {/* Word cloud */}
          <div className="flex flex-1 flex-wrap content-center items-center justify-center gap-x-5 gap-y-3 py-4">
            {CLOUD_WORDS.map((w) => (
              <motion.span
                key={w.text}
                initial={{ opacity: 0, scale: 0.5 }}
                whileInView={{ opacity: 0.9, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.45, delay: w.delay, ease: [0.16, 1, 0.3, 1] }}
                className={`inline-block font-bold ${w.size} ${w.color} ${w.rotate}`}
              >
                {w.text}
              </motion.span>
            ))}
          </div>

          {/* Description */}
          <div className="mt-4">
            <h3 className="mb-2 text-xl font-semibold text-white">4 ways to engage</h3>
            <p className="max-w-sm text-sm font-light leading-relaxed text-white/60">
              Word clouds, multiple choice, open-ended responses, and star ratings — mix them between any slides for live audience interaction.
            </p>
          </div>
        </motion.div>

        {/* 3 small tiles — stacked on the right */}
        {SMALL_FEATURES.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.5, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
            className={`relative rounded-2xl border ${f.border} bg-white/5 p-6 backdrop-blur-sm lg:col-span-2`}
          >
            <div className={`mb-4 inline-flex rounded-xl ${f.bg} p-2.5 ${f.color}`}>
              {f.icon}
            </div>
            <h3 className="mb-2 text-base font-semibold text-white">{f.title}</h3>
            <p className="text-sm font-light leading-relaxed text-white/55">{f.body}</p>
          </motion.div>
        ))}

      </div>

      {/* Bottom CTA */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="mt-16 flex flex-col items-center gap-4 text-center"
      >
        <p className="text-lg font-light text-white/60">Ready to run your next session?</p>
        <PrimaryCta to="/decks">
          Create a Live Poll now
        </PrimaryCta>
      </motion.div>
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Shared CTA button
   ───────────────────────────────────────────────────────────────────────── */

function PrimaryCta({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-hot-pink px-8 py-4 text-base font-medium text-white shadow-[0_0_32px_-8px] shadow-hot-pink/60 transition-all hover:scale-[1.02] hover:shadow-[0_0_48px_-4px] hover:shadow-hot-pink/80 focus:outline-none focus:ring-2 focus:ring-white/40"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full"
      />
      <span className="relative inline-flex items-center gap-2">{children}</span>
    </Link>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Gradient orbs
   ───────────────────────────────────────────────────────────────────────── */

function GradientOrbs() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <motion.div
        className="absolute -left-32 top-1/4 size-[40rem] rounded-full bg-hot-pink/25 blur-[120px]"
        animate={{ x: [0, 40, -20, 0], y: [0, -30, 20, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute right-0 top-1/3 size-[36rem] rounded-full bg-sky-blue/25 blur-[120px]"
        animate={{ x: [0, -50, 30, 0], y: [0, 40, -10, 0] }}
        transition={{ duration: 28, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-0 left-1/3 size-[32rem] rounded-full bg-fresh-green/20 blur-[120px]"
        animate={{ x: [0, 30, -40, 0], y: [0, -20, 30, 0] }}
        transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Footer strip
   ───────────────────────────────────────────────────────────────────────── */

function FooterStrip() {
  return (
    <footer className="relative z-10 border-t border-white/10">
      {/* Main footer row — logo + links */}
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-8 sm:px-10">
        <Link to="/"><AlayaMark className="text-white" /></Link>
        <nav className="hidden items-center gap-6 text-sm font-light text-white/55 sm:flex">
          <a href="#how"    className="transition hover:text-white">How it works</a>
          <a href="#features" className="transition hover:text-white">Features</a>
          <Link to="/join"  className="transition hover:text-white">Join a session</Link>
          <Link to="/decks" className="transition hover:text-white">Create a session</Link>
        </nav>
      </div>
      {/* Copyright strip */}
      <div className="border-t border-white/5">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 text-[11px] font-light text-white/40 sm:px-10">
          <span>Built by Alaya · for teams that lead</span>
          <span>© 2026 Alaya</span>
        </div>
      </div>
    </footer>
  )
}
