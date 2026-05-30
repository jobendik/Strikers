import { CFG } from '../config/constants';
import { V3, distSq } from '../core/math';
import { ball, match } from '../game/state';
import { ownGoalX } from './analysis';
import type { Player } from '../entities/Player';

/**
 * Goalkeeper brain. Rushes out to smother the ball when it threatens the goal
 * and no teammate has control; otherwise holds a rear-interpose line, tracking
 * the ball laterally scaled into the goal mouth.
 */
export function gkBrain(p: Player, _dt: number): void {
  const team = p.team;
  const own = ownGoalX(team);
  const goalC = V3(own, 0, 0);

  if (distSq(goalC, ball.position) < CFG.gkInterceptR * CFG.gkInterceptR && match.controlTeam !== team) {
    p.goSeek(ball.position); // rush to intercept
    return;
  }

  // rear-interpose target: track the ball laterally, scaled into the goal mouth
  const rearZ = ball.position.z * ((CFG.goalHalf * 2) / (CFG.halfW * 2));
  const dx = ball.position.x - own;
  const dz = ball.position.z - rearZ;
  const dl = Math.hypot(dx, dz) || 1;
  p.goArrive(V3(own + (dx / dl) * CFG.gkTend, 0, rearZ + (dz / dl) * CFG.gkTend));
}
