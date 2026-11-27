import { CFG } from '../config/constants';
import { ball } from './state';
import type { Player } from '../entities/Player';

/** Ball-centre height when resting on the turf. */
export const GROUND_Y = CFG.ballR;

/** Is the ball currently airborne (meaningfully above the turf)? */
export function ballAirborne(): boolean {
  return ball.position.y > GROUND_Y + 0.08;
}

/** Planar distance from a player to the ball. */
export function planarToBall(p: Player): number {
  return Math.hypot(ball.position.x - p.position.x, ball.position.z - p.position.z);
}

/** Is the ball at a headable height within this player's reach right now? */
export function canHead(p: Player): boolean {
  return (
    p.kickCooldown <= 0 &&
    p.act === 'none' &&
    !p.queued &&
    ball.position.y >= CFG.headLow &&
    ball.position.y <= CFG.headHigh &&
    planarToBall(p) <= CFG.headReach
  );
}

/** Is the ball at a volleyable height within this player's reach right now? */
export function canVolley(p: Player): boolean {
  return (
    p.kickCooldown <= 0 &&
    p.act === 'none' &&
    ball.position.y >= CFG.volleyLow &&
    ball.position.y <= CFG.volleyHigh &&
    planarToBall(p) <= 1.15
  );
}
