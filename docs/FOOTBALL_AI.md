# Football AI

Built on Yuka (state machine per player, perception memory, fuzzy module) with our
own steering, prediction and decision code.

## Pitch control (`src/ai/pitchControl.ts`)

A 24 × 16 grid over the pitch, refreshed 8 times a simulated second. For each cell:
the earliest arrival time of each side (per player: a reaction beat, then the
distance from where his momentum is carrying him at ~his sprint speed; players on
the floor or mid-tackle pay for it; keepers only contest their own box), an
outfield-only variant (who could *mark* a man there), and a control probability
`σ((t_away − t_home)/0.45 s)`. Helpers: `controlAt`, `oppArrivalAt`,
`arrivalTime`, `threatAt` (a smooth expected-threat field from distance/angle to
goal plus territory) and `spaceAhead` (share of the cone in front of a carrier
that his side controls).

It is read by:

- **Support runs** (`Team.assignSupport`) — the two most advanced team-mates are
  each sent to the cell that maximises threat × his time advantage over the nearest
  defender, with an open lane from the ball, a comfortable distance from the
  carrier, hysteresis, and separation from the other runner (no fixed spots).
- **Passing** (`ai/passing.ts`) — every team-mate offers a ball to feet and a ball
  into the space he is attacking; each is scored on one scale (threat at the
  target + the receiver's ownership margin − distance − backwards − a flat risk,
  more for a ball into space) and compared with `keepValue` (threat where the
  carrier is *or can carry it to*, room ahead, pressure discounted by dribbling
  ability). He releases it when the pass is clearly better, lays off when closed
  down, plays safe in his own half, or backs himself to beat his man.
- **The dev lab** — `G` toggles the control field; the panel shows the carrier's
  live keep value and best pass utility.

Measured effect (PRO, 8 × 2×120 s, same seeds): pass completion 72–76 % → 76–81 %,
shots per match ≈ 9 → 11–13, goals unchanged in range.

## Current structure

- **Team (`entities/Team.ts`)** — each tick assigns dynamic roles: in possession
  CARRIER + SUPPORT (support-spot solver, 4 Hz) + a caller making a run
  (`ai/passRequests.ts`); out of possession one CHASER (two when the first is not
  close in our half), a **cover** defender who gets on the ball→goal line when the
  ball is within 19 m, markers goal-side of the most dangerous attackers.
  Mentality (user-set / score-reactive for the AI side) shifts the block.
- **Carrier (`ai/carrier.ts`)** — steers the dribble every tick (toward goal,
  round the nearest defender, sprint only into open grass); 8 Hz decision:
  chip → shoot → requested pass → through-ball → cross → safe pass → clear.
  Shooting is an expected-value call: `estimateXg` × openness from
  `pickShotTarget`, against a threshold shaded by composure, fuzzy desirability
  (distance / pressure / centrality), urgency when losing late and conservatism
  when protecting a lead. A dwell time and pressure test stop pinball passing.
- **Chaser (`ai/states.ts`)** — closes down, jockeys goal-side, and times a
  standing tackle (more likely the moment the ball is off the carrier's foot;
  rate from tackling rating and difficulty reaction); slides only when beaten.
- **Receiver** — runs to the earliest reachable point on the predicted ball path
  (`predict.interceptPoint`); may hit it first time in front of goal.
- **Goalkeeper (`ai/goalkeeper.ts`)** — bisector positioning with near-post shade,
  angle narrowing by threat, shot reading from the predicted flight with
  reaction time (anticipation from the shooter's wind-up) and reading error,
  step / dive decision, sweeping for reachable loose balls, one-on-one smother.
- **Pass safety (`ai/analysis.ts`)** — time-to-intercept per opponent using the
  exact rolling model at the pace the pass will really be played.

## Difficulty

`DIFF`: reaction lag, execution-noise multiplier, keeper quality, pressing
cohesion, work-rate. **No speed boosts, no altered duel odds.**

## Measured behaviour (AI v AI, 10 matches/scenario, 2×120 s, seeded)

See `PROGRESS.md` for the current table. Mirror matches are balanced (≈50 %
possession; no home/away bias beyond noise).

## Gaps (Milestone 3)

Pitch control exists but is not yet used for *defending* (cover shadows, pressing triggers, line height) or for the dribble direction; no team tactical state machine
(build-up / press / block / transition); no overlaps, third-man runs or
near/far-post box movement; marking is nearest-attacker; no opponent modelling;
no tactical identities per nation; set pieces are unstructured; the lab overlay shows
control, intents and the carrier's decision but not pass-candidate lanes or defensive assignments.
