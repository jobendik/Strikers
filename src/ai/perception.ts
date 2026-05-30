import type { Vector3 } from 'yuka';
import { CFG } from '../config/constants';
import { headingVec } from '../core/math';
import { sim } from '../core/time';
import { ball } from '../game/state';
import type { Player } from '../entities/Player';

/**
 * Perception layer built on Yuka's `MemorySystem`.
 *
 * Each AI player keeps a short-term memory record of the ball. The ball is only
 * "sensed" when it falls inside the player's vision range and field-of-view
 * (derived from the player's heading). When the ball leaves their view they
 * keep chasing its last-known position for `memorySpan` seconds before
 * re-acquiring — producing believable reaction lag instead of omniscient AI.
 *
 * Vision sharpness scales with difficulty: weaker AIs have a narrower cone and
 * shorter sight, so they lose track of play behind them more often.
 */

// [easy, pro, legend] — field of view (radians) and vision range (world units).
const FOV = [2.6, 3.5, 4.4];
const RANGE = [40, 52, 64];
const MEMORY_SPAN = 0.8;

export function initPerception(p: Player): void {
  p.memory.memorySpan = MEMORY_SPAN;
  p.memory.createRecord(ball);
}

export function updatePerception(p: Player): void {
  const rec = p.memory.getRecord(ball);
  // Goalkeepers always have keen sight of the ball; outfielders use a cone.
  const fov = p.roleType === 'GK' ? FOV[2] : FOV[CFG.diff];
  const range = p.roleType === 'GK' ? RANGE[2] + 8 : RANGE[CFG.diff];

  const dx = ball.position.x - p.position.x;
  const dz = ball.position.z - p.position.z;
  const dist = Math.hypot(dx, dz);

  let visible = dist <= range;
  if (visible && dist > 1e-3) {
    const fwd = headingVec(p.heading);
    const dot = (dx / dist) * fwd.x + (dz / dist) * fwd.z; // cos(angle to heading)
    if (dot < Math.cos(fov * 0.5)) visible = false; // outside the FOV cone
  }

  if (visible) {
    if (!rec.visible) rec.timeBecameVisible = sim.elapsed;
    rec.timeLastSensed = sim.elapsed;
    rec.lastSensedPosition.copy(ball.position);
    rec.visible = true;
  } else {
    rec.visible = false;
  }
}

/**
 * Where the player currently believes the ball is. While in view this is the
 * exact position; just after losing sight it is the last-seen position; once
 * memory expires the player re-acquires the true position.
 */
export function perceivedBallPos(p: Player): Vector3 {
  const rec = p.memory.getRecord(ball);
  if (!rec || rec.timeLastSensed === -Infinity) return ball.position;
  const fresh = sim.elapsed - rec.timeLastSensed <= p.memory.memorySpan;
  return fresh ? rec.lastSensedPosition : ball.position;
}
