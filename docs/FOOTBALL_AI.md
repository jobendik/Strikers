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

Measured (PRO, seeded, after the harness fix below): pass completion 76–77 %,
13–15 shots and ≈ 4.5 goals per 4 minutes, 46–51 % of shots on target.

> **Harness lesson:** the first measurements of this model were wrong — the grid's
> module-level regulator was not reset between headless matches, so after the first
> match of a run the grid was frozen. `SimRegulator` now survives clock resets and
> the harness asserts the grid refreshes > 5×/s in every match.

## Team tactical state (`Team.updateTactic`)

Each side is always in one collective state, chosen from possession, where the
ball is, how long since it changed hands, the mentality (user-set, or
score-reactive for the AI) and the difficulty's pressing quality:

| In possession | Out of possession |
| --- | --- |
| `buildUp` — ball in our third | `counterPress` — just lost it: hunt for 1.6–3 s with two men |
| `attack` — settled in their half | `pressHigh` — attacking mentality / top difficulty: engage everywhere |
| `counter` — just won it and ≤ 2 of their outfielders are goal-side of the ball: runners break at full pace, runs weighted toward getting in behind | `midBlock` — engage from just inside their half; beyond that the first defender only *contains* |
| | `lowBlock` — ball deep in our half or defensive mentality: engage late, sit goal-side |

What the state changes: the **line of engagement** (press vs contain, with
hysteresis), whether a **second presser** goes, how far goal-side of the ball the
**block** sits and how hard it squeezes toward the ball (compactness in both
axes), and **marking**: touch-tight and goal-side near our box, stepping into the
passing lane further out.

Measured share of time (LEGEND, 8 matches): build-up 21 %, mid block 20 %,
attack 19 %, counter-press 17 %, low block 12 %, counter 10 %, high press 1 %.
Mirror matches are balanced over 30 seeded games (2.20–2.13 goals, 9–9–12).

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

`DIFF`: tackle-timing lag, execution-noise multiplier (1.6 → 0.95, deliberately a
narrow band), keeper quality, pressing cohesion, work-rate. **No speed boosts, no
altered duel odds.** Top tiers press high only with the ball pinned in the final third.

## Directness and releasing the ball

`Team.directness()` (0..1): 0.9 on a counter, 0.35 in attack, 0.15 in build-up, plus
up to 0.6 as a spell of possession passes 4 → 12 s without a shot or turnover. It
adds value to ground gained in the pass utility and lowers the shot threshold, so a
side stops passing round a set block. A carrier who sees a defender closing (on him
within 0.7 s) moves the ball before the challenge if a pass is not worse than keeping
it. Pass-lane safety projects a closing defender's run forward.

## Possession while the ball is in flight, pass and move, marking

`Team.inAttack` stays true while a pass of ours is on its way to one of our players
(the receiver stands in as the carrier for support runs). The passer (`ball.passer`,
for 2.6 s) runs ≈ 11 m on past his marker — never the last man, not in build-up, held
on the second-last defender under sim rules — and is worth +0.15 as a return ball.
Defending, attackers are picked up most-dangerous-first by the nearest free defender,
who aims 0.35 s ahead of the run; `Player.markTight` rises from 0.6 (zonal blend with
his formation spot) to 1.0 inside ≈ 15 m of goal, where he ignores the block's shape
and sprints to stay with his man.

## Keeper distribution and headers

With the ball in his hands the keeper throws to a team-mate with 4.5 m of room and
no body in the first metres of the lane or under the landing point (the throw lands
short and reaches feet on the bounce), else punts; opposing AI players drop 10 m off
while he holds it. Headers: at goal inside 9.5 m; unpressured the ball is brought
down; otherwise nodded to a team-mate or cleared — always headed *down* to land.

## Measured behaviour (AI v AI, 10 matches/scenario, 2×120 s, seeded)

See `PLAYTEST_REPORT.md` for the current table. Mirror matches are balanced (≈50 %
possession; no home/away bias beyond noise).

## Gaps (Milestone 3)

Pitch control is not yet used for defending decisions or for the dribble direction; the tactical states are rule-based (no opponent modelling, no pressing traps); no overlaps, third-man runs or
near/far-post box movement; marking is nearest-attacker; no opponent modelling;
no tactical identities per nation; set pieces are unstructured; the lab overlay shows
control, intents and the carrier's decision but not pass-candidate lanes or defensive assignments.
