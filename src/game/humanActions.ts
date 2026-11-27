import type { Vector3 } from 'yuka';
import { CFG } from '../config/constants';
import { V3, clamp, headingVec } from '../core/math';
import { emit } from '../core/bus';
import { ball, match, oppOf } from './state';
import { canChipKeeper, findThroughBall, goalX, passWeight, pickShotTarget } from '../ai/analysis';
import { headBall, kick, lobKick, makeKick, requestKick, shootAt, startSlide, startTackle } from './control';
import { canHead, planarToBall } from './aerial';
import { interceptPoint } from './predict';
import { nextUserPlayer, setUser } from './movement';
import { timeBall } from '../entities/Ball';
import type { Player } from '../entities/Player';

/*
 * The human control layer: turns button presses into football actions.
 *
 * Design rules
 *   · Contextual, not modal — the same button does the sensible thing for the
 *     situation (SHOOT is a shot on the ball, a header under a high ball, a slide
 *     off it), so a beginner needs four buttons.
 *   · Expressive on top — modifiers (finesse, chip, through-ball, lob, jockey)
 *     and the stick add mastery without being required.
 *   · Aim is the player's — the stick chooses the corner / the receiver; assists
 *     only tidy the result (keep a shot inside the frame, lead a pass onto a run).
 *   · Buffered — an action pressed just before the ball arrives is played
 *     first-time as it arrives (first-time shots and one-touch passing).
 */

export interface ShotMods {
  /** Curl it with the inside of the foot: less pace, more bend, more accurate. */
  finesse?: boolean;
  /** Dink it over the keeper. */
  chip?: boolean;
}

const _tmp = V3();

function live(): Player | null {
  match.userIdleT = 0; // a button press is the user taking charge
  if (match.paused || match.state !== 'play' || match.restart) return null;
  return match.userPlayer;
}

/** Is the ball about to arrive at this player (so an action can be played first-time)? */
function ballArriving(p: Player): boolean {
  if (match.controlPlayer) return false;
  if (match.receivingPlayer === p) return true;
  const hit = interceptPoint(p.position.x, p.position.z, p.ath.sprint, 0, CFG.volleyHigh);
  return !!hit && hit.t < 0.55;
}

function stick(): { x: number; z: number; l: number } {
  const l = Math.hypot(match.input.x, match.input.z);
  return l > 0.25 ? { x: match.input.x / l, z: match.input.z / l, l } : { x: 0, z: 0, l: 0 };
}

/**
 * SHOOT. `charge` 0–1 sets pace and height (a tap is a low placed finish, a full
 * hold a rising drive). The stick picks the side of the goal; with the stick
 * idle the shot goes away from the keeper.
 */
export function userShoot(charge = 1, mods: ShotMods = {}): void {
  const p = live();
  if (!p) return;
  const team = p.team;
  const opp = oppOf(team);
  const onBall = match.controlPlayer === p;

  if (onBall || ballArriving(p)) {
    const gx = goalX(team);
    const dGoal = Math.hypot(gx - ball.position.x, ball.position.z);

    // chip: explicit modifier, or a soft tap with the keeper off his line
    if (mods.chip || (charge < 0.3 && canChipKeeper(ball.position, team, opp, _tmp))) {
      if (!mods.chip || !canChipKeeper(ball.position, team, opp, _tmp)) {
        // a manual chip with the keeper home: float it toward the far post
        _tmp.set(gx - team.side * 0.8, 0, clamp(-opp.gk.position.z * 2, -(CFG.goalHalf - 0.8), CFG.goalHalf - 0.8));
      }
      if (lobKick(p, _tmp, clamp(dGoal * 0.24, 3.0, 5.4), 'kick', 0, 'chip')) emit({ t: 'toast', text: 'CHIP!' });
      return;
    }

    // aim: stick chooses the corner (lateral component across the goal mouth)
    const s = stick();
    const G = CFG.goalHalf;
    let tz: number;
    if (s.l > 0) {
      // screen-space lateral is world z; pushing toward a post aims at it
      tz = clamp(s.z * 1.25, -1, 1) * (G - 0.25);
      // assist: don't let a slight stick lean put it straight at the keeper
      if (Math.abs(tz - opp.gk.position.z) < 0.6) tz += Math.sign(tz - opp.gk.position.z || 1) * 0.6;
    } else {
      pickShotTarget(ball.position, team, opp, p.ath.composure, _tmp);
      tz = _tmp.z;
    }
    // shooting assist keeps the *aim* inside the frame; execution error can still miss
    const margin = 0.35 + 0.35 * (1 - p.ath.shooting);
    tz = clamp(tz, -(G - margin), G - margin);
    const finesse = !!mods.finesse;
    // height from charge: tap = along the turf, full = just under the bar
    const ty = finesse ? 0.3 + 1.5 * charge : 0.25 + (CFG.crossbarH - 0.55) * charge * charge;
    let power = CFG.shootPow * (0.6 + 0.4 * charge) * (0.9 + 0.14 * p.ath.shooting);
    if (finesse) power *= 0.78;
    // finesse bends it away from the keeper and back inside the far post
    const curlSign = Math.sign(tz - opp.gk.position.z || 1) * team.side;
    const curl = finesse ? CFG.curlHuman * (0.55 + 0.45 * p.ath.shooting) * -curlSign : CFG.curlHuman * 0.12 * -curlSign;
    const airborne = ball.position.y > CFG.volleyLow && !onBall;
    if (shootAt(p, gx, ty, tz, power, curl, airborne ? 'volley' : finesse ? 'finesse' : 'shot')) {
      emit({ t: 'toast', text: airborne ? 'VOLLEY!' : finesse ? 'FINESSE' : charge > 0.8 ? 'SHOOT!' : charge < 0.35 ? 'PLACED' : 'SHOT' });
    }
    return;
  }

  // off the ball: a high ball is headed, otherwise it's a slide tackle
  if (canHead(p)) {
    const gx = goalX(team);
    const dGoal = Math.hypot(gx - ball.position.x, ball.position.z);
    if (dGoal < 16) {
      const tz = clamp(ball.position.z * 0.35, -(CFG.goalHalf - 0.6), CFG.goalHalf - 0.6);
      if (headBall(p, V3(gx - ball.position.x, 0, tz - ball.position.z), 15, true)) emit({ t: 'toast', text: 'HEADER!' });
    } else {
      const s = stick();
      headBall(p, V3(s.l > 0 ? s.x : team.side, 0, s.l > 0 ? s.z : 0), 13, false);
    }
    return;
  }
  if (match.controlTeam !== team && startSlide(p)) emit({ t: 'toast', text: 'SLIDE!' });
}

