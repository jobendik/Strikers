import { CFG } from '../config/constants';
import { V3, clamp, distSq, headingVec, rand } from '../core/math';
import { ball, match, oppOf, teamIndex } from '../game/state';
import { kick, clearBall } from '../game/control';
import { evaluateCarrier } from './fuzzy';
import {
  addNoise,
  canShoot,
  clampShot,
  findBestPass,
  goalX,
  isOppWithin,
  nearestOpp,
} from './analysis';
import type { Player } from '../entities/Player';

// scratch target reused by the carrier decision
const _shot = V3();

/**
 * Ball-carrier behaviour. Dribbles toward goal every frame, then — throttled by
 * a Yuka Regulator — runs a fuzzy-logic decision to shoot, pass or clear.
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

  // how directly is the ball ahead of the player's heading?
  const toBall = V3(ball.position.x - p.position.x, 0, ball.position.z - p.position.z);
  const tl = toBall.length() || 1;
  const fwd = headingVec(p.heading);
  const dot = clamp((toBall.x / tl) * fwd.x + (toBall.z / tl) * fwd.z, 0, 1);

  // fuzzy inputs: distance to goal mouth, and marking pressure (0..1).
  // Both must stay within the FLV ranges or Yuka skips fuzzification.
  const distToGoal = clamp(Math.hypot(goalX(team) - ball.position.x, ball.position.z), 0, 30);
  const nd = o ? Math.hypot(o.position.x - p.position.x, o.position.z - p.position.z) : Infinity;
  const pressure01 = clamp(1 - nd / (CFG.comfortZone * 2), 0, 1);
  const desire = evaluateCarrier(distToGoal, pressure01);

  // 1) shoot — needs a clear lane AND fuzzy approval (else a rare pot shot)
  let power = CFG.shootPow * (0.6 + 0.4 * dot);
  let canSh = canShoot(ball.position, power, team, opp, _shot);
  const wantsShot = desire.shoot >= 45;
  if (!canSh && p.position.x * team.side > 4 && Math.random() < CFG.potShot) {
    _shot.set(goalX(team), 0, rand(-CFG.goalHalf * 0.8, CFG.goalHalf * 0.8));
    canSh = true;
  }
  if (canSh && (wantsShot || !isOppWithin(p, CFG.comfortZone))) {
    addNoise(_shot);
    clampShot(_shot, team);
    kick(p, V3(_shot.x - ball.position.x, 0, _shot.z - ball.position.z), power, 'kick');
    match.stats.shots[idx]++;
    return;
  }

  // 2) pass — when fuzzy says so or when threatened, and a safe lane exists
  power = CFG.passLong * (0.6 + 0.4 * dot);
  if (desire.pass >= 55 || isOppWithin(p, CFG.comfortZone)) {
    const pass = findBestPass(p, power, CFG.minPassDist, opp);
    if (pass) {
      addNoise(pass.target);
      kick(p, V3(pass.target.x - ball.position.x, 0, pass.target.z - ball.position.z), power, 'pass');
      return;
    }
  }

  // 3) cornered deep in our own half under pressure -> clear it
  if (isOppWithin(p, 1.7) && p.position.x * team.side < -6) clearBall(p);
}
