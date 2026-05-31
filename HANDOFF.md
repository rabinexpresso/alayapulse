# Alaya Pulse — Handoff Document

**Purpose of this file:** Hand the project from one Claude Code session to another (PC → MacBook, or any device). When you open Claude Code on a new machine, share this file as your first message — Claude will pick up exactly where we left off.

> **NOTE TO CLAUDE (on the receiving machine):** This document is the source of truth for the project's context, decisions, and current state. Treat it the way you'd treat a project memory file. After reading, save the key facts to your local memory system and continue the build from "Current state — where we left off" below.

---

## 1. About the user

- Vibe coder — no programming background
- Communicates in plain language; Claude figures out implementation
- Don't ask the user technical decisions; recommend and explain in one sentence why
- Always explain approach in plain English BEFORE writing code, get confirmation, then build
- Keep explanations short and practical — they care about what it does for the user, not how it works internally
- Works for **HLE / Alaya** (a brand)
- Already has another project: **The Leadership Challenge** (plain HTML/JS, on GitHub Pages, repo: `rabinexpresso/leadershipchallenge`)
- Comfortable with: clicking through installers, copying-pasting commands, using GitHub, using Firebase Console
- Not comfortable with: terminal commands they've never seen, technical jargon, making framework choices

## 2. The project: Alaya Pulse

**One-line:** A free, premium-feeling, animation-heavy live polling web app for Alaya internal use — a Mentimeter alternative without audience caps, with great slide import, and a far better visual design.

**Why it exists:** Mentimeter's free tier caps audience size and questions per slide. Alaya wants an internal-use tool with no caps, better slide import, and a premium look.

**Working directory (Windows):** `C:\Users\rabin.r_homeloanexpe\Desktop\Apps\Claude\Alaya Pulse Check`
**Working directory (Mac, suggested):** `~/Desktop/Apps/Claude/Alaya Pulse Check` (or wherever the user prefers — confirm with them)

## 3. Decisions locked in during interview rounds

### Round 1 — Foundation
1. **Primary user:** Alaya internal team (employees running all-hands, pulse checks, team meetings, internal training)
2. **Top frustrations to fix vs Mentimeter:** audience caps, weak slide import, dated look
3. **Audience join method:** QR code + 6-character short code + short URL all visible on presenter screen
4. **Presenter auth:** Guest mode first (instant create), sign-up only to save/reuse decks to Firebase

### Round 2 — Features
1. **Question types at launch (priority):** MCQ, Word Cloud, Open-ended/Short answer, Rating/Scoring
2. **Slide import:** Pixel-perfect (render as images, not editable text)
3. **Audience identity:** Optional name (anonymous default; presenter can toggle "require name" per session)
4. **Visual personality:** Bold + cinematic — Aceternity/Magic UI vibe. Premium animated experience, clearly "not Mentimeter."

### Round 3 — Experience
1. **Slide import formats:** PDF (primary), images (PNG/JPG), HTML. For PowerPoint/Word, user does "Save As → PDF" first. No native .pptx parsing (would need paid converter API).
2. **Audience phone after vote:** Presenter toggles per question — default just confirms "Thanks", optionally shows live results on phones for "wow" questions
3. **Color hierarchy (Alaya brand):**
   - Midnight Sky navy `#000079` = primary brand, backgrounds, headlines
   - Hot Pink `#ff0065` = primary action (Start, Vote, Submit, big CTAs)
   - Sky Blue `#00b0ff`, Fresh Green `#42db66`, Golden Sun `#ffc709` = chart segments, question-type tags, accents (Golden Sun used sparingly)
   - White + Midnight Sky tints = surfaces
4. **Audience phone background:** Light (white) — on-brand with Alaya guidelines

### Final infra decisions
- **App name:** Alaya Pulse
- **Database:** Firestore (inside Firebase) — handles 600+ audience on free tier with "presenter-only live view" architecture pattern. Audience writes votes via HTTP (no live listeners on phones by default). Only the presenter screen subscribes to real-time updates.
- **Hosting:** Vercel (free tier, auto-deploys from GitHub)
- **Audience scale target:** 600+ free; upgrade to Firebase Blaze (~$5/month) only when consistently exceeding free tier

## 4. Tech stack

