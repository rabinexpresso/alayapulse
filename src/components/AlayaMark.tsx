import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'

/**
 * Alaya DNA monogram — recreated from the official brand reference.
 *
 * Structure (back to front):
 *   1. Left grey wing  — outer left circle, partially hidden behind blue
 *   2. Right grey wing — outer right circle, partially hidden behind green
 *   3. Sky blue circle — left inner
 *   4. Fresh green circle — right inner
 *   5. Hot pink circle  — center, frontmost (on top of blue + green)
 *
 * The grey circles peek out from behind the coloured ones, creating
 * the "butterfly wing" silhouette seen in the official brand asset.
 *
 * Swap this SVG for the official brand file when available.
 */
export function DnaMonogram({
  className,
  animate = true,
}: {
  className?: string
  animate?: boolean
}) {
  return (
    <motion.svg
      viewBox="0 0 130 58"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('h-8 w-auto', className)}
      initial={animate ? { opacity: 0, scale: 0.9 } : false}
      animate={animate ? { opacity: 1, scale: 1 } : false}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      aria-hidden="true"
    >
      {/* 1. Left grey wing (behind blue) */}
      <circle cx="26" cy="29" r="22" fill="#b0abc8" opacity="0.75" />

      {/* 2. Right grey wing (behind green) */}
      <circle cx="104" cy="29" r="22" fill="#b0abc8" opacity="0.75" />

      {/* 3. Sky blue — left inner */}
      <circle cx="50" cy="29" r="22" fill="#00b0ff" />

      {/* 4. Fresh green — right inner */}
      <circle cx="80" cy="29" r="22" fill="#42db66" />

      {/* 5. Hot pink — center, frontmost */}
      <circle cx="65" cy="29" r="22" fill="#ff0065" />
    </motion.svg>
  )
}

/**
 * "alaya pulse" wordmark — Poppins lowercase per brand guidelines.
 * "alaya" is always lowercase except at the start of a sentence.
 */
export function AlayaWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'font-sans text-xl font-semibold tracking-tight',
        className,
      )}
    >
      alaya<span className="text-hot-pink"> pulse</span>
    </span>
  )
}

/** Combined monogram + wordmark — used in nav.
 *  Wraps the wordmark in a Framer Motion div that pulses a coloured
 *  drop-shadow in a heartbeat rhythm (lub-dub), cycling through the
 *  three Alaya brand colours: hot-pink → sky-blue → fresh-green.
 */
export function AlayaMark({ className }: { className?: string }) {
  return (
    <motion.div
      className={cn('inline-flex items-center gap-2.5', className)}
      animate={{
        filter: [
          /* ── Hot-pink lub-dub ─────────────────────────────────────── */
          'drop-shadow(0 0 0px rgba(255,0,101,0))',
          // lub — tight inner glow + wide outer halo
          'drop-shadow(0 0 6px rgba(255,0,101,1)) drop-shadow(0 0 18px rgba(255,0,101,0.55))',
          // dip
          'drop-shadow(0 0 2px rgba(255,0,101,0.35))',
          // dub — stronger than lub
          'drop-shadow(0 0 10px rgba(255,0,101,1)) drop-shadow(0 0 28px rgba(255,0,101,0.65))',
          'drop-shadow(0 0 0px rgba(255,0,101,0))',
          /* ── Sky-blue lub-dub ─────────────────────────────────────── */
          'drop-shadow(0 0 0px rgba(0,176,255,0))',
          'drop-shadow(0 0 6px rgba(0,176,255,1)) drop-shadow(0 0 18px rgba(0,176,255,0.55))',
          'drop-shadow(0 0 2px rgba(0,176,255,0.35))',
          'drop-shadow(0 0 10px rgba(0,176,255,1)) drop-shadow(0 0 28px rgba(0,176,255,0.65))',
          'drop-shadow(0 0 0px rgba(0,176,255,0))',
          /* ── Fresh-green lub-dub ──────────────────────────────────── */
          'drop-shadow(0 0 0px rgba(66,219,102,0))',
          'drop-shadow(0 0 6px rgba(66,219,102,1)) drop-shadow(0 0 18px rgba(66,219,102,0.55))',
          'drop-shadow(0 0 2px rgba(66,219,102,0.35))',
          'drop-shadow(0 0 10px rgba(66,219,102,1)) drop-shadow(0 0 28px rgba(66,219,102,0.65))',
          'drop-shadow(0 0 0px rgba(66,219,102,0))',
          /* ── Silent rest until loop ───────────────────────────────── */
          'drop-shadow(0 0 0px rgba(255,0,101,0))',
        ],
      }}
      transition={{
        duration: 6,
        repeat: Infinity,
        ease: 'linear',
        times: [
          0,    0.06, 0.10, 0.15, 0.22,   // pink  (0 – 22 %)
          0.33, 0.39, 0.43, 0.48, 0.55,   // blue  (33 – 55 %)
          0.66, 0.72, 0.76, 0.81, 0.88,   // green (66 – 88 %)
          1.00,                            // silent hold → loop
        ],
      }}
    >
      <AlayaWordmark />
    </motion.div>
  )
}
