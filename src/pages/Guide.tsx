import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Hammer, Presentation, BarChart2, Upload, Scissors, LayoutGrid,
  FileSpreadsheet, ListPlus, Bookmark, Play, Compass, Trophy,
  Download, Share2, Lightbulb, AlertTriangle,
} from 'lucide-react'
import { AlayaMark } from '@/components/AlayaMark'

/* ─────────────────────────────────────────────────────────────────────────
   User Guide — /guide
   ──────────────────────────────────────────────────────────────────────────
   All guide copy lives in the GUIDE data structure below so future edits
   are one-file changes. Screenshots live in public/guide/*.png — an <img>
   that fails to load hides itself, so topics work with or without images.

   Every topic has a stable id — link directly to it as /guide#<id>
   (e.g. /guide#quiz-mode) when answering "how do I…?" questions.
   ───────────────────────────────────────────────────────────────────────── */

interface Step {
  text: React.ReactNode
  image?: string       // file name inside public/guide/
  imageAlt?: string
}
interface Topic {
  id: string
  icon: React.ReactNode
  title: string
  intro?: React.ReactNode
  steps: Step[]
  tip?: React.ReactNode
  warning?: React.ReactNode
}
interface Stage {
  id: string
  icon: React.ReactNode
  label: string
  title: string
  topics: Topic[]
}

/* Small inline mention of a UI button, e.g. <Btn>Save</Btn> */
function Btn({ children, color = 'default' }: { children: React.ReactNode; color?: string }) {
  const palette: Record<string, string> = {
    default: 'border-white/25 bg-white/10 text-white',
    pink:    'border-hot-pink/40 bg-hot-pink/15 text-hot-pink',
    blue:    'border-sky-blue/40 bg-sky-blue/15 text-sky-blue',
    green:   'border-fresh-green/40 bg-fresh-green/15 text-fresh-green',
    orange:  'border-[#f97316]/40 bg-[#f97316]/15 text-[#fb923c]',
    gold:    'border-golden-sun/40 bg-golden-sun/15 text-golden-sun',
  }
  return (
    <span className={`inline-block whitespace-nowrap rounded-md border px-1.5 py-px text-[0.82em] font-semibold leading-snug ${palette[color]}`}>
      {children}
    </span>
  )
}

