import { State } from 'yuka';
import { CFG, DIFF } from '../config/constants';
import { V3, clamp, lerp } from '../core/math';
import { chance } from '../core/rng';
import { sim } from '../core/time';
import { ball, match } from '../game/state';
import { canHead, planarToBall } from '../game/aerial';
import { estimateXg, headBall, makeKick, shootAt, startSlide, startTackle } from '../game/control';
import { perceivedBallPos } from './perception';
import { goalX, ownGoalX, pickShotTarget } from './analysis';
import { aiCarry } from './carrier';
import { gkBrain } from './goalkeeper';
import type { Player } from '../entities/Player';
import type { PlayerRole } from '../config/types';

/*
 * Player states extend Yuka's `State` class — `StateMachine.add()` performs an
 * `instanceof State` check, so plain object literals are rejected at runtime.
 * Only `execute` is overridden; `enter`/`exit` inherit the base no-ops.
 */

const _aim = V3();

/**
 * AI header. On goal when it is a real chance (close in); a ball played to him
 * that he has time to bring down is left to drop; in their half he nods it on to
 * a team-mate; defending he heads it up and away. Returns false if he lets it go.
 */
function aiHeader(p: Player): boolean {
  const team = p.team;
  const side = team.side;
  const gx = goalX(team);
  const distGoal = Math.hypot(gx - ball.position.x, ball.position.z);
  const opp = match.teams[0] === team ? match.teams[1] : match.teams[0];
  if (p.position.x * side > 6 && distGoal < 9.5) {
    // down and away from the keeper, inside the post by as much as a header can stray
    const errDeg = makeKick(p, 'header', 'aim', gx, 0.6, 0, 15).err;
    pickShotTarget(ball.position, team, opp, p.ath.composure, _aim, errDeg);
    const tz = clamp(_aim.z, -(CFG.goalHalf - 0.5), CFG.goalHalf - 0.5);
    return headBall(p, V3(gx - ball.position.x, 0, tz - ball.position.z), 15, true);
  }
  let oppNear = Infinity;
  for (const o of opp.players) {
    if (o.sentOff) continue;
    oppNear = Math.min(oppNear, Math.hypot(o.position.x - p.position.x, o.position.z - p.position.z));
  }
  // nobody on him and it is dropping: bring it down instead of heading it back into
  // the air (except in front of his own goal, where it just has to go)
  const ownBox = Math.abs(p.position.x - ownGoalX(team)) < CFG.boxDepth + 2;
  if (oppNear > 2.6 && ball.velocity.y < 1.5 && !ownBox) return false;
  if (p.position.x * side > -4) {
    // nod it on to the nearest team-mate ahead of / level with him
    let mate: Player | null = null;
    let best = 14;
    for (const m of team.outfield()) {
      if (m === p || m.sentOff) continue;
      const d = Math.hypot(m.position.x - p.position.x, m.position.z - p.position.z);
      if (d > 3 && d < best && (m.position.x - p.position.x) * side > -4) {
        best = d;
        mate = m;
      }
    }
    if (mate) return headBall(p, V3(mate.position.x - ball.position.x, 0, mate.position.z - ball.position.z), 0, false, Math.max(4, best - 1));
  }
  return headBall(p, V3(side, 0, Math.sign(ball.position.z || 1) * 0.6), 13, false);
}

