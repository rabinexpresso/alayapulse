import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'

/* ─────────────────────────────────────────────────────────────────────────
   Celebration effects — shared by the presenter leaderboard and the
   audience phone's result screen. Pure framer-motion, no extra libraries.
   ───────────────────────────────────────────────────────────────────────── */

const COLORS = ['#ffc709', '#ff0065', '#00b8d9', '#36b37e', '#ffffff', '#a855f7']

/** Confetti falling from the top. `waves` > 1 sends later bursts. */
export function Confetti({ pieces = 90, waves = 1 }: { pieces?: number; waves?: number }) {
  // Generated once so pieces don't reshuffle on re-render.
  const list = useMemo(
    () => Array.from({ length: pieces * waves }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.floor(i / pieces) * 1.6 + Math.random() * 0.6,
      duration: 2.4 + Math.random() * 1.8,
      drift: (Math.random() - 0.5) * 220,
      rotate: Math.random() * 720 - 360,
      size: 7 + Math.random() * 8,
      color: COLORS[i % COLORS.length],
      round: Math.random() > 0.5,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
      {list.map(p => (
        <motion.div
          key={p.id}
          initial={{ y: -40, x: 0, opacity: 1, rotate: 0 }}
          animate={{ y: '110vh', x: p.drift, opacity: [1, 1, 0.9, 0], rotate: p.rotate }}
          transition={{ duration: p.duration, delay: p.delay, ease: 'easeIn' }}
          className="absolute top-0"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.round ? p.size : p.size * 0.45,
            backgroundColor: p.color,
            borderRadius: p.round ? '9999px' : '2px',
          }}
        />
      ))}
    </div>
  )
}

/**
 * Firework bursts along both sides and across the top — a flash, then sparks
 * flying out and fading. Kept to the edges so the winner's row stays clear.
 */
export function Fireworks({ bursts = 9 }: { bursts?: number }) {
  const list = useMemo(
    () => Array.from({ length: bursts }, (_, i) => {
      const side = i % 3            // 0 = left, 1 = right, 2 = top
      return {
        id: i,
        x: side === 0 ? 6 + Math.random() * 18 : side === 1 ? 76 + Math.random() * 18 : 28 + Math.random() * 44,
        y: side === 2 ? 8 + Math.random() * 14 : 18 + Math.random() * 50,
        delay: i * 0.42 + Math.random() * 0.2,
        color: COLORS[i % 4],
        radius: 90 + Math.random() * 70,
      }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const SPARKS = 22
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      {list.map(b => (
        <div key={b.id} className="absolute" style={{ left: `${b.x}%`, top: `${b.y}%` }}>
          <motion.span
            className="absolute -left-6 -top-6 size-12 rounded-full"
            style={{ background: `radial-gradient(circle, ${b.color} 0%, transparent 70%)` }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 2.2, 2.6], opacity: [0, 0.9, 0] }}
            transition={{ duration: 0.7, delay: b.delay, ease: 'easeOut' }}
          />
          {Array.from({ length: SPARKS }, (_, k) => {
            const a = (k / SPARKS) * Math.PI * 2
            return (
              <motion.span
                key={k}
                className="absolute -left-[3px] -top-[3px] size-1.5 rounded-full"
                style={{ backgroundColor: b.color, boxShadow: `0 0 8px ${b.color}` }}
                initial={{ x: 0, y: 0, opacity: 0, scale: 1 }}
                animate={{
                  x: Math.cos(a) * b.radius,
                  y: Math.sin(a) * b.radius + 40,     // a little gravity
                  opacity: [0, 1, 1, 0],
                  scale: [1, 1, 0.8, 0.3],
                }}
                transition={{ duration: 1.5, delay: b.delay, ease: [0.16, 1, 0.3, 1] }}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** A number that rolls up from 0 to `value` once it mounts. */
export function CountUp({ value, duration = 1100, delay = 150 }: { value: number; duration?: number; delay?: number }) {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    let raf = 0
    const start = performance.now() + delay
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration))
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))))   // ease-out
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration, delay])
  return <>{shown.toLocaleString()}</>
}
