# ⚽ Yuka Strikers — AI Soccer

A fast, mobile-first 5-a-side arcade football game for the browser. You command
the **Crimson Strikers** against **Azure United**; every other player on the
pitch is driven by game AI — steering behaviors, perception with short-term
memory, fuzzy-logic decision making and team state machines.

- **Rendering:** [three.js](https://threejs.org)
- **Game AI:** [Yuka](https://mugen87.github.io/yuka/) (Vehicle steering,
  `StateMachine`, `MemorySystem`, `FuzzyModule`, `Regulator`)
- **Tooling:** [Vite](https://vitejs.dev) + TypeScript, deployed to GitHub Pages
- **Zero art/audio assets** — the pitch, players, ball and every sound effect are
  generated procedurally at runtime.

> Architecture inspired by Mat Buckland's *Programming Game AI by Example*
> (ch. 4, "Simple Soccer") and the Yuka "kickoff" demo. See
> [`docs/ai-architecture.md`](docs/ai-architecture.md) for a full evaluation of
> the AI techniques against the source material in
> [`docs/inspiration.md`](docs/inspiration.md).

## Play

| Action | Touch | Keyboard |
| --- | --- | --- |
| Move | Left joystick | `WASD` / Arrows |
| Shoot | ⚽ button | `K` |
| Pass | ➤ button | `J` |
| Sprint | » button | `Shift` |
| Switch player | ⇄ button | `Space` |

Best played in **landscape** on a phone — it's installable as a PWA.

## Develop

```bash
npm install
npm run dev        # start the Vite dev server (http://localhost:5173)
npm run build      # typecheck + production build into dist/
npm run preview    # preview the production build locally
npm run typecheck  # tsc --noEmit only
```

## Deploy (GitHub Pages)

A GitHub Actions workflow (`.github/workflows/deploy.yml`) builds the project and
publishes `dist/` to GitHub Pages on every push to `main` (and to the active
feature branch). To enable it once:

1. In the repository **Settings → Pages**, set **Source** to **GitHub Actions**.
2. Push to a tracked branch — the workflow builds and deploys automatically.

The Vite `base` is derived from the repository name at build time
(`BASE_PATH=/<repo>/`), so the site is served correctly from
`https://<owner>.github.io/<repo>/`. For local builds the default base is
`/strikers/`; override with `BASE_PATH=/ npm run build` to build for the site
root.

## Project structure

```
src/
├── main.ts                # bootstrap: build stadium, create state, wire UI, start loop
├── style.css              # all UI styling (extracted from the monolith)
├── config/
│   ├── constants.ts       # CFG, DIFF, FORMATION — single source of balance truth
│   └── types.ts           # shared types (roles, formation, input, …)
├── core/
│   ├── math.ts            # V3, clamp, lerp, rand, distSq, headingVec
│   ├── time.ts            # shared simulation clock (delta + elapsed)
│   ├── audio.ts           # procedural Web Audio engine
│   └── haptics.ts         # Vibration API feedback for mobile
├── rendering/
│   ├── scene.ts           # renderer, scene, camera, lights, world group
│   ├── pitchTexture.ts    # canvas-painted pitch markings
│   ├── stadium.ts         # pitch, stands, floodlights, goals, ad boards
│   └── meshes.ts          # player + ball meshes
├── entities/
│   ├── Ball.ts            # Yuka MovingEntity + constant-deceleration model
│   ├── Player.ts          # Yuka Vehicle: steering + memory + FSM
│   └── Team.ts            # role assignment, support spots, marking
├── ai/
│   ├── analysis.ts        # pass safety, canShoot, lead passes (Buckland math)
│   ├── perception.ts      # vision cone + short-term memory (Yuka MemorySystem)
│   ├── fuzzy.ts           # fuzzy shoot/pass arbitration (Yuka FuzzyModule)
│   ├── states.ts          # player states (Yuka State subclasses)
│   ├── carrier.ts         # ball-carrier brain
│   └── goalkeeper.ts      # goalkeeper brain
├── game/
│   ├── state.ts           # shared singletons (ball, teams, match) + helpers
│   ├── control.ts         # possession, kicks, pressure, fouls
│   ├── physics.ts         # ball integration, bounds, set-pieces
│   ├── movement.ts        # player integration, stamina, collisions, switching
│   ├── humanActions.ts    # user shoot / pass / switch
│   ├── flow.ts            # scoring, kickoff, full-time
│   ├── render.ts          # mesh + camera sync
│   ├── input.ts           # joystick, buttons, keyboard
│   └── loop.ts            # the main RAF simulation loop
└── ui/
    └── hud.ts             # scoreboard, toast, overlays, menu wiring
```

The original single-file prototype is preserved at
[`reference/original-yuka-strikers.html`](reference/original-yuka-strikers.html).

## License

MIT
