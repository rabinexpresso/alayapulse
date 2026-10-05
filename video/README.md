# Walkthrough video (User Guide)

The video on `/guide` (`public/alaya-pulse-tutorial.mp4`) is built from short scene clips, so a new feature only needs its own scene recorded — not the whole video.

```
video/
  clips/                 one .webm per scene, joined in name order (s01-intro … s24-outro)
  assets/demo-deck.html  the sample HTML slides imported in the video
  assets/test-demo.csv   the 5 sample self-paced test questions
  assets/music.m4a       background music (looped to fit by the build)
  record-tutorial.mjs    records every scene on the LIVE site (captions + cursor dot included)
  build-video.mjs        joins the clips, adds the music, prints each scene's start time
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