/** The team-mate the stick is pointing at (angle first, then distance), or null. */
function aimedMate(p: Player, maxAngleCos = 0.55): Player | null {
  const s = stick();
  let best: Player | null = null;
  let bs = -Infinity;
  for (const m of p.team.players) {
    if (m === p || m.sentOff) continue;
    const dx = m.position.x + m.velocity.x * 0.25 - p.position.x;
    const dz = m.position.z + m.velocity.z * 0.25 - p.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 2.2) continue;
    let score: number;
    if (s.l > 0) {
      const cos = (dx / d) * s.x + (dz / d) * s.z;
      if (cos < maxAngleCos) continue;
      // angle dominates; a nearer option wins between two in the same direction
      score = cos * 3 - d * 0.03;
    } else {
      // stick idle: the nearest open, forward option
      const fwd = (dx / d) * p.team.side;
      score = 1.2 * fwd - d * 0.06 - (m.roleType === 'GK' ? 1.5 : 0);
    }
    if (score > bs) {
      bs = score;
      best = m;
    }
  }
  return best;
}

/** Where to put a ground pass so it meets a moving team-mate in his stride. */
function leadTarget(p: Player, m: Player, power: number, out: Vector3): void {
  const d0 = Math.hypot(m.position.x - ball.position.x, m.position.z - ball.position.z);
  let t = timeBall(power, d0);
  if (t < 0) t = d0 / Math.max(6, power * 0.7);
  // he keeps running for most of the ball's travel time
  const k = Math.min(t, 1.4) * 0.75;
  out.set(
    clamp(m.position.x + m.velocity.x * k, -CFG.halfL + 1, CFG.halfL - 1),
    0,
    clamp(m.position.z + m.velocity.z * k, -CFG.halfW + 1, CFG.halfW - 1),
  );
  void p;
}

/**
 * PASS. A tap is a ground pass to the team-mate the stick points at; `lob`
 * (a held press) lofts it — a cross from wide, a ball over the top elsewhere.
 * With nobody in the stick's direction it is played into space that way.
 */
