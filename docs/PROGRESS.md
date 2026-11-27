# Progress — exact current state

_Last updated: session 1, continued (2026-11-27)._

## Where things are

jobendik/Strikers#21 (everything up to the idle assist) was **merged to `main`** on
2026-11-27. Work since then — settings, pitch control, tactical states, balance pass 2,
passing realism — is on branch `claude/zealous-ritchie-lvr8qi` (with `main` merged in)
in a follow-up PR. Everything below passes all gates.

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
- Milestone 3 under way: pitch-control grid driving support runs and a pass-vs-keep
  utility decision; team tactical states (build-up / attack / counter / counter-press /
  high press / mid block / low block) with a line of engagement, compact block and
  lane-denial marking — see `FOOTBALL_AI.md`.
- Balance pass 2: keeper distribution from the hands, landed headers, power-vs-accuracy
  shooting, reaction time on interceptions, realistic dive timing, team directness.
  Scoring fell from 5–8 goals per 4 minutes to ≈ 2 (≈ 3.3 per real 6-minute match) with
  83–91 % pass completion at every tier — see `PLAYTEST_REPORT.md`.
- AI shooters aim inside the post by how far the strike can stray (on-target share
  35 % → 47 %, keepers now make ≈ 3.5 saves a match); `npm run sim` has a balance guard.

The three parallel branches (`worktree-agent-*`) are fully merged; their worktrees
under `.claude/worktrees/` can be deleted.

All gates pass (latest run): typecheck, build, 214 unit tests, `npm run sim`
(+ `--physics`, all green), `npm run test:browser` (13 checks).

Integration already done: crowd colours + scoreboard names per fixture, a random
lighting/weather preset per match (`modes.configureTeams`), audio quality follows
the graphics tier, legacy `Audio.kick()`-style calls removed from the sim.

## Next actions, in order

1. **Get a human to play it** (keyboard, a real gamepad, a phone) and listen to it.
   Every "feel" judgement so far is inferred. Capture findings in `PLAYTEST_REPORT.md`.
2. **Attacking variety (AI-02):** the balance numbers now meet `QUALITY_STANDARD.md` at
   the game's real match length (2×3 min: 2.5–4.4 goals, 10–16 shots, ≈ 45–55 % on
   target, 24–34 % conversion, 83–91 % pass completion at every tier) and `npm run sim`
   fails if they drift far (balance guard). What is missing is *how* chances are made:
   60 % of shots still come from 5–15 m after a carry or a single pass. Add runs in
   behind and across the line, wall passes / third-man, overlaps, crosses to near/far
   post — and check each with `npm run sim -- 8 120 --diag --diff 1` (shot context,
   pass table, possession spells, zones), `--close`, `--gk`. Do not buy goals by
   weakening keepers or sharpening finishing.
3. **Settings UI (rest):** stick dead zone, key/pad remapping, master/commentary volume
   (camera, conditions, assistance, crowd/effects volume are done). _Old text:_ camera mode, assists (receive / tackle / idle), stick dead zone, audio
   bus volumes (`Audio.setVolume`), lighting preset choice, key/pad remapping.
4. **Milestone 3 — continue:** watch the defending and tactical states as continuous
   play (only stills and statistics so far); use pitch control for the dribble direction and
   for defensive cover; give in-possession states real differences (patient build-up
   vs direct); structured runs (overlap, third man, near/far post); per-nation
   tactical identities. Draw pass lanes + defensive assignments in the lab.
5. **Animation:** source licensed walk/jog/strafe/slide/header/keeper-set clips;
   upper-body layer; leg IK to the ball; a proper shooting clip.
6. **Milestone 5 prerequisite:** make pitch/team size per-match config (remove
   module-level reads of `CFG.halfL` etc. in `Team.spots`, `FORMATION`, `penalty.ts`,
   `rendering/layout.ts`).
7. Use `simulateMatch` for World Cup AI-v-AI fixtures; put `test:browser` in CI.

## Known issues

- No human playtest; no real-GPU or real-phone measurements; nobody has heard the audio.
- An earlier note here said the AI made too few chances. That compared 2×2-minute
  harness runs with targets written for 2×3 minutes; at the real length the volume is
  on target. Chance *variety* is the real gap (see next action 2).
- The keeper's throw has no animation (the ball simply leaves his hands); a user-controlled
  player is not made to give the keeper room (only the throw's lane check protects it).
- The scripted 11 m corner shot in `--gk` is never saved (that scenario has no wind-up
  for the keeper to anticipate) — in matches 10–15 m shots are saved 36–42 %.
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
