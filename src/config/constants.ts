import { V3 } from '../core/math';
import type { DiffSetting, FormationEntry } from './types';

/**
 * Central gameplay configuration. Pitch is modelled in world units with the
 * home team attacking +X. Tunable from one place so balance is easy to iterate.
 */
export const CFG = {
  halfL: 30,
  halfW: 20,
  goalHalf: 4.4,
  goalH: 4.0,
  goalDepth: 2.2,
  boxDepth: 11,
  boxHalfW: 13,
  sixDepth: 3.6,
  sixHalfW: 7,
  ballR: 0.42,
  playerR: 0.46,
  playerH: 1.7,
  controlR: 1.35,
  carryDist: 1.05,
  tackleEdge: 0.35,
  ballDecel: 8,
  ballMax: 40,
  ballStop: 0.5,
  spd: { out: 9.4, gk: 8.2, sprint: 1.34 },
  force: 130,
  shootRange: 20,
  shootPow: 30,
  passShort: 18,
  passLong: 24,
  clearPow: 24,
  shootAttempts: 6,
  potShot: 0.02,
  passInterceptScale: 0.22,
  comfortZone: 3.0,
  minPassDist: 5,
  gkInterceptR: 9,
  gkTend: 2.4,
  staminaDrain: 0.05,
  staminaRegen: 0.06,
  foulChance: 0.07,
  matchSeconds: 180, // length of ONE half (the match is two halves — see flow.ts)
  diff: 1, // 0 easy · 1 pro · 2 legend

  // --- match structure (two halves + half-time + stoppage) ---
  stoppagePerGoal: 3.0, // seconds of added time accrued per goal
  stoppagePerFoul: 1.4, // ...and per stoppage in play (foul / free kick)
  stoppageMax: 30, // cap on a half's added time

  // --- aerial ball physics (Notblox-inspired 3D ball) ---
  gravity: 24, // world units / s² — tuned for snappy arcade arcs
  ballRest: 0.52, // vertical restitution on bounce
  bounceFric: 0.78, // horizontal velocity retained per bounce
  controlHeight: 1.25, // a ground player can only collect a ball below this height
  crossbarH: 4.0, // ball must be under this to count as a goal
  headLow: 0.9, // ball heights a player can head/volley
  headHigh: 2.5,
  headReach: 1.7, // planar range for contesting an aerial ball

  // --- new actions (footballSimulationEngine action set) ---
  throughPow: 22, // through-ball power, played into space behind the line
  crossPow: 21, // lofted cross power
  chipPow: 17, // delicate chip to lob the keeper
  slideSpeed: 1.9, // slide-tackle lunge speed multiplier
  slideTime: 0.42, // how long a slide commits the player
  slideReach: 2.2, // slide-tackle ball-win range
  slideCooldown: 1.1, // recovery before sliding again
  slideFoulBase: 0.18, // base foul chance from a slide (scaled by tackling)

  // --- ball spin / swerve (Magnus effect — extends Notblox's real ball motion) ---
  // lateral accel = magnusK · spin · horizontalSpeed; tuned so a full-curl shot
  // bends ~1.5 units over its flight while a clinical AI bend stays on frame.
  magnusK: 0.28, // how strongly spin curves the ball per unit of horizontal speed
  spinDecay: 0.45, // fraction of spin shed per second in flight
  curlHuman: 2.2, // max curl a human can bend onto a shot (joystick lateral at release)
  curlAI: 0.55, // curl a clinical AI shooter bends toward goal centre (stays on target)
  curlCross: 1.2, // curl that whips a cross into the box

  // --- woodwork (posts + crossbar rebounds) ---
  postR: 0.16, // collision radius of a goalpost / crossbar
  woodRest: 0.62, // restitution off the frame

  // --- pass reception (Simple Soccer's intended-receiver model) ---
  receiveSpan: 2.6, // seconds an assigned receiver chases the pass before giving up

  // --- off-ball spacing (Yuka SeparationBehavior — the flagged-unused Yuka group
  // steering behaviour). A push-away force keeps team-mates from clumping so the
  // attack spreads into space and offers real passing options. ---
  spreadRadius: 4.6, // team-mates within this push each other apart
  spreadWeight: 9, // SteeringManager weight on the separation force

  // --- goalkeeper diving saves (deepens Simple Soccer's keeper, uses the aerial
  // model). The keeper predicts a shot's crossing point and flings himself. ---
  gkDiveSpeed: 2.6, // lateral lunge speed multiplier during a dive
  gkDiveTime: 0.5, // how long a dive commits the keeper
  gkDiveCooldown: 0.7, // recovery before he can dive again
  gkDiveReach: 1.05, // small catch-radius bonus at full stretch (the lunge does the work)
  gkDiveTrigger: 14, // min ball speed (u/s) toward goal to trigger a dive
  // The keeper can only fling himself so far. With his standing catch radius this
  // still leaves the corners beatable from a central position — place it, curl it
  // around him, wrong-foot him, or pick the far top corner.
  gkDiveLunge: 2.0, // furthest lateral distance a dive physically covers
  gkParrySpeed: 24, // a save above this speed may be parried (rebound) not caught

  // --- game-feel juice ---
  goalSlowmo: 0.32, // time scale at the instant of a goal
  slowmoRecover: 1.7, // how fast time returns to normal (units/s of time-scale)
};

/** Per-difficulty AI tuning. Indexed by CFG.diff. */
export const DIFF: DiffSetting[] = [
  { label: 'EASY', aiSpd: 0.88, react: 0.34, passSafe: 2.6, shootBias: 0.55, keeper: 0.74 },
  { label: 'PRO', aiSpd: 0.97, react: 0.22, passSafe: 2.1, shootBias: 0.78, keeper: 0.78 },
  { label: 'LEGEND', aiSpd: 1.05, react: 0.12, passSafe: 1.7, shootBias: 0.95, keeper: 0.82 },
];

/** Formation: GK + 2 DEF + 2 ATT. Home attacks +X; away is mirrored at build time. */
export const FORMATION: FormationEntry[] = [
  { role: 'GK', def: V3(-27, 0, 0), att: V3(-25, 0, 0) },
  { role: 'DEF', def: V3(-18, 0, -9), att: V3(-9, 0, -9) },
  { role: 'DEF', def: V3(-18, 0, 9), att: V3(-9, 0, 9) },
  { role: 'ATT', def: V3(-9, 0, -7), att: V3(9, 0, -7) },
  { role: 'ATT', def: V3(-9, 0, 7), att: V3(11, 0, 6) },
];