const GUIDE: Stage[] = [
  {
    id: 'build',
    icon: <Hammer className="size-4" />,
    label: 'Step 1',
    title: 'Build your deck',
    topics: [
      {
        id: 'import-slides',
        icon: <Upload className="size-4" />,
        title: 'Import your slides',
        intro: 'Already have slides? Bring them in as HTML, PDF, images or video. PowerPoint / Keynote / Google Slides users: export to PDF first, then import the PDF.',
        steps: [
          { text: <>From <strong>My Decks</strong>, open a deck (or create a new one) to enter the editor.</> },
          { text: <>In the left sidebar, click the orange <Btn color="orange">Import</Btn> button, then choose <Btn>Import slides</Btn>.</>, image: 'import-menu.png', imageAlt: 'Import menu with Import slides option' },
          { text: <>Pick your file. A PDF becomes one slide per page. An HTML slideshow is scanned automatically — look for the <em>“Auto-split into N slides”</em> message at the top.</>, image: 'autosplit-toast.png', imageAlt: 'Auto-split toast after importing an HTML deck' },
          { text: <><strong>Check the number.</strong> If “N” matches the real number of slides in your HTML file, you’re done. If it didn’t split (or the number is wrong), fix it in 10 seconds — see the next topic.</> },
        ],
        warning: <>During the live show, always move between slides with <strong>Alaya Pulse’s own navigation</strong> — keyboard ← → arrows, or the arrow buttons that appear at the left/right edges of the screen. Don’t click the next/back buttons drawn inside your HTML slides; Pulse blocks most of them, but its own controls are the reliable way.</>,
      },
      {
        id: 'split-html',
        icon: <Scissors className="size-4" />,
        title: 'Fix the split when auto-detect misses',
        intro: 'Alaya Pulse tries to detect how many slides your HTML file contains, but some files hide it too well. You always have a manual override.',
        steps: [
          { text: <>First, know your real number: open the HTML file directly in your browser, go to the last slide, and read its counter (e.g. <em>“21 / 21”</em> → the number is <strong>21</strong>).</> },
          { text: <>In the editor, click the imported HTML slide to select it.</> },
          { text: <>Click the gold <Btn color="gold">＋ Split into … slides</Btn> button at the top-right of the slide. If Pulse detected a count it’s pre-filled; if not, the button reads <em>“Split into multiple slides”</em> — either way you can set the true number before confirming.</>, image: 'split-manual.png', imageAlt: 'Manual split button above the imported HTML slide' },
          { text: <>The one HTML slide becomes that many Pulse slides — so you can insert questions between them and step through one by one.</> },
        ],
        tip: <>Split wrong? Just change the number and split again, or use Undo (Ctrl+Z).</>,
      },
      {
        id: 'add-slides',
        icon: <ListPlus className="size-4" />,
        title: 'Add question & content slides',
        intro: 'Questions are what make a session interactive — mix them between your normal slides.',
        steps: [
          { text: <>Click <Btn color="pink">Add slide</Btn> (or <em>“Insert slide here”</em> between two slides in the sidebar).</>, image: 'add-slide-menu.png', imageAlt: 'Add slide menu showing all slide types' },
          { text: <><strong>Question types:</strong> <Btn>MCQ</Btn> (multiple choice, supports correct answers), <Btn>Word Cloud</Btn> (short words build a live cloud), <Btn>Open Ended</Btn> (free-text answers), <Btn>Rating</Btn> (score items on a scale).</> },
          { text: <><strong>Content types:</strong> <Btn>Heading</Btn>, <Btn>Bullets</Btn>, <Btn>Quote</Btn> and <Btn>Custom Slide</Btn> for anything you design yourself.</> },
          { text: <><strong>Leaderboard:</strong> add it after your quiz questions — during a quiz it shows the top scorers with points. (See the Quiz mode topic below.)</> },
          { text: <>Each question slide has its own settings on the right — options, correct answer(s), timer, and how many answers each person may submit.</> },
        ],
      },
      {
        id: 'import-questions',
        icon: <FileSpreadsheet className="size-4" />,
        title: 'Import many questions at once (CSV + AI)',
        intro: 'Typing 20 questions by hand is slow. If your questions already live in a Word document, let an AI convert them into the import template for you.',
        steps: [
          { text: <>Click <Btn color="orange">Import</Btn> → <Btn>Import questions in CSV</Btn>, then click <Btn>Download template</Btn> to save the CSV template.</>, image: 'csv-modal.png', imageAlt: 'Import questions modal with Download template' },
          { text: <>Open an AI chat (e.g. Gemini). Attach <strong>both</strong> the template and your Word document, and ask: <em>“Fill this CSV template with the questions from my document. Keep the exact column layout. Include the question type, options, correct answers and a timer for each.”</em></> },
          { text: <>Check the AI’s output (especially the correct answers!), save it as a <strong>.csv</strong> file.</> },
          { text: <>Back in Alaya Pulse, upload the finished CSV in the same <em>Import questions</em> window. Every question becomes a ready-made slide.</> },
        ],
        tip: <>The template’s columns cover question text, type, options, correct answer(s), an explanation (shown after the answer is revealed) and timer seconds — anything you leave empty just uses the defaults.</>,
      },
      {
        id: 'rearrange',
        icon: <LayoutGrid className="size-4" />,
        title: 'Rearrange slides in Slide Overview',
        steps: [
          { text: <>Click the <Btn>Slide overview</Btn> button (grid icon) in the editor.</>, image: 'slide-overview.png', imageAlt: 'Slide Overview grid' },
          { text: <><strong>Drag</strong> any slide card to a new position to reorder the deck.</> },
          { text: <>Click a card to jump straight to editing that slide.</> },
        ],
        tip: <>The sidebar list also supports dragging slides up and down for quick single moves.</>,
      },
      {
        id: 'save-undo',
        icon: <Bookmark className="size-4" />,
        title: 'Save, undo, redo',
        steps: [
          { text: <>Click <Btn>Save</Btn> in the top bar whenever you want to store your deck — it flips to <em>“Saved”</em> when done.</> },
          { text: <>Made a mistake? <Btn>Undo</Btn> with the toolbar arrow or <strong>Ctrl+Z</strong>. <Btn>Redo</Btn> with <strong>Ctrl+Shift+Z</strong>.</> },
          { text: <>Save before starting a show or closing the tab, so nothing is lost.</> },
        ],
      },
    ],
  },
  {
    id: 'present',
    icon: <Presentation className="size-4" />,
    label: 'Step 2',
    title: 'Present live',
    topics: [
      {
        id: 'slideshow',
        icon: <Play className="size-4" />,
        title: 'Start the show & get your audience in',
        steps: [
          { text: <>Click the pink <Btn color="pink">Start Show</Btn> button in the editor. You land in the <strong>lobby</strong>: a big QR code plus a short session code.</>, image: 'lobby-qr.png', imageAlt: 'Session lobby with QR code and join code' },
          { text: <>The audience scans the QR with their phone camera — or types the code at <strong>alaya-pulse.web.app/join</strong>. You’ll see the audience counter tick up as they arrive.</> },
          { text: <>Press <strong>→</strong> (or click the right edge) to leave the lobby and begin. The QR and code stay visible in the bottom bar for latecomers.</> },
          { text: <><strong>Resume vs New Show:</strong> if you exit and come back, <Btn color="pink">Resume</Btn> continues the <em>same</em> session — everyone stays connected, no re-scanning. <Btn color="blue">New Show</Btn> starts fresh with a new code (audience must join again). Use Resume for accidental exits or quick edits mid-session.</> },
        ],
      },
      {
        id: 'navigate',
        icon: <Compass className="size-4" />,
        title: 'Moving between slides during the show',
        steps: [
          { text: <><strong>Keyboard:</strong> → / ← arrows move forward and back. On a question slide, → first reveals the results, then moves on.</> },
          { text: <><strong>Mouse:</strong> hover the far left or right edge of the screen — arrow buttons appear. The bottom bar also has ‹ › arrows next to the slide counter.</>, image: 'show-navigation.png', imageAlt: 'Slideshow navigation arrows and bottom bar' },
          { text: <><strong>Imported HTML decks:</strong> ignore any next/back buttons drawn inside the slides themselves — always use the Pulse controls above. Pulse keeps its slide counter and the deck perfectly in sync only when it does the driving.</> },
        ],
        tip: <>Press <strong>I</strong> to hide or show the bottom info bar. Press <strong>Esc</strong> to exit the show.</>,
      },
      {
        id: 'quiz-mode',
        icon: <Trophy className="size-4" />,
        title: 'Quiz mode — points, timer resets, re-votes',
        intro: 'Quiz mode turns your MCQ questions into a scored competition: right answers earn points, faster answers earn more, and a Leaderboard slide shows the champions.',
        steps: [
          { text: <><strong>Turn it on in the editor:</strong> click the <Btn color="gold">Quiz Off</Btn> toggle in the top bar so it reads <Btn color="gold">Quiz On</Btn> and glows gold. Every MCQ without a timer automatically gets a 30-second one.</>, image: 'quiz-toggle.png', imageAlt: 'Quiz mode toggle in the editor toolbar' },
          { text: <><strong>Check it during the show:</strong> a gold <em>“Quiz mode”</em> badge sits in the bottom bar of the slideshow. No badge = quiz is off.</> },
          { text: <><strong>Reset a question / timer:</strong> on a question slide, click the circular-arrow <Btn>Reset votes</Btn> control in the bottom bar and confirm. All answers for that question are cleared, the timer restarts, and everyone can answer once more.</>, image: 'reset-votes.png', imageAlt: 'Reset votes control during a live question' },
          { text: <>Add a <Btn>Leaderboard</Btn> slide (usually at the end, or between rounds) to show the running top-10 with points.</> },
        ],
        tip: <>Set each question’s timer length in the editor — the timer also drives speed points, so shorter timers make speed matter more.</>,
      },
    ],
  },
  {
    id: 'after',
    icon: <BarChart2 className="size-4" />,
    label: 'Step 3',
    title: 'After the session',
    topics: [
      {
        id: 'results',
        icon: <Download className="size-4" />,
        title: 'Download the results',
        steps: [
          { text: <>After a show, open the deck and click <Btn>Results</Btn> — this opens the results page with every question’s answers.</> },
          { text: <>Use the download buttons to export everything as an <strong>Excel file</strong> (per-question tabs, participants, and — for quizzes — the leaderboard) or as a <strong>PDF summary</strong>.</>, image: 'results-page.png', imageAlt: 'Results page with Excel and PDF download buttons' },
          { text: <>Results are saved with the deck, so you can come back and download them later too.</> },
        ],
      },
      {
        id: 'share',
        icon: <Share2 className="size-4" />,
        title: 'Share your deck',
        steps: [
          { text: <>In the editor’s top bar, click <Btn>Share</Btn>.</> },
          { text: <><Btn>Copy link</Btn> gives you a link anyone can open to view the deck and import their own copy — perfect for handing a deck to a colleague.</>, image: 'share-menu.png', imageAlt: 'Share menu with Copy link' },
          { text: <><Btn>Download JSON</Btn> saves the deck as a file — a backup you (or anyone) can bring back via <Btn color="orange">Import</Btn>.</> },
        ],
        tip: <>Sharing sends a <em>copy</em> — the other person’s edits never change your original deck.</>,
      },
    ],
  },
]