export function userPass(lob = false): void {
  const p = live();
  if (!p) return;
  const team = p.team;
  const onBall = match.controlPlayer === p;
  if (!onBall && !ballArriving(p)) {
    // off the ball, PASS is the standing tackle
    if (match.controlTeam !== team) startTackle(p);
    return;
  }
  const s = stick();
  const call =
    match.callingPlayer && match.callingPlayer.team === team && match.callingPlayer !== p && !match.callingPlayer.sentOff && match.callTarget
      ? { mate: match.callingPlayer, target: match.callTarget }
      : null;

  let mate = aimedMate(p);
  // stick idle: honour the team-mate calling for it
  if (s.l === 0 && call) mate = call.mate;

  if (lob) {
    if (!mate) {
      let adv = -Infinity;
      for (const m of team.outfield()) {
        if (m === p) continue;
        const a = m.position.x * team.side;
        if (a > adv) {
          adv = a;
          mate = m;
        }
      }
    }
    if (!mate) return;
    const wide = Math.abs(p.position.z) > 9 && p.position.x * team.side > 6;
    const d = Math.hypot(mate.position.x - p.position.x, mate.position.z - p.position.z);
    const flight = 0.9 + d * 0.035;
    _tmp.set(
      clamp(mate.position.x + mate.velocity.x * flight * 0.7 + team.side * 1.2, -CFG.halfL + 1.5, CFG.halfL - 1.5),
      0,
      clamp(mate.position.z + mate.velocity.z * flight * 0.7, -CFG.halfW + 1.5, CFG.halfW - 1.5),
    );
    const swing = wide ? CFG.curlCross * Math.sign(p.position.z || 1) * team.side : 0;
    if (lobKick(p, _tmp, clamp(d * 0.2, 2.6, 6), 'pass', swing, wide ? 'cross' : 'lob', mate)) {
      emit({ t: 'toast', text: wide ? `CROSS — ${mate.name}` : `OVER THE TOP — ${mate.name}` });
    }
    return;
  }

  if (mate) {
    const useCall = call && call.mate === mate && s.l === 0;
    if (useCall) _tmp.copy(call.target);
    else leadTarget(p, mate, CFG.passLong * 0.8, _tmp);
    const dx = _tmp.x - ball.position.x;
    const dz = _tmp.z - ball.position.z;
    const dist = Math.hypot(dx, dz);
    kick(p, V3(dx, 0, dz), passWeight(dist, CFG.passLong), 'pass', 0, 'pass', mate);
    return;
  }
  // nobody that way: play it into space where the stick points
  if (s.l > 0) {
    const spec = makeKick(p, 'pass', 'ground', ball.position.x + s.x * 14, 0, ball.position.z + s.z * 14, 14, { pass: true });
    requestKick(p, spec);
  }
}

/**
 * THROUGH-BALL. Played into space ahead of a runner, weighted to die in front of
 * him. `lob` floats it over the defensive line instead.
 */
export function userThrough(lob = false): void {
  const p = live();
  if (!p) return;
  if (match.controlPlayer !== p && !ballArriving(p)) return;
  const team = p.team;
  const opp = oppOf(team);
  const s = stick();
  // prefer the runner the stick points at; else the best one the AI can see
  let runner = s.l > 0 ? aimedMate(p, 0.3) : null;
  let tx = 0;
  let tz = 0;
  if (runner && runner.roleType !== 'GK') {
    const fwdV = Math.max(0, runner.velocity.x * team.side);
    const lead = 6 + fwdV * 0.75;
    tx = clamp(runner.position.x + team.side * lead, -CFG.halfL + 2, CFG.halfL - 2);
    tz = clamp(runner.position.z + runner.velocity.z * 0.5 + s.z * 2, -CFG.halfW + 2, CFG.halfW - 2);
  } else {
    const thr = findThroughBall(p, opp);
    if (!thr) {
      userPass(lob);
      return;
    }
    runner = thr.receiver;
    tx = thr.target.x;
    tz = thr.target.z;
  }
  const dx = tx - ball.position.x;
  const dz = tz - ball.position.z;
  const dist = Math.hypot(dx, dz);
  if (lob) {
    if (lobKick(p, _tmp.set(tx, 0, tz), clamp(dist * 0.17, 2.4, 5), 'pass', 0, 'lob', runner)) emit({ t: 'toast', text: 'LOBBED THROUGH!' });
  } else if (kick(p, V3(dx, 0, dz), passWeight(dist, CFG.throughPow, CFG.passArriveThrough), 'pass', 0, 'through', runner)) {
    emit({ t: 'toast', text: 'THROUGH BALL!' });
  }
}

/**
 * KNOCK-ON — push the ball well ahead and sprint onto it. Beats a flat-footed
 * defender for pace, but the ball is anyone's while it's away from his feet.
 */
export function userKnockOn(): void {
  const p = live();
  if (!p || match.controlPlayer !== p) return;
  const s = stick();
  const h = s.l > 0 ? { x: s.x, z: s.z } : headingVec(p.heading);
  const spec = makeKick(p, 'knock', 'ground', ball.position.x + h.x * 12, 0, ball.position.z + h.z * 12, CFG.knockSpeed, { pass: false, shot: false });
  if (requestKick(p, spec)) {
    p.boost = CFG.knockBoostTime;
    // he chases his own knock-on: keep him as the receiver so he isn't frozen out of it
    emit({ t: 'toast', text: 'KNOCK ON!' });
  }
}

/** Standing tackle (off the ball). */
export function userTackle(): void {
  const p = live();
  if (!p || match.controlTeam === p.team) return;
  if (planarToBall(p) < CFG.tackleReach + 1.2) startTackle(p);
}

/** SWITCH — to the next-best-placed player, or the one in the stick's direction. */
export function switchPlayer(dirX = 0, dirZ = 0): void {
  if (match.paused || match.state !== 'play' || !match.userPlayer) return;
  if (match.controlTeam === match.teams[0] && match.controlPlayer && match.controlPlayer.roleType !== 'GK') return;
  const next = nextUserPlayer(dirX, dirZ);
  if (next) {
    setUser(next);
    match.switchLock = 1.6;
  }
}
