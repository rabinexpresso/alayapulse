import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { BarChart2, QrCode, FileImage, Zap } from 'lucide-react'
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

function Hero() {
  return (
    <section className="relative z-10 mx-auto flex min-h-[calc(100vh-72px)] max-w-6xl flex-col items-center justify-center px-6 pb-20 pt-12 text-center sm:px-10">

      <AnimatedHeadline />

      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.65, ease: [0.16, 1, 0.3, 1] }}
        className="mt-8 max-w-2xl text-balance text-lg font-light text-white/70 sm:text-xl"
      >
        The live polling tool built for Alaya — no audience caps, no paywalls,
        no ugly results screens. Import your slides, ask questions, watch the
        room respond in real time.
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
        className="mt-7 text-xs font-light tracking-wide text-white/40"
      >
        No signup required · Start your first poll in 30 seconds
      </motion.p>

      {/* Scroll hint */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4, duration: 0.8 }}
        className="absolute bottom-10 left-1/2 -translate-x-1/2"
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

function AnimatedHeadline() {
  const words = ['Live', 'polls', 'that']
  const accentWord = 'move'
  const trailing = ['people.']

  const wordVariants = {
    hidden: { opacity: 0, y: 28, filter: 'blur(8px)' },
    show:   { opacity: 1, y: 0,  filter: 'blur(0px)' },
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

/* ─────────────────────────────────────────────────────────────────────────
   How it works — 3-step section
   ───────────────────────────────────────────────────────────────────────── */

const STEPS = [
  {
    number: '01',
    title:  'Build your session',
    body:   'Import PDFs, HTML presentations, or videos — then mix in question slides for live interaction. Or build from scratch with custom canvas slides.',
    color:  'text-sky-blue',
    bg:     'bg-sky-blue/10',
    border: 'border-sky-blue/20',
  },
  {
    number: '02',
    title:  'Audience scans & joins',
    body:   'Show the QR code or 6-character code on screen. Anyone with a phone can join in seconds — no app download, no account.',
    color:  'text-hot-pink',
    bg:     'bg-hot-pink/10',
    border: 'border-hot-pink/20',
  },
  {
    number: '03',
    title:  'Results update live',
    body:   'Votes, words, and answers stream in as people respond. Reveal results whenever you\'re ready — the whole room reacts together.',
    color:  'text-fresh-green',
    bg:     'bg-fresh-green/10',
    border: 'border-fresh-green/20',
  },
]

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
          <motion.div
            key={step.number}
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.55, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
            className={`relative rounded-2xl border ${step.border} ${step.bg} p-8`}
          >
            <span className={`mb-5 block font-mono text-4xl font-bold ${step.color} opacity-40`}>
              {step.number}
            </span>
            <h3 className="mb-3 text-xl font-semibold text-white">{step.title}</h3>
            <p className="text-sm font-light leading-relaxed text-white/60">{step.body}</p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}

/* ─────────────────────────────────────────────────────────────────────────
   Features — 4-card grid
   ───────────────────────────────────────────────────────────────────────── */

const FEATURES = [
  {
    icon:  <BarChart2 className="size-5" />,
    title: 'Live results, zero lag',
    body:  'Responses appear on the presenter\'s screen the moment the audience submits. No refresh. No delay.',
    color: 'text-hot-pink',
    bg:    'bg-hot-pink/10',
  },
  {
    icon:  <QrCode className="size-5" />,
    title: 'No audience cap, ever',
    body:  'Designed for the whole room. Whether that\'s 10 people or 500, everyone joins the same way.',
    color: 'text-sky-blue',
    bg:    'bg-sky-blue/10',
  },
  {
    icon:  <FileImage className="size-5" />,
    title: 'Any slide, any format',
    body:  'PDF, HTML presentations, videos, images — or build custom slides from scratch. Import once, present anywhere.',
    color: 'text-fresh-green',
    bg:    'bg-fresh-green/10',
  },
  {
    icon:  <Zap className="size-5" />,
    title: '4 ways to engage',
    body:  'Multiple choice, word cloud, open-ended responses, and star ratings — mix them between any slides for live interaction.',
    color: 'text-golden-sun',
    bg:    'bg-golden-sun/10',
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.5, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-2xl border border-white/8 bg-white/5 p-6 backdrop-blur-sm"
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
