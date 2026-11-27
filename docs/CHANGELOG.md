# Changelog (next-gen program)

## Unreleased — Milestone 1 in progress

### Simulation
- Fixed 120 Hz deterministic simulation shared by game and harness; seeded RNG.
- Ball physics v2 (drag, 3-axis spin/Magnus, spin-coupled bounce, rolling model,
  sub-stepped frame collisions, nets, dead-ball beat before restarts).
- Possession v2: touch dribbling, first-touch model, wind-up strikes resolved at
  contact, aim solver, geometric tackles and slides, fouls.
- Goalkeepers rebuilt (positioning, reaction/anticipation, finite dives, outcomes).
- Locomotion body model with derived athletic profiles; AI no longer gets speed
  from difficulty.
- Real proportions: 6.4 × 2.44 m goals, real running speeds, 0.18 m ball.
- Stats: xG, pass completion, interceptions, shot log, distance covered.

### Presentation
- Per-nation kits, single-skeleton welded rig, skin/hair/boot variety, numbers,
  new selection + pass-call indicators, new ball.
- Snapshot interpolation; animation as a pure function of snapshots.
- Tele-broadcast camera with predictive framing and four modes.
- Replays rebuilt on recorded snapshots (animated, two angles).
- Event bus feedback module (toasts, haptics, camera kicks, captions).

### Input
- Gamepad support; finesse, chip, through-ball, lobbed through, jockey,
  directional switching; buffered first-time actions; desktop key hints.

### Assists
- Assisted receiving, auto standing tackle, idle assist (AI plays the user's man
  while the controls are untouched).

### Tooling
- `npm run test:browser`: scripted gameplay checks in headless Chromium.
- Development lab overlay (F2 / `?lab`).
- Seeded harness with determinism check; `--physics`, `--gk`, `--diag` modes.
- `window.__strikers` dev/test API.

### Changed behaviour to be aware of
- The old automatic "pressure timer" dispossession is gone; winning the ball takes
  a tackle (auto-tackle assist is on by default) or a loose touch.
- Out-of-play no longer teleports the ball instantly; there is a short dead-ball beat.
- Matches are lower scoring.
