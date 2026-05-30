import { State } from 'yuka';
import { CFG, DIFF } from '../config/constants';
import { V3, clamp, lerp } from '../core/math';
import { sim } from '../core/time';
import { ball, match, teamIndex } from '../game/state';
import { canHead, planarToBall } from '../game/aerial';
import { headBall, startSlide } from '../game/control';
import { perceivedBallPos } from './perception';
import { goalX } from './analysis';
import { aiCarry } from './carrier';
import { gkBrain } from './goalkeeper';
import type { Player } from '../entities/Player';
import type { PlayerRole } from '../config/types';

/*
 * Player states extend Yuka's `State` class — `StateMachine.add()` performs an
 * `instanceof State` check, so plain object literals are rejected at runtime.
 * Only `execute` is overridden; `enter`/`exit` inherit the base no-ops.
 */

/** AI header: knock an airborne ball on goal (attacking) or upfield (defending). */
function aiHeader(p: Player): void {
  const team = p.team;
  const gx = goalX(team);
  const distGoal = Math.hypot(gx - ball.position.x, ball.position.z);
  if (p.position.x * team.side > 4 && distGoal < 16) {
    const tz = clamp(ball.position.z * 0.4, -(CFG.goalHalf - 0.6), CFG.goalHalf - 0.6);
    headBall(p, V3(gx - ball.position.x, 0, tz - ball.position.z), CFG.passShort);
    match.stats.shots[teamIndex(team)]++;
  } else {
    headBall(p, V3(team.side, 0, Math.sign(ball.position.z || 1) * 0.7), CFG.clearPow * 0.7);
  }
}

/** Hold/return to formation position; shuffle or mark when defending. */
class PositionState extends State<Player> {
  override execute(p: Player): void {
    if (p.isHuman) return;
    if (canHead(p)) {
      aiHeader(p);
      return;
    }
    let h = p.homePos();
    if (!p.team.inAttack && p.marking && p.markTarget) {
      h = V3(lerp(h.x, p.markTarget.x, 0.55), 0, lerp(h.z, p.markTarget.z, 0.55));
    } else if (!p.team.inAttack) {
      // slide laterally toward where the ball is perceived to be
      h.z = lerp(h.z, clamp(perceivedBallPos(p).z, -CFG.halfW + 3, CFG.halfW - 3), 0.2);
    }
    p.goArrive(h);
  }
}

/** Closest defender to the ball — intercept it, head it, or slide in. */
class ChaseState extends State<Player> {
  override execute(p: Player): void {
    if (p.isHuman) return;

    if (canHead(p)) {
      aiHeader(p);
      return;
    }

    // slide-tackle opportunity: an opponent is carrying the ball just ahead of us
    const c = match.controlPlayer;
    if (c && c.team !== p.team && p.slideCd <= 0 && ball.position.y < CFG.controlHeight) {
      const reach = planarToBall(p);
      // only lunge when the carrier is roughly level or goal-side of us (a real
      // chase-from-behind tackle), not when they've already gone past.
      const goalSide = (c.position.x - p.position.x) * p.team.side < 0.6;
      if (reach < CFG.slideReach + 0.7 && reach > 1.1 && goalSide) {
        const perSec = 0.35 + DIFF[CFG.diff].aiSpd * 0.6; // legends commit more often
        if (Math.random() < perSec * sim.dt) {
          startSlide(p);
          return;
        }
      }
    }

    const rec = p.memory.getRecord(ball);
    if (rec && rec.visible) {
      p.goPursue(ball); // predictive intercept while the ball is in view
    } else {
      p.goArrive(perceivedBallPos(p)); // chase last-known position from memory
    }
  }
}

/** The carrier — dribble toward goal and decide shoot/pass/clear (fuzzy brain). */
class CarryState extends State<Player> {
  override execute(p: Player): void {
    if (p.isHuman) return;
    aiCarry(p, sim.dt);
  }
}

/** Off-ball attacker — move to the best support spot. */
class SupportState extends State<Player> {
  override execute(p: Player): void {
    if (p.isHuman) return;
    if (canHead(p)) {
      aiHeader(p);
      return;
    }
    p.goArrive(p.supportTarget);
  }
}

/**
 * The intended receiver of a pass (Simple Soccer's `ReceiveBall`). Runs onto
 * the ball — predictively pursuing it while it travels — so passes are met by a
 * deliberate run rather than picked up by whoever happens to be nearest. This is
 * what turns isolated passes into give-and-gos and runs in behind.
 */
class ReceiveState extends State<Player> {
  override execute(p: Player): void {
    if (p.isHuman) return;
    if (canHead(p)) {
      aiHeader(p);
      return;
    }
    const rec = p.memory.getRecord(ball);
    if (rec && rec.visible) p.goPursue(ball);
    else p.goArrive(perceivedBallPos(p));
  }
}

/** Goalkeeper brain — tend goal, rush to intercept, or distribute. */
class GkState extends State<Player> {
  override execute(p: Player): void {
    if (p.isHuman) return;
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
