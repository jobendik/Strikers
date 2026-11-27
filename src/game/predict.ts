import { CFG } from '../config/constants';
import { sim } from '../core/time';
import { ball, match } from './state';
import { makeBallState, stepBallState, type BallState } from './physics';

/*
 * Short-horizon ball prediction.
 *
 * Integrates the *real* ball model forward (drag, Magnus, bounces, roll) from the
 * live ball state and caches the sampled path for the current tick. Everything
 * that needs to anticipate the ball reads it: receivers running onto a pass,
 * defenders cutting out a through-ball, the keeper reading a shot, the dev lab's
 * trajectory overlay.
 *
 * It deliberately ignores future touches, the goal frame and bodies — it answers
 * "where does this ball go if nobody gets to it?".
 */

export const TRAJ_DT = 1 / 30;
export const TRAJ_N = 96; // 3.2 s look-ahead
const SUB = 2;

export interface Trajectory {
  n: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
}

const traj: Trajectory = { n: 0, x: new Float32Array(TRAJ_N), y: new Float32Array(TRAJ_N), z: new Float32Array(TRAJ_N) };
const S: BallState = makeBallState();
let cachedTick = -1;
let cachedEpoch = -1;

/** The predicted free flight of the ball from now (sample i is `i·TRAJ_DT` seconds ahead). */
export function ballTrajectory(): Trajectory {
  if (cachedTick === sim.tick && cachedEpoch === sim.epoch) return traj;
  cachedTick = sim.tick;
  cachedEpoch = sim.epoch;
  S.px = ball.position.x;
  S.py = ball.position.y;
  S.pz = ball.position.z;
  S.vx = ball.velocity.x;
  S.vy = ball.velocity.y;
  S.vz = ball.velocity.z;
  S.wx = ball.w.x;
  S.wy = ball.w.y;
  S.wz = ball.w.z;
  S.grounded = ball.grounded;
  const h = TRAJ_DT / SUB;
  let n = 0;
  for (; n < TRAJ_N; n++) {
    traj.x[n] = S.px;
    traj.y[n] = S.py;
    traj.z[n] = S.pz;
    // stop sampling once it is dead on the turf (the rest would be identical)
    if (S.grounded && S.vx === 0 && S.vz === 0) {
      n++;
      break;
    }
    for (let k = 0; k < SUB; k++) stepBallState(S, h);
  }
  traj.n = n;
  return traj;
}

/** Invalidate the cached trajectory (call after the ball is struck mid-tick). */
export function invalidateTrajectory(): void {
  cachedTick = -1;
}

export interface Intercept {
  /** Seconds from now. */
  t: number;
  x: number;
  y: number;
  z: number;
}

const _hit: Intercept = { t: 0, x: 0, y: 0, z: 0 };

/**
 * Earliest point on the ball's predicted path that a runner starting at (px,pz)
 * can reach in time, given a top speed, a reaction delay and the highest ball he
 * can play. Returns null if the ball gets away (or leaves the pitch) first.
 * The returned object is a shared scratch value — copy what you need.
 */
export function interceptPoint(px: number, pz: number, speed: number, react = 0, maxH = CFG.controlHeight, reach = CFG.controlR): Intercept | null {
  const tr = ballTrajectory();
  for (let i = 0; i < tr.n; i++) {
    const t = i * TRAJ_DT;
    const bx = tr.x[i];
    const bz = tr.z[i];
    if (Math.abs(bx) > CFG.halfL + 0.5 || Math.abs(bz) > CFG.halfW + 0.5) return null; // gone out first
    if (tr.y[i] - CFG.ballR > maxH) continue;
    const d = Math.hypot(bx - px, bz - pz) - reach;
    if (d <= Math.max(0, t - react) * speed) {
      _hit.t = t;
      _hit.x = bx;
      _hit.y = tr.y[i];
      _hit.z = bz;
      return _hit;
    }
  }
  // the ball stops before the horizon: he can always walk to a dead ball
  const last = tr.n - 1;
  if (last >= 0 && tr.n < TRAJ_N) {
    const bx = tr.x[last];
    const bz = tr.z[last];
    if (Math.abs(bx) <= CFG.halfL + 0.5 && Math.abs(bz) <= CFG.halfW + 0.5) {
      const d = Math.max(0, Math.hypot(bx - px, bz - pz) - reach);
      _hit.t = Math.max(last * TRAJ_DT, react + d / Math.max(0.1, speed));
      _hit.x = bx;
      _hit.y = tr.y[last];
      _hit.z = bz;
      return _hit;
    }
  }
  return null;
}

/**
 * Time (s) until the free ball crosses the plane x = `planeX`, with the crossing
 * point written to `out`. Returns −1 if it won't within the horizon.
 */
export function crossingAt(planeX: number, out: { y: number; z: number }): number {
  const tr = ballTrajectory();
  for (let i = 1; i < tr.n; i++) {
    const a = tr.x[i - 1] - planeX;
    const b = tr.x[i] - planeX;
    if (a === 0 || a * b < 0) {
      const f = a === b ? 0 : a / (a - b);
      out.y = tr.y[i - 1] + (tr.y[i] - tr.y[i - 1]) * f;
      out.z = tr.z[i - 1] + (tr.z[i] - tr.z[i - 1]) * f;
      return (i - 1 + f) * TRAJ_DT;
    }
  }
  return -1;
}

/** Is the ball currently a free ball that nobody controls (so its prediction is meaningful)? */
export function ballIsFree(): boolean {
  return match.controlPlayer === null;
}
