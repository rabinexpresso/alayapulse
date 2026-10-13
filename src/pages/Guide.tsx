import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Hammer, Presentation, BarChart2, Upload, Scissors, LayoutGrid,
  FileSpreadsheet, ListPlus, Bookmark, Play, Compass, Trophy, ClipboardCheck,
  Download, Share2, Lightbulb, AlertTriangle, ClipboardList, ArrowRight, Maximize2, X,
} from 'lucide-react'
import { AlayaMark } from '@/components/AlayaMark'
import { cn } from '@/lib/utils'

/* ─────────────────────────────────────────────────────────────────────────
   User Guide — /guide
   ──────────────────────────────────────────────────────────────────────────
   All guide copy lives in the GUIDE data structure below so future edits
   are one-file changes. Screenshots live in public/guide/*.png — an <img>
   that fails to load hides itself, so topics work with or without images.

   Every topic has a stable id — link directly to it as /guide#<id>
   (e.g. /guide#quiz-mode) when answering "how do I…?" questions.
   ───────────────────────────────────────────────────────────────────────── */

/** Scrolls up to the walkthrough video and plays it from `seconds`. */
function playVideoAt(seconds: number) {
  const v = document.getElementById('guide-video') as HTMLVideoElement | null
  if (!v) return
  v.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const go = () => { v.currentTime = seconds; v.play().catch(() => {}) }
  if (v.readyState >= 1) go()
  else { v.addEventListener('loadedmetadata', go, { once: true }); v.load() }
}

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
  /** Where this topic starts in the walkthrough video, in seconds */
  videoAt?: number
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
    survey:  'border-hot-pink/50 bg-hot-pink/20 text-[#ff7aae]',
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
        videoAt: 9,
        icon: <Upload className="size-4" />,
        title: 'Import your slides',
        intro: 'Already have slides? Bring them in as a PDF, images, video or an HTML slideshow. Using PowerPoint, Keynote or Google Slides? Save as PDF first.',
        steps: [
          { text: <>Open a deck from <strong>My Decks</strong>, or create a new one.</> },
          { text: <>Click the orange <Btn color="orange">Import</Btn> button at the top of the sidebar, then <Btn>Import slides</Btn>.</>, image: 'import-menu.png', imageAlt: 'Import menu with Import slides option' },
          { text: <>Pick your file. A PDF becomes one slide per page.</> },
          { text: <>An HTML slideshow is split into slides for you, and a message at the top says how many. Check the number matches your slides. If it doesn’t, see the next topic.</>, image: 'autosplit-toast.png', imageAlt: 'Auto-split message after importing an HTML deck' },
        ],
        warning: <>During the show, move between slides with Alaya Pulse’s own controls: the <strong>← →</strong> keys, or the arrows at the edges of the screen. Don’t use the next / back buttons drawn inside an HTML slide.</>,
      },
      {
        id: 'split-html',
        videoAt: 27,
        icon: <Scissors className="size-4" />,
        title: 'Fix the split when it’s wrong',
        intro: 'Sometimes Alaya Pulse can’t tell how many slides an HTML file has. You can set the number yourself.',
        steps: [
          { text: <>Find the real number: open the HTML file in your browser, go to the last slide and read its counter. For example, <em>“21 / 21”</em> means <strong>21</strong>.</> },
          { text: <>In the editor, click the HTML slide.</> },
          { text: <>Click the gold <Btn color="gold">＋ Split into … slides</Btn> button above the slide, type the number and confirm.</>, image: 'split-manual.png', imageAlt: 'Split button above the imported HTML slide' },
          { text: <>You now have that many slides, so you can put questions between them.</> },
        ],
        tip: <>Wrong number? Change it and split again, or press <strong>Ctrl+Z</strong> to undo.</>,
      },
      {
        id: 'add-slides',
        videoAt: 44,
        icon: <ListPlus className="size-4" />,
        title: 'Add questions and content slides',
        intro: 'Questions make a session interactive. Mix them in between your normal slides.',
        steps: [
          { text: <>Use the <strong>Add slide</strong> panel at the bottom of the sidebar, or click <em>“Insert slide here”</em> between two slides.</>, image: 'add-slide-menu.png', imageAlt: 'Add slide panel showing all slide types' },
          { text: <><strong>Question slides:</strong> <Btn>MCQ</Btn> multiple choice · <Btn>Word Cloud</Btn> short words that build a cloud · <Btn>Open-ended</Btn> written answers · <Btn>Rating</Btn> score things on a scale · <Btn>Ranking</Btn> put things in order.</> },
          { text: <><strong>Content slides:</strong> <Btn>Heading</Btn>, <Btn>Bullets</Btn>, <Btn>Quote</Btn>, and <Btn>Custom Slide</Btn> for anything you design yourself.</> },
          { text: <>Click any slide to edit it. The settings are on the left and a preview of the big screen is on the right (on a smaller window, the preview is underneath).</> },
          { text: <><strong>Colours:</strong> pick a plain colour or one of five gradients — Midnight, Ocean, Forest, Flame or Sunset. The text colour is set for you, so it’s easy to read on a projector.</> },
          { text: <><strong>Reading ranking results:</strong> items are listed in everyone’s combined order. “Average position” 1.0 means everyone put it first, so lower is better.</> },
        ],
        tip: <>Want a scored competition? See <strong>Live quiz</strong> below. Want everyone to answer at their own pace? See <strong>Self-paced test</strong>.</>,
      },
      {
        id: 'import-questions',
        videoAt: 74,
        icon: <FileSpreadsheet className="size-4" />,
        title: 'Import lots of questions at once (CSV + AI)',
        intro: 'Got your questions in a Word document? Let AI turn them into a file Alaya Pulse can import.',
        steps: [
          { text: <>Click <Btn color="orange">Import</Btn> → <Btn>Import questions in CSV</Btn>, then <Btn>Download template</Btn>.</>, image: 'csv-modal.png', imageAlt: 'Import questions window with Download template' },
          { text: <>Open Gemini (or ChatGPT or Claude). Attach the template and your Word document, then paste the prompt from the import window — it has a <Btn>Copy</Btn> button.</> },
          { text: <>Check what the AI made, especially the correct answers. Save it as a <strong>.csv</strong> file.</> },
          { text: <>Upload the .csv in the same window, and choose where the questions go: <strong>live questions</strong>, a <strong>self-paced test</strong> or a <strong>survey</strong>.</> },
        ],
        tip: <>The template has columns for the question, type, options, correct answer, explanation and timer. Leave a column empty to use the default.</>,
      },
      {
        id: 'rearrange',
        videoAt: 98,
        icon: <LayoutGrid className="size-4" />,
        title: 'Move slides around',
        steps: [
          { text: <>Click the grid button next to <Btn color="orange">Import</Btn> to open <strong>Slide overview</strong>.</>, image: 'slide-overview.png', imageAlt: 'Slide overview grid' },
          { text: <>Drag a slide to move it. Click a slide to edit it.</> },
        ],
        tip: <>You can also drag slides up and down in the sidebar.</>,
      },
      {
        id: 'save-undo',
        videoAt: 109,
        icon: <Bookmark className="size-4" />,
        title: 'Save and undo',
        steps: [
          { text: <>Your deck saves by itself a few seconds after each change. <Btn>Save</Btn> saves straight away and shows <em>“Saved”</em>.</> },
          { text: <>Made a mistake? Click the undo arrow at the top or press <strong>Ctrl+Z</strong>. Redo with <strong>Ctrl+Shift+Z</strong>.</> },
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
        videoAt: 135,
        icon: <Play className="size-4" />,
        title: 'Start the show and get people in',
        steps: [
          { text: <>Click the pink <Btn color="pink">Start Show</Btn> button. You land in the <strong>lobby</strong>, with a big QR code and a 6-letter code.</>, image: 'lobby-qr.png', imageAlt: 'Lobby with QR code and join code' },
          { text: <>People scan the QR code with their phone camera, or go to <strong>alaya-pulse.web.app/join</strong> and type the code. The audience count goes up as they join.</> },
          { text: <>Press <strong>→</strong> to start. The QR code and join code stay in the bottom bar for latecomers.</> },
          { text: <><strong>Left the show by accident?</strong> <Btn color="pink">Resume</Btn> carries on the same session, so nobody has to join again. <Btn color="blue">New Show</Btn> starts a new session with a new code.</> },
          { text: <><strong>Finishing:</strong> press <strong>Esc</strong> (or ✕ in the bottom bar), then <Btn color="pink">End session</Btn>. You can type who it was with — for example “Sydney team” — so you can find it in Results later.</> },
        ],
      },
      {
        id: 'navigate',
        videoAt: 162,
        icon: <Compass className="size-4" />,
        title: 'Moving through the show',
        steps: [
          { text: <><strong>Keyboard:</strong> <strong>→</strong> and <strong>←</strong> move forward and back. On a question, → first shows the results, then moves on.</> },
          { text: <><strong>Mouse:</strong> hover over the left or right edge of the screen for arrows, or use ‹ › in the bottom bar.</>, image: 'show-navigation.png', imageAlt: 'Slide arrows and the bottom bar' },
          { text: <><strong>HTML slides:</strong> always use these controls, not the buttons drawn inside your slides.</> },
        ],
        tip: <>Press <strong>I</strong> to hide or show the bottom bar.</>,
      },
      {
        id: 'quiz-mode',
        videoAt: 118,
        icon: <Trophy className="size-4" />,
        title: 'Live quiz — points and a leaderboard',
        intro: 'Live quiz turns your multiple-choice questions into a competition. Right answers score points, faster answers score more, and a Leaderboard slide shows the winners.',
        steps: [
          { text: <><strong>It turns on by itself</strong> when you tick a correct answer on an MCQ. The top bar shows <Btn color="gold">Live quiz On</Btn>, a Leaderboard slide is added at the end, and each MCQ gets a 30-second timer. Don’t want a competition? Click <Btn>Turn off</Btn>.</>, image: 'quiz-toggle.png', imageAlt: 'Live quiz switch in the editor' },
          { text: <>During the show, a gold <em>“Live quiz”</em> badge in the bottom bar shows it’s on.</> },
          { text: <><strong>Ask a question again:</strong> click the circular arrow in the bottom bar and confirm. Answers are cleared, the timer restarts and everyone can answer again.</>, image: 'reset-votes.png', imageAlt: 'Reset answers button during a question' },
          { text: <>Want scores between rounds? Add more <Btn>Leaderboard</Btn> slides. Each one reveals the top 10, and every phone shows that person’s place.</> },
        ],
        tip: <>Shorter timers make speed matter more.</>,
      },
      {
        id: 'self-paced-test',
        icon: <ClipboardCheck className="size-4" />,
        title: 'Self-paced test — everyone at their own pace',
        videoAt: 209,
        intro: 'Everyone gets all the questions on their phone at once and answers at their own pace, within one time limit. Multiple choice marks itself. You mark written answers afterwards, by hand or with AI.',
        steps: [
          { text: <><strong>Add it:</strong> in the Add slide panel, click <Btn color="gold">Self-paced test</Btn>. A gold frame appears in the sidebar — the questions inside it are the test.</> },
          { text: <><strong>Add questions:</strong> click <Btn>Add question</Btn> or <Btn color="gold">Import CSV</Btn> inside the test. Any question type works. On multiple-choice questions, tick the correct answer.</> },
          { text: <><strong>Questions you mark</strong> (open-ended, word cloud, rating, ranking): set the marks and, if you like, a <strong>marking guide</strong> — what a good answer includes. Press Enter to put each point on its own line. Phones never see it.</> },
          { text: <><strong>Settings:</strong> click the gold header card to set the time limit, when people see their score, what comes after the test (leaderboard, answer review or both), and the colour.</> },
          { text: <><strong>Run it:</strong> press <Btn color="gold">Start test</Btn>. The big screen shows the time left and who has finished. You can add time, <Btn>Pause</Btn>, <Btn>Restart</Btn> or <Btn color="pink">End test</Btn>.</> },
          { text: <><strong>On the phones:</strong> people can skip questions and come back to them. If they try to submit with questions left, the phone shows which ones — and the Submit button appears as soon as they answer the last one.</> },
          { text: <><strong>After the test:</strong> press → for the leaderboard and the answer review, one question at a time. For questions you mark, the answers show first; click <Btn>Show answer guide</Btn> (or press <strong>G</strong>) to show your guide beside them.</> },
          { text: <><strong>Removing the test:</strong> click the bin on the gold header. It asks whether to keep the questions as live questions or delete them too. Undo brings either back.</> },
        ],
        tip: <>Answers save as people go. If someone’s phone closes, they scan the QR code again and carry on.</>,
      },
      {
        id: 'survey',
        icon: <ClipboardList className="size-4" />,
        title: 'Survey — feedback before, during or after',
        intro: 'A survey is like a Google Form inside your deck. Everyone gets all the questions on their phone at once. Nothing is marked or timed, and it’s anonymous unless you ask for names.',
        steps: [
          { text: <><strong>Add it:</strong> in the Add slide panel, click <Btn color="survey">Survey</Btn>. A pink frame appears in the sidebar. Click its header to give it a title.</> },
          { text: <><strong>Add questions:</strong> click <Btn>Add question</Btn> or <Btn color="survey">Import CSV</Btn> inside the survey. In a CSV, use <strong>checkboxes</strong> for “tick all that apply”, and the <strong>required</strong> column (yes / no) for must-answer questions.</> },
          { text: <><strong>On each question:</strong> choose <strong>Must answer</strong> or <strong>Optional</strong>. For multiple choice, choose <strong>One answer</strong> or <strong>Several answers</strong>.</> },
          { text: <><strong>Settings:</strong> <strong>Anonymous</strong> (the default) or <strong>Ask for names</strong>; open <strong>Until I close it</strong> or <strong>Until a date</strong>; and the colour.</> },
          { text: <><strong>During the show:</strong> the survey opens when your show reaches it. Phones that joined show it straight away, and the big screen shows a QR code for everyone else plus a count of responses. <Btn>Show results</Btn> steps through the answers; <Btn>Close survey</Btn> stops new ones.</> },
          { text: <><strong>After the show:</strong> people can still answer with the survey link, the join code or the QR code — until you close it. New answers appear in Results.</> },
          { text: <><strong>Removing the survey:</strong> click the bin on the pink header. It asks whether to keep the questions as live questions or delete them too.</> },
        ],
        tip: <>Put a survey at the start for a check-in, in the middle for a quick pulse, or at the end for feedback.</>,
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
        videoAt: 349,
        icon: <Download className="size-4" />,
        title: 'See and download the results',
        steps: [
          { text: <>Open the deck and click <Btn color="gold">Results</Btn> in the top bar.</> },
          { text: <><strong>Pick a session:</strong> each one has a button showing its name, or its date and time. Used one deck with different groups? Name each session when you end the show, or click <Btn>Name this session</Btn> on the Results page.</> },
          { text: <><strong>More than one part?</strong> Tabs at the top switch between live questions, tests and surveys, in the order you showed them.</> },
          { text: <><strong>Download:</strong> <Btn color="green">Download Excel</Btn> for everything, or <Btn color="pink">Download PDF</Btn> for a summary. The Excel opens on a <strong>Start here</strong> tab that explains every other tab.</>, image: 'results-page.png', imageAlt: 'Results page with the Excel and PDF buttons' },
          { text: <><strong>Test results:</strong> everyone’s score, time and status. Click a name to see their answers.</> },
          { text: <><strong>Marking written answers:</strong> in the Excel, open the <strong>Test – Answers to mark</strong> tab and type a mark in <strong>Your mark</strong>. Or use the marking box on the Results page to get AI to suggest marks.</> },
          { text: <><strong>Survey results:</strong> <strong>Summary</strong> shows a chart for each question, and <strong>Individual</strong> shows one person’s whole form. Use <Btn>Print summary</Btn>, <Btn>Word report</Btn>, <Btn>Excel</Btn>, or <Btn color="pink">Copy for Gemini</Btn> for an AI summary of the main themes.</> },
          { text: <><strong>Question labels:</strong> <em>Live quiz</em> questions score points, <em>Self-paced test</em> questions are marked, and <em>Poll</em> questions just show what the room thinks.</> },
        ],
        tip: <>Results are saved with the deck, so you can come back any time. Check anything AI writes before you share it, and follow your company’s AI policy.</>,
      },
      {
        id: 'share',
        videoAt: 366,
        icon: <Share2 className="size-4" />,
        title: 'Share your deck',
        steps: [
          { text: <>In the top bar, click <Btn>Share</Btn>.</> },
          { text: <><Btn>Copy link</Btn> gives a link anyone can open to see the deck and make their own copy.</>, image: 'share-menu.png', imageAlt: 'Share menu with Copy link' },
          { text: <><Btn>Download JSON</Btn> saves the deck as a file — a backup you can bring back with <Btn color="orange">Import</Btn>.</> },
        ],
        tip: <>Sharing sends a copy. Other people’s changes never touch your deck.</>,
      },
    ],
  },
]

