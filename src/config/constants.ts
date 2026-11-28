import { V3 } from '../core/math';
import type { DiffSetting, FormationEntry } from './types';

/**
 * Central gameplay configuration. Pitch is modelled in world units with the
 * home team attacking +X. Tunable from one place so balance is easy to iterate.
 */
export const CFG = {
  halfL: 30,
  halfW: 20,
  // Real-world proportions (1 unit = 1 m): a 6.4 m × 2.44 m goal for the 5-a-side
  // pitch (full-size 7.32 m arrives with 11-a-side), a slightly oversized 0.18 m
  // ball for broadcast readability, 0.06 m posts.
  goalHalf: 3.2,
  goalH: 2.44,
  goalDepth: 2.0,
  boxDepth: 11,
  boxHalfW: 13,
  sixDepth: 3.6,
  sixHalfW: 7,
  ballR: 0.18,
  playerR: 0.46,
  playerH: 1.7,
  /** Planar foot reach: a ball inside this (and low enough) can be played. */
  controlR: 0.9,
  /** While the ball is this close the carrier has it under close control. */
  closeControlR: 1.3,
  /** Beyond this the carrier has lost the ball (a loose ball). */
  loseControlR: 2.6,
  carryDist: 0.62,
  tackleEdge: 0.35,
  /** Rolling deceleration on grass (m/s²). See physics.ts for the full model. */
  ballDecel: 2.5,
  ballMax: 38,
  ballStop: 0.25,
  /**
   * Top speeds in m/s at a neutral (70) pace rating. `out`/`gk` are *sprint*
   * speeds; `run` is the fraction used when not sprinting. Real footballers
   * sprint at ~8–9.5 m/s — these are real-world numbers, not arcade ones.
   */
  spd: { out: 8.0, gk: 7.2, run: 0.72, sprint: 1 },
  force: 130,
  shootRange: 26,
  shootPow: 31,
  passShort: 14,
  passLong: 22,
  clearPow: 24,
  shootAttempts: 6,
  potShot: 0.012,
  passInterceptScale: 0.22,
  comfortZone: 3.0,
  minPassDist: 5,
  gkInterceptR: 9,
  gkTend: 0.9,
  staminaDrain: 0.045, // per second of sprinting (≈22 s flat-out to empty)
  staminaRegen: 0.03, // per second when not sprinting (faster when standing)
  foulChance: 0.07,
  matchSeconds: 180, // length of ONE half (the match is two halves — see flow.ts)
  diff: 1, // 0 easy · 1 pro · 2 legend

  // --- match structure (two halves + half-time + stoppage) ---
  stoppagePerGoal: 3.0, // seconds of added time accrued per goal
  stoppagePerFoul: 1.4, // ...and per stoppage in play (foul / free kick)
  stoppageMax: 30, // cap on a half's added time

  // --- aerial ball physics (Notblox-inspired 3D ball) ---
  gravity: 10.6, // m/s² — a hair above real (9.81) so lofted balls stay snappy
  airDrag: 0.0115, // quadratic drag: a = −k·|v|·v  (≈ real football, Cd≈0.25)
  ballRest: 0.6, // vertical restitution on a firm bounce (drops with impact speed)
  groundMu: 0.42, // turf friction coefficient during a bounce (couples spin ⇄ speed)
  bounceFric: 0.78, // legacy (unused by physics v2)
  bounceMin: 0.9, // min downward impact speed (m/s) that counts as a real bounce —
  // below this a grounded ball settles into a roll
  controlHeight: 0.55, // a ball above this can't be trapped with the feet…
  chestHeight: 1.35, // …but can be cushioned on the thigh/chest up to here (harder)
  crossbarH: 2.44, // ball must be under this to count as a goal
  headLow: 1.1, // ball heights a player can head
  headHigh: 2.55, // (standing jump reach)
  headReach: 1.05, // planar range for contesting an aerial ball
  volleyLow: 0.3, // ball heights a player can volley
  volleyHigh: 1.1,

  // --- new actions (footballSimulationEngine action set) ---
  throughPow: 20, // through-ball power cap, played into space behind the line
  crossPow: 21, // lofted cross power
  chipPow: 17, // delicate chip to lob the keeper
  slideSpeed: 1.25, // slide-tackle lunge speed (× the player's sprint speed, decaying)
  slideTime: 0.55, // how long a slide commits the player
  slideRecover: 0.55, // on the turf afterwards before he can move again
  slideReach: 1.15, // reach of the sliding leg (from body centre, along the slide)
  slideCooldown: 1.6, // recovery before sliding again
  slideFoulBase: 0.2, // base foul chance from a mistimed slide (scaled by tackling)
  tackleReach: 1.25, // standing-tackle foot reach
  tackleWindup: 0.09, // seconds from committing to the foot arriving
  tackleRecover: 0.42, // stumble after a missed standing tackle
  tackleCooldown: 0.75,

  // --- ball spin / swerve (Magnus effect — extends Notblox's real ball motion) ---
  // lateral accel = magnusK · spin · horizontalSpeed; tuned so a full-curl shot
  // bends ~1.5 units over its flight while a clinical AI bend stays on frame.
  // Magnus acceleration = magnusK · (ω × v), ω in rad/s. A 60 rad/s (~10 rev/s)
  // side-spun 25 m/s strike bends ≈ 4 m over a 25 m flight — like a real free kick.
  magnusK: 0.0058,
  spinDecay: 0.28, // fraction of spin shed per second in flight
  spinDecayGround: 3.2, // side-spin dies quickly once the ball is rolling
  curlHuman: 62, // max side-spin (rad/s) a human can whip onto a shot
  curlAI: 26, // side-spin a clinical AI shooter uses (kept on target by the aim solver)
  curlCross: 34, // side-spin that swings a cross into the box

  // --- woodwork (posts + crossbar rebounds) ---
  postR: 0.06, // collision radius of a goalpost / crossbar
  woodRest: 0.62, // restitution off the frame

  // --- pass reception (Simple Soccer's intended-receiver model) ---
  receiveSpan: 3.4, // seconds an assigned receiver chases the pass before giving up
  passRequestSpan: 1.35, // seconds a teammate keeps calling for a pass
  passRequestMinScore: 7.8, // minimum lane score before a run is worth advertising
  passRequestBoost: 1.12, // small pace burst for the caller making the run

  // --- ground-pass weighting (scale strike power to distance so a short pass is
  // a crisp roll, not a full-power blast that overruns its target by 30 units) ---
  passArrive: 9.5, // speed (m/s) a ground pass should still carry when it reaches its target
  passArriveThrough: 5.0, // a through-ball dies into space for the runner
  passOverrun: 1.25, // legacy
  passOverMin: 2.0, // legacy
  passMinPow: 9, // floor so even the shortest pass keeps some zip

  // --- off-ball spacing (Yuka SeparationBehavior — the flagged-unused Yuka group
  // steering behaviour). A push-away force keeps team-mates from clumping so the
  // attack spreads into space and offers real passing options. ---
  spreadRadius: 4.6, // team-mates within this push each other apart
  spreadWeight: 9, // SteeringManager weight on the separation force

  // --- goalkeeper diving saves (deepens Simple Soccer's keeper, uses the aerial
  // model). The keeper predicts a shot's crossing point and flings himself. ---
  gkDiveSpeed: 3.4, // body speed through a full-stretch dive (m/s) — ~3.3 m covered in ~0.6 s with the arms
  gkDiveTime: 0.62, // airborne phase of a dive
  gkDiveRecover: 0.7, // on the ground afterwards
  gkDiveCooldown: 1.2, // recovery before he can dive again
  gkDiveReach: 1.05, // legacy
  gkArm: 0.9, // hips-to-fingertips reach at full stretch
  gkTouchR: 0.27, // ball within this of the keeper's body/arm line is touched
  gkDiveTrigger: 9, // min ball speed (m/s) toward goal to treat it as a shot
  // The keeper can only fling himself so far. With his standing catch radius this
  // still leaves the corners beatable from a central position — place it, curl it
  // around him, wrong-foot him, or pick the far top corner.
  gkDiveLunge: 1.45, // furthest his body travels in a dive (arms add gkArm beyond that)
  gkParrySpeed: 17, // above this a stretched save is usually parried, not held

  // --- game-feel juice ---
  goalSlowmo: 0.32, // time scale at the instant of a goal
  goalSlowmoBig: 0.2, // deeper slow-mo for a *big* goal (knockout / last-gasp / lead-changer)
  slowmoRecover: 1.7, // how fast time returns to normal (units/s of time-scale)
  celebrateBall: 0.7, // seconds the ball keeps flying into the net in slow-mo (normal goal)
  celebrateBallBig: 1.05, // ...longer, more cinematic beat for a big goal (H2)

  // --- penalty shootout (settles drawn knockout ties; reuses the diving keeper) ---
  pen: {
    spotOut: 9, // penalty spot distance from the goal line
    power: 23, // base shot speed (scaled up by charge)
    keeperReach: 1.2, // planar catch radius of the diving keeper at the ball
    keeperSpeed: 7.5, // dive speed (m/s) — reaches a corner in time *if* he reads it
    setupTime: 0.9, // pause before each kick can be taken
    resultTime: 1.7, // how long a kick result is shown
    flightTimeout: 2.4, // failsafe: an unresolved kick is recorded as a miss
    aiKeeperRead: [0.42, 0.52, 0.62, 0.7, 0.76], // chance the AI keeper picks the right side, by diff (0–4)
    aiOnTarget: [0.78, 0.84, 0.9, 0.93, 0.95], // chance an AI penalty is on target, by diff (0–4)
    bestOf: 5, // kicks each before sudden death
  },

  // --- knock-on burst (double-tap sprint): push the ball ahead and explode past ---
  knockSpeed: 13.5, // speed the ball is knocked ahead
  knockBoost: 1.07, // sprint-speed multiplier while chasing the knock-on (no ball at feet)
  knockBoostTime: 1.1, // how long the burst lasts

  // --- corner kicks: a defender's last touch over his own byline ---
  cornerInset: 0.7, // how far inside the lines the corner ball is placed

  // --- goalkeeper angle-narrowing (off-the-line positioning to compress shot angle) ---
  // When an attacker enters the penalty box with the ball on the ground, the keeper
  // steps forward along the goal-to-ball axis by up to `gkAngleStep` units.
  gkAngleStep: 3.0, // maximum units the keeper advances off his line to narrow the angle

  // --- perception: sound cue (Legend difficulty only) ---
  // A fast ball within this radius is always sensed, even from behind, simulating
  // elite players reacting to the sound and feel of the ball.
  soundBallR: 10, // sensing radius (world units) for the sound cue
  soundBallSpd: 12, // minimum ball ground speed (u/s) that triggers the cue

  // --- restarts ---
  deadBallTime: 0.9, // the ball keeps flying this long after going out before the restart

};

