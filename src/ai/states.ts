import { State } from 'yuka';
import { CFG, DIFF } from '../config/constants';
import { V3, clamp, lerp } from '../core/math';
import { chance } from '../core/rng';
import { sim } from '../core/time';
import { ball, match } from '../game/state';
import { canHead, planarToBall } from '../game/aerial';
import { estimateXg, headBall, shootAt, startSlide, startTackle } from '../game/control';
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

/** AI header: on goal when it's a chance, otherwise up and away. */
function aiHeader(p: Player): void {
  const team = p.team;
  const gx = goalX(team);
  const distGoal = Math.hypot(gx - ball.position.x, ball.position.z);
  if (p.position.x * team.side > 6 && distGoal < 13) {
    const tz = clamp(ball.position.z * 0.4, -(CFG.goalHalf - 0.6), CFG.goalHalf - 0.6);
    headBall(p, V3(gx - ball.position.x, 0, tz - ball.position.z), 15, true);
  } else {
    headBall(p, V3(team.side, 0, Math.sign(ball.position.z || 1) * 0.6), 13, false);
  }
}

/** Hold/return to formation position; shuffle or mark when defending. */
class PositionState extends State<Player> {
  override execute(p: Player): void {
    if (p.isHuman && !p.autopilot) return;
    if (canHead(p)) {
      aiHeader(p);
      return;
    }
    let h = p.homePos();
    if (!p.team.inAttack && p.cover && p.markTarget) {
      // second defender: get in the way of the shot, square to the ball
      p.goArrive(p.markTarget, true);
      p.faceYaw = Math.atan2(ball.position.x - p.position.x, ball.position.z - p.position.z);
      return;
    }
    if (!p.team.inAttack && p.marking && p.markTarget) {
      h = V3(lerp(h.x, p.markTarget.x, 0.6), 0, lerp(h.z, p.markTarget.z, 0.6));
    } else if (!p.team.inAttack) {
      // slide laterally toward where the ball is perceived to be
      h.z = lerp(h.z, clamp(perceivedBallPos(p).z, -CFG.halfW + 3, CFG.halfW - 3), 0.25);
    }
    p.goArrive(h);
  }
}

/** Closest defender to the ball — close down, jockey, and pick the moment to tackle. */
class ChaseState extends State<Player> {
  override execute(p: Player): void {
    if (p.isHuman && !p.autopilot) return;
    if (canHead(p)) {
      aiHeader(p);
      return;
    }
    const D = DIFF[CFG.diff];
    const c = match.controlPlayer;
    if (c && c.team !== p.team && !(c.roleType === 'GK' && match.gkHold > 0) && match.setPieceT <= 0) {
      const reach = planarToBall(p);
      const side = p.team.side;
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
    if (canHead(p)) {
      aiHeader(p);
      return;
    }
    const far = Math.hypot(p.supportTarget.x - p.position.x, p.supportTarget.z - p.position.z) > 5;
    p.goArrive(p.supportTarget, far && p === match.callingPlayer);
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
    if (canHead(p)) {
      aiHeader(p);
      return;
    }
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
