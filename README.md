# ⚽ Yuka Strikers — AI Soccer

A fast, mobile-first 5-a-side arcade football game for the browser. You command
the **Crimson Strikers** against **Azure United**; every other player on the
pitch is driven by game AI — steering behaviors, perception with short-term
memory, fuzzy-logic decision making, team state machines and **named,
attribute-driven players**.

- **Rendering:** [three.js](https://threejs.org)
- **Game AI:** [Yuka](https://mugen87.github.io/yuka/) (Vehicle steering,
  `StateMachine`, `MemorySystem`, `FuzzyModule`, `Regulator`)
- **Tooling:** [Vite](https://vitejs.dev) + TypeScript, deployed to GitHub Pages
- **Zero art/audio assets** — the pitch, players, ball and every sound effect are
  generated procedurally at runtime.

### What makes it fun

- ⚽ **Real aerial ball** — gravity, bounce and height, so the ball lives in 3D.
- 🌀 **Curl it** — bend shots and crosses with the joystick; clinical AI strikers
  swerve it around the keeper (a Magnus-effect spin on the ball).
- 🪁 **Chips, crosses & lobbed through-balls** — dink a rushing keeper, whip a
  cross into the box, or float one over the top.
- 🎯 **Charged shooting** — hold SHOOT to power up; a soft tap places it or chips.
- 💥 **Headers & volleys** — airborne balls must be headed, not just collected.
- 🦵 **Slide tackles** — a committed lunge with real risk/reward and fouls.
- 🤝 **Give-and-go AI** — a passed-to teammate *runs onto the ball* instead of
  waiting to be found (Simple Soccer's intended-receiver model).
- 🧤 **Diving keepers** — the goalkeeper reads your shot and flings himself at
  the corner; beat him by placing it, curling it round him or wrong-footing him,
  and watch screamers get parried out for a rebound.
- 🏃 **Off-ball runs** — team-mates spread into space instead of clumping (Yuka's
  `SeparationBehavior` group steering), so there's always a pass on.
- 🪵 **Woodwork** — rattle one off the post or bar for a heart-in-mouth near-miss.
- 🎬 **Arcade juice** — camera shake, a slow-motion goal cam and a ball trail.
- 📣 **Living stadium** — a procedural crowd that swells as you bear down on goal
  and roars for shots, saves and goals (every sound synthesised at runtime).
- 🧬 **Named squads with attributes** — pace, shooting, passing, tackling and
  composure give every player a distinct identity.
- ⏱️ **Two halves, half-time & stoppage** — added time accrues from goals and
  fouls; the second half is kicked off by the other side.
- 🥅 **Penalty shootouts** — settle a drawn knockout from the spot: best-of-five
  then sudden death, taking *and* keeping against the diving keeper.
- 🎞️ **Instant goal replays** — every goal is replayed in slow motion from a
  dramatic low camera, with a skip control.
- 🧠 **Mentality** — set your team Defensive / Balanced / Attacking; the AI
  opponent adapts to the scoreline (chases when behind, sits on a lead).
- 📊 **Match stats & Man of the Match** — possession, shots on target, tackles,
  saves and a standout-player rating at full time.
- 🎚️ **Arcade or Sim** — opt into offside and yellow/red cards when you want the
  authenticity; Arcade (default) keeps it frustration-free.

See [`docs/ai-architecture.md`](docs/ai-architecture.md) for how each feature
maps back to the source engines in [`docs/inspiration.md`](docs/inspiration.md).

> Architecture inspired by Mat Buckland's *Programming Game AI by Example*
> (ch. 4, "Simple Soccer") and the Yuka "kickoff" demo. See
> [`docs/ai-architecture.md`](docs/ai-architecture.md) for a full evaluation of
> the AI techniques against the source material in
> [`docs/inspiration.md`](docs/inspiration.md).

## Play

| Action | Touch | Keyboard |
| --- | --- | --- |
| Move | Left joystick | `WASD` / Arrows |
| Shoot (hold = power, tap = place/chip, lean stick = curl) | ⚽ button | `K` |
| Pass (hold = loft/cross) | ➤ button | `J` |
| Through-ball | ➤ while flicking joystick forward | `J` + forward |
| Slide tackle / header (off the ball) | ⚽ button | `K` |
| Sprint | » button | `Shift` |
| Switch player | ⇄ button | `Space` |
| Pause | ⏸ button | `Esc` / `P` |
| Penalty (take) | aim joystick + ⚽ | aim + `K` |
| Penalty (keep) | pick a corner + ⚽ | side + `K` |

**Tip:** when the keeper rushes out, a *soft tap* of SHOOT dinks the ball over
him. Hold SHOOT to wind up a screamer.

Best played in **landscape** on a phone — it's installable as a PWA.

### Modes & options

- **Match type** — *Friendly* (a draw ends level) or *Knockout* (a draw is
  settled by a penalty shootout).
- **Rules** — *Arcade* (default) or *Sim* (offside + yellow/red cards).
- **Mentality** — Defensive / Balanced / Attacking for your team.
- **Difficulty** — Easy / Pro / Legend, and a 2/3/5-minute half length.

### Settings & accessibility

A **Settings** panel (and a **How to play** overlay) on the start menu cover
haptics on/off, a **Graphics** tier (LITE turns off replays and lowers
resolution for weaker phones) and a **left-handed layout** that swaps the
joystick and button pad. A **tactical radar** minimap shows the shape of the
game. Every choice is saved to `localStorage` between sessions.

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
│   ├── players.ts         # named squads + per-player attributes (Openfoot/open-football)
│   └── types.ts           # shared types (roles, formation, input, attributes, …)
├── core/
│   ├── math.ts            # V3, clamp, lerp, rand, distSq, headingVec
│   ├── time.ts            # shared simulation clock (delta + elapsed)
│   ├── audio.ts           # procedural Web Audio engine
│   ├── haptics.ts         # Vibration API feedback for mobile
│   └── settings.ts        # persistent prefs (sound/haptics/quality/layout/options)
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
│   ├── aerial.ts          # 3D ball helpers: lob launch, header detection (Notblox)
│   ├── control.ts         # possession, kicks, lobs, headers, slide tackles, fouls
│   ├── physics.ts         # 3D ball integration (gravity + bounce), bounds, set-pieces
│   ├── movement.ts        # player integration, slides, stamina, collisions, switching
│   ├── humanActions.ts    # user shoot/chip · pass/cross/through-ball · slide/header
│   ├── flow.ts            # scoring, halves/half-time/stoppage, MOTM, pause, kickoff
│   ├── penalty.ts         # penalty shootout mini-game (take + keep vs diving keeper)
│   ├── replay.ts          # goal replay ring buffer + dramatic playback
│   ├── rules.ts           # opt-in Sim rules: offside + yellow/red cards
│   ├── render.ts          # mesh + camera sync
│   ├── input.ts           # joystick, buttons, keyboard
│   └── loop.ts            # the main RAF simulation loop
└── ui/
    ├── hud.ts             # scoreboard, toast, overlays, shootout board
    └── radar.ts           # tactical minimap
```

The original single-file prototype is preserved at
[`reference/original-yuka-strikers.html`](reference/original-yuka-strikers.html).

## License

MIT
