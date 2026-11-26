import { CFG } from '../config/constants';
import { V3, clamp, distSq, headingVec } from '../core/math';
import { chance, rngRange } from '../core/rng';
import { sim } from '../core/time';
import { ball, match, oppOf, teamIndex } from '../game/state';
import { clearBall, estimateXg, kick, lobKick, pressureOn, shootAt } from '../game/control';
import { evaluateCarrier } from './fuzzy';

import {
  addNoise,
  canChipKeeper,
  findBestPass,
  findThroughBall,
  goalX,
  isOppWithin,
  nearestOpp,
  passWeight,
  pickShotTarget,
} from './analysis';
import type { Player } from '../entities/Player';

// scratch targets reused by the carrier decision
const _shot = V3();
const _chip = V3();

/**
 * Ball-carrier behaviour. Every tick he steers his dribble (toward goal, away
 * from the nearest defender, sprinting only into open grass); a few times a
 * second he weighs up his options — chip, shot, the team-mate calling for it,
 * a through-ball, a cross, a safe pass, or a clearance.
 *
 * The shot decision is an expected-value call (estimated xG × how much of the
 * goal the keeper leaves open) shaded by Yuka fuzzy logic on distance / pressure
 * / angle, the player's composure and the state of the match.
 */
export function aiCarry(p: Player, _dt: number): void {
  const team = p.team;
  const side = team.side;
  // --- dribble: steer toward goal, veering around the nearest opponent ---
  const gx = goalX(team);
  const toGoal = Math.abs(gx - p.position.x);
  const t = V3(clamp(p.position.x + side * 8, -CFG.halfL + 2, CFG.halfL - 2), 0, p.position.z * (toGoal < 16 ? 0.55 : 0.8));
  const o = nearestOpp(p);
  let open = true;
  if (o) {
    const d2 = distSq(o.position, p.position);
    const ahead = (o.position.x - p.position.x) * side;
    if (d2 < 36 && ahead > -1) {
      // go round him on the side with more room
      const ax = p.position.x - o.position.x;
      const az = p.position.z - o.position.z;
      const al = Math.hypot(ax, az) || 1;
      const sideStep = Math.sign(az || (p.position.z > 0 ? -1 : 1));
      t.x += (ax / al) * 2.5;
      t.z += sideStep * 5 + (az / al) * 2;
      open = d2 > 16 && ahead < 0.5;
    }
  }
  t.x = clamp(t.x, -CFG.halfL + 2, CFG.halfL - 2);
  t.z = clamp(t.z, -CFG.halfW + 2, CFG.halfW - 2);
  // burst into open grass; stay on the jog (close control) when someone is tight
  p.goArrive(t, open && p.stamina > 0.3);

  // --- decision (throttled) ---
  if (p.act === 'kick' || p.queued || p.busy()) return;
  if (!p.decisionRegulator.ready()) return;

  const opp = oppOf(team);
  const idx = teamIndex(team);
  const A = p.ath;
  const press = pressureOn(p);

  // fuzzy inputs: distance to goal mouth, marking pressure (0..1), centrality
  const distToGoal = clamp(Math.hypot(gx - ball.position.x, ball.position.z), 0, 30);
  const central01 = clamp(1 - Math.abs(ball.position.z) / CFG.halfW, 0, 1);
  const desire = evaluateCarrier(distToGoal, press, central01);

  // match context: chase the game late, protect a lead late
  const scoreDiff = match.score[idx] - match.score[1 - idx];
  const timeRemaining = match.timeLeft + (match.stoppageLeft > 0 ? match.stoppageLeft : 0);
  const late = match.half >= 2;
  const urgency = scoreDiff < 0 && late ? clamp(1 - timeRemaining / 45, 0, 1) : 0;
  const conserve = scoreDiff >= 1 && late && timeRemaining < 30 ? clamp(1 - timeRemaining / 30, 0, 1) : 0;

  // how long he has had it, and is he being closed down / boxed in?
  const held = sim.elapsed - p.gotBallT;
  // closed down: someone within ~1.5 m — or within ~2.5 m once he has had a moment on it
  const pressured = press > 0.6 || (press > 0.32 && held > 0.45);
  const speedNow = Math.hypot(p.velocity.x, p.velocity.z);
  const boxedIn = held > 0.8 && speedNow < 1.8 && !open;

  // facing: he can't hit a clean ball at a target behind him
  const h = headingVec(p.heading);
  const faceGoal = h.x * side;

  // 0) CHIP the keeper if he has come off his line
  if (A.composure > 0.6 && faceGoal > 0.2 && canChipKeeper(ball.position, team, opp, _chip) && chance(0.25 + A.composure * 0.4)) {
    addNoise(_chip, A.shooting);
    lobKick(p, _chip, clamp(distToGoal * 0.22, 3.2, 5.2), 'kick', 0, 'chip');
    return;
  }

  // 1) SHOOT — value of the chance vs. the nerve to take it
  if (faceGoal > -0.1 && distToGoal < CFG.shootRange) {
    const openness = pickShotTarget(ball.position, team, opp, A.composure, _shot);
    const xg = estimateXg(team, ball.position.x, ball.position.z, press) * (0.45 + 0.75 * openness);
    // threshold falls with composure and urgency, rises when protecting a lead
    let need = 0.2 - 0.07 * A.composure - 0.09 * urgency + 0.12 * conserve;
    // fuzzy approval (close + central + unmarked) lowers it; a hopeless angle raises it
    need -= (desire.shoot - 50) / 380;
    // a better pass on (someone calling in a better spot) makes him pickier
    if (match.callingPlayer && match.callingPlayer.team === team && match.callTarget) {
      const cx = estimateXg(team, match.callTarget.x, match.callTarget.z, 0.2);
      if (cx > xg * 1.35) need += 0.08;
    }
    const pot = chance(CFG.potShot * (1 + urgency * 3) * (1 - conserve * 0.9)) && distToGoal < 24;
    if (xg > need || (pot && openness > 0.25)) {
      const power = CFG.shootPow * (0.82 + 0.2 * A.shooting) * (distToGoal < 9 ? 0.86 : 1);
      // a clinical finisher bends it away from the keeper, around him into the corner
      const curlSign = Math.sign(_shot.z - opp.gk.position.z || 1) * side;
      const finesse = distToGoal < 17 && A.shooting > 0.8 && openness < 0.8 && chance(0.4);
      const curl = (finesse ? CFG.curlAI * 1.5 : CFG.curlAI * 0.5) * A.shooting * -curlSign;
      shootAt(p, _shot.x, _shot.y, _shot.z, finesse ? power * 0.8 : power, curl, finesse ? 'finesse' : 'shot');
      return;
    }
  }

  // 2) REQUESTED PASS — honour a team-mate who has found a safe lane
  const caller = match.callingPlayer;
  if (
    caller &&
    caller.team === team &&
    caller !== p &&
    !caller.sentOff &&
    match.callTarget &&
    (pressured || boxedIn || (held > 0.5 && (desire.pass >= 52 ? chance(0.3) : chance(0.06 + A.passing * 0.1))))
  ) {
    const target = match.callTarget.clone();
    addNoise(target, A.passing);
    const dx = target.x - ball.position.x;
    const dz = target.z - ball.position.z;
    const ahead = dx * side > 3;
    kick(p, V3(dx, 0, dz), passWeight(Math.hypot(dx, dz), CFG.passLong, ahead ? CFG.passArriveThrough + 1.5 : CFG.passArrive), 'pass', 0, ahead ? 'through' : 'pass', caller);
    return;
  }

  // 3) THROUGH-BALL — slide a runner in behind when not yet in shooting range
  if (distToGoal > 11 && held > 0.35 && chance(0.07 + A.passing * 0.14 + (pressured ? 0.2 : 0))) {
    const thr = findThroughBall(p, opp);
    if (thr) {
      addNoise(thr.target, A.passing);
      const dx = thr.target.x - ball.position.x;
      const dz = thr.target.z - ball.position.z;
      kick(p, V3(dx, 0, dz), passWeight(Math.hypot(dx, dz), CFG.throughPow, CFG.passArriveThrough), 'pass', 0, 'through', thr.receiver);
      return;
    }
  }

  // 4) CROSS — a lofted ball into the box from a wide, advanced position
  if (Math.abs(p.position.z) > 9 && p.position.x * side > 8) {
    let mate: Player | null = null;
    let bestD = Infinity;
    for (const m of team.outfield()) {
      if (m === p) continue;
      const central = Math.abs(m.position.z) < 8 && m.position.x * side > 12;
      const d = Math.hypot(gx - m.position.x, m.position.z);
      if (central && d < bestD) {
        bestD = d;
        mate = m;
      }
    }
    if (mate && held > 0.3 && chance(pressured ? 0.6 : 0.22)) {
      const swing = CFG.curlCross * Math.sign(p.position.z || 1) * side; // in-swinging toward goal
      // aim in front of the runner, between him and the goal
      const tx = clamp(mate.position.x + side * 1.5 + mate.velocity.x * 0.5, -CFG.halfL + 2, CFG.halfL - 2);
      lobKick(p, V3(tx, 0, mate.position.z + mate.velocity.z * 0.5), rngRange(3.2, 4.6), 'pass', swing, 'cross', mate);
      return;
    }
  }

  // 5) PASS — when fuzzy says so or when threatened, and a safe lane exists
  const passThreshold = 55 - conserve * 14;
  if (pressured || boxedIn || (desire.pass >= passThreshold && held > 1.1 && chance(0.25)) || held > 3.2) {
    const pass = findBestPass(p, CFG.passLong, CFG.minPassDist, opp);
    if (pass) {
      addNoise(pass.target, A.passing);
      const dx = pass.target.x - ball.position.x;
      const dz = pass.target.z - ball.position.z;
      kick(p, V3(dx, 0, dz), passWeight(Math.hypot(dx, dz), CFG.passLong), 'pass', 0, 'pass', pass.receiver);
      return;
    }
  }

  // 6) cornered deep in our own half under pressure -> clear it
  if (isOppWithin(p, 1.8) && p.position.x * side < -8) clearBall(p);
}
