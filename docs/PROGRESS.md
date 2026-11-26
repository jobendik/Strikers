# Progress — exact current state

_Last updated: session 1 (2026-11-26)._

## Where things are

Branch `claude/zealous-ritchie-lvr8qi`, draft PR jobendik/Strikers#21.

**Merged and passing all gates:** simulation core v2, AI adaptation, snapshot
presenter/animation/camera/replay, input (gamepad etc.), player kits/rig, program docs.

**Parallel branches not merged yet** (git worktrees under `.claude/worktrees/`,
branches `worktree-agent-*`; each owns disjoint files):

| Branch | Owns | State at last check |
| --- | --- | --- |
| `worktree-agent-a88ee1f3d8ae17d15` | `rendering/{scene,stadium,pitch*,…}.ts`, quality tiers, `docs/RENDERING_DESIGN.md` | WIP: bowl, crowd, pitch, nets, sky, post chain written; wiring `stadium.ts` in progress |
| `worktree-agent-a35111c9c2a84c83f` | `core/audio.ts`, `src/audio/*`, `docs/AUDIO_DESIGN.md` | Engine + crowd model committed; verification, tests and doc in progress |
| `worktree-agent-a69471a86ed6dec24` | player rendering | **Merged** (incl. `docs/PLAYER_RENDERING.md`) |

If those branches still exist when you read this: check `git log` on each, run its
gates, then `git merge` into the work branch (conflicts are only expected in
`simtest/vite.config.ts` stub strings, `src/core/settings.ts`, `index.html`).

## Integration to do right after merging

- **Audio:** delete nothing — the sim no longer calls legacy `Audio.kick()` etc.
  Confirm `Audio.update(dt)` is called (it is, in `loop.ts`) and that the bus
  subscriptions fire in a live match; wire any new volume/quality API into Settings.
- **Stadium:** call `setCrowdColors(home, away)` in `modes.configureTeams`; pick an
  environment preset per match (or expose it in the menu); check the gameplay
  camera (`camera.ts` RIGS) is not occluded; make sure `renderFrame()` owns the
  post chain; confirm the lite tier still disables replays.
- Re-take the browser smoke screenshots (`scratchpad/pw/smoke.cjs` pattern in
  CLAUDE.md) and update `QUALITY_STANDARD.md`.

## Next actions, in order

1. Merge + integrate the two remaining branches (above).
2. **Balance pass (PLAY-03 / GK-01):** conversion ≈ 50 % → 25–30 %. Levers already
   identified: too many shots from < 10 m (cover/second-defender behaviour, keeper
   smother), keeper outcome curve too binary by distance (`npm run sim -- --gk`),
   difficulty should not raise both sides' scoring. Use `--diag` (shots by
   distance) and `--gk` after each change.
3. **Human-control verification:** a Playwright script that plays as the user
   (dribble, turn, pass to a team-mate, through-ball, tackle) and asserts
   outcomes; verify gamepad code with a mocked `navigator.getGamepads`.
4. **Animation calibration:** frame-step the kick and dive clips against the ball
   (`__strikers.step(1)` + close camera) and fix `CLIP_CAL` in `playerAnim.ts`.
5. **Dev lab overlay (TOOL-02):** trajectory, intents, passing candidates.
6. Settings UI for camera mode, assists, dead zone; remove the stale `animState`
   field; update README controls table.
7. Then Milestone 3 (team intelligence) — start with a pitch-control grid.

## Known issues

- Conversion and close-range chances too high (see above).
- `README.md` still describes the old controls and the old physics.
- Old stadium (TV-static crowd, near-side stand intruding at the bottom of the
  frame) is still what this branch renders until the stadium branch is merged.
- Gamepad code has never run against a real or mocked pad.
- `CFG` pitch dimensions are read at module load in a few places (blocks 7/11-a-side).
- Penalty shoot-out was ported to the new physics but only type-checked, not played.
- World Cup AI-v-AI fixtures still use the statistical model in `worldcup.ts`
  (could now use `simulateMatch`).

## Baseline numbers

See `PLAYTEST_REPORT.md` (baseline vs current tables) and `PERFORMANCE_BUDGET.md`.
