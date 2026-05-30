import { CFG } from '../config/constants';
import { attr01 } from '../config/players';
import { V3, clamp, distSq, headingVec, rand } from '../core/math';
import { ball, match, oppOf, teamIndex } from '../game/state';
import { kick, clearBall, lobKick } from '../game/control';
import { evaluateCarrier } from './fuzzy';
import {
  addNoise,
  canChipKeeper,
  canShoot,
  clampShot,
  findBestPass,
  findThroughBall,
  goalX,
  isOppWithin,
  nearestOpp,
} from './analysis';
import type { Player } from '../entities/Player';

// scratch targets reused by the carrier decision
const _shot = V3();
const _chip = V3();

/**
 * Ball-carrier behaviour. Dribbles toward goal every frame, then — throttled by
 * a Yuka Regulator — runs a fuzzy-logic decision that now arbitrates between a
 * chip over the keeper, a shot, a through-ball, a cross, a safe pass or a
 * clearance. Player attributes (shooting, passing, composure) shade every call.
 */
export function aiCarry(p: Player, _dt: number): void {
  // --- dribble: steer toward goal, veering around the nearest opponent ---
  const t = V3(clamp(p.position.x + p.team.side * 7, -CFG.halfL + 2, CFG.halfL - 2), 0, p.position.z * 0.7);
  const o = nearestOpp(p);
  if (o && distSq(o.position, p.position) < 25) {
    const ax = p.position.x - o.position.x;
    const az = p.position.z - o.position.z;
    const al = Math.hypot(ax, az) || 1;
    t.x += (ax / al) * 4;
    t.z += (az / al) * 4;
  }
  t.x = clamp(t.x, -CFG.halfL + 2, CFG.halfL - 2);
  t.z = clamp(t.z, -CFG.halfW + 2, CFG.halfW + 2);
  p.goArrive(t);

  // --- decision (throttled) ---
  if (!p.decisionRegulator.ready()) return;

  const team = p.team;
  const opp = oppOf(team);
  const idx = teamIndex(team);
  const shootAcc = attr01(p.attr.shooting);
  const passAcc = attr01(p.attr.passing);
  const composure = attr01(p.attr.composure);

  // how directly is the ball ahead of the player's heading?
  const toBall = V3(ball.position.x - p.position.x, 0, ball.position.z - p.position.z);
  const tl = toBall.length() || 1;
  const fwd = headingVec(p.heading);
  const dot = clamp((toBall.x / tl) * fwd.x + (toBall.z / tl) * fwd.z, 0, 1);

  // fuzzy inputs: distance to goal mouth, and marking pressure (0..1).
  const distToGoal = clamp(Math.hypot(goalX(team) - ball.position.x, ball.position.z), 0, 30);
  const nd = o ? Math.hypot(o.position.x - p.position.x, o.position.z - p.position.z) : Infinity;
  const pressure01 = clamp(1 - nd / (CFG.comfortZone * 2), 0, 1);
  const desire = evaluateCarrier(distToGoal, pressure01);

  // 0) CHIP the keeper if he has rushed off his line — high-reward, composure-gated
  if (composure > 0.55 && canChipKeeper(ball.position, team, opp, _chip) && Math.random() < 0.35 + composure * 0.45) {
    addNoise(_chip, shootAcc); // target already sits just beyond the line; keep its arc
    lobKick(p, _chip, 3.1, 'kick');
    match.stats.shots[idx]++;
    return;
  }

  // 1) SHOOT — needs a clear lane AND fuzzy approval; composure lowers the nerve threshold
  let power = CFG.shootPow * (0.6 + 0.4 * dot) * (0.85 + 0.3 * shootAcc);
  let canSh = canShoot(ball.position, power, team, opp, _shot);
  const wantsShot = desire.shoot >= 45 - composure * 14;
  if (!canSh && p.position.x * team.side > 4 && Math.random() < CFG.potShot) {
    _shot.set(goalX(team), 0, rand(-CFG.goalHalf * 0.8, CFG.goalHalf * 0.8));
    canSh = true;
  }
  if (canSh && (wantsShot || !isOppWithin(p, CFG.comfortZone))) {
    addNoise(_shot, shootAcc);
    clampShot(_shot, team);
    kick(p, V3(_shot.x - ball.position.x, 0, _shot.z - ball.position.z), power, 'kick');
    match.stats.shots[idx]++;
    return;
  }

  // 2) THROUGH-BALL — slide a runner in behind when we're not yet in shooting range
  if (distToGoal > 10 && Math.random() < 0.4 + passAcc * 0.4) {
    const thr = findThroughBall(p, opp);
    if (thr) {
      addNoise(thr.target, passAcc);
      kick(p, V3(thr.target.x - ball.position.x, 0, thr.target.z - ball.position.z), CFG.throughPow, 'pass');
      return;
    }
  }

  // 3) CROSS — lofted ball into the box from a wide, advanced position
  if (Math.abs(p.position.z) > 8 && p.position.x * team.side > 6) {
    let mate: Player | null = null;
    let bestD = Infinity;
    for (const m of team.outfield()) {
      if (m === p) continue;
      const central = Math.abs(m.position.z) < 8 && m.position.x * team.side > 7;
      const d = Math.hypot(goalX(team) - m.position.x, m.position.z);
      if (central && d < bestD) {
        bestD = d;
        mate = m;
      }
    }
    if (mate && Math.random() < 0.5) {
      lobKick(p, V3(mate.position.x + team.side, 0, mate.position.z), 2.6, 'pass');
      return;
    }
  }

  // 4) PASS — when fuzzy says so or when threatened, and a safe lane exists
  power = CFG.passLong * (0.6 + 0.4 * dot);
  if (desire.pass >= 55 || isOppWithin(p, CFG.comfortZone)) {
    const pass = findBestPass(p, power, CFG.minPassDist, opp);
    if (pass) {
      addNoise(pass.target, passAcc);
      kick(p, V3(pass.target.x - ball.position.x, 0, pass.target.z - ball.position.z), power, 'pass');
      return;
    }
  }

  // 5) cornered deep in our own half under pressure -> clear it
  if (isOppWithin(p, 1.7) && p.position.x * team.side < -6) clearBall(p);
}
