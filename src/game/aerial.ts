import { CFG } from '../config/constants';
import { sim } from '../core/time';
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

/**
 * Is the ball at a headable height within this player's reach right now?
 * A ball the other side has only just struck cannot be reacted to: for the first
 * tenth of a second an opponent only gets his head to it if it comes straight at
 * him, and his full reach returns over the next fifth (as for feet — control.ts).
 */
export function canHead(p: Player): boolean {
  if (p.kickCooldown > 0 || p.act !== 'none' || p.queued) return false;
  if (ball.position.y < CFG.headLow || ball.position.y > CFG.headHigh) return false;
  let reach = CFG.headReach;
  const since = sim.elapsed - ball.lastKickT;
  if (since < 0.32 && ball.lastTouch && ball.lastTouch !== p.team) reach = 0.35 + (reach - 0.35) * Math.min(1, Math.max(0, (since - 0.1) / 0.22));
  return planarToBall(p) <= reach;
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
