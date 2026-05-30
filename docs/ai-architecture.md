# AI Architecture & Evaluation against `inspiration.md`

This document evaluates how Yuka Strikers uses game AI, measured against the five
references in [`inspiration.md`](inspiration.md), and records what *more* was
pulled in from those sources during the TypeScript rewrite.

## TL;DR

The original prototype already used Yuka's `Vehicle` steering plus a hand-rolled
mini-FSM and Buckland's "Simple Soccer" passing/shooting math. The rewrite keeps
all of that and adds **four more first-class Yuka subsystems** that the
prototype left on the table:

| Capability | Prototype | Now | Yuka API |
| --- | --- | --- | --- |
| Steering (arrive/seek/pursue) | ✅ | ✅ | `Vehicle`, `ArriveBehavior`, `SeekBehavior`, `PursuitBehavior` |
| Finite state machines | custom object FSM | ✅ native | `StateMachine`, `State` |
| Perception / short-term memory | ❌ | ✅ **new** | `MemorySystem`, `MemoryRecord` |
| Fuzzy-logic decisions | ❌ (hard thresholds) | ✅ **new** | `FuzzyModule`, `FuzzyVariable`, `FuzzyRule`, fuzzy sets |
| Throttled "thinking" | manual timers | ✅ native | `Regulator` |

## 1. Yuka.js — the core AI library

**What the prototype used:** `Vehicle` + `ArriveBehavior`, `SeekBehavior`,
`PursuitBehavior`, and a bespoke `FSM` class.

**What we added from Yuka:**

- **`StateMachine` / `State`** — the bespoke FSM was replaced with Yuka's native
  state machine. Player states (`PositionState`, `ChaseState`, `CarryState`,
  `SupportState`, `GkState` in [`src/ai/states.ts`](../src/ai/states.ts)) now
  subclass `Yuka.State`. This mirrors the structure Buckland describes and makes
  it trivial to extend with `globalState` / message handling later. *(Note: Yuka
  validates `instanceof State` in `StateMachine.add()`, so the states must be
  real subclasses, not plain objects.)*

- **`MemorySystem` perception** — every AI player now has a vision cone (derived
  from its heading) and a short-term memory of the ball
  ([`src/ai/perception.ts`](../src/ai/perception.ts)). When the ball leaves a
  player's view they keep chasing its **last-known position** for `memorySpan`
  seconds before re-acquiring, producing believable reaction lag instead of
  omniscient defenders. Vision sharpness (FOV + range) scales with difficulty, so
  EASY opponents genuinely lose track of play behind them while LEGEND keepers
  see almost everything. This directly implements the "perception systems
  (giving entities vision and short-term memory)" highlighted in the inspiration.

- **`FuzzyModule` decision making** — the ball carrier's shoot-vs-pass choice is
  arbitrated by a fuzzy inference system
  ([`src/ai/fuzzy.ts`](../src/ai/fuzzy.ts)). Two fuzzy variables —
  *distance to goal* (Close/Medium/Far) and *marking pressure* (Low/High) — feed
  rules that output *shoot* and *pass* desirability (0–100). The carrier combines
  these crisp scores with the hard feasibility gates (`canShoot`,
  `findBestPass`), so it stays smart *and* legal: e.g. close & unmarked yields a
  shoot desirability of ~87, while far-out yields ~12. Buckland uses fuzzy logic
  for weapon selection in *Programming Game AI by Example*; here the same
  technique drives attacking decisions.

- **`Regulator` throttling** — the carrier's decision loop and the team's
  support-spot solver are gated by `Regulator`s (≈7 Hz and ≈4 Hz) instead of
  manual countdown timers, which keeps per-frame cost down on mobile.

**Deliberately *not* used (with rationale):**

- **NavMesh pathfinding** — Simple Soccer is played on an open rectangle with no
  static obstacles, so a navigation mesh would add cost with no gameplay benefit.
- **Goal-driven / `Think` agents** — the role-based FSM already captures soccer's
  shallow decision tree cleanly; a full goal-evaluator hierarchy would be
  over-engineering for a 3-minute arcade match.
- **`SeparationBehavior` / `OffsetPursuitBehavior`** — these require an
  `EntityManager`-populated neighborhood to function. We already resolve player
  spacing with a cheap O(n²) soft-collision pass (10 players only), so wiring up
  the manager purely for steering separation wasn't worth the coupling. This is a
  natural future addition if the squad size grows.

## 2. phaser-simple-soccer / "Simple Soccer" architecture

This is the architectural blueprint, not a library. We implement its core ideas:

- **Team state via role assignment** — [`Team.update`](../src/entities/Team.ts)
  computes attack/defence each frame and assigns dynamic roles (CARRIER,
  SUPPORT, CHASER, POSITION, GK), the equivalent of Simple Soccer's team states.
