# Headless balance harness

A no-renderer, AI-vs-AI match runner used to measure **balance** and **correctness**
without a browser. It runs the *real* simulation — `state`, `control`, `physics`,
`movement`, `flow`, the full Yuka AI, pass-requests, pass-weighting — and stubs only
the presentation shell (render / audio / DOM / meshes). It found and validated the
shot-on-target stats fix and the away-team shot-curl direction fix.

## Run

```bash
npm run sim            # 6 matches/scenario, 120s halves (defaults)
npm run sim -- 20 180  # 20 matches/scenario, 180s halves
```

(Or directly: `vite build -c simtest/vite.config.ts && node simtest/dist/harness.mjs [matches] [secondsPerHalf]`.)

## What it reports (per scenario, averaged)

`goals · shots · onTarget · passes · passComp% · possessionH% · saves` plus correctness
guards: `maxOOB` (ball ever out of bounds), `stuck` (dead-ball frames), `nan`, `guard`
(match failed to end). A healthy run: on-target ≤ shots, ~50% possession in mirror
matchups, no NaN/guard, maxOOB < 1.

## How it works

- `vite.config.ts` aliases the browser/render/audio/DOM modules to inline no-op stubs
  (SSR build, so the real gameplay code runs under Node).
- `harness.ts` mirrors `loop.ts`'s play/celebrate stepping with a fixed 1/60 dt, runs
  full two-half matches, and aggregates stats. It points `performance.now` at the sim
  clock so Yuka's `Regulator` AI-decision throttles fire on sim time, not wall-clock.
- `FREEZE` pins both teams to balanced mentality to isolate the away-adaptation effect.

`simtest/dist/` is a build artifact (gitignored).
