# ⚽ Strikers '26 — World Soccer Championship

A 5-a-side football game for the browser, themed around the **World Championship
2026**, in the middle of a program to become a genuinely next-generation browser
football game (see [`docs/VISION.md`](docs/VISION.md) and
[`docs/PROGRESS.md`](docs/PROGRESS.md)).

- **Simulation:** deterministic, fixed 120 Hz, seeded — the same code runs in the
  browser and in the headless harness (~500× real time).
- **Ball:** a free physical body at all times — drag, 3-axis spin with Magnus
  swerve, spin-coupled bounces, woodwork, nets. Nobody "has" the ball; a dribbler
  keeps it by touching it.
- **Players:** real proportions and speeds; acceleration, agility, strength and
  touch derived from each player's ratings; wind-up strikes resolved at contact;
  timed tackles; keepers who position, read, dive, parry, tip and smother.
- **AI:** [Yuka](https://mugen87.github.io/yuka/) state machines, perception and
  fuzzy logic, plus xG-based shooting, interception prediction and a covering
  defender. Difficulty changes how well the AI thinks — never how fast it runs.
- **Presentation:** [three.js](https://threejs.org); per-nation kits; a stadium
  bowl with a 17 000-strong instanced crowd in both teams' colours, LED boards,
  cloth goal nets, five lighting/weather presets, four graphics tiers; tele
  broadcast cameras; animated multi-angle replays from recorded play.
- **Audio:** fully procedural (no audio files): boot, woodwork, net, whistle and a
  crowd driven by an emotion model of the match.
- **Tooling:** Vite + TypeScript; seeded balance harness with physics self-tests
  and keeper scenarios; scripted browser gameplay checks; an in-game dev lab (F2).
- **Zero downloaded art/audio assets** apart from one Mixamo character rig and
  seven clips (see [`docs/PLAYER_RENDERING.md`](docs/PLAYER_RENDERING.md) for the
  licence note). Progression is all earned in-game — no real money, no tracking.

> Status: nobody has human-playtested the rebuilt game yet. Everything claimed in
> the docs is backed by automated runs or screenshots, and says which.

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
- 📣 **Pass calls** — open teammates actively signal safe lanes with a glowing
  run cue; tap PASS with no strong aim to hit the player asking for it.
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
- 🏆 **World Cup 2026 + 16 nations** — pick your nation and win a tournament that
  mirrors the real format (4 groups → QF → SF → Final, mapped to real matchdays);
  the sim resolves the rest of the field. A drawn knockout tie goes to penalties.
- ⚡ **Knock-on burst** — double-tap sprint to push the ball into space and
  explode past a defender.
- 🚩 **Corners** — a defender's touch over his own byline is a corner, not a let-off.
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

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Move | `WASD` / arrows | left stick | joystick |
| Sprint (double-tap = knock-on) | `Shift` | RT | » |
| Pass · hold = lofted / cross · off the ball = tackle | `J` | A | ➤ |
| Shoot · hold = power + height · off the ball = slide / header | `K` | B | ⚽ |
| Finesse shot (curled) | `I` | X or RB + B | — |
| Chip | `O` | LB + B | soft tap when the keeper is out |
| Through-ball · hold = lobbed | `L` | Y | — |
| Jockey | `C` / `Ctrl` | LT | — |
| Switch player (toward the stick) | `Space` | LB / right stick | ⇄ |
| Camera mode | `V` | Back | — |
| Pause | `Esc` / `P` | Start | ⏸ |
| Dev lab overlay | `F2` | — | — |

The stick aims: which side of the goal a shot goes, who a pass is for, where a
first touch takes the ball. An action pressed just before the ball arrives is
played first-time. See [`docs/GAMEPLAY_DESIGN.md`](docs/GAMEPLAY_DESIGN.md).

**Tip:** when the keeper rushes out, a *soft tap* of SHOOT dinks the ball over
him. Hold SHOOT to wind up a screamer.

Best played in **landscape** on a phone — it's installable as a PWA.

### Modes & options

- **Your nation** — pick one of **16 national teams**, each with a distinct
  attribute identity and kit; the scoreboard, player kits and profile follow your
  choice (clashing kits trigger an away strip).
- **Match type** — *Friendly* (a draw ends level), *Knockout* (a draw is settled
  by a penalty shootout), or *World Cup* (the living tournament: 4 groups of 4 →
  QF → SF → Final, mapped to real 2026 matchdays; the sim resolves every other
  fixture, your run resumes across sessions, win the final to be crowned).
- **Rules** — *Arcade* (default) or *Sim* (offside + yellow/red cards).
- **Mentality** — Defensive / Balanced / Attacking for your team.
- **Difficulty** — Easy / Pro / Legend / **Ultimate / World Class** (harder tiers
  pay more XP), and a 2/3/5-minute half length.

### Settings & accessibility

A **Settings** panel (and a **How to play** overlay) on the start menu cover
haptics on/off, a **Graphics** tier (LITE turns off replays and lowers
resolution for weaker phones) and a **left-handed layout** that swaps the
joystick and button pad. A **tactical radar** minimap shows the shape of the
game. Every choice is saved to `localStorage` between sessions.

### Progression & retention (all earned in-game — no real money, no tracking)

Every match feeds a deep, **ethical** progression loop (see [`retention.md`](retention.md)):

- 👤 **Profile & account level** — XP from every match (win > draw > loss, but a
  loss still pays), a Rookie → Legend title ladder, an editable name, a flag
  avatar and career stat tiles.
- 🗓️ **Daily & weekly** — daily orders (rerollable) + a daily-chest meter, weekly
  orders + a forgiving "play 3 days" activity meter; first-win-of-day bonus.
- 🎟️ **Season Track** — a 30-tier "World Cup 2026 Season" with a battle-pass claim
  flow and an **earned** Elite track (unlocked by completing a week's orders, never
  paid; retroactive).
- 🎒 **Collection & economy** — kits, ball skins, celebrations, shot trails,
  banners, nets, stingers and name titles; duplicates convert to **shards**; **free
  chests** with *published* odds + pity (Epic ≤ 10, Mythic ≤ 50); an earned-currency
  **shop** with a daily rotation (items always return — no fake stock).
- 🏅 **Medals, achievements & mastery** — instant in-match medals, long-term
  achievements with visible progress (plus hidden ones), and per-nation mastery.
- 📡 **Live (simulated)** — a weekly leaderboard, an activity feed and region goals,
  all clearly **labelled as simulations** (no real players / no real aggregate data),
  plus rotating weekly events (Double XP, Coin Rush, Goal Festival).
- 🤝 **Honest by design** — published odds, opt-in rewarded ads that never gate
  progress, neutral exit/pause copy, reduced-motion support, and a "Simulated · no
  payments · no tracking" framing wherever an economy is implied.

The whole save is one versioned, migration-safe record (`src/core/playerData.ts`)
and persists through a swappable backend (`localStorage` now, the CrazyGames data
module on-platform).

## Develop

```bash
npm install
npm run dev        # start the Vite dev server (http://localhost:5173)
npm run build      # typecheck + production build into dist/
npm run preview    # preview the production build locally
npm run typecheck  # tsc --noEmit only
npm run test       # unit tests (progression, economy, saves, crowd-emotion model)
npm run sim        # headless AI-v-AI balance run + determinism check
npm run sim -- --physics   # ball-model and aim-solver self-tests
npm run sim -- --gk        # keeper save-rate scenarios
npm run test:browser       # scripted gameplay in headless Chromium (needs a dev server)
npm run sim        # headless AI-vs-AI balance harness (see simtest/)
npm run test       # headless unit tests for the progression/economy engines
```

**Validation gates** (run before committing gameplay/balance or progression
changes): `npm run typecheck` → `npm run build` → `npm run sim` (mirror ≈ even,
on-target ≤ shots, no NaN/hang) → `npm run test` (engine unit tests green).

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
│   ├── audio.ts           # procedural Web Audio engine (first-gesture unlock)
│   ├── haptics.ts         # Vibration API feedback for mobile
│   ├── dates.ts           # local-day / ISO-week keys for the daily/weekly loop
│   ├── settings.ts        # persistent prefs (sound/haptics/quality/layout/options)
│   ├── playerData.ts      # the versioned, migration-safe player save (one record)
│   └── progression.ts     # account XP curve + title ladder (pure)
├── rendering/
│   ├── scene.ts           # renderer, scene, camera, lights, world group
│   ├── pitchTexture.ts    # canvas-painted pitch markings
│   ├── stadium.ts         # pitch, stands, floodlights, goals, ad boards
│   ├── meshes.ts          # player + ball meshes
│   └── playerLoader.ts    # loads the Mixamo FBX player model + animations
├── platform/
│   ├── storage.ts         # swappable KV save backend (localStorage / data module)
│   └── crazygames.ts      # defensive CrazyGames SDK seam (init/ads/data; no-op in dev)
├── entities/             # Ball · Player (Yuka Vehicle) · Team
├── ai/                   # analysis · perception · fuzzy · states · carrier · goalkeeper
├── game/
│   ├── state.ts · aerial.ts · control.ts · physics.ts · movement.ts · humanActions.ts
│   ├── flow.ts · penalty.ts · rules.ts · replay.ts · render.ts · input.ts · loop.ts
│   ├── simulate.ts        # shared headless match loop (sim harness + tournament)
│   ├── modes.ts           # match setup + the result-screen owner (reward pipeline)
│   ├── rewards.ts         # match reward pipeline (XP/coins/quests/season/chests/event)
│   ├── quests.ts          # daily orders + chest, weekly orders + activity meter
│   ├── season.ts          # Season Track (free + earned Elite) ladder + claim flow
│   ├── collection.ts      # cosmetic catalogue, equip, shards, completion bonuses
│   ├── chests.ts          # chest drop tables + pity
│   ├── shop.ts            # deterministic daily shop (no fake stock)
│   ├── medals.ts · mastery.ts · achievements.ts   # G-cluster (post-match, pure)
│   ├── events.ts · rivals.ts                       # weekly events + simulated live service
│   └── worldcup.ts        # tournament engine: groups, bracket, resolver, resume
└── ui/
    ├── hud.ts · radar.ts · commentary.ts           # in-match surfaces
    ├── resultScreen.ts · profile.ts                # result card + profile card
    ├── daily.ts · weekly.ts · season.ts            # retention cards/screens
    ├── collection.ts · chest.ts · shop.ts · awards.ts · live.ts
    ├── worldcup.ts · pause.ts · onboarding.ts · rewarded.ts
    └── …
```

Headless tests live in [`simtest/`](simtest/): `harness.ts` (the AI-vs-AI balance
sim, `npm run sim`) and `units.ts` (progression/economy engine unit tests,
`npm run test`). The original single-file prototype is preserved at
[`reference/original-yuka-strikers.html`](reference/original-yuka-strikers.html).

## License

MIT
