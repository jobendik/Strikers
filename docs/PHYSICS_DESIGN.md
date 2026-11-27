# Physics design

World units are metres; +Y up; the pitch lies in X/Z. All of this runs inside the
fixed 120 Hz step. Constants live in `src/config/constants.ts` (`CFG`).

## The ball (`src/game/physics.ts`, `src/entities/Ball.ts`)

State: position, velocity, angular velocity **ω** (3 axes), `grounded`, `inNet`.

| Regime | Model |
| --- | --- |
| Flight | `a = −g ŷ − k_d |v| v + k_m (ω × v)`; g = 10.6 m/s² (a touch over real so lofted balls stay snappy), k_d = 0.0115 (≈ real Cd 0.25), k_m = 0.0058. Spin decays 28 %/s. |
| Bounce | Normal restitution `e = clamp(0.6 − 0.012·impact, 0.3, 0.6)`. Friction impulse at the contact point: enough to stop the slip (hollow sphere ⇒ Δv = −0.4·u), capped at `μ(1+e)·impact`, μ = 0.42; the same impulse changes ω (back-spin checks, top-spin kicks on). Impacts under 0.9 m/s settle into a roll. |
| Roll | `dv/dt = −(a + k_d v²)`, a = 2.5 m/s² (grass); ω locked to rolling; side-spin decays fast. Closed forms in `Ball.ts`: `timeBall`, `rollSpeedAt`, `rollSpeedFor`, `rollRange` — the AI uses these, the harness checks them against the integrator. |
| Goal frame | Posts/crossbar are cylinders (r = 0.06). Near the goal the tick is sub-stepped (≤ 6) so a 38 m/s ball cannot tunnel; circle-vs-circle reflection with restitution 0.62. |
| Nets | A box behind each line. A ball that came through the mouth (`inNet`) is caught: ~6 % restitution, heavy tangential damping. A ball that hits the netting from outside thuds off it. Emits `net` with impact data for the visual net. |
| Laws | Goal = whole ball over the line with `inNet` set. Out of play = whole ball over a line → `awardRestart` (0.9 s dead-ball beat while the ball keeps travelling) → `setPiece`. |

`stepBallState()` operates on a plain struct so the same integrator runs the live
ball, the look-ahead (`predict.ts`: 3.2 s at 30 Hz, cached per tick) and the aim
solver.

### Aim solver (`control.solveLaunch`)
Modes: `ground` (roll to a point), `lob` (land on a point with a chosen apex),
`aim` (pass through a 3-D point at a chosen speed). Starts from the vacuum
solution and corrects yaw / pitch / speed over 4 fly-throughs of the real
integrator, so drag and curl are compensated. Self-test (`npm run sim -- --physics`):
aimed shots hit their target point within 0.12 m, lobs land within 0.5 m.

## Possession (`src/game/control.ts`)

- **Dribble touches.** The carrier touches the ball when it stops running ahead
  of him the way he wants to go. Touch speed = his wanted speed + a lead that
  depends on pace and his *control* rating: jogging ≈ +0.7…1.2 m/s (ball stays
  within ~0.3 m), sprinting ≈ +1.35…2.3 m/s (ball runs ~1 m ahead; occasional
  heavy touches for poor technicians). Direction error scales the same way.
- **Ball binding.** A carrier whose touch has run away must reach the ball before
  he can turn with it (`movement.bindToBall`) — sprint-dribbling turns wider.
- **First touch.** Relative ball speed vs. a capacity from control rating, ball
  height, direction of arrival, own speed, pressure and whether he was the
  intended receiver. Good touch → ball brought to his feet in the direction he
  wants; poor touch → part of the incoming pace survives, off line; too hot →
  it cannons off him (a block).
- **Strikes.** `requestKick` queues a `KickSpec`; the wind-up (0.04–0.23 s by kick
  type) starts once the ball will be playable at contact; `strike` resolves at
  the contact tick from the ball's real position and applies execution error
  (skill, speed, pressure, body shape, first-time, ball height).
- **Challenges.** Standing tackle and slide are a leg segment tested against the
  ball and the carrier: ball first → duel on tackling vs control/strength (bonus
  if the ball is off his foot); man first from behind / studs → foul chance.
  A missed tackle leaves the tackler recovering.
- **Loss of control.** Ball > 1.3 m from the carrier can simply be collected by a
  nearer opponent; > 2.6 m is a loose ball.

## Goalkeeper contact

The keeper is a body/arm line: vertical feet→hands when standing, trailing hip →
fingertips along the dive when diving (reach grows over 0.3 s, shrinks 30 % for
high balls). Ball within 0.45 m of the line is touched → fingertip (edge of
reach, changes course, keeps pace) / spill (stretched vs. pace) / catch / parry,
by speed, stretch and keeper quality.

## Players (`src/game/movement.ts`, `src/config/attributes.ts`)

Desired velocity (stick or AI steering) → actual velocity under limits from the
derived athletic profile: sprint 7.2–8.6 m/s (real-world numbers), acceleration
11–17.5 m/s² tapering toward top speed, braking 15–22 m/s², lateral grip from
agility, turn rate 7.5–13.5 rad/s, ball at feet costs pace and agility, stamina
drains only while sprinting. Body contact is strength-weighted and inelastic;
big collisions cause a stumble.

## Known limitations

- No ball–body collision above chest height (heads only via the header action);
  no ball–leg collision for players who are mid-action.
- Net is a rigid damped box in the simulation (visual deformation is presentation).
- Throw-ins/corners/free kicks are "quick restarts" with a taker placed on the
  ball; no walls, no set-piece routines.
- Weather does not affect physics yet.
- Drag crisis (speed-dependent Cd) and spin-dependent drag are not modelled.
