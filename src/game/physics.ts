import type { Vector3 } from 'yuka';
import { CFG } from '../config/constants';
import { V3, clamp, distSq, headingVec } from '../core/math';
import { ball, match } from './state';
import { setControl } from './control';
import { addStoppage, scoreGoal } from './flow';
import { attackHeading } from '../ai/analysis';
import { GROUND_Y } from './aerial';
import { Audio } from '../core/audio';
import { Haptics } from '../core/haptics';
import { addShake } from './render';
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
    ball.spin = 0;
  } else if (c && c.kickCooldown <= 0) {
    const fwd = headingVec(c.heading);
    ball.position.x = c.position.x + fwd.x * CFG.carryDist;
    ball.position.y = GROUND_Y;
    ball.position.z = c.position.z + fwd.z * CFG.carryDist;
    ball.velocity.set(c.velocity.x, 0, c.velocity.z);
    ball.spin = 0;
  } else {
    integrateFreeBall(dt);
  }
  hitWoodwork();
  checkBounds();
}

/** Free-flight integration: gravity, ground bounce, rolling friction + air drag. */
function integrateFreeBall(dt: number): void {
  // Magnus swerve: spin pushes the ball sideways, perpendicular to its travel,
  // so a struck ball bends. Scales with horizontal speed (fast balls curve more)
  // and decays through the flight as the spin bleeds off.
  if (ball.spin !== 0) {
    const hx = ball.velocity.x;
    const hz = ball.velocity.z;
    const hsp = Math.hypot(hx, hz);
    if (hsp > 0.5) {
      const a = CFG.magnusK * ball.spin * hsp; // lateral acceleration magnitude
      ball.velocity.x += (-hz / hsp) * a * dt;
      ball.velocity.z += (hx / hsp) * a * dt;
    }
    ball.spin *= Math.max(0, 1 - CFG.spinDecay * dt);
    if (Math.abs(ball.spin) < 0.02) ball.spin = 0;
  }

  ball.velocity.y -= CFG.gravity * dt;
  ball.position.x += ball.velocity.x * dt;
  ball.position.y += ball.velocity.y * dt;
  ball.position.z += ball.velocity.z * dt;

  // ground bounce
  if (ball.position.y <= GROUND_Y) {
    ball.position.y = GROUND_Y;
    if (ball.velocity.y < 0) {
      const impact = -ball.velocity.y;
      // Only a genuine fall rebounds. A ball that is merely rolling still dips a
      // hair below the turf every frame (gravity integrates onto vy just above,
      // before this clamp), so without this threshold the bounce path would fire
      // on every frame and scrub the ball's *horizontal* speed by bounceFric
      // continuously — killing every ground pass and shot within a metre. Below
      // the threshold we just settle the vertical velocity and leave the roll
      // (and its rolling friction, applied below) untouched.
      if (impact > CFG.bounceMin) {
        ball.velocity.y = impact * CFG.ballRest;
        ball.velocity.x *= CFG.bounceFric;
        ball.velocity.z *= CFG.bounceFric;
        if (impact > 6) Audio.bounce();
      } else {
        ball.velocity.y = 0; // settle into a roll
      }
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

/**
 * Rebound the ball off the goal frame (posts + crossbar). Turns balls that
 * would otherwise have sailed harmlessly out into dramatic near-misses that
 * clang back into play — and finally puts the unused post() sound to work.
 */
function hitWoodwork(): void {
  if (match.state !== 'play') return;
  const gx = ball.position.x > 0 ? CFG.halfL : -CFG.halfL;
  if (Math.abs(ball.position.x - gx) > CFG.postR + CFG.ballR) return; // not at the goal line
  const margin = CFG.postR + CFG.ballR;
  let hit = false;

  // upright posts: at z = ±goalHalf, below the bar. Only a ball level with the
  // post line (a would-be miss or graze) clangs — one aimed cleanly inside the
  // mouth passes through to score, so corner-bound shots are still rewarded.
  if (ball.position.y < CFG.crossbarH && Math.abs(ball.position.z) > CFG.goalHalf - 0.05) {
    for (const pz of [-CFG.goalHalf, CFG.goalHalf]) {
      if (Math.abs(ball.position.z - pz) < margin) {
        ball.velocity.z = (ball.position.z < pz ? -1 : 1) * Math.abs(ball.velocity.z) * CFG.woodRest;
        ball.velocity.x *= -CFG.woodRest;
        hit = true;
        break;
      }
    }
  }
  // crossbar: at y = crossbarH, between the posts. Likewise only a ball up at
  // bar height clangs — a clean low strike still counts as a goal.
  if (
    !hit &&
    Math.abs(ball.position.z) < CFG.goalHalf &&
    ball.position.y > CFG.crossbarH - 0.05 &&
    Math.abs(ball.position.y - CFG.crossbarH) < margin
  ) {
    ball.velocity.y = -Math.abs(ball.velocity.y) * CFG.woodRest;
    ball.velocity.x *= -CFG.woodRest;
    hit = true;
  }

  if (hit) {
    ball.position.x = gx - Math.sign(gx) * margin; // nudge back inside the field of play
    ball.spin *= 0.3;
    Audio.post();
    Haptics.tap();
    addShake(0.35);
    flashToast(ball.position.y > CFG.crossbarH - 0.6 ? 'OFF THE BAR!' : 'OFF THE POST!');
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
    // a defender's own touch over his byline is a corner; otherwise a goal kick
    if (ball.lastTouch === defTeam) {
      cornerKick(defTeam, Math.sign(z || 1));
    } else {
      const gkx = defTeam.side > 0 ? -CFG.halfL + 5 : CFG.halfL - 5;
      setPiece(V3(gkx, 0, clamp(z, -6, 6)), defTeam, 'GOAL KICK', true);
    }
  }
}

/** Award a corner to the team attacking `defTeam`'s goal, taken from the `zSign` flag. */
function cornerKick(defTeam: Team, zSign: number): void {
  const attTeam = defTeam === match.teams[0] ? match.teams[1] : match.teams[0];
  const lineX = defTeam.side > 0 ? -CFG.halfL : CFG.halfL; // defTeam's own goal line
  const pos = V3(lineX - Math.sign(lineX) * CFG.cornerInset, 0, zSign * (CFG.halfW - CFG.cornerInset));
  addStoppage(CFG.stoppagePerFoul); // a corner banks a little added time
  setPiece(pos, attTeam, 'CORNER', false);
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
