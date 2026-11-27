# Strikers '26 — working notes for Claude Code sessions

This repository is in the middle of a multi-session program to turn the game into a
next-generation browser football game. **Start every session by reading
`docs/PROGRESS.md`** (exact current state + the next action), then
`docs/MASTER_PLAN.md` (milestones and requirement IDs).

## Gates (all must pass before pushing)

```bash
npm run typecheck
npm run build
npm run test                 # 156+ unit tests (progression/economy/save migration)
npm run sim                  # headless AI-vs-AI balance run + determinism check
npm run sim -- --physics     # ball-model / aim-solver self-tests
npm run sim -- --gk          # keeper save-rate scenarios (read the table, no pass/fail)
npm run sim -- 6 120 --diag  # event diagnostics for tuning (--diff 0..4 picks the tier, --close traces point-blank chances)
```

## Rules of the codebase

- **The simulation is deterministic and fixed-step.** One tick = `SIM_DT` (1/120 s),
  advanced only by `stepSimulation()` (`src/game/step.ts`) — shared by the game loop
  and the headless harness. Never feed it a frame delta.
- **Sim code never touches audio / DOM / rendering.** It emits typed events on
  `src/core/bus.ts` and updates `pulse`. Presentation subscribes
  (`src/presentation/feedback.ts`, `src/core/audio.ts`, stadium, camera).
- **Random numbers in the sim come from `src/core/rng.ts`** (`rng`, `chance`, `rand`
  from `core/math`). Presentation uses `Math.random()`. Mixing them breaks
  determinism (the harness checks it).
- **The ball is never attached to a player.** Possession = `match.controlPlayer` keeps
  touching a free ball (`control.updateDribble`). Every kick goes through
  `requestKick` → wind-up → `strike` at contact.
- **Rendering reads snapshots, not the sim** (`src/game/snapshot.ts` →
  `render.applyView`). Replays feed the same presenter.
- Difficulty changes AI *decision quality* (`DIFF` in `config/constants.ts`), never
  running speed or duel odds.
- World units are metres. Home (user) team attacks +X. The broadcast camera is on +Z.
- Player saves are versioned and migration-safe (`src/core/playerData.ts`) — do not
  break them; no monetisation, no dark patterns (see `retention.md`).

## Looking at the game

No GPU in the cloud sandbox: Chromium runs SwiftShader (~1–2 fps). Use the dev API
and step the sim manually instead of waiting on wall-clock time:

```js
// Playwright, after the page loads and window.__strikers exists
document.getElementById('btnIntroGo')?.click(); document.getElementById('btnPlay').click();
__strikers.loop.manual = true;      // the loop renders but does not advance the sim
__strikers.run(2.5);                // advance 2.5 simulated seconds deterministically
__strikers.summary();               // state for assertions
window.__camOverride = { pos:[x,y,z], look:[x,y,z], fov:30 };  // pin the camera
```

Launch flags: `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`.
Frame-rate numbers measured here are meaningless; use `__strikers.renderInfo()`
(draw calls / triangles) and say plainly that real-GPU timing is unverified.

## Honesty rules for this program

Do not mark a requirement done because code exists — it needs verification evidence
in `docs/MASTER_PLAN.md`. Distinguish automated evidence, AI observation of
screenshots, and human playtesting (none has happened yet — say so).