| Tool | Why | Setup status |
|---|---|---|
| React + TypeScript + Vite | Modern foundation; required for chosen component libs | Not yet scaffolded |
| Tailwind CSS | Styling system | Not yet installed |
| shadcn/ui | Component foundation (buttons, dialogs, inputs) | Not yet installed |
| Framer Motion | Animation library for React | Not yet installed |
| Magic UI (free, copy-paste from magicui.design) | Premium "wow" components | Pull components as needed |
| Aceternity UI (free, copy-paste from ui.aceternity.com) | Cinematic hero effects | Pull components as needed |
| 21st.dev Magic MCP | AI-generated custom components | User has API key; MCP not yet installed |
| pdf.js (pdfjs-dist) | Client-side PDF → image rendering for slide import | Not yet installed |
| Firebase (Firestore) | Realtime vote sync | No Firebase project created yet |
| qrcode.react | QR code generation | Not yet installed |
| @dnd-kit/sortable + @dnd-kit/core | Drag-drop slide reordering | Not yet installed |
| GSAP | NOT using initially (Framer Motion is sufficient); add later if scroll-driven cinematic moments are wanted | Skipped |

## 5. Alaya brand guidelines (from brand book)

- **Primary font:** Poppins — full family (ExtraLight, Light, Regular, Medium, SemiBold, Bold)
  - Body text: Poppins Light
  - Subheadings: Poppins Light Title Case
  - Headlines: Poppins SemiBold Uppercase
- **Logo:** "alaya" wordmark in lowercase + DNA monogram (stylised double helix in pink/blue/green/grey). Always lowercase "alaya" except first letter when starting a sentence. Never all caps. Never altered, rotated, or recoloured.
- **Photography style:** Vibrant, joyful, human (festival paint, candid moments — energetic)
- **White space:** Healthy amount — "professionalism" is a core brand value alongside distinctiveness
- **DNA monogram:** Use as visual anchor; represents Alaya's "why" — they meld into clients' DNA

## 6. Phase 1 — MVP scope (build in this order)

1. Project scaffold (Vite + React + TS + Tailwind + shadcn + Framer Motion)
2. Alaya brand tokens (colors + Poppins font) wired into Tailwind config
3. Landing page with premium hero — visitors should immediately see the visual direction
4. Audience join screen (mobile-first, light theme, anonymous by default)
5. Voting UIs for 4 question types: MCQ, Word Cloud, Open-ended, Rating
6. Live results screens with animations (word cloud popping, bars growing, ratings averaging)
7. Per-question toggle: "Show live results on audience phones"
8. Per-session toggle: "Require name"
9. Presenter create flow — drag-drop PDF, add question slides, reorder
10. Slideshow mode (full-screen, arrow keys, QR/code overlay on first slide)
11. Firestore wire-up with presenter-only-listener pattern
12. Polish + branding pass

## 7. Phase 2 — deferred (don't build yet)

- Sign-up + save decks to user's Firebase account
- Quiz mode + leaderboard
- Scales, Ranking, Q&A with upvotes (extra question types)
- Export results to CSV
- Per-deck custom branding

## 8. Current state — where we left off (2026-05-31)

### What's built and live

The app is **fully scaffolded and deployed** at **https://alaya-pulse.web.app** (Firebase Hosting).

**Hosting note:** The app is deployed on Firebase Hosting (not Vercel as originally planned — Firebase was already in use for the database so hosting was added there instead).

**Infrastructure:**
- ✅ React + TypeScript + Vite + Tailwind CSS + Framer Motion — all installed and running
- ✅ Firebase Firestore (realtime vote sync) + Firebase Hosting (deployment)
- ✅ GitHub repo connected; `firebase deploy` pushes a new live build

**Question types — all working:**
- ✅ **MCQ** — multiple choice with live bar chart results, correct-answer reveal support in schema
- ✅ **Word Cloud** — dominant word centred, other words spiral outward (Mentimeter-style), animated pop-in for new words, smooth slide for repositioned words, profanity filter, duplicate-word block per person, max-submissions enforcement
- ✅ **Open Ended / Short Answer** — audience types free text; responses appear on presenter screen
- ✅ **Rating / Scoring** — 1–5 or 1–10 scale; live average displayed

