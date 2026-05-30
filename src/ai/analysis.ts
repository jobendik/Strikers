import { Vector3 } from 'yuka';
import { CFG } from '../config/constants';
import { V3, clamp, distSq, rand } from '../core/math';
import { timeBall } from '../entities/Ball';
import { ball, oppOf } from '../game/state';
import type { Player } from '../entities/Player';
import type { Team } from '../entities/Team';

/* ----------------------------- geometry helpers -------------------------- */

export function attackHeading(side: number): number {
  return side > 0 ? Math.PI / 2 : -Math.PI / 2;
}
export function goalX(team: Team): number {
  return team.side > 0 ? CFG.halfL : -CFG.halfL;
}
export function ownGoalX(team: Team): number {
  return team.side > 0 ? -CFG.halfL : CFG.halfL;
}
export function nearestOpp(p: Player): Player | null {
  let n: Player | null = null;
  let nd = Infinity;
  for (const o of oppOf(p.team).players) {
    const d = distSq(o.position, p.position);
    if (d < nd) {
      nd = d;
      n = o;
    }
  }
  return n;
}
export function isOppWithin(p: Player, r: number): boolean {
  const r2 = r * r;
  for (const o of oppOf(p.team).players) {
    if (distSq(o.position, p.position) <= r2) return true;
  }
  return false;
}
export function isInside(p: Vector3): boolean {
  return Math.abs(p.x) < CFG.halfL - 0.3 && Math.abs(p.z) < CFG.halfW - 0.3;
}
export function supportSpot(team: Team, carrier: Player, sideSign: number): Vector3 {
  return V3(
    clamp(carrier.position.x + team.side * 9, -CFG.halfL + 6, CFG.halfL - 6),
    0,
    clamp(carrier.position.z + sideSign * 8, -CFG.halfW + 4, CFG.halfW - 4),
  );
}

// scratch vectors reused across analysis calls
const _tmpT2 = V3();

/* ------------------- pass safety (Buckland time-to-intercept) ------------ */

export function isPassSafeFromOpp(
  start: Vector3,
  target: Vector3,
  receiver: Player | null,
  opp: Player,
  power: number,
): boolean {
  const dx = target.x - start.x;
  const dz = target.z - start.z;
  const L = Math.hypot(dx, dz) || 1e-6;
  const fx = dx / L;
  const fz = dz / L;
  const rx = fz;
  const rz = -fx; // forward + lateral axes
  const ox = opp.position.x - start.x;
  const oz = opp.position.z - start.z;
  const lz = ox * fx + oz * fz;
  const lx = ox * rx + oz * rz;
  if (lz < 0) return true; // opponent is behind the ball
  const d2st = distSq(start, target);
  const d2so = distSq(start, opp.position);
  if (d2st < d2so) {
    if (receiver) return distSq(target, opp.position) > distSq(target, receiver.position);
    return true;
  }
  const t = timeBall(power, lz);
  if (t < 0) return true;
  const reach = opp.maxSpeed * t + CFG.ballR + CFG.playerR;
  return reach < Math.abs(lx);
}

export function isPassSafe(
  start: Vector3,
  target: Vector3,
  receiver: Player | null,
  power: number,
  oppTeam: Team,
  skipGK = false,
): boolean {
  for (const o of oppTeam.players) {
    if (skipGK && o.roleType === 'GK') continue;
    if (!isPassSafeFromOpp(start, target, receiver, o, power)) return false;
  }
  return true;
}

/** Can a goal be scored from `origin` with `power`? Fills `out` with a target. */
export function canShoot(origin: Vector3, power: number, team: Team, oppTeam: Team, out: Vector3): boolean {
  const gX = goalX(team);
  const hw = CFG.goalHalf;
  for (let i = 0; i < CFG.shootAttempts; i++) {
    const z = rand(-hw + CFG.ballR, hw - CFG.ballR);
    const tgt = V3(gX, 0, z);
    if (timeBall(power, Math.hypot(gX - origin.x, z - origin.z)) < 0) continue;
    if (isPassSafe(origin, tgt, null, power, oppTeam, true)) {
      out.copy(tgt);
      return true;
    }
  }
  return false;
}

/** Tangent points from P to circle(C, R), or null if P is inside the circle. */
export function tangentPoints(C: Vector3, R: number, P: Vector3): [Vector3, Vector3] | null {
  const d = Math.hypot(P.x - C.x, P.z - C.z);
  if (d <= R || R <= 0) return null;
  const ax = (P.x - C.x) / d;
  const az = (P.z - C.z) / d;
  const al = Math.acos(clamp(R / d, -1, 1));
  const c = Math.cos(al);
  const s = Math.sin(al);
  return [
    V3(C.x + R * (ax * c - az * s), 0, C.z + R * (ax * s + az * c)),
    V3(C.x + R * (ax * c + az * s), 0, C.z + R * (-ax * s + az * c)),
  ];
}