/** Per-difficulty AI tuning. Indexed by CFG.diff (0 Easy → 4 World Class). */
export const DIFF: DiffSetting[] = [
  // Difficulty changes how well the AI *thinks and executes* — never how fast it
  // can physically run (`aiSpd` is a mild work-rate factor: how readily players
  // commit to a sprint, capped at 1.0 = the same physics the human gets).
  //   react  — seconds of lag in a defender's tackle timing (the keeper's reactions come from `keeper`)
  //   noise  — execution error multiplier on passes/shots
  //   keeper — keeper quality 0..1 (read accuracy, reaction, handling)
  //   press  — how aggressively/cohesively the team closes down (0..1)
  { label: 'EASY', aiSpd: 0.9, react: 0.4, keeper: 0.55, noise: 1.6, press: 0.35 },
  { label: 'PRO', aiSpd: 0.95, react: 0.27, keeper: 0.68, noise: 1.3, press: 0.55 },
  { label: 'LEGEND', aiSpd: 1.0, react: 0.19, keeper: 0.78, noise: 1.15, press: 0.72 },
  { label: 'ULTIMATE', aiSpd: 1.0, react: 0.15, keeper: 0.86, noise: 1.05, press: 0.86 },
  { label: 'WORLD CLASS', aiSpd: 1.0, react: 0.12, keeper: 0.93, noise: 0.95, press: 1.0 },
];

/**
 * Team mentality — shifts the whole resting shape up or down the pitch. The user
 * picks theirs in the menu; the away side adapts to the scoreline (chases when
 * behind, sits on a lead). `push` is the depth bias in world units along the
 * team's attacking direction.
 */
export const MENTALITY = [
  { label: 'DEFENSIVE', push: -3.4 },
  { label: 'BALANCED', push: 0 },
  { label: 'ATTACKING', push: 3.8 },
];

/** Formation: GK + 2 DEF + 2 ATT. Home attacks +X; away is mirrored at build time. */
export const FORMATION: FormationEntry[] = [
  { role: 'GK', def: V3(-27, 0, 0), att: V3(-25, 0, 0) },
  { role: 'DEF', def: V3(-18, 0, -9), att: V3(-9, 0, -9) },
  { role: 'DEF', def: V3(-18, 0, 9), att: V3(-9, 0, 9) },
  { role: 'ATT', def: V3(-9, 0, -7), att: V3(9, 0, -7) },
  { role: 'ATT', def: V3(-9, 0, 7), att: V3(11, 0, 6) },
];