/* The whole journey for a first-timer; each line links to its topic. */
const QUICK_START: { text: React.ReactNode; link: string }[] = [
  { text: <>Make a deck: import your slides, then add questions between them.</>, link: 'add-slides' },
  { text: <>Click <Btn color="pink">Start Show</Btn>. People scan the QR code to join.</>, link: 'slideshow' },
  { text: <>Move through with the → key. Questions show results as people answer.</>, link: 'navigate' },
  { text: <>Afterwards, click <Btn color="gold">Results</Btn> to see and download everything.</>, link: 'results' },
]

/* What people usually come here to do — big cards that jump to the answer. */
const TASKS: { label: string; sub: string; link: string; icon: React.ReactNode; card: string; ink: string }[] = [
  { label: 'Build my deck',      sub: 'Import slides, add questions',  link: 'import-slides',   icon: <Upload className="size-5" />,         card: 'border-[#f97316]/35 hover:border-[#f97316]/75', ink: 'bg-[#f97316]/15 text-[#fb923c]' },
  { label: 'Run a live session', sub: 'QR code, moving through',       link: 'slideshow',       icon: <Presentation className="size-5" />,   card: 'border-hot-pink/35 hover:border-hot-pink/75',   ink: 'bg-hot-pink/15 text-[#ff6aa0]' },
  { label: 'Live quiz',          sub: 'Points and a leaderboard',      link: 'quiz-mode',       icon: <Trophy className="size-5" />,         card: 'border-golden-sun/35 hover:border-golden-sun/75', ink: 'bg-golden-sun/15 text-golden-sun' },
  { label: 'Self-paced test',    sub: 'Everyone at their own pace',    link: 'self-paced-test', icon: <ClipboardCheck className="size-5" />, card: 'border-golden-sun/35 hover:border-golden-sun/75', ink: 'bg-golden-sun/15 text-golden-sun' },
  { label: 'Survey',             sub: 'Feedback, like a Google Form',  link: 'survey',          icon: <ClipboardList className="size-5" />,  card: 'border-hot-pink/35 hover:border-hot-pink/75',   ink: 'bg-hot-pink/15 text-[#ff6aa0]' },
  { label: 'Get the results',    sub: 'Excel, PDF, Word, AI summary',  link: 'results',         icon: <BarChart2 className="size-5" />,      card: 'border-fresh-green/35 hover:border-fresh-green/75', ink: 'bg-fresh-green/15 text-fresh-green' },
]

