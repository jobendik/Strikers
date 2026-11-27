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

### Football intelligence
- Pitch-control model (arrival times, control field, threat field) driving off-ball
  support runs and a pass-vs-keep utility decision; carriers take defenders on.
- Team tactical states with a line of engagement, second presser, compact
  ball-oriented block, lane-denial marking and counter-attacks.
- Dev lab: pitch-control field, live decision utilities, team tactic.
- Team directness: a spell of possession that goes nowhere turns more direct
  (forward passes, shooting); carriers move the ball before a closing defender arrives.

### Balance pass 2 (found with new `--diag` tables)
- Keeper distributes from his hands (throw to an open team-mate, else a punt);
  opponents give him ten metres. Previously he put it at his feet and a forward a
  metre away scored — about half of all goals.
- Headers are headed down to land (no more 60-header rallies); unpressured players
  bring the ball down; headers at goal only from close in.
- Shot power costs accuracy for user and AI; AI places close finishes.
- A freshly struck ball cannot be reacted to for a tenth of a second (only body
  contact stops it) — passes can be slipped past a closing defender.
- Keeper dive takes a realistic time to full stretch; spread stance is not a wall;
  fingertip saves deflect more; high balls are taken standing.
- Shot/pass execution noise compressed across difficulty tiers; dead knobs removed.
- Harness: `--diag --diff N`, per-distance shot context (marking, keeper position,
  outcome), pass outcomes by kind/length/pressure, possession zones, `--close`.

### Settings
- Camera rig, match conditions, assistance level, crowd/effects volume.

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
