import { State } from 'yuka';
import { CFG } from '../config/constants';
import { V3, clamp, lerp } from '../core/math';
import { sim } from '../core/time';
import { ball } from '../game/state';
import { perceivedBallPos } from './perception';
import { aiCarry } from './carrier';
import { gkBrain } from './goalkeeper';
import type { Player } from '../entities/Player';
import type { PlayerRole } from '../config/types';

/*
 * Player states extend Yuka's `State` class — `StateMachine.add()` performs an
 * `instanceof State` check, so plain object literals are rejected at runtime.
 * Only `execute` is overridden; `enter`/`exit` inherit the base no-ops.
 */

/** Hold/return to formation position; shuffle or mark when defending. */
class PositionState extends State<Player> {
  override execute(p: Player): void {
    if (p.isHuman) return;
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

/** Closest defender to the ball — intercept it. */
class ChaseState extends State<Player> {
  override execute(p: Player): void {
    if (p.isHuman) return;
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
    p.goArrive(p.supportTarget);
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
  GK: new GkState(),
};