/** Roughly how long a topic takes to read (its steps are short). */
const readMinutes = (t: Topic) => Math.max(1, Math.round(t.steps.length / 4))
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/* A screenshot beside the steps: click to see it bigger. Hides itself if
   the image file doesn't exist (yet). */
function Shot({ src, alt, step, onZoom }: { src: string; alt: string; step: number; onZoom: (src: string, alt: string) => void }) {
  return (
    <figure>
      <button
        onClick={() => onZoom(src, alt)}
        aria-label={`Enlarge: ${alt}`}
        className="group relative block w-full overflow-hidden rounded-xl border border-white/10 bg-black/20 shadow-lg transition hover:border-white/25"
      >
        <img
          src={`/guide/${src}`}
          alt={alt}
          loading="lazy"
          className="block w-full"
          onError={e => { (e.currentTarget.closest('figure') as HTMLElement).style.display = 'none' }}
        />
        <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/65 px-2 py-0.5 text-[11px] text-white/85 opacity-0 transition group-hover:opacity-100">
          <Maximize2 className="size-3" /> Click to enlarge
        </span>
      </button>
      <figcaption className="mt-1.5 text-xs text-white/45">Step {step} · {alt}</figcaption>
    </figure>
  )
}

/* A topic's tip and warning boxes. */
function Notes({ topic }: { topic: Topic }) {
  return (
    <>
      {topic.tip && (
        <div className="flex gap-2.5 rounded-xl border border-sky-blue/20 bg-sky-blue/10 px-4 py-3">
          <Lightbulb className="mt-0.5 size-4 shrink-0 text-sky-blue" />
          <p className="text-[13px] leading-relaxed text-white/80">{topic.tip}</p>
        </div>
      )}
      {topic.warning && (
        <div className="flex gap-2.5 rounded-xl border border-golden-sun/25 bg-golden-sun/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-golden-sun" />
          <p className="text-[13px] leading-relaxed text-white/80">{topic.warning}</p>
        </div>
      )}
    </>
  )
}

