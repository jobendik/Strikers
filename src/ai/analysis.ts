import { Vector3 } from 'yuka';
import { CFG } from '../config/constants';
import { V3, clamp, distSq, rand } from '../core/math';
import { rollSpeedFor, timeBall } from '../entities/Ball';
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
    if (o.sentOff) continue;
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
  let ox = opp.position.x - start.x;
  let oz = opp.position.z - start.z;
  const d2so = ox * ox + oz * oz;
  // a man closing the passer down keeps coming while the ball is struck: judge the
  // lane against where his run takes him in the next moment, not where he is now
  if (d2so < 30) {
    ox += opp.velocity.x * 0.22;
    oz += opp.velocity.z * 0.22;
  }
  const lz = ox * fx + oz * fz;
  const lx = ox * rx + oz * rz;
  if (lz < 0) return true; // opponent is behind the ball
  const d2st = distSq(start, target);
  if (d2st < d2so) {
    // the opponent is beyond the target: safe only if the receiver clearly gets there first
    if (receiver) return Math.sqrt(distSq(target, opp.position)) > Math.sqrt(distSq(target, receiver.position)) + 2.4;
    return true;
  }
  const t = timeBall(power, lz);
  if (t < 0) return true;
  // he needs a moment to read it, then covers ground at close to his sprint speed
  const react = opp.roleType === 'GK' ? 0.12 : 0.2;
  const reach = opp.ath.sprint * 0.92 * Math.max(0, t - react) + CFG.controlR + 0.25;
  return reach < Math.abs(lx);
}

export function isPassSafe(
  start: Vector3,
  target: Vector3,
  receiver: Player | null,
  power: number,
  oppTeam: Team,
  skipGK = false,
  weighted = true,
): boolean {
  // judge the pass at the pace it will actually be played (weighted to arrive), not flat out
  if (weighted) power = passWeight(Math.hypot(target.x - start.x, target.z - start.z), power);
  for (const o of oppTeam.players) {
    if (o.sentOff) continue;
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
    if (isPassSafe(origin, tgt, null, power, oppTeam, true, false)) {
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
  // Execution error is now applied to the strike itself (see control.makeKick);
  // this only adds a small *decision* imprecision to where the AI means to put it.
  const n = 0.22 * (1.25 - accuracy);
  t.z += rand(-n, n);
  t.x += rand(-n, n) * 0.4;
}

/**
 * Strike power for a ground pass that should *arrive* at `dist` rather than be
 * blasted at a fixed speed. Inverts the rolling-friction range model
 * (range = v²/2a ⇒ v = √(2·a·range)) and aims a little past the target so a
 * runner can chase it, clamped to a floor and the caller's budget `maxPow`. A
 * 5-unit pass becomes a crisp ~12 u/s roll instead of a 24 u/s missile.
 */
export function passWeight(dist: number, maxPow: number, arrive = CFG.passArrive): number {
  // exact inverse of the rolling model: hit it so it is still doing `arrive` m/s on arrival
  const v = rollSpeedFor(dist, arrive);
  return clamp(v, Math.min(CFG.passMinPow, maxPow), maxPow);
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
    // lead the runner: further when he is already moving forward at pace
    const fwdV = Math.max(0, m.velocity.x * team.side);
    const lead = 5 + fwdV * 0.6;
    tgt.set(
      clamp(m.position.x + team.side * lead, -CFG.halfL + 2.5, CFG.halfL - 2.5),
      0,
      clamp(m.position.z * 0.88 + m.velocity.z * 0.4, -CFG.halfW + 3, CFG.halfW - 3),
    );
    if (!isInside(tgt)) continue;
    if (passer.position.distanceTo(m.position) < CFG.minPassDist) continue;
    if (!isPassSafe(ball.position, tgt, m, passWeight(Math.hypot(tgt.x - ball.position.x, tgt.z - ball.position.z), CFG.throughPow, CFG.passArriveThrough), oppTeam, true, false)) continue;
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
  if (Math.abs(gx - gk.position.x) < 4.2) return false; // keeper still near his line
  if ((gk.position.x - origin.x) * team.side <= 0) return false; // keeper not between ball and goal
  const dgoal = Math.abs(gx - origin.x);
  const dkeeper = Math.hypot(gk.position.x - origin.x, gk.position.z - origin.z);
  if (dgoal > 24 || dgoal < 8 || dkeeper < 3.5) return false;
  // land it a metre short of the line so it drops under the bar behind him
  out.set(gx - team.side * 1.0, 0, clamp(origin.z * 0.3, -(CFG.goalHalf - 0.9), CFG.goalHalf - 0.9));
  return true;
}

/** Snaps a shot target onto the goal line, inside the posts. */
export function clampShot(t: Vector3, team: Team): void {
  t.x = goalX(team);
  t.z = clamp(t.z, -(CFG.goalHalf - 0.45), CFG.goalHalf - 0.45);
}

/**
 * Choose where in the goal mouth to shoot: the reachable point furthest from the
 * keeper (low corners when he is central, the open side when he is off-centre).
 * Writes the aim point (x on the goal line, y height, z) into `out` and returns a
 * 0..1 "openness" score (how much of the goal the keeper leaves uncovered there).
 * `composure` decides how fine the shooter dares to cut it toward the post/bar.
 */
export function pickShotTarget(origin: Vector3, team: Team, oppTeam: Team, composure: number, out: Vector3, errDeg = 0): number {
  const gx = goalX(team);
  const gk = oppTeam.gk;
  const G = CFG.goalHalf;
  // metres inside the post he aims: as fine as he dares — but a shooter who knows
  // how much this strike can stray (`errDeg`, 1σ) leaves himself that much frame
  const dGoal = Math.hypot(gx - origin.x, origin.z);
  const spread = dGoal * Math.tan((errDeg * Math.PI) / 180);
  const margin = clamp(Math.max(1.15 - 0.5 * composure, 0.3 + 0.8 * spread), 0.5, G - 1.1);
  // where the keeper's body would be on the shot line when the ball passes him
  let best = -1;
  for (let i = 0; i < 6; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = side * Math.max(0.6, G - margin - (i >= 4 ? 1.1 : 0));
    const y = i >= 2 && i < 4 ? CFG.crossbarH - 0.8 - 0.3 * (1 - composure) : 0.35;
    // keeper's lateral offset from the shot line, measured at the keeper's depth
    const tK = clamp((gk.position.x - origin.x) / (gx - origin.x || 1e-6), 0, 1);
    const zAtK = origin.z + (z - origin.z) * tK;
    const off = Math.abs(zAtK - gk.position.z);
    // high shots are harder to save but harder to hit; low corners are the percentage ball
    // low into the corner is the percentage finish; going high only pays when the keeper is close and set
    const dK = Math.hypot(gk.position.x - origin.x, gk.position.z - origin.z);
    let score = clamp(off / 2.6, 0, 1) + (y > 1 ? (dK < 7 ? 0.1 : -0.08) : 0);
    // an outfield defender standing on the line of the shot blocks it
    for (const o of oppTeam.players) {
      if (o === gk || o.sentOff) continue;
      const tO = (o.position.x - origin.x) / (gx - origin.x || 1e-6);
      if (tO <= 0.03 || tO >= 1) continue;
      const zO = origin.z + (z - origin.z) * tO;
      if (Math.abs(zO - o.position.z) < 0.7 && (y < 1.2 || tO < 0.25)) score -= 0.6;
    }
    if (score > best) {
      best = score;
      out.set(gx, y, z);
    }
  }
  return clamp(best, 0, 1);
}
