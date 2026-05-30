import type { Vector3 } from 'yuka';
import { CFG } from '../config/constants';
import { V3, clamp, distSq, headingVec } from '../core/math';
import { ball, match } from './state';
import { setControl } from './control';
import { scoreGoal } from './flow';
import { attackHeading } from '../ai/analysis';
import { flashToast } from '../ui/hud';
import type { Team } from '../entities/Team';
import type { Player } from '../entities/Player';

/** Advance the ball: glued to the carrier, or free with constant deceleration. */
export function updateBall(dt: number): void {
  const c = match.controlPlayer;
  if (c && match.gkHold > 0) {
    ball.position.x = c.position.x;
    ball.position.z = c.position.z;
    ball.velocity.set(0, 0, 0);
  } else if (c && c.kickCooldown <= 0) {
    const fwd = headingVec(c.heading);
    ball.position.x = c.position.x + fwd.x * CFG.carryDist;
    ball.position.z = c.position.z + fwd.z * CFG.carryDist;
    ball.velocity.copy(c.velocity);
  } else {
    ball.position.x += ball.velocity.x * dt;
    ball.position.z += ball.velocity.z * dt;
    const sp = ball.velocity.length();
    if (sp > 0) {
      const ns = Math.max(0, sp - CFG.ballDecel * dt);
      ball.velocity.multiplyScalar(ns / sp);
    }
    if (ball.velocity.length() < CFG.ballStop) ball.velocity.set(0, 0, 0);
  }
  ball.position.y = 0;
  checkBounds();
}

/** Detect goals and out-of-play; trigger scoring or set-pieces. */
function checkBounds(): void {
  if (match.state !== 'play') return;
  const x = ball.position.x;
  const z = ball.position.z;
  if (x > CFG.halfL - 0.1 && Math.abs(z) < CFG.goalHalf) {
    scoreGoal(0);
    return;
  }
  if (x < -CFG.halfL + 0.1 && Math.abs(z) < CFG.goalHalf) {
    scoreGoal(1);
    return;
  }
  if (Math.abs(z) > CFG.halfW - 0.3) {
    const ez = Math.sign(z) * (CFG.halfW - 0.7);
    const toTeam = ball.lastTouch === match.teams[0] ? match.teams[1] : match.teams[0];
    setPiece(V3(clamp(x, -CFG.halfL + 5, CFG.halfL - 5), 0, ez), toTeam, 'THROW-IN', false);
    return;
  }
  if (Math.abs(x) > CFG.halfL - 0.1) {
    const defTeam = x > 0 ? match.teams[1] : match.teams[0];
    const gkx = defTeam.side > 0 ? -CFG.halfL + 5 : CFG.halfL - 5;
    setPiece(V3(gkx, 0, clamp(z, -6, 6)), defTeam, 'GOAL KICK', true);
  }
}

/** Restart play with a free kick / throw-in / goal kick taken by `team`. */
export function setPiece(pos: Vector3, team: Team, label: string, toKeeper: boolean): void {
  ball.position.set(pos.x, 0, pos.z);
  ball.velocity.set(0, 0, 0);
  match.controlPlayer = null;
  match.controlTeam = null;
  let taker: Player | null = toKeeper ? team.gk : null;
  if (!taker) {
    let nd = Infinity;
    for (const p of team.outfield()) {
      const d = distSq(p.position, pos);
      if (d < nd) {
        nd = d;
        taker = p;
      }
    }
  }
  if (taker) {
    taker.position.set(pos.x, 0, pos.z);
    taker.velocity.set(0, 0, 0);
    taker.heading = attackHeading(team.side);
    setControl(taker);
    match.gkHold = toKeeper ? 0.7 : 0;
  }
  match.controlCooldown = 0;
  ball.lastTouch = team;
  flashToast(label);
}