export default function Guide() {
  const { hash } = useLocation()
  // The topic being read, for the menu; the screenshot shown big
  const [activeId, setActiveId] = useState<string | null>(null)
  const [zoom, setZoom] = useState<{ src: string; alt: string } | null>(null)

  // Scroll to the linked topic (e.g. /guide#quiz-mode) once content renders
  useEffect(() => {
    if (!hash) { window.scrollTo(0, 0); return }
    const el = document.getElementById(hash.slice(1))
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }, [hash])

  // The menu follows along: "here" is the last topic whose top has passed
  // the upper third of the screen
  useEffect(() => {
    const ids = GUIDE.flatMap(s => s.topics.map(t => t.id))
    let frame = 0
    const update = () => {
      frame = 0
      let here: string | null = null
      for (const id of ids) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= window.innerHeight * 0.33) here = id
      }
      setActiveId(here)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); cancelAnimationFrame(frame) }
  }, [])

  useEffect(() => {
    if (!zoom) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoom(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom])

  return (
    <div className="min-h-screen bg-midnight-sky-900 text-white">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-white/5 bg-midnight-sky-900/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] items-center px-6 py-4">
          <Link to="/"><AlayaMark className="text-white" /></Link>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1440px] gap-10 px-6 py-10">
        {/* Sticky topic menu (desktop) — follows the topic you're reading, with
            its own scroll so every link stays reachable once it's pinned. */}
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
                      aria-current={activeId === t.id ? 'location' : undefined}
                      className={cn(
                        'block border-l-2 py-1 pl-3 text-[13px] leading-snug transition hover:border-hot-pink hover:text-white',
                        activeId === t.id ? 'border-hot-pink font-medium text-white' : 'border-transparent text-white/55',
                      )}
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
          {/* Title + quick start, with the walkthrough video beside them */}
          <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
            <div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                User <span className="text-hot-pink">Guide</span>
              </h1>
              <p className="mt-3 font-light text-white/60">
                How to build a deck, run a live session and get the results — in the order you’ll do it.
              </p>

              {/* Quick start — the whole journey in four lines */}
              <div className="mt-6 rounded-2xl border border-hot-pink/25 bg-hot-pink/[0.06] p-5">
                <p className="text-[11px] font-bold uppercase tracking-widest text-hot-pink">Quick start · 2 min</p>
                <ol className="mt-3 space-y-2.5 text-sm leading-relaxed text-white/85">
                  {QUICK_START.map((q, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-hot-pink/15 text-xs font-bold text-hot-pink">{i + 1}</span>
                      <span>{q.text} <a href={`#${q.link}`} className="whitespace-nowrap text-hot-pink underline-offset-2 hover:underline">How →</a></span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            {/* Walkthrough video — self-hosted (no third-party player), so
                everything stays inside our own Google Cloud project. */}
            <figure className="overflow-hidden rounded-2xl border border-white/10 bg-black">
              <video
                id="guide-video"
                controls
                preload="metadata"
                playsInline
                poster="/guide/video-poster.jpg"
                className="block w-full"
              >
                <source src="/alaya-pulse-tutorial.mp4" type="video/mp4" />
                Your browser can’t play this video — the written steps below cover everything it shows.
              </video>
              <figcaption className="flex items-center gap-2 border-t border-white/10 px-4 py-2.5 text-[13px] text-white/50">
                <Play className="size-3.5 shrink-0 text-hot-pink" />
                The full walkthrough — 6 min 19 sec. Prefer reading? Every step is below.
              </figcaption>
            </figure>
          </div>

          {/* Jump straight to a task */}
          <p className="mt-12 text-[11px] font-bold uppercase tracking-widest text-white/45">What do you want to do?</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {TASKS.map(t => (
              <a
                key={t.link}
                href={`#${t.link}`}
                className={cn('group flex items-center gap-3.5 rounded-2xl border bg-white/[0.04] p-4 transition hover:bg-white/[0.08]', t.card)}
              >
                <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl', t.ink)}>{t.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{t.label}</span>
                  <span className="block text-[13px] font-light text-white/55">{t.sub}</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-white/30 transition group-hover:translate-x-0.5 group-hover:text-white/70" />
              </a>
            ))}
          </div>

          {GUIDE.map(stage => (
            <section key={stage.id} className="mt-14">
              <div className="mb-6 flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-xl bg-hot-pink/15 text-hot-pink">
                  {stage.icon}
                </span>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-hot-pink">{stage.label}</p>
                  <h2 className="text-xl font-bold tracking-tight">{stage.title}</h2>
                </div>
              </div>

              <div className="space-y-5">
                {stage.topics.map(topic => {
                  const shots = topic.steps.flatMap((s, i) => s.image ? [{ src: s.image, alt: s.imageAlt ?? '', step: i + 1 }] : [])
                  const hasNotes = !!(topic.tip || topic.warning)
                  // Pictures (or, without any, the tip) sit beside the steps on a wide screen
                  const twoCol = shots.length > 0 || hasNotes
                  return (
                    <article
                      key={topic.id}
                      id={topic.id}
                      className="scroll-mt-24 rounded-2xl border border-white/10 bg-white/[0.03] p-6 lg:p-7"
                    >
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <h3 className="flex items-center gap-2.5 text-lg font-semibold">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white/75">
                            {topic.icon}
                          </span>
                          {topic.title}
                        </h3>
                        <span className="rounded-full bg-white/[0.08] px-2.5 py-0.5 text-xs text-white/55">{readMinutes(topic)} min read</span>
                        {topic.videoAt !== undefined && (
                          <button
                            onClick={() => playVideoAt(topic.videoAt!)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-hot-pink/40 bg-hot-pink/10 px-3 py-0.5 text-xs font-medium text-white/90 transition hover:bg-hot-pink/20"
                          >
                            <Play className="size-3 text-hot-pink" />
                            Watch ({clock(topic.videoAt)})
                          </button>
                        )}
                      </div>
                      {topic.intro && (
                        <p className="mt-3 max-w-3xl text-[15px] font-light leading-relaxed text-white/65">{topic.intro}</p>
                      )}

                      <div className={cn('mt-5 grid gap-8', twoCol && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]')}>
                        <div className="min-w-0">
                          <ol className="space-y-4">
                            {topic.steps.map((step, i) => (
                              <li key={i} className="flex gap-3">
                                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-hot-pink/15 text-xs font-bold text-hot-pink">
                                  {i + 1}
                                </span>
                                <p className="min-w-0 flex-1 text-[15px] leading-relaxed text-white/85">{step.text}</p>
                              </li>
                            ))}
                          </ol>
                          {shots.length > 0 && hasNotes && <div className="mt-6 space-y-3"><Notes topic={topic} /></div>}
                        </div>
                        {twoCol && (
                          <aside className="min-w-0 space-y-5 lg:sticky lg:top-24 lg:self-start">
                            {shots.length > 0
                              ? shots.map(s => <Shot key={s.src} {...s} onZoom={(src, alt) => setZoom({ src, alt })} />)
                              : <div className="space-y-3"><Notes topic={topic} /></div>}
                          </aside>
                        )}
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          ))}

          <p className="mt-14 border-t border-white/10 pt-6 text-center text-sm font-light text-white/40">
            That’s it — build, present, get the results. Each section has its own link, like alaya-pulse.web.app/guide#survey, to send to a colleague.
          </p>
        </main>
      </div>

      {/* A screenshot, big */}
      {zoom && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={zoom.alt}
          onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/85 p-6 backdrop-blur-sm"
        >
          <img src={`/guide/${zoom.src}`} alt={zoom.alt} className="max-h-full max-w-full rounded-xl shadow-2xl" />
          <button
            onClick={() => setZoom(null)}
            aria-label="Close"
            className="absolute right-5 top-5 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
          >
            <X className="size-5" />
          </button>
        </div>
      )}
    </div>
  )
}
