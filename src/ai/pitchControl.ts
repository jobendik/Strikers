import { CFG } from '../config/constants';
import { clamp } from '../core/math';
import { SimRegulator } from '../core/time';
import { match } from '../game/state';
import { goalX } from './analysis';
import type { Player } from '../entities/Player';
import type { Team } from '../entities/Team';

/*
 * Pitch control.
 *
 * "Who gets there first?" answered for every patch of grass. For each cell of a
 * coarse grid we compute the time each side's quickest player needs to arrive —
 * from where he is, with the momentum he is carrying, at the pace he really has —
 * and turn the difference into a control probability. It is the standard football
 * analytics model, kept cheap enough to run several times a second.
 *
 * Nothing here decides anything by itself; it is the shared picture the decision
 * code reads:
 *   · off-ball support — run to space *we* get to first, not to a fixed spot
 *   · passing — a ball into space is on only if the runner beats the defenders to it
 *   · dribbling — carry when the grass ahead is ours, release when it is theirs
 *   · the dev lab draws it, so a tactical problem can be seen rather than guessed
 *
 * Deterministic: updated on a simulation-time regulator from simulation state only.
 */

export const PC_NX = 24;
export const PC_NZ = 16;
const N = PC_NX * PC_NZ;

/** Earliest arrival (s) of the home / away side at each cell centre. */
export const tHome = new Float32Array(N);
export const tAway = new Float32Array(N);
/** The same for outfield players only — a keeper guards his goal, he doesn't mark runners. */
export const tHomeOut = new Float32Array(N);
export const tAwayOut = new Float32Array(N);
/** Probability (0..1) that the *home* side controls each cell. */
export const control = new Float32Array(N);
/** Bumped every time the grid is recomputed (presentation uses it to refresh the overlay). */
export let pcVersion = 0;

/** How decisively a time advantage converts to control (seconds). */
const TAU = 0.45;

const regulator = new SimRegulator(8, 0.25);

export function cellX(ix: number): number {
  return -CFG.halfL + ((ix + 0.5) * 2 * CFG.halfL) / PC_NX;
}
export function cellZ(iz: number): number {
  return -CFG.halfW + ((iz + 0.5) * 2 * CFG.halfW) / PC_NZ;
}

/**
 * Seconds for `p` to get to (x, z): a reaction beat, then the distance from where
 * his current momentum is taking him, at close to his sprint speed. Players who
 * are on the floor, mid-tackle or stumbling pay for it.
 */
export function arrivalTime(p: Player, x: number, z: number): number {
  let react = 0.2;
  if (p.act === 'recover' || p.act === 'slide' || p.act === 'dive') react += Math.max(0.3, p.actDur - p.actT + 0.25);
  else if (p.act === 'stumble' || p.act === 'tackle') react += 0.3;
  // carry 0.25 s of current velocity: moving toward the point helps, away from it costs
  const sx = p.position.x + p.velocity.x * 0.25;
  const sz = p.position.z + p.velocity.z * 0.25;
  const d = Math.hypot(x - sx, z - sz);
  const v = p.ath.sprint * (0.82 + 0.12 * p.stamina);
  // a keeper does not leave his area to contest open grass
  let t = react + d / v;
  if (p.roleType === 'GK') {
    const own = p.team.side > 0 ? -CFG.halfL : CFG.halfL;
    if (Math.abs(x - own) > CFG.boxDepth || Math.abs(z) > CFG.boxHalfW) t += 2.5;
  }
  return t;
}

/** Earliest arrival of the side's *outfield* players (written to `_outfield`) and of anyone incl. the keeper (returned). */
let _outfield = Infinity;
function teamArrival(team: Team, x: number, z: number): number {
  let best = Infinity;
  let out = Infinity;
  for (const p of team.players) {
    if (p.sentOff) continue;
    const t = arrivalTime(p, x, z);
    if (t < best) best = t;
    if (p.roleType !== 'GK' && t < out) out = t;
  }
  _outfield = out;
  return best;
}

