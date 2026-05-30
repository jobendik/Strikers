import { CFG, DIFF } from '../config/constants';
import { V3, clamp, distSq, rand } from '../core/math';
import { ball, match } from '../game/state';
import { startGkDive } from '../game/control';
import { ownGoalX } from './analysis';
import type { Player } from '../entities/Player';

/**
 * Goalkeeper brain. First reads the flight of any incoming shot and — if it is
 * heading for a corner beyond his standing reach — flings himself at the
 * predicted crossing point (a full-stretch diving save, deepening Simple
 * Soccer's keeper logic and leaning on the aerial ball model). Failing a dive,
 * he rushes out to smother a close ball, otherwise holds a rear-interpose line.
 */
export function gkBrain(p: Player, _dt: number): void {
  const team = p.team;
  const own = ownGoalX(team);
  const goalC = V3(own, 0, 0);

  // --- diving save: predict where a fast incoming shot crosses the keeper line ---
  if (p.dive <= 0 && p.diveCd <= 0 && match.controlTeam !== team) {
    const vx = ball.velocity.x;
    const vz = ball.velocity.z;
    const speed = Math.hypot(vx, vz);
    const towardGoal = (own - ball.position.x) * vx > 0.5; // x-velocity points at our line
    if (towardGoal && speed > CFG.gkDiveTrigger) {
      const keeperRating = DIFF[CFG.diff].keeper;
      // commit only when the ball will arrive within the dive window, so the
      // full-stretch reach is still live as it crosses the line.
      const lead = CFG.gkDiveTime * (0.6 + keeperRating * 0.45);
      const t = (p.position.x - ball.position.x) / vx; // time for the ball to reach his x
      if (t > 0.02 && t < lead) {
        const predZ = ball.position.z + vz * t;
        const predY = ball.position.y + ball.velocity.y * t - 0.5 * CFG.gravity * t * t;
        if (Math.abs(predZ) < CFG.goalHalf + 0.9 && predY < CFG.crossbarH && predY > -0.4) {
          const lateral = Math.abs(predZ - p.position.z);
          const standReach = CFG.controlR * 1.7 * keeperRating;
          // dive for anything beyond a standing save and within a dramatic miss —
          // shots into the far corner (lateral past his lunge) simply fly in.
          if (lateral > standReach * 0.7 && lateral < CFG.gkDiveLunge + standReach + 1.5) {
            // imperfect read: weaker keepers misjudge the corner more (placement beats them)
            const err = rand(-1, 1) * (1.3 - keeperRating) * 2.0;
            const dir = Math.sign(predZ - p.position.z) || 1;
            // the lunge is capped — he can't reach the opposite corner of the goal
            const cover = Math.min(Math.abs(predZ - p.position.z), CFG.gkDiveLunge);
            const tz = clamp(p.position.z + dir * cover + err, -CFG.goalHalf - 0.6, CFG.goalHalf + 0.6);
            const tx = p.position.x + (ball.position.x - p.position.x) * 0.12;
            startGkDive(p, tx, tz);
            return;
          }
        }
      }
    }
  }

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
