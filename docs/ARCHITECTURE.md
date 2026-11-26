# Architecture

```
            input (touch · keyboard · gamepad)            src/game/input.ts
                          │  intents
                          ▼
   humanActions.ts ──► requestKick / startTackle / …      (decides what a button means)
                          │
┌─────────────────────────▼──────────────────────────────────────────────────┐
│ SIMULATION  (deterministic, fixed 120 Hz, seeded)        src/game/step.ts  │
│                                                                            │
│  flow.ts      clock, halves, goals, kick-offs            rules.ts  offside/cards │
│  control.ts   possession, dribble touches, first touch, strikes, tackles,  │
│               keeper contact, distribution                                 │
│  movement.ts  locomotion body model, body contact, user-player selection   │
│  physics.ts   ball integrator, goal frame, nets, laws of the game, restarts│
│  predict.ts   look-ahead ball trajectory, interception solver              │
│  penalty.ts   shoot-out mini-game                                          │
│  ai/*         Team roles · player FSM (Yuka) · carrier decisions (fuzzy +  │
│               xG) · goalkeeper brain · perception/memory · pass requests   │
│  entities/*   Player (Yuka Vehicle: FSM + memory) · Team · Ball            │
│  config/*     CFG constants · DIFF · squads · derived athletic profiles    │
└──────────────┬───────────────────────────────┬─────────────────────────────┘
               │ typed events + pulse          │ snapshot per tick
               ▼  src/core/bus.ts              ▼  src/game/snapshot.ts
   audio (core/audio.ts, src/audio/*)     render.ts  applyView(snapshot)
   feedback.ts (toasts, haptics, shake)     ├─ playerAnim.ts  pose = f(snapshot)
   stadium (crowd, nets, boards)            ├─ camera.ts      broadcast rigs
   commentary captions                      └─ replay.ts      snapshot ring → same presenter
                                                 │
                                                 ▼ rendering/* (three.js scene, stadium, pitch, players)
```

## The three boundaries

| Boundary | Rule | Why |
| --- | --- | --- |
| input → sim | Handlers call action functions between ticks; actions are *requests* (a kick is queued, wound up, then resolved at contact). | Buffering, first-time play, fair AI/human parity. |
| sim → presentation | Events (`bus.emit`) + `pulse` + snapshots. Sim never imports audio/DOM/render for behaviour. | Headless harness runs the identical sim; determinism; any new presentation system gets an honest feed. |
| presentation → sim | None, except `match.holdKickoff` (a replay is on screen) and UI flow calls (start/pause/half-time). | Presentation cannot change outcomes. |

## Time

`loop.ts` accumulates real time × `match.timeScale` and runs whole ticks of
`SIM_DT`; the remainder is the interpolation alpha passed to `presentLive`.
Slow-motion fills the accumulator slower — steps never change size. The harness
calls the same `stepSimulation` in a tight loop (~500× real time).

## Determinism

`core/rng.ts` (sfc32) is seeded in `startMatch(seed)`. Everything random inside
the sim draws from it; regulators are sim-time (`SimRegulator`). The harness
asserts that the same seed gives an identical final-state hash and that a
different seed does not. Human input is not recorded yet, so live matches are not
re-simulable — replays use recorded snapshots instead (see REPLAY in
`MASTER_PLAN.md`).

## Legacy that remains

- `flow.ts` / `penalty.ts` still call HUD/menu functions directly for screen flow
  (stubbed in the harness build). Gameplay feedback from them is on the bus.
- `simtest/vite.config.ts` replaces rendering/DOM modules with inline stubs for
  the headless build — extend the stub strings when sim code imports a new export
  from a stubbed module.
- `ui/*`, `game/{rewards,quests,season,…}.ts`, `core/playerData.ts` (progression,
  economy, saves) are untouched by this program so far.

## Dev/test API

`window.__strikers` (`src/dev/api.ts`): live `match`/`ball`, `step(n)`/`run(s)`
for deterministic stepping with `loop.manual = true`, `bus`, `trajectory()`,
`renderInfo()`, `summary()`, replay and camera controls.
