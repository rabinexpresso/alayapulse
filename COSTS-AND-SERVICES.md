# Alaya Pulse — Services, Costs & Limits

A plain-English reference for what each service does, what's free, and what it costs if limits are exceeded.

---

## How the app is split across services

The app is not one thing in one place. It uses 4 separate services, each doing a specific job:

| Service | Job | Cost model |
|---|---|---|
| **Firebase Hosting** | Delivers the app (HTML/JS/CSS) to people's browsers when they visit the URL | Free up to 360 MB/day downloads. Pay per GB beyond that. |
| **Firestore** | The live database — stores decks, questions, votes, results, session data | Free up to daily read/write limits + 1 GB total stored. Pay per unit beyond. |
| **Firebase Auth** | Handles Google sign-in. Confirms who you are so your decks stay private | Always free. No limits. |
| **Cloudinary** | Stores the slide images when you import a PDF (Firestore can't hold large images) | Free up to 25 GB. Big jump to paid after. |

---

## What gets stored where

- **PDF slides** → images saved to Cloudinary. Only a short web link (URL) saved to Firestore.
- **HTML slides** → the HTML code saved to Firestore. Smart deduplication — if a file has 30 pages, the HTML is only stored once, not 30 times.
- **Question slides** (MCQ, Word Cloud, Rating, Open-ended) → saved to Firestore as plain text/numbers. Very small.
- **Votes during a live session** → each vote is one small record written to Firestore.
- **Session results** → saved to a separate Firestore document from the deck, so each gets its own storage space.
- **Your Google account info** → handled entirely by Firebase Auth. Not stored in Firestore.

### The 1 MB Firestore document limit
Firestore has a hard technical rule: **no single document can exceed 1 MB**. This is not a billing thing — it applies on both free and paid plans and cannot be bypassed by paying more. The app is already built to work around this:
- PDF images go to Cloudinary (not Firestore) so deck documents stay tiny
- Results are stored in a separate document from the deck
- HTML slides are deduplicated so a 30-page file doesn't multiply the storage
- If results are still too large (e.g. 600 people all write long answers), the app automatically trims — drops individual responses but keeps totals and averages

---

## Free limits and costs if exceeded

### Firebase Hosting (app delivery)
- **Free:** 10 GB stored, **360 MB/day** downloaded by visitors
- **Cost beyond free:** $0.15 per GB downloaded
- **Alaya reality:** measured from a real production build, the app is **~460 KB gzipped** on first load (the PDF and Excel export libraries only download if someone uses those features). So 600 people joining = **~276 MB** — still inside the free limit. The free tier covers roughly **780 visitors per day**.
- **Risk level:** the most likely line item to exceed, but only on a very big day. Beyond the limit it's $0.15/GB — cents, not dollars.

### Firestore — Writes
- **Free:** 20,000 writes per day
- **Cost beyond free:** $0.18 per 100,000 writes
- **Alaya reality:** 600 people × 10 questions = 6,000 writes per session. Free limit covers ~3 big sessions per day. If exceeded: **~$0.01 per session**
- **Risk level:** Possible on heavy event days. Negligible cost.

### Firestore — Reads
- **Free:** 50,000 reads per day
- **Cost beyond free:** $0.06 per 100,000 reads
- **Alaya reality:** Presenter screen reads data continuously during a session. Even 1 million reads in a month = **$0.60**
- **Risk level:** Unlikely to notice. Tiny cost even if exceeded.

### Firestore — Storage (total data stored)
- **Free:** 1 GB total across all documents
- **Cost beyond free:** $0.108 per GB per month
- **Alaya reality:** One deck ≈ 20–50 KB. 1 GB = space for roughly 20,000–50,000 decks. Would take years of heavy use to reach.
- **Risk level:** Practically never.

### Firebase Auth
- **Free:** Unlimited users, unlimited sign-ins
- **Cost:** Always $0
- **Risk level:** None.

### Cloudinary (PDF slide images)
- **Free:** 25 GB storage + 25 GB bandwidth per month
- **Cost beyond free:** Jumps to $89/month — the steepest increase of any service
- **Alaya reality:** Each PDF page becomes one image (~100–300 KB). A 20-page PDF = ~4 MB. You'd need to upload thousands of PDFs to approach 25 GB.
- **Risk level:** Low for now. Worth monitoring if PDF uploads become very frequent. If it ever becomes an issue, the fix is to delete old unused decks.

---

## Likelihood of costs — ranked

1. **Hosting bandwidth** — most likely to exceed on big event days. Cost: cents per event.
2. **Firestore writes** — possible if running multiple large sessions in one day. Cost: cents per session.
3. **Cloudinary** — only if many large PDFs uploaded over a long time. Jump to $89/month is the one to watch.
4. **Firestore reads** — unlikely. Tiny cost even if hit.
5. **Firestore storage** — practically never for Alaya's scale.
6. **Firebase Auth** — always free.

---

## When to upgrade to Firebase Blaze plan

The Blaze plan is pay-as-you-go. You keep all the same free limits — you only pay for what goes above them. You just need to add a credit card.

**Upgrade before going live with real audiences.** Without Blaze, if you hit a daily limit mid-session, votes silently fail to save. With Blaze, it just costs a few cents and everything keeps working.

**Setting a spending alert** (e.g. email me if monthly spend exceeds $10) takes 2 minutes in the Firebase console and means zero surprises.

---

## Staying on Firebase Hosting vs switching to Vercel

| | Firebase Hosting | Vercel |
|---|---|---|
| Bandwidth limit | 360 MB/day free, then $0.15/GB | No limit, always free |
| Setup | Already deployed | ~5 minutes, connect GitHub |
| Auto-deploy from GitHub | Yes | Yes |
| Custom domain | Yes (free) | Yes (free) |
| URL | alaya-pulse.web.app | alayapulse.vercel.app (or custom domain) |

Firebase Hosting is fine for now — costs are tiny even when limits are exceeded. Vercel removes the hosting cost entirely and is worth switching to before going public.

---

*Last updated: May 2026*
