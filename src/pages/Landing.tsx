import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { ArrowRight, Play } from 'lucide-react'
import { AlayaMark, DnaMonogram } from '@/components/AlayaMark'

/* ─────────────────────────────────────────────────────────────────────────
   Landing page — premium hero, dark Midnight Sky background, animated
   gradient orbs, oversized typography, Hot Pink primary CTA.
   ───────────────────────────────────────────────────────────────────────── */

export default function Landing() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-midnight-sky-900 text-white">
      {/* Animated gradient orbs */}
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

      {/* Top nav */}
      <Nav />

      {/* Hero */}
      <Hero />

      {/* Footer strip */}
      <FooterStrip />
    </main>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Sub-sections
   ───────────────────────────────────────────────────────────────────────── */

function Nav() {
  return (
    <header className="relative z-20">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 sm:px-10">
        <Link to="/" className="group">
          <AlayaMark className="text-white" />
        </Link>
        <nav className="hidden items-center gap-8 text-sm font-light text-white/70 md:flex">
          <a href="#how" className="transition hover:text-white">
            How it works
          </a>
          <a href="#features" className="transition hover:text-white">
            Features
          </a>
        </nav>
        <div className="flex items-center gap-3">
          <Link
            to="/join"
            className="hidden text-sm font-light text-white/70 transition hover:text-white sm:inline"
          >
            Join a session
          </Link>
          <Link
            to="/create"
            className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur-md transition hover:bg-white/20"
          >
            Sign in
          </Link>
        </div>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section className="relative z-10 mx-auto flex min-h-[calc(100vh-88px)] max-w-6xl flex-col items-center justify-center px-6 pb-20 pt-12 text-center sm:px-10">

      {/* Headline */}
      <AnimatedHeadline />

      {/* Subhead */}
      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.65, ease: [0.16, 1, 0.3, 1] }}
        className="mt-8 max-w-2xl text-balance text-lg font-light text-white/70 sm:text-xl"
      >
        The Mentimeter alternative built for teams that hate audience caps
        and dated UX. Pixel-perfect slide import, live results that don't
        suck, beautiful on every phone.
      </motion.p>

      {/* CTAs */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="mt-12 flex flex-col items-center gap-4 sm:flex-row sm:gap-5"
      >
        <PrimaryCta to="/create">
          Start a session — free
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </PrimaryCta>
        <SecondaryCta href="#demo">
          <Play className="size-4 fill-current" />
          See how it works
        </SecondaryCta>
      </motion.div>

      {/* Reassurance copy */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.7, delay: 1.0 }}
        className="mt-7 text-xs font-light tracking-wide text-white/40"
      >
        No signup required · Start your first poll in 30 seconds
      </motion.p>
    </section>
  )
}

function AnimatedHeadline() {
  const words = ['Live', 'polls', 'that']
  const accentWord = 'move'
  const trailing = ['people.']

  const wordVariants = {
    hidden: { opacity: 0, y: 28, filter: 'blur(8px)' },
    show: { opacity: 1, y: 0, filter: 'blur(0px)' },
  }

  return (
    <motion.h1
      initial="hidden"
      animate="show"
      transition={{ staggerChildren: 0.08, delayChildren: 0.1 }}
      className="font-display text-balance text-5xl font-semibold leading-[1.05] tracking-[-0.04em] sm:text-7xl md:text-[5.5rem] lg:text-[6.5rem]"
    >
      {words.map((w, i) => (
        <motion.span
          key={`w-${i}`}
          variants={wordVariants}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="inline-block"
        >
          {w}&nbsp;
        </motion.span>
      ))}
      {/* "move" — gradient italic, extra right padding so the italic "e" isn't clipped */}
      <motion.span
        variants={wordVariants}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="relative inline-block overflow-visible"
      >
        <span
          className="bg-gradient-to-r from-hot-pink via-fresh-green to-sky-blue bg-clip-text italic text-transparent"
          style={{ paddingRight: '0.12em', display: 'inline-block' }}
        >
          {accentWord}
        </span>
      </motion.span>
      &nbsp;
      {trailing.map((w, i) => (
        <motion.span
          key={`t-${i}`}
          variants={wordVariants}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="inline-block"
        >
          {w}
        </motion.span>
      ))}
    </motion.h1>
  )
}

function PrimaryCta({
  to,
  children,
}: {
  to: string
  children: React.ReactNode
}) {
  return (
    <Link
      to={to}
      className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-hot-pink px-8 py-4 text-base font-medium text-white shadow-[0_0_32px_-8px] shadow-hot-pink/60 transition-all hover:scale-[1.02] hover:shadow-[0_0_48px_-4px] hover:shadow-hot-pink/80 focus:outline-none focus:ring-2 focus:ring-white/40 focus:ring-offset-2 focus:ring-offset-midnight-sky-900"
    >
      {/* Shimmer sweep on hover */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full"
      />
      <span className="relative inline-flex items-center gap-2">{children}</span>
    </Link>
  )
}

function SecondaryCta({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      className="group inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-7 py-4 text-base font-medium text-white backdrop-blur-md transition-all hover:scale-[1.02] hover:border-white/40 hover:bg-white/10"
    >
      {children}
    </a>
  )
}

function GradientOrbs() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <motion.div
        className="absolute -left-32 top-1/4 size-[40rem] rounded-full bg-hot-pink/30 blur-[120px]"
        animate={{ x: [0, 40, -20, 0], y: [0, -30, 20, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute right-0 top-1/3 size-[36rem] rounded-full bg-sky-blue/30 blur-[120px]"
        animate={{ x: [0, -50, 30, 0], y: [0, 40, -10, 0] }}
        transition={{ duration: 28, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-0 left-1/3 size-[32rem] rounded-full bg-fresh-green/25 blur-[120px]"
        animate={{ x: [0, 30, -40, 0], y: [0, -20, 30, 0] }}
        transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  )
}

function FooterStrip() {
  return (
    <div className="relative z-10 border-t border-white/5">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 text-xs font-light text-white/40 sm:px-10">
        <span className="inline-flex items-center gap-2">
          <DnaMonogram className="h-4" animate={false} />
          Built by Alaya · for teams that lead
        </span>
        <span className="hidden sm:inline">
          v0.1 · in active development
        </span>
      </div>
    </div>
  )
}
