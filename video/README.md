# Walkthrough video (User Guide)

The video on `/guide` (`public/alaya-pulse-tutorial.mp4`) is built from short scene clips, so a new feature only needs its own scene recorded — not the whole video.

```
video/
  clips/                 one .webm per scene, joined in name order (s01-intro … s24-outro)
  clips/captions.json    every caption and when it appears in its clip (written by the recorder)
  assets/demo-deck.html  the sample HTML slides imported in the video
  assets/test-demo.csv   the 6 sample self-paced test questions (5 multiple choice, 1 written)
  assets/survey-demo.csv the 4 sample survey questions
  assets/music.m4a       background music (looped to fit by the build)
  record-tutorial.mjs    records every scene on the LIVE site (captions + cursor dot included)
  build-video.mjs        joins the clips, adds the music and the narrator, prints each scene's start time
  voice.mjs              the narrator: Google Text-to-Speech reads each caption aloud
  voice/                 the narrator's saved lines (one .mp3 per caption)
```

## Adding a scene for a new feature

1. Add a `scene(page, 'sNNx-name', …)` block to `record-tutorial.mjs`. Name it so it sorts into the right place — e.g. `s16b-new-thing` lands between `s16` and `s17`.
2. Record. Every scene's clip is rewritten each run, so to record only the new one, comment out the others (the deck/show set-up they depend on still has to run).
3. `node video/build-video.mjs` — rebuilds the video and prints every scene's start time.
4. In `src/pages/Guide.tsx`, update each topic's `videoAt` from those times, and the "Full walkthrough — N min N sec" line.
5. Build, deploy, commit (including the new clip).

If a feature changes screens that older scenes show (a renamed button, a new window), re-record those scenes too.

## Notes

- Run both scripts from the project root: `node video/record-tutorial.mjs`, then `node video/build-video.mjs`.
- Recording uses the live site and creates a throwaway practice session with 9 simulated colleagues (via the Firebase SDK and `.env`).
- Captions stay on screen for at least `1.3 s + 58 ms per character`, so they're easy to read.

## The narrator

- The build reads every caption aloud as it appears and dips the music under the voice. `NARRATOR=off node video/build-video.mjs` builds without it.
- The voice is Google's `en-AU-Chirp3-HD-Charon` (Australian man), made with Text-to-Speech in the `alaya-pulse` Google Cloud project. It signs in with the Firebase CLI login used for deploying (`npx firebase-tools login --reauth` if it has run out). A few thousand characters per build, well inside Google's free monthly allowance.
- Lines are saved in `voice/`, so only new or changed captions go to Google. Bump `STYLE` in `voice.mjs` to remake them all.
- Pronunciation fixes are in `voice.mjs`: "deck" is given a more open vowel (in this Australian voice it otherwise sounds like "dick"), and "Esc" is said as "Escape".
- Questions should go up at the end. The voice doesn't always do that, so each question is read a few times, the reading that climbs most is kept, and if none climb enough its last word is lifted.
- If a line would run into the next caption, the build speeds it up slightly (at most 15%) and says so.