/** Best (lead) pass to a given receiver -> fills `out`, returns whether one exists. */
export function getBestPassToReceiver(passer: Player, receiver: Player, power: number, oppTeam: Team, out: Vector3): boolean {
  const t = timeBall(power, passer.position.distanceTo(receiver.position));
  if (t < 0) return false;
  const range = t * receiver.maxSpeed * CFG.passInterceptScale;
  const tp = tangentPoints(receiver.position, range, ball.position);
  const cand = tp ? [tp[0], V3(receiver.position.x, 0, receiver.position.z), tp[1]] : [V3(receiver.position.x, 0, receiver.position.z)];
  const oppGoal = V3(goalX(passer.team), 0, 0);
  let best = false;
  let minGoal = Infinity;
  for (const c of cand) {
    if (!isInside(c)) continue;
    if (isPassSafe(ball.position, c, receiver, power, oppTeam)) {
      const gd = distSq(c, oppGoal);
      if (gd < minGoal) {
        minGoal = gd;
        out.copy(c);
        best = true;
      }
    }
  }
  return best;
}

/** Scan teammates for the best safe pass toward the opponent goal. */
export function findBestPass(
  passer: Player,
  power: number,
  minDist: number,
  oppTeam: Team,
): { receiver: Player; target: Vector3 } | null {
  const team = passer.team;
  const oppGoal = V3(goalX(team), 0, 0);
  let receiver: Player | null = null;
  let minGoal = Infinity;
  const tgt = V3();
  for (const m of team.players) {
    if (m === passer) continue;
    if (passer.position.distanceTo(m.position) < minDist) continue;
    if (getBestPassToReceiver(passer, m, power, oppTeam, _tmpT2)) {
      const gd = distSq(_tmpT2, oppGoal);
      if (gd < minGoal) {
        minGoal = gd;
        receiver = m;
        tgt.copy(_tmpT2);
      }
    }
  }
  return receiver ? { receiver, target: tgt } : null;
}

/**
 * Difficulty- and skill-scaled aiming noise added to a target. `accuracy` is a
 * 0–1 attribute fraction (shooting/passing/composure) — a clinical player
 * sprays the ball far less than a journeyman.
 */
export function addNoise(t: Vector3, accuracy = 0.5): void {
  const n = (0.78 - CFG.diff * 0.2) * (1.25 - accuracy);
  t.z += rand(-n, n);
  t.x += rand(-n, n) * 0.4;
}

/**
 * A driven through-ball into space ahead of a forward-running teammate, behind
 * the defensive line — a first-class action from the footballSimulationEngine
 * set. Returns the runner and the space to play them into, or null.
 */
export function findThroughBall(passer: Player, oppTeam: Team): { receiver: Player; target: Vector3 } | null {
  const team = passer.team;
  const gx = goalX(team);
  let best: Player | null = null;
  let bestScore = -Infinity;
  const target = V3();
  const tgt = V3();
  for (const m of team.outfield()) {
    if (m === passer) continue;
    const ahead = (m.position.x - passer.position.x) * team.side;
    if (ahead < -1.5) continue; // only thread it forward
    tgt.set(
      clamp(m.position.x + team.side * 6.5, -CFG.halfL + 3, CFG.halfL - 3),
      0,
      clamp(m.position.z * 0.85, -CFG.halfW + 3, CFG.halfW - 3),
    );
    if (!isInside(tgt)) continue;
    if (passer.position.distanceTo(m.position) < CFG.minPassDist) continue;
    if (!isPassSafe(ball.position, tgt, m, CFG.throughPow, oppTeam, true)) continue;
    const score = -Math.abs(gx - tgt.x) + ahead * 0.6;
    if (score > bestScore) {
      bestScore = score;
      best = m;
      target.copy(tgt);
    }
  }
  return best ? { receiver: best, target } : null;
}

/**
 * If the opposing keeper has rushed off the line, returns a chip target under
 * the bar behind them, else null. Enables the AI (and assists the human) to lob
 * an advancing goalkeeper — only possible with the aerial ball model.
 */
export function canChipKeeper(origin: Vector3, team: Team, oppTeam: Team, out: Vector3): boolean {
  const gk = oppTeam.gk;
  const gx = goalX(team);
  if (Math.abs(gx - gk.position.x) < 3.5) return false; // keeper still on his line
  if ((gk.position.x - origin.x) * team.side <= 0) return false; // keeper not between ball and goal
  const dgoal = Math.abs(gx - origin.x);
  if (dgoal > 17 || dgoal < 3.5) return false;
  // aim ~2 units beyond the line so the ball is still dropping (over the keeper,
  // under the bar) as it crosses the goal line, rather than bottoming out on it.
  out.set(gx + team.side * 2, 0, clamp(origin.z * 0.3, -(CFG.goalHalf - 0.7), CFG.goalHalf - 0.7));
  return true;
}

/** Snaps a shot target onto the goal line, inside the posts. */
export function clampShot(t: Vector3, team: Team): void {
  t.x = goalX(team);
  t.z = clamp(t.z, -(CFG.goalHalf - 0.35), CFG.goalHalf - 0.35);
}