/** Hold/return to formation position; shuffle or mark when defending. */
class PositionState extends State<Player> {
  override execute(p: Player): void {
    if (p.isHuman && !p.autopilot) return;
    if (canHead(p) && aiHeader(p)) return;
    let h = p.homePos();
    if (!p.team.inAttack && p.cover && p.markTarget) {
      // second defender: get in the way of the shot, square to the ball
      p.goArrive(p.markTarget, true);
      p.faceYaw = Math.atan2(ball.position.x - p.position.x, ball.position.z - p.position.z);
      return;
    }
    if (!p.team.inAttack && p.marking && p.markTarget) {
      const w = p.markTight;
      h = V3(lerp(h.x, p.markTarget.x, w), 0, lerp(h.z, p.markTarget.z, w));
      if (w > 0.85) {
        // a man to pick up in front of our goal: stay with him, whatever the shape says
        p.goArrive(h, Math.hypot(h.x - p.position.x, h.z - p.position.z) > 2.5);
        return;
      }
    } else if (!p.team.inAttack) {
      // slide laterally toward where the ball is perceived to be
      h.z = lerp(h.z, clamp(perceivedBallPos(p).z, -CFG.halfW + 3, CFG.halfW - 3), 0.25);
    }
    if (!p.team.inAttack && !p.cover) {
      // compactness: the block moves with the ball. Drop when it is played in
      // behind our position, squeeze up when we are hunting it.
      const side = p.team.side;
      const t = p.team.tactic;
      const bx = perceivedBallPos(p).x;
      const depth = t === 'lowBlock' ? 11 : t === 'midBlock' ? 8 : 5; // how far goal-side of the ball the unit sits
      const lineX = bx - side * depth;
      const k = t === 'pressHigh' || t === 'counterPress' ? 0.55 : 0.4;
      const own = ownGoalX(p.team);
      let x = lerp(h.x, lineX, k);
      // never deeper than the edge of our six-yard area, never beyond the ball
      x = side > 0 ? clamp(x, own + 5, Math.max(own + 5, bx - 1)) : clamp(x, Math.min(own - 5, bx + 1), own - 5);
      h.x = x;
    }
    p.goArrive(h);
  }
}

/** Closest defender to the ball — close down, jockey, and pick the moment to tackle. */
class ChaseState extends State<Player> {
  override execute(p: Player): void {
    if (p.isHuman && !p.autopilot) return;
    if (canHead(p) && aiHeader(p)) return;
    const D = DIFF[CFG.diff];
    const c = match.controlPlayer;
    if (c && c.team !== p.team && !(c.roleType === 'GK' && match.gkHold > 0) && match.setPieceT <= 0) {
      const reach = planarToBall(p);
      const side = p.team.side;
      if (!p.team.engage && reach > 2.2) {
        // the block is set and the ball is beyond the line of engagement: don't
        // chase it — hold the carrier up from a distance, between him and our goal
        const ownX = ownGoalX(p.team);
        const gx0 = ownX - ball.position.x;
        const gz0 = -ball.position.z * 0.5;
        const gl0 = Math.hypot(gx0, gz0) || 1;
        const hold = 6.5;
        p.goJockey(V3(ball.position.x + (gx0 / gl0) * hold, 0, ball.position.z + (gz0 / gl0) * hold), Math.atan2(ball.position.x - p.position.x, ball.position.z - p.position.z));
        return;
      }
      // is he goal-side of the carrier (between ball and our goal)?
      const own = ownGoalX(p.team);
      const goalSide = Math.abs(p.position.x - own) < Math.abs(c.position.x - own) + 0.4;
      const cb = planarToBall(c); // how far the ball is from the carrier's feet

      if (reach < CFG.tackleReach - 0.1 && ball.position.y < 0.6 && p.tackleCd <= 0) {
        // In range. A good defender waits for the touch: the ball away from the
        // carrier's feet is the moment to step in. Timing sharpness = tackling + difficulty.
        const window = cb > 0.8 ? 1 : 0.25;
        const rate = (1.2 + 6.5 * p.ath.tackling) * window * (1.15 - D.react * 1.6);
        if (chance(rate * sim.dt)) {
          startTackle(p);
          return;
        }
      } else if (!goalSide && reach < CFG.slideReach + 1.0 && reach > 1.2 && p.slideCd <= 0 && ball.position.y < 0.5) {
        // beaten and chasing back: the last-ditch slide (risky — more so near our box)
        const inBox = Math.abs(ball.position.x - own) < CFG.boxDepth + 1 && Math.abs(ball.position.z) < CFG.boxHalfW;
        const danger = Math.abs(ball.position.x - own) < 20 ? 1.6 : 0.6;
        if (chance((0.25 + 0.7 * D.press) * danger * (inBox ? 0.4 : 1) * sim.dt)) {
          startSlide(p);
          return;
        }
      }

      if (goalSide && reach < 4.2 && reach > 1.0) {
        // jockey: hold him up, stay between ball and goal, close the last yard carefully
        const gx = own - ball.position.x;
        const gz = 0 - ball.position.z * 0.6;
        const gl = Math.hypot(gx, gz) || 1;
        const stand = clamp(reach - 0.9, 0.7, 1.4) * (1.1 - 0.5 * D.press);
        const tx = ball.position.x + c.velocity.x * 0.18 + (gx / gl) * stand;
        const tz = ball.position.z + c.velocity.z * 0.18 + (gz / gl) * stand;
        p.goJockey(V3(tx, 0, tz), Math.atan2(ball.position.x - p.position.x, ball.position.z - p.position.z));
        void side;
        return;
      }
      p.goPursue();
      return;
    }

    const rec = p.memory.getRecord(ball);
    if (rec && rec.visible) p.goPursue();
    else p.goArrive(perceivedBallPos(p), true); // chase last-known position from memory
  }
}

