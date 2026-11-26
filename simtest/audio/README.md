# Audio verification harness

Nobody can listen inside CI, so the procedural audio engine is checked by
*measurement*: scenarios are rendered through an `OfflineAudioContext` in headless
Chromium and analysed numerically (peaks, RMS over time, band energies, partials,
L/R correlation, voice/node counts). See `docs/AUDIO_DESIGN.md` for what is
asserted and what still needs human ears.

These scripts were written against a dev server on port 5183 and a scratch output
directory — adjust the constants at the top before running:

```bash
npx vite --port 5183 --strictPort &
NODE_PATH=$(npm root -g) node simtest/audio/verify.cjs   # the 90 numeric assertions
NODE_PATH=$(npm root -g) node simtest/audio/live.cjs     # real AudioContext, console-error sweep
```

`pagelab.js` is injected into the page (render + analysis helpers); `harness.cjs`
is the small Playwright launcher they share. Not part of `npm run test`.
