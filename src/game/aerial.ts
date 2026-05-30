import type { Vector3 } from 'yuka';
import { CFG } from '../config/constants';
import { ball } from './state';
import type { Player } from '../entities/Player';

/** Ball-centre height when resting on the turf. */
export const GROUND_Y = CFG.ballR;

/** Is the ball currently airborne (meaningfully above the turf)? */
export function ballAirborne(): boolean {
  return ball.position.y > GROUND_Y + 0.05;
}

/**
 * Launch the ball so it arcs from its current position to `target`, reaching an
 * apex of `peak` units above the ground. This is the shared primitive behind
 * crosses, lofted through-balls and chips over the keeper — the real-ball
 * trajectory idea borrowed from Notblox's physics-driven football mode.
 *
 * Solving the projectile: apex height h ⇒ launch vy = √(2·g·h); flight time to
 * return to launch height = 2·vy/g; horizontal speed = distance / flightTime.
 */
export function launchLob(target: Vector3, peak: number): void {
  const dx = target.x - ball.position.x;
  const dz = target.z - ball.position.z;
  const dist = Math.hypot(dx, dz) || 1e-3;
  let vy = Math.sqrt(2 * CFG.gravity * Math.max(0.5, peak));
  let flight = (2 * vy) / CFG.gravity;
  let hsp = dist / flight;
  // if the target is too far to reach within the max ball speed, raise the arc
  // (longer flight) so the ball still lands on target instead of dropping short.
  if (hsp > CFG.ballMax) {
    hsp = CFG.ballMax;
    flight = dist / hsp;
    vy = (CFG.gravity * flight) / 2;
  }
  ball.velocity.set((dx / dist) * hsp, vy, (dz / dist) * hsp);
}

/** Planar distance from a player to the ball. */
export function planarToBall(p: Player): number {
  return Math.hypot(ball.position.x - p.position.x, ball.position.z - p.position.z);
}

/**
 * Can `p` reach the airborne ball to head/volley it right now? The kick-cooldown
 * gate stops a player heading the same ball every frame (which would pump its
 * vertical velocity and make it hover).
 */
export function canHead(p: Player): boolean {
  return (
    p.kickCooldown <= 0 &&
    ball.position.y >= CFG.headLow &&
    ball.position.y <= CFG.headHigh &&
    planarToBall(p) <= CFG.headReach
  );
}