- **SupportSpotCalculator** — `Team.computeSupport` scores a grid of candidate
  support positions by pass safety, shooting opportunity and distance from the
  carrier, exactly as Buckland's `SupportSpotCalculator` does.
- **Pass safety via time-to-intercept** — `isPassSafe` /
  `isPassSafeFromOpp` transform opponents into the pass's local frame and compare
  the ball's travel time against each opponent's reach.
- **`canShoot` and `getBestPassToReceiver`** — shot-lane sampling and
  tangent-point *lead* passes (passing into space ahead of a moving receiver).
- **Goalkeeper logic** — rush-to-intercept inside a threat radius, otherwise hold
  a rear-interpose line scaled into the goal mouth
  ([`src/ai/goalkeeper.ts`](../src/ai/goalkeeper.ts)).
- **Marking** — defending POSITION players are assigned to the most dangerous
  attackers and sit goal-side of them (`Team.assignMarks`).

## 3. AI-3DSoccer (Three.js)

A learning resource for mapping 2D AI logic into a 3D Three.js scene rather than a
library to depend on. We follow the same pattern: **all AI is computed in 2D**
(the x/z ground plane) and the result is lifted into a 3D presentation
(`src/game/render.ts`), which keeps the simulation cheap and the visuals rich.

## 4. football-simulator / Manager engines

These are event-driven statistical simulators for the "Football Manager" genre —
deliberately *not* a fit for a real-time arcade game. The only idea we borrow is
**attribute-driven probability**: difficulty tuning (`DIFF`) scales AI speed,
reaction time, pass safety margins and keeper reach, and aiming noise is applied
to AI shots/passes so outcomes feel statistical rather than robotic.

## 5. RoboCup Soccer Simulation

A heavy academic multi-agent research platform — explicitly out of scope for web
game development. The one concept echoed here is **decentralised agents acting on
local perception**: each player decides from its own vision/memory of the ball
rather than reading a global oracle, which is the spirit of the RoboCup 2D league
(noisy, relative sensor data) distilled to an arcade scale.

## Second wave — what we pulled in from the four newer engines

The four newer references (Notblox, footballSimulationEngine, Openfoot Manager,
open-football) pushed the game from a flat 2D pass-and-shoot prototype into a
3D-feeling arcade match with distinct characters. Here is the evaluation and
exactly what was implemented from each.

| Capability | Before | Now | Source |
| --- | --- | --- | --- |
| 3D / aerial ball | ❌ flat `y=0` | ✅ gravity + bounce + height | **Notblox** |
| Chips over the keeper | ❌ | ✅ AI + human | Notblox (aerial) |
| Crosses / lofted passes | ❌ | ✅ | Notblox (aerial) |
| Headers & volleys | ❌ | ✅ AI + human | Notblox (aerial) |
| Through-balls | ❌ | ✅ AI + human | **footballSimulationEngine** |
| Slide tackles | hard-coded human "lunge" | ✅ first-class, risk/reward, AI + human | footballSimulationEngine |
| Per-player attributes | ❌ identical clones | ✅ pace/shooting/passing/tackling/composure | **Openfoot Manager** |
| Named squads / identity | ❌ | ✅ named, numbered players | **open-football** |

### 6. Notblox — real, physics-driven ball motion

Notblox runs server-authoritative Rapier physics so the ball has true 3D
motion. We don't need multiplayer or a full rigid-body engine, but we adopted
its essential idea: **the ball now lives in 3D**. `src/game/physics.ts`
integrates gravity, a ground bounce (restitution + horizontal friction) and
separate rolling-vs-air drag, while `src/game/aerial.ts` provides the
projectile primitive `launchLob(target, peak)` that solves the launch velocity
to land the ball on a target at a chosen apex. This single primitive unlocks
three new, genuinely exciting actions:

- **Chip the keeper** (`canChipKeeper`) — when the goalkeeper rushes off his
  line, the carrier (AI) or the player (a *soft tap* of SHOOT) dinks the ball
  over him into the net. Numerically validated to clear a 2.5 m keeper and drop
  under the 4.0 m bar.
- **Crosses / lofted balls** — wide, advanced carriers loft the ball into the
  box; the human holds PASS to do the same.
- **Headers & volleys** — an airborne ball can no longer be collected on the
  ground; it must be **headed**. AI defenders head clear, attackers head on
  goal, and the human heads with SHOOT. Control is height-gated in
  `resolveControl` so aerial play is meaningfully different from ground play.

The ball mesh carries a fake contact shadow that shrinks as it climbs, selling
the height on a top-down arcade camera.

### 7. footballSimulationEngine — an explicit action set

Its lesson is the **vocabulary of actions** (shoot / through-ball / intercept /
slide) and the discipline of *separating movement decisions from ball physics*.
We added the two we were missing:

- **Through-ball** (`findThroughBall` in `src/ai/analysis.ts`) — a driven pass
  into space *behind* the defensive line, ahead of a forward-running teammate.
  The AI carrier prefers it from midfield; the human triggers it by flicking the
  joystick forward as they pass.
- **Slide tackle** (`startSlide` / `resolveSlides` in `src/game/control.ts`) —
  a committed lunge with real risk/reward: it can win the ball cleanly or
  concede a free kick, with the foul chance scaled by the slider's `tackling`
  attribute. AI chasers slide situationally (more often on higher difficulty);
  the human slides with SHOOT when off the ball. Movement during a slide is
  resolved in its own branch of `movePlayers`, keeping it cleanly separated from
  steering — exactly the engine's movement-vs-physics separation principle.

### 8. Openfoot Manager — attribute-driven squads

The manager engines model players as bundles of attributes. We distilled that to
five arcade-relevant ratings per player — **pace, shooting, passing, tackling,
composure** (`src/config/players.ts`) — and wired them through the whole sim:
pace scales running speed; shooting scales shot power and (with composure)
aiming noise; passing scales pass accuracy and through-ball willingness;
tackling drives tackle success and foul avoidance; composure lets a carrier
shield the ball longer and back himself to shoot. The two squads are
deliberately asymmetric in character (quick/clinical Strikers vs.
physical/solid United) so matches read differently.

### 9. open-football — named identities

We don't simulate decades of a football world, but we borrowed its spark:
**every player is named and numbered**. The HUD shows who you're controlling,
and the asymmetric attribute profiles give those names personalities — SOLA and
FÈNX up top feel quick and clinical; United's MARS and KOLT feel like a wall.

## Third wave — deeper coordination, real swerve & game-feel

A later pass mined the sources again for what was *still* on the table. Three
gaps stood out: passes had no intended receiver (Simple Soccer's central
mechanic), the "real ball" only flew in straight lines (Notblox runs full
rigid-body spin), and the match lacked arcade *juice*. All three are now closed.

| Capability | Before | Now | Source |
| --- | --- | --- | --- |
| Intended pass receiver runs onto the ball | ❌ nearest player collects | ✅ `RECEIVE` state + `m_pReceivingPlayer` | **Simple Soccer** (Buckland ch.4) |
| Ball swerve / curl | ❌ straight lines | ✅ Magnus spin on shots & crosses | **Notblox** (real ball physics) |
| Woodwork rebounds | ❌ flew out | ✅ posts + crossbar clang back in | match realism |
| Camera shake / goal slow-mo / ball trail | ❌ | ✅ | arcade game-feel |

### Pass reception — Simple Soccer's `m_pReceivingPlayer`