/* Screenshot that removes itself if the image file doesn't exist (yet). */
function Shot({ src, alt }: { src: string; alt: string }) {
  return (
    <img
      src={`/guide/${src}`}
      alt={alt}
      loading="lazy"
      className="mt-3 w-full max-w-2xl rounded-xl border border-white/10 shadow-lg"
      onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none' }}
    />
  )
}

export default function Guide() {
  const { hash } = useLocation()

  // Scroll to the linked topic (e.g. /guide#quiz-mode) once content renders
  useEffect(() => {
    if (!hash) { window.scrollTo(0, 0); return }
    const el = document.getElementById(hash.slice(1))
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }, [hash])

  return (
    <div className="min-h-screen bg-midnight-sky-900 text-white">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-white/5 bg-midnight-sky-900/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/"><AlayaMark className="text-white" /></Link>
          <Link
            to="/"
            className="rounded-full border border-white/15 px-4 py-1.5 text-sm text-white/70 transition hover:border-white/40 hover:text-white"
          >
            Back
          </Link>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-10 px-6 py-10">
        {/* Sticky topic menu (desktop) — bounded height with its own scroll,
            so every link stays reachable even once the nav is pinned. */}
        <nav className="scrollbar-sidebar sticky top-24 hidden w-56 shrink-0 self-start overflow-y-auto lg:block" style={{ maxHeight: 'calc(100vh - 7rem)' }}>
          {GUIDE.map(stage => (
            <div key={stage.id} className="mb-5">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/40">
                {stage.icon}{stage.title}
              </p>
              <ul className="space-y-0.5 border-l border-white/10">
                {stage.topics.map(t => (
                  <li key={t.id}>
                    <a
                      href={`#${t.id}`}
                      className="block border-l-2 border-transparent py-1 pl-3 text-[13px] leading-snug text-white/60 transition hover:border-hot-pink hover:text-white"
                    >
                      {t.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Content */}
        <main className="min-w-0 flex-1">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            User <span className="text-hot-pink">Guide</span>
          </h1>
          <p className="mt-3 max-w-2xl font-light text-white/60">
            Everything you need to build a deck, run a live session and collect the results —
            in the order you’ll actually do it. Tip: every section has its own link, so you can
            share <span className="font-mono text-white/80">alaya-pulse.web.app/guide#quiz-mode</span> style
            links that jump straight to an answer.
          </p>

          {GUIDE.map(stage => (
            <section key={stage.id} className="mt-12">
              <div className="mb-6 flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-xl bg-hot-pink/15 text-hot-pink">
                  {stage.icon}
                </span>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-hot-pink">{stage.label}</p>
                  <h2 className="text-xl font-bold tracking-tight">{stage.title}</h2>
                </div>
              </div>

              <div className="space-y-4">
                {stage.topics.map(topic => (
                  <article
                    key={topic.id}
                    id={topic.id}
                    className="scroll-mt-24 rounded-2xl border border-white/10 bg-white/[0.03] p-6"
                  >
                    <h3 className="flex items-center gap-2.5 text-lg font-semibold">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white/70">
                        {topic.icon}
                      </span>
                      {topic.title}
                    </h3>
                    {topic.intro && (
                      <p className="mt-2.5 text-sm font-light leading-relaxed text-white/60">{topic.intro}</p>
                    )}

                    <ol className="mt-4 space-y-4">
                      {topic.steps.map((step, i) => (
                        <li key={i} className="flex gap-3">
                          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-hot-pink/15 text-xs font-bold text-hot-pink">
                            {i + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm leading-relaxed text-white/85">{step.text}</p>
                            {step.image && <div><Shot src={step.image} alt={step.imageAlt ?? ''} /></div>}
                          </div>
                        </li>
                      ))}
                    </ol>

                    {topic.tip && (
                      <div className="mt-5 flex gap-2.5 rounded-xl border border-sky-blue/20 bg-sky-blue/10 px-4 py-3">
                        <Lightbulb className="mt-0.5 size-4 shrink-0 text-sky-blue" />
                        <p className="text-[13px] leading-relaxed text-white/80">{topic.tip}</p>
                      </div>
                    )}
                    {topic.warning && (
                      <div className="mt-5 flex gap-2.5 rounded-xl border border-golden-sun/25 bg-golden-sun/10 px-4 py-3">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-golden-sun" />
                        <p className="text-[13px] leading-relaxed text-white/80">{topic.warning}</p>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}

          <p className="mt-14 border-t border-white/10 pt-6 text-center text-sm font-light text-white/40">
            That’s the whole journey — build, present, download. Have fun out there. 🎉
          </p>
        </main>
      </div>
    </div>
  )
}
