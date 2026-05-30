import type { Vector3 } from 'yuka';
import { CFG } from '../config/constants';
import { V3, clamp, distSq, headingVec } from '../core/math';
import { ball, match } from './state';
import { setControl } from './control';
import { scoreGoal } from './flow';
import { attackHeading } from '../ai/analysis';
import { GROUND_Y } from './aerial';
import { Audio } from '../core/audio';
import { flashToast } from '../ui/hud';
import type { Team } from '../entities/Team';
import type { Player } from '../entities/Player';

/** Advance the ball: glued to the carrier, or free with full 3D arc physics. */
export function updateBall(dt: number): void {
  const c = match.controlPlayer;
  if (c && match.gkHold > 0) {
    ball.position.x = c.position.x;
    ball.position.y = GROUND_Y;
    ball.position.z = c.position.z;
    ball.velocity.set(0, 0, 0);
  } else if (c && c.kickCooldown <= 0) {
    const fwd = headingVec(c.heading);
    ball.position.x = c.position.x + fwd.x * CFG.carryDist;
    ball.position.y = GROUND_Y;
    ball.position.z = c.position.z + fwd.z * CFG.carryDist;
    ball.velocity.set(c.velocity.x, 0, c.velocity.z);
  } else {
    integrateFreeBall(dt);
  }
  checkBounds();
}

/** Free-flight integration: gravity, ground bounce, rolling friction + air drag. */
function integrateFreeBall(dt: number): void {
  ball.velocity.y -= CFG.gravity * dt;
  ball.position.x += ball.velocity.x * dt;
  ball.position.y += ball.velocity.y * dt;
  ball.position.z += ball.velocity.z * dt;

  // ground bounce
  if (ball.position.y <= GROUND_Y) {
    ball.position.y = GROUND_Y;
    if (ball.velocity.y < 0) {
      const impact = -ball.velocity.y;
      ball.velocity.y = impact * CFG.ballRest;
      ball.velocity.x *= CFG.bounceFric;
      ball.velocity.z *= CFG.bounceFric;
      if (impact > 6) Audio.bounce();
      if (ball.velocity.y < 1.6) ball.velocity.y = 0; // settle into a roll
    }
  }

  const airborne = ball.position.y > GROUND_Y + 0.02;
  const hsp = Math.hypot(ball.velocity.x, ball.velocity.z);
  if (hsp > 0) {
    // strong rolling friction on the turf; light drag in the air
    const decel = airborne ? CFG.ballDecel * 0.12 : CFG.ballDecel;
    const ns = Math.max(0, hsp - decel * dt);
    const k = ns / hsp;
    ball.velocity.x *= k;
    ball.velocity.z *= k;
  }
  if (!airborne && ball.velocity.y === 0 && hsp < CFG.ballStop) {
    ball.velocity.x = 0;
    ball.velocity.z = 0;
  }
}

/** Detect goals and out-of-play; trigger scoring or set-pieces. */
function checkBounds(): void {
  if (match.state !== 'play') return;
  const x = ball.position.x;
  const z = ball.position.z;
  const underBar = ball.position.y < CFG.crossbarH;
  if (x > CFG.halfL - 0.1 && Math.abs(z) < CFG.goalHalf && underBar) {
    scoreGoal(0);
    return;
  }
  if (x < -CFG.halfL + 0.1 && Math.abs(z) < CFG.goalHalf && underBar) {
    scoreGoal(1);
    return;
  }
  // (a ball that sails over the bar between the posts simply becomes a goal kick below)
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
  ball.position.set(pos.x, GROUND_Y, pos.z);
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
