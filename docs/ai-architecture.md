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

## Decision pipeline (per AI player, per frame)

```
Team.update
 ├─ updatePerception(player)        # MemorySystem: sense ball within vision cone
 ├─ assign dynamic role             # CARRIER / SUPPORT / CHASER / POSITION / GK
 └─ StateMachine.changeTo(role) → State.execute
      ├─ CarryState  → aiCarry      # Regulator-throttled fuzzy shoot/pass/clear
      ├─ ChaseState  → pursue ball if visible, else last-known position
      ├─ SupportState→ arrive at best support spot (SupportSpotCalculator)
      ├─ PositionState→ hold shape / mark / shuffle to perceived ball
      └─ GkState     → intercept or rear-interpose
```
