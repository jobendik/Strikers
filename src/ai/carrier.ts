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
  goalX,
  isOppWithin,
  nearestOpp,
  passWeight,
  pickShotTarget,
} from './analysis';
import { chooseBestPass, keepValue, makePassOption } from './passing';
import type { Player } from '../entities/Player';

// scratch targets reused by the carrier decision
const _shot = V3();
const _chip = V3();
const _tgt = V3();
const _opt = makePassOption();

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
  // about to be closed down: the nearest man will be on him within a beat
  let closing = false;
  if (o && !pressured) {
    const ox = p.position.x - o.position.x;
    const oz = p.position.z - o.position.z;
    const od = Math.hypot(ox, oz) || 1;
    const rate = ((o.velocity.x - p.velocity.x) * ox + (o.velocity.z - p.velocity.z) * oz) / od;
    closing = od < 6 && rate > 1.5 && (od - 1.4) / rate < 0.7;
  }
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
    let need = 0.115 - 0.05 * A.composure - 0.07 * urgency + 0.12 * conserve - 0.035 * team.directness();
    // fuzzy approval (close + central + unmarked) lowers it; a hopeless angle raises it
    need -= (desire.shoot - 50) / 380;
    // a better pass on (someone calling in a better spot) makes him pickier
    if (match.callingPlayer && match.callingPlayer.team === team && match.callTarget) {
      const cx = estimateXg(team, match.callTarget.x, match.callTarget.z, 0.2);
      if (cx > xg * 1.35) need += 0.08;
    }
    const pot = chance(CFG.potShot * (1 + urgency * 3) * (1 - conserve * 0.9)) && distToGoal < 24;
    if (xg > need || (pot && openness > 0.25)) {
      // placement close in, power from range (power costs accuracy — see control.makeKick)
      const power = CFG.shootPow * clamp(0.6 + 0.013 * distToGoal + 0.12 * A.shooting, 0.68, 1);
      // a clinical finisher bends it away from the keeper, around him into the corner
      const curlSign = Math.sign(_shot.z - opp.gk.position.z || 1) * side;
      const finesse = distToGoal < 17 && A.shooting > 0.8 && openness < 0.8 && chance(0.4);
      const curl = (finesse ? CFG.curlAI * 1.5 : CFG.curlAI * 0.5) * A.shooting * -curlSign;
      shootAt(p, _shot.x, _shot.y, _shot.z, finesse ? power * 0.8 : power, curl, finesse ? 'finesse' : 'shot');
      return;
    }
  }

  // 2) CROSS — a lofted ball into the box from a wide, advanced position
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

  // 3) PASS or KEEP — a utility decision. The best ball on (to feet or into the
  // space a runner is attacking, scored by threat, ownership and distance) is
  // compared with what keeping it is worth (where he is, the room ahead, the
  // pressure on him). He releases it when the pass is clearly better football —
  // or straight away when he is being closed down.
  const haveOption = chooseBestPass(p, opp, _opt, pressured && toGoal > 34);
  if (haveOption) {
    const keep = keepValue(p);
    // a good passer sees it earlier; protecting a lead he recycles it more readily;
    // fuzzy "pass desirability" (far out / wide / marked) nudges the bar down
    const bar = 0.3 - 0.15 * A.passing - 0.25 * conserve - (desire.pass - 50) / 250;
    const better = _opt.utility > keep + bar;
    // Closed down he does not automatically get rid: with a man on him he will
    // lay it off if that is at least as good, play safe in his own half, or — the
    // better the dribbler, the more often — back himself to beat his man.
    const dribbler = 0.5 * A.control + 0.3 * A.agility + 0.2 * A.pace;
    const ownHalf = p.position.x * side < -2;
    const onTop = press > 0.74; // defender within a metre
    const underPressure =
      pressured && (_opt.utility > keep + 0.12 || (ownHalf && chance(0.5)) || (onTop && chance(0.45)) || chance(0.22 * (1.25 - dribbler)));
    // with time on the ball he takes a touch and looks up before moving it on — unless
    // the pass on is a clear chance (a runner in behind, a man free in the box)
    const killer = _opt.utility > keep + bar + 0.25;
    // the good passer moves it *before* the challenge arrives, while the lane is open
    const early = closing && held > 0.25 && _opt.utility > keep - 0.05 && chance(0.25 + 0.5 * A.passing);
    const release = boxedIn || underPressure || early || (held > (killer ? 0.3 : 0.9) && better && chance(killer ? 0.6 : 0.3)) || held > 5;
    if (release) {
      _tgt.set(_opt.x, 0, _opt.z);
      addNoise(_tgt, A.passing);
      const dx = _tgt.x - ball.position.x;
      const dz = _tgt.z - ball.position.z;
      const dist = Math.hypot(dx, dz);
      if (_opt.space) kick(p, V3(dx, 0, dz), passWeight(dist, CFG.throughPow, CFG.passArriveThrough), 'pass', 0, 'through', _opt.receiver);
      else kick(p, V3(dx, 0, dz), passWeight(dist, CFG.passLong), 'pass', 0, 'pass', _opt.receiver);
      return;
    }
  }

  // 4) cornered deep in our own half under pressure -> clear it
  if (isOppWithin(p, 1.6) && p.position.x * side < -15 && held > 0.5) clearBall(p);
}