**Session flow — working end to end:**
- ✅ Presenter creates a deck (drag-drop PDF import or manual slide builder)
- ✅ Audience joins via QR code + 6-char code shown on presenter screen
- ✅ Presenter advances slides; audience votes on their phone
- ✅ Live results update on presenter screen in real time
- ✅ Timer countdown visible on presenter screen (audience phone timer — not yet built)
- ✅ Results export to CSV and PDF

**Slide types beyond questions:**
- ✅ Content slides (text + optional image)
- ✅ Canvas slides (uploaded image fills full screen)
- ✅ Transparent background option on question/content/canvas slides

**Word cloud — detailed state (most recent work, 2026-05-31):**
- `measureWord()` uses character-count formula (not `canvas.measureText` which falls back to a narrow system font)
- Dominant word (idx=0, highest count) is placed at dead-centre — no spiral — with font shrink fallback if it overflows
- Other words: Archimedean spiral from r=0, step=0.25 angular / r=0.30 radial, gap=10px
- Framer Motion + CSS `transform` conflict fixed by splitting into outer `div` (positions with left/top + translate(-50%,-50%)) and inner `motion.span` (animates scale/opacity only)
- `prevTextsRef` tracks which words existed in previous render to distinguish new vs repositioned
- Duplicate word block: `submittedWords[]` stored in sessionStorage, checked before submit
- Progress dots: flex-wrap layout, narrower dots when maxSubmissions > 7

**CSV / PDF export — recent fixes (2026-05-31):**
- Newlines in question text collapsed before CSV export (prevents broken rows in Excel/Sheets)
- PDF export: adaptive font size for long question titles; subtitle positioned below last wrapped line; MCQ table option text normalised; better column widths

### Remaining backlog (not yet built)

1. **MCQ correct answer reveal** — presenter triggers reveal that highlights the correct answer on results screen
2. **Open Ended response pinning / auto-scroll** — pin notable responses; auto-scroll as new ones arrive
3. **Rating ranked results display** — show results sorted/ranked rather than raw counts
4. **Timer countdown on audience phone** — currently countdown only visible on presenter screen

## 9. Next steps (continuing on same machine)

The project is already scaffolded and running — no setup needed. To continue:

1. Open Claude Code in `C:\Users\rabin.r_homeloanexpe\Desktop\Apps\Claude\Alaya Pulse Check`
2. Share this HANDOFF.md as the first message if starting a new session
3. Pick up the backlog items in Section 8 above

To deploy after any change:
```bash
npm run build && firebase deploy
```

## 10. Important constraints / gotchas

- **Don't use Firebase Realtime Database** — chose Firestore for connection-limit reasons
- **Don't build PowerPoint native parsing** — the "save as PDF first" workflow is intentional, agreed with user
- **Don't add Quiz mode / Scales / Ranking / Q&A yet** — Phase 2
- **Don't add GSAP initially** — Framer Motion is enough until user explicitly wants scroll-driven cinematic moments
- **Audience listening to live results is OFF by default** per question — only the presenter screen has the live Firestore listener. Audience writes votes; doesn't subscribe. This is the architectural pattern that keeps us free at 600+ users.
- **Logo:** "alaya" is always lowercase. Never alter the DNA monogram.
- **Hot Pink is the action color** — primary CTAs only. Don't overuse.
- **Light theme on audience phone**, dark/navy backgrounds on presenter screen and landing page.

## 11. Files referenced (Windows paths — recreate equivalents on Mac as needed)

- `C:\Users\rabin.r_homeloanexpe\.claude\projects\C--Users-rabin-r-homeloanexpe-Desktop-Apps-Claude-Alaya-Pulse-Check\memory\project_alaya_pulse_check.md` — project memory file (PC only)
- `C:\Users\rabin.r_homeloanexpe\.claude\projects\C--Users-rabin-r-homeloanexpe-Desktop-Apps-Claude-Alaya-Pulse-Check\memory\MEMORY.md` — memory index (PC only)
- `C:\Users\rabin.r_homeloanexpe\Desktop\Apps\Claude\Alaya Pulse Check\HANDOFF.md` — this file

---

**End of handoff.** Claude on the receiving machine: confirm you've read this, ask the user to verify the working folder path on Mac, then proceed through Section 9 step-by-step.
