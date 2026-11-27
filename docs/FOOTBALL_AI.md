# Football AI

Built on Yuka (state machine per player, perception memory, fuzzy module) with our
own steering, prediction and decision code.

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

No pitch-control / influence map yet; no team tactical state machine
(build-up / press / block / transition); no overlaps, third-man runs or
near/far-post box movement; marking is nearest-attacker; no opponent modelling;
no tactical identities per nation; set pieces are unstructured; no AI
visualisation overlay (the Football Intelligence Lab) yet.