/** Recompute the grid if it is due (call once per tick while the ball is in play). */
export function updatePitchControl(force = false): void {
  if (!force && !regulator.ready()) return;
  const home = match.teams[0];
  const away = match.teams[1];
  let i = 0;
  for (let iz = 0; iz < PC_NZ; iz++) {
    const z = cellZ(iz);
    for (let ix = 0; ix < PC_NX; ix++, i++) {
      const x = cellX(ix);
      const th = teamArrival(home, x, z);
      tHomeOut[i] = _outfield;
      const ta = teamArrival(away, x, z);
      tAwayOut[i] = _outfield;
      tHome[i] = th;
      tAway[i] = ta;
      control[i] = 1 / (1 + Math.exp(-(ta - th) / TAU));
    }
  }
  pcVersion++;
}

/** Bilinear sample of a grid at a world position. */
function sample(grid: Float32Array, x: number, z: number): number {
  const fx = clamp(((x + CFG.halfL) / (2 * CFG.halfL)) * PC_NX - 0.5, 0, PC_NX - 1);
  const fz = clamp(((z + CFG.halfW) / (2 * CFG.halfW)) * PC_NZ - 0.5, 0, PC_NZ - 1);
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const x1 = Math.min(PC_NX - 1, x0 + 1);
  const z1 = Math.min(PC_NZ - 1, z0 + 1);
  const ax = fx - x0;
  const az = fz - z0;
  const a = grid[z0 * PC_NX + x0] * (1 - ax) + grid[z0 * PC_NX + x1] * ax;
  const b = grid[z1 * PC_NX + x0] * (1 - ax) + grid[z1 * PC_NX + x1] * ax;
  return a * (1 - az) + b * az;
}

/** Probability (0..1) that `team` controls the grass at (x, z). */
export function controlAt(team: Team, x: number, z: number): number {
  const c = sample(control, x, z);
  return team === match.teams[0] ? c : 1 - c;
}

/** Earliest arrival (s) of `team`'s opposing *outfield* players at (x, z) — who could mark or tackle a man there. */
export function oppArrivalAt(team: Team, x: number, z: number): number {
  return sample(team === match.teams[0] ? tAwayOut : tHomeOut, x, z);
}

/**
 * How dangerous is it for `team` to have the ball at (x, z)? 0..1 — a smooth
 * "expected threat": mostly proximity and angle to goal, plus a little credit for
 * simply being further up the pitch.
 */
export function threatAt(team: Team, x: number, z: number): number {
  const gx = goalX(team);
  const dx = Math.abs(gx - x);
  const dist = Math.hypot(dx, z);
  const ang = Math.abs(Math.atan2(CFG.goalHalf - z, dx) - Math.atan2(-CFG.goalHalf - z, dx));
  const af = clamp(ang / 0.7, 0, 1);
  const shot = Math.exp(-dist / 9) * Math.pow(af, 1.1);
  const adv = clamp((x * team.side + CFG.halfL) / (2 * CFG.halfL), 0, 1);
  return clamp(0.75 * shot + 0.25 * adv * adv, 0, 1);
}

/**
 * Share of the grass in a cone ahead of `p` (toward the goal he attacks) that his
 * side controls — the dribbler's "is there room to run into?".
 */
export function spaceAhead(p: Player, reach = 9): number {
  const side = p.team.side;
  let sum = 0;
  let n = 0;
  for (let k = 1; k <= 3; k++) {
    const d = (reach * k) / 3;
    for (let j = -1; j <= 1; j++) {
      const x = p.position.x + side * d;
      const z = p.position.z + j * d * 0.45;
      if (Math.abs(x) > CFG.halfL - 1 || Math.abs(z) > CFG.halfW - 1) continue;
      sum += controlAt(p.team, x, z);
      n++;
    }
  }
  return n ? sum / n : 0;
}