Buckland's *Simple Soccer* doesn't let "whoever is nearest" pick up a pass: the
passer nominates a receiver, dispatches it a *ReceiveBall* message, and that
player runs onto the ball while the rest of the team supports. We implement the
same model without the full message bus: every pass call-site
(`findBestPass`, `findThroughBall`, crosses, keeper distribution, and the
human's pass/through-ball/cross) now records the intended receiver via
`setReceiver()` (`src/game/state.ts`). `Team.update` promotes that player to a
new `RECEIVE` role, and `ReceiveState` (`src/ai/states.ts`) predictively pursues
the ball — turning isolated passes into **give-and-gos and runs in behind**. The
assignment lapses after `receiveSpan` seconds, or the instant anyone gains
control (`setControl` clears it), so a misplaced pass never strands a runner.

### Curling shots & crosses — Magnus spin (Notblox, extended)

Notblox's headline gift was a ball that lives in 3D; its underlying Rapier
physics also carries spin. We add a scalar `ball.spin` and integrate a **Magnus
sideways acceleration** (`magnusK · spin · horizontalSpeed`, perpendicular to
travel) in `integrateFreeBall`, decaying through flight. A clinical AI striker
bends the shot *toward goal centre* (so the curl keeps it on frame while
troubling the keeper); crosses are whipped back into the middle; and the **human
bends the ball with the joystick** — leaning the stick across the shot line at
release imparts curl proportional to their `shooting` attribute. Scoring a
bending screamer is now a thing.

### Woodwork, shake, slow-mo, trail

`hitWoodwork` (`src/game/physics.ts`) reflects the ball off the posts and
crossbar with restitution — finally wiring up the previously-unused `post()`
sound — for dramatic near-misses. `addShake` (`src/game/render.ts`) punches the
broadcast camera on goals, saves, slide tackles and woodwork; goals trigger a
brief `timeScale` dip so the ball flies into the net in **slow motion** under a
cinematic push-in; and a lightweight additive **ball trail** streaks behind fast
or airborne balls. None of these touch the simulation's correctness — they make
it *feel* like an arcade game on a phone.

## Fourth wave — the last unused Yuka behaviour, a keeper with reflexes & a living stadium

A final sweep of the sources turned up three things still on the table: the one
Yuka group-steering behaviour the earlier waves had explicitly deferred, a
goalkeeper that was still essentially static, and a match that was visually juicy
but sonically dead between the big moments.

| Capability | Before | Now | Source |
| --- | --- | --- | --- |
| Off-ball players spread into space | ❌ cheap collision push only | ✅ `SeparationBehavior` group steering | **Yuka** (the deferred behaviour) |
| Goalkeeper diving saves / parries | ❌ static interpose | ✅ predicts the shot, flings himself, parries screamers | **Simple Soccer** keeper, deepened + Notblox aerial |
| Living-stadium atmosphere | ❌ silent between events | ✅ procedural crowd bed that swells near goal + roars | **open-football** (living world) |

### Off-ball spacing — Yuka's `SeparationBehavior` (the deferred behaviour)

The first architecture pass listed `SeparationBehavior` under *"Deliberately not
used"*, noting it "requires an `EntityManager`-populated neighborhood" and was "a
natural future addition if the squad size grows." We've now wired it in **without**
the `EntityManager` coupling that prompted deferring it: Yuka's
`SeparationBehavior.calculate()` only reads `vehicle.neighbors`, so
[`movement.ts`](../src/game/movement.ts) populates that array directly each frame
(same-team outfielders within `spreadRadius`) and toggles the behaviour for
off-ball roles. It is added to the steering manager **last**, so the
move-to-target force (`arrive`/`pursuit`) is satisfied first and separation nudges
with the remaining force budget. The result: the two supporters and the marking
defenders no longer stack on the same blade of grass — the attack fans out and
offers genuine passing options, and two defenders stop diving onto the same spot.
This is Reynolds/Buckland flocking applied to soccer team shape.

### Goalkeeper diving saves — Simple Soccer's keeper, using the aerial model

The keeper used to be a rear-interpose slider — he only ever saved balls that
happened to roll inside his standing reach. He now **reads the shot**
([`goalkeeper.ts`](../src/ai/goalkeeper.ts)): when a fast ball is travelling
toward goal he projects its trajectory (including the aerial `y` term from the
Notblox ball model) to his goal line, and if it will arrive in a corner beyond a
standing save he commits a full-stretch **dive** (`startGkDive`) toward the
predicted crossing point. The lunge is a committed lateral skate
([`movement.ts`](../src/game/movement.ts), mirroring the slide-tackle branch) with
an extended catch radius while airborne ([`resolveControl`](../src/game/control.ts)),
and the keeper mesh pitches forward so it *reads* as a dive. Crucially the lunge
is **distance-capped** so a keeper cannot cover both corners — placement, curl and
wrong-footing still beat him — and his read carries a difficulty-scaled error, so
weaker keepers misjudge the corner. A screamer reached at full stretch may be
**parried** rather than held, popping out a dramatic rebound. Saves swell the
crowd and flash *WHAT A SAVE!*. This turns a whole band of former tap-ins into
spectacular saves while keeping the game high-scoring and beatable.

### Living stadium — procedural crowd ambience (open-football's living world)

open-football's spark is an autonomous, living football world. Distilled to an
arcade beat, [`audio.ts`](../src/core/audio.ts) now runs a continuous,
procedurally-synthesised **crowd bed** (looped, low-passed brown noise) whose
level is driven by the play: [`loop.ts`](../src/game/loop.ts) swells it as the
ball approaches either goal, and `roar()` punches a short excitement spike on
shots, saves and goals. Like every other sound in the game it's generated at
runtime — zero audio assets — and respects the mute toggle.

## Decision pipeline (per AI player, per frame)

```
Team.update
 ├─ updatePerception(player)        # MemorySystem: sense ball within vision cone
 ├─ assign dynamic role             # CARRIER / SUPPORT / CHASER / RECEIVE / POSITION / GK
 └─ StateMachine.changeTo(role) → State.execute
      ├─ CarryState  → aiCarry      # fuzzy: chip / shoot(curl) / through-ball / cross(swerve) / pass / clear
      ├─ ChaseState  → header if airborne, else slide-tackle chance, else pursue/last-known
      ├─ ReceiveState→ run onto the ball (pursue while it travels) — Simple Soccer's ReceiveBall
      ├─ SupportState→ arrive at best support spot (header if airborne)
      ├─ PositionState→ hold shape / mark / shuffle (header if airborne)
      └─ GkState     → read shot → dive, else intercept, else rear-interpose

movePlayers (after the FSM runs)
 ├─ updateSpacing(player)           # populate Yuka neighbors → SeparationBehavior spreads off-ball roles
 ├─ keeper dive lunge / slide lunge # committed actions override steering
 └─ integrate steering + stamina + soft body-collision
```
