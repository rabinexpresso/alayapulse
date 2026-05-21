import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import { AlayaMark } from '@/components/AlayaMark'

/**
 * Reusable placeholder for routes not yet built.
 * Keeps the dark-on-light theme parity with the eventual screens.
 */
export function ComingSoon({
  title,
  blurb,
  audienceLight = false,
}: {
  title: string
  blurb: string
  /** Audience-facing screens use light theme per Round 3 decision. */
  audienceLight?: boolean
}) {
  const bg = audienceLight ? 'bg-white text-midnight-sky-900' : 'bg-midnight-sky-900 text-white'
  const subtleText = audienceLight ? 'text-midnight-sky-700' : 'text-white/60'
  const accent = audienceLight ? 'text-hot-pink' : 'text-hot-pink'

  return (
    <main className={`relative min-h-screen ${bg}`}>
      <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 sm:px-10">
        <Link to="/" className="inline-flex items-center gap-2">
          <AlayaMark />
        </Link>
        <Link
          to="/"
          className={`inline-flex items-center gap-1.5 text-sm font-light transition hover:opacity-80 ${subtleText}`}
        >
          <ArrowLeft className="size-4" />
          Back to home
        </Link>
      </header>

      <section className="mx-auto flex min-h-[calc(100vh-200px)] max-w-2xl flex-col items-center justify-center px-6 text-center sm:px-10">
        <motion.span
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className={`mb-6 inline-block rounded-full border ${
            audienceLight ? 'border-midnight-sky-300 bg-midnight-sky-50' : 'border-white/15 bg-white/5'
          } px-4 py-1.5 text-xs font-medium uppercase tracking-[0.18em] ${accent}`}
        >
          Coming next
        </motion.span>
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="text-balance text-4xl font-semibold tracking-[-0.02em] sm:text-5xl"
        >
          {title}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className={`mt-6 max-w-lg text-balance text-base font-light sm:text-lg ${subtleText}`}
        >
          {blurb}
        </motion.p>
      </section>
    </main>
  )
}