/** The carrier — dribble toward goal and decide shoot/pass/clear. */
class CarryState extends State<Player> {
  override execute(p: Player): void {
    if (p.isHuman && !p.autopilot) return;
    aiCarry(p, sim.dt);
  }
}

/** Off-ball attacker — move to the best support spot. */
class SupportState extends State<Player> {
  override execute(p: Player): void {
    if (p.isHuman && !p.autopilot) return;
    if (canHead(p) && aiHeader(p)) return;
    const far = Math.hypot(p.supportTarget.x - p.position.x, p.supportTarget.z - p.position.z) > 5;
    // on the counter everyone breaks at full pace; otherwise only the man showing for it sprints
    p.goArrive(p.supportTarget, far && (p === match.callingPlayer || p.team.tactic === 'counter' || sim.elapsed < p.burstT));
  }
}

/**
 * The intended receiver of a pass (Simple Soccer's `ReceiveBall`). Runs onto the
 * ball's predicted path — and, in front of goal with a clear sight of it, hits it
 * first time rather than taking a touch.
 */
class ReceiveState extends State<Player> {
  override execute(p: Player): void {
    if (p.isHuman && !p.autopilot) return;
    if (canHead(p) && aiHeader(p)) return;
    // first-time finish: the ball is arriving, he is in front of goal and composed enough
    if (!p.queued && p.act === 'none' && match.controlPlayer === null) {
      const d = planarToBall(p);
      const team = p.team;
      const distGoal = Math.hypot(goalX(team) - p.position.x, p.position.z);
      if (d < 3.2 && distGoal < 15 && ball.position.y < CFG.volleyHigh && p.ath.composure > 0.72) {
        const opp = match.teams[0] === team ? match.teams[1] : match.teams[0];
        const open = pickShotTarget(ball.position, team, opp, p.ath.composure, _aim);
        const xg = estimateXg(team, p.position.x, p.position.z, 0.2) * (0.45 + 0.75 * open);
        if (xg > 0.2 && chance(0.5 + 0.4 * p.ath.shooting)) {
          shootAt(p, _aim.x, _aim.y, _aim.z, CFG.shootPow * 0.88, 0, ball.position.y > CFG.volleyLow ? 'volley' : 'shot');
        }
      }
    }
    p.goPursue();
  }
}

/** Goalkeeper brain — tend goal, rush to intercept, or distribute. */
class GkState extends State<Player> {
  override execute(p: Player): void {
    if (p.isHuman && !p.autopilot) return;
    gkBrain(p, sim.dt);
  }
}

/** State registry, keyed to match the dynamic PlayerRole ids. */
export const PLAYER_STATES: Record<PlayerRole, State<Player>> = {
  POSITION: new PositionState(),
  CHASER: new ChaseState(),
  CARRIER: new CarryState(),
  SUPPORT: new SupportState(),
  RECEIVE: new ReceiveState(),
  GK: new GkState(),
};
