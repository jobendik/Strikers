# Progress — exact current state

_Last updated: session 1 (2026-11-26)._

## Where things are

Branch `claude/zealous-ritchie-lvr8qi`, draft PR jobendik/Strikers#21. Everything
below is merged there and passes all gates.

- Simulation core v2 (fixed step, seeded, physical ball, touch possession, strikes,
  tackles, keepers, locomotion), AI adapted to it.
- Snapshot presenter, animation driver, broadcast cameras, snapshot replays.
- Input: keyboard, gamepad, touch; buffered actions; event-timestamp tap/hold.
- Player rendering (kits, single-skeleton rig, indicators, ball) — `PLAYER_RENDERING.md`.
- Stadium, crowd, pitch, nets, LED boards, lighting presets, quality tiers, post
  chain — `RENDERING_DESIGN.md`.
- Procedural audio engine + crowd-emotion model — `AUDIO_DESIGN.md`.
- Dev lab overlay (F2; `G` = pitch control), `window.__strikers`, harness modes, browser checks.
- Settings: camera rig, conditions, assistance level, crowd/effects volume.
- Milestone 3 started: pitch-control grid driving support runs and a pass-vs-keep
  utility decision (`ai/pitchControl.ts`, `ai/passing.ts`) — see `FOOTBALL_AI.md`.

The three parallel branches (`worktree-agent-*`) are fully merged; their worktrees
under `.claude/worktrees/` can be deleted.

All gates pass at the end of session 1: typecheck, build, 214 unit tests, `npm run sim`
(+ `--physics`, all green), `npm run test:browser` (13 checks).

Integration already done: crowd colours + scoreboard names per fixture, a random
lighting/weather preset per match (`modes.configureTeams`), audio quality follows
the graphics tier, legacy `Audio.kick()`-style calls removed from the sim.

## Next actions, in order

1. **Get a human to play it** (keyboard, a real gamepad, a phone) and listen to it.
   Every "feel" judgement so far is inferred. Capture findings in `PLAYTEST_REPORT.md`.
2. **Balance (PLAY-03 / GK-01):** conversion is 33 % at PRO but 44–49 % at
   Legend+; ~60 % of shots come from 5–10 m; `--gk` shows a cliff between an
   unsaveable precise 11 m corner and near-certain saves from 16 m+. Next levers:
   more shots from range (AI shot selection), defenders blocking more, keeper
   reaction variance. Passing is too quick (≈ 120 passes / 4 min) — make carriers
   take players on and hold the ball. Use `--diag` and `--gk` after each change.
3. **Settings UI (rest):** stick dead zone, key/pad remapping, master/commentary volume
   (camera, conditions, assistance, crowd/effects volume are done). _Old text:_ camera mode, assists (receive / tackle / idle), stick dead zone, audio
   bus volumes (`Audio.setVolume`), lighting preset choice, key/pad remapping.
4. **Milestone 3 — continue:** pitch control now drives support and passing. Next:
   use it for defending (AI-05: cover shadows, press triggers, compactness, line
   height), for the dribble direction, and build the team tactical state machine
   (AI-06). Draw pass lanes + defensive assignments in the lab.
5. **Animation:** source licensed walk/jog/strafe/slide/header/keeper-set clips;
   upper-body layer; leg IK to the ball; a proper shooting clip.
6. **Milestone 5 prerequisite:** make pitch/team size per-match config (remove
   module-level reads of `CFG.halfL` etc. in `Team.spots`, `FORMATION`, `penalty.ts`,
   `rendering/layout.ts`).
7. Use `simulateMatch` for World Cup AI-v-AI fixtures; put `test:browser` in CI.

## Known issues

- No human playtest; no real-GPU or real-phone measurements; nobody has heard the audio.
- Finishing still too clinical at the top difficulties; passing too quick (see above).
- Idle assist (`match.assistIdle`): after 1.6 s with the controls untouched the AI plays
  the user's man until input resumes — on by default, no settings toggle yet.
- One shared face / no hair geometry on players; crowd cards look flat in close
  side-on replays; exterior of the bowl is bare.
- Gamepad verified only with a mocked pad. Under 1–2 fps software rendering a pad
  *tap* reads as a hold (it is polled per frame) — not an issue at real frame rates.
- Set pieces are quick restarts (no walls, no routines); no shielding/skill moves.
- `CFG` pitch dimensions are read at module load in a few places (blocks 7/11-a-side).
- World Cup AI-v-AI fixtures still use the statistical model in `worldcup.ts`.
- The Mixamo `.fbx` files are redistributed in the repo — the owner must confirm
  the licence allows that (see `PLAYER_RENDERING.md`).
- Invented brand/stadium names (VELOQA, BRIZZO, TELLURA, PYXEL PLAY, ZEPHRA, "The
  Meridian Bowl") have not been checked against trademark registers.

## Baseline numbers

See `PLAYTEST_REPORT.md` (baseline vs current tables) and `PERFORMANCE_BUDGET.md`.
