import { CFG, DIFF } from '../config/constants';
import { V3, clamp } from '../core/math';
import { rngNormal, rngRange } from '../core/rng';
import { sim } from '../core/time';
import { ball, match } from '../game/state';
import { inOwnBox, startGkDive } from '../game/control';
import { crossingAt, interceptPoint } from '../game/predict';
import { ownGoalX } from './analysis';
import type { Player } from '../entities/Player';

/*
 * Goalkeeper brain.
 *
 *   positioning  stands on the line between the ball and the centre of his goal,
 *                and comes off his line to narrow the angle as the ball nears
 *   shot-stopping reads the *predicted* flight of a shot (the real ball model,
 *                swerve and dip included), after a human-like reaction delay and
 *                with a reading error that both shrink with keeper quality. If he
 *                can shuffle across he does; if not he dives — and a dive covers
 *                only so much ground in the time the shot gives him.
 *   sweeping     comes for through-balls and loose balls he can reach first
 *   one-on-ones  closes the attacker down to smother
 *
 * Difficulty never moves him faster — it sharpens his reactions and his reading.
 */

const _cross = { y: 0, z: 0 };
const _t = V3();

export function gkBrain(p: Player, _dt: number): void {
  const team = p.team;
  const own = ownGoalX(team);
  const K = DIFF[CFG.diff].keeper;
  const side = team.side; // +1 defends the −X goal

  // holding the ball (or a restart): nothing to tend
  if (match.controlPlayer === p) {
    p.deact();
    return;
  }
  if (p.act !== 'none') return;

  const bx = ball.position.x;
  const bz = ball.position.z;
  const distGoal = Math.hypot(bx - own, bz);
  // close-range danger in front of him: set big (spread) — see control.keeperContact
  const dBall = Math.hypot(bx - p.position.x, bz - p.position.z);
  if (dBall < 7.5 && match.controlTeam !== team && distGoal < 13) p.spreadT = sim.elapsed;
  const loose = match.controlPlayer === null;
  const theirs = match.controlTeam !== null && match.controlTeam !== team;

  // --- shot-stopping ---
  const vx = ball.velocity.x;
  const speed = Math.hypot(vx, ball.velocity.y, ball.velocity.z);
  const incoming = loose && (own - bx) * vx > 0 && speed > CFG.gkDiveTrigger;
  if (incoming) {
    // where does it cross his plane (a stride in front of the line, where he stands)?
    const planeX = p.position.x;
    const t = crossingAt(planeX, _cross);
    if (t > 0 && t < 1.6) {
      const onFrame = Math.abs(_cross.z) < CFG.goalHalf + 1.0 && _cross.y < CFG.crossbarH + 0.7;
      if (onFrame) {
        // reaction: he needs a beat to pick the shot up before he can move for it
        if (p.shotSeenT < 0 || sim.elapsed - p.shotSeenT > 1.5) {
          p.shotSeenT = sim.elapsed;
          p.shotReact = -1;
        }
        // his reaction clock started when he saw the leg go back (anticipation),
        // but he can never move before the ball is struck plus a minimum beat
        if (p.shotReact < 0) {
          const full = (0.36 - 0.2 * K) * rngRange(0.78, 1.32);
          const sinceStrike = sim.elapsed - ball.lastKickT;
          const anticipated = sim.elapsed - p.shotSeenT - sinceStrike; // wind-up he watched
          p.shotReact = sim.elapsed - p.shotSeenT + Math.max(0.07, full - anticipated * (0.4 + 0.5 * K) - sinceStrike);
        }
        const seen = sim.elapsed - p.shotSeenT;
        if (seen >= p.shotReact) {
          // reading error shrinks with quality and as the ball gets closer
          const err = rngNormal() * (1 - K) * 0.9 * clamp(t / 0.5, 0.3, 1.2);
          const pz = _cross.z + err;
          const lat = pz - p.position.z;
          const absLat = Math.abs(lat);
          const reachStand = 0.6;
          const need = absLat - reachStand; // ground to make up beyond his standing reach
          p.faceYaw = side > 0 ? Math.PI / 2 : -Math.PI / 2;
          if (need <= 0 && _cross.y < 2.1) {
            // straight at him: set himself
            _t.set(planeX, 0, p.position.z + lat * 0.8);
            p.goArrive(_t);
            return;
          }
          if (need < 0.45 && t > 0.32 && _cross.y < 2.0) {
            // a step across is enough
            _t.set(planeX, 0, clamp(pz, -CFG.goalHalf, CFG.goalHalf));
            p.goSeek(_t);
            p.faceYaw = side > 0 ? Math.PI / 2 : -Math.PI / 2;
            return;
          }
          // dive: go when the flight time matches the dive (not early, not late)
          const diveLead = Math.min(CFG.gkDiveTime * 0.8, 0.12 + (need + 0.5) / CFG.gkDiveSpeed);
          if (t <= diveLead && p.diveCd <= 0) {
            startGkDive(p, planeX + (bx - planeX) * 0.06, pz, _cross.y);
            return;
          }
          // waiting for the moment: creep toward it
          _t.set(planeX, 0, p.position.z + Math.sign(lat) * Math.min(absLat, 0.7));
          p.goArrive(_t);
          p.faceYaw = side > 0 ? Math.PI / 2 : -Math.PI / 2;
          return;
        }
        // not reacted yet — hold
        p.faceYaw = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        return;
      }
    }
  } else if (sim.elapsed - p.shotSeenT > 0.6) {
    p.shotSeenT = -1;
  }

  // --- sweeping: a loose ball he gets to first inside (or just outside) his box ---
  if (loose && distGoal < 19 && speed < 22) {
    const hit = interceptPoint(p.position.x, p.position.z, p.ath.sprint * 0.95, 0.12, CFG.headHigh, 1.0);
    if (hit && Math.abs(hit.x - own) < CFG.boxDepth - 0.5 && Math.abs(hit.z) < CFG.boxHalfW - 0.5) {
      // is any attacker getting there before him?
      let beaten = false;
      const opp = match.teams[0] === team ? match.teams[1] : match.teams[0];
      for (const o of opp.players) {
        if (o.sentOff) continue;
        const d = Math.hypot(o.position.x - hit.x, o.position.z - hit.z) - CFG.controlR;
        if (d / o.ath.sprint < hit.t - 0.1) {
          beaten = true;
          break;
        }
      }
      if (!beaten) {
        p.goPursue();
        return;
      }
    }
  }

  // --- one-on-one: an attacker bearing down inside the box — come and smother ---
  if (theirs && match.controlPlayer && inOwnBox(p, bx, bz)) {
    const c = match.controlPlayer;
    const dKeeper = Math.hypot(bx - p.position.x, bz - p.position.z);
    // is a defender close enough to deal with it instead?
    let covered = false;
    for (const m of team.players) {
      if (m === p || m.sentOff) continue;
      if (Math.hypot(m.position.x - bx, m.position.z - bz) < 2.2) covered = true;
    }
    if (!covered && distGoal < 9.5 && Math.abs(bz) < 7) {
      if (dKeeper < 1.7 && Math.hypot(ball.position.x - c.position.x, ball.position.z - c.position.z) > 0.7 && p.diveCd <= 0) {
        // the ball is off his foot: go down at his feet
        startGkDive(p, bx, bz, 0.3);
        return;
      }
      // advance along the ball→goal line, staying big
      const gx = own - bx;
      const gz = -bz;
      const gl = Math.hypot(gx, gz) || 1;
      const stand = clamp(dKeeper * 0.45, 1.2, 3.5);
      _t.set(bx + (gx / gl) * stand, 0, bz + (gz / gl) * stand);
      p.goArrive(_t, true);
      p.faceYaw = Math.atan2(bx - p.position.x, bz - p.position.z);
      return;
    }
  }

  // --- positioning: on the bisector of the angle the ball makes with the two posts,
  // off the line by threat; at a tight angle he shades toward (and guards) the near post ---
  const G = CFG.goalHalf;
  const u1x = own - bx;
  const u1z = -G - bz;
  const u2x = own - bx;
  const u2z = G - bz;
  const l1 = Math.hypot(u1x, u1z) || 1;
  const l2 = Math.hypot(u2x, u2z) || 1;
  let hx = u1x / l1 + u2x / l2;
  let hz = u1z / l1 + u2z / l2;
  const hl = Math.hypot(hx, hz) || 1;
  hx /= hl;
  hz /= hl;
  // where the bisector meets the goal line
  const tLine = Math.abs(hx) > 1e-3 ? (own - bx) / hx : 0;
  let gz = clamp(bz + hz * tLine, -G + 0.3, G - 0.3);
  const wide = Math.atan2(Math.abs(bz), Math.abs(bx - own) + 0.5); // 0 = straight on, π/2 = on the byline
  gz += Math.sign(bz || 1) * clamp((wide - 0.35) * 1.5, 0, 1.25);
  gz = clamp(gz, -G + 0.35, G - 0.35);
  // (narrowing the angle is how a keeper stops a close-range finish; from range he stays home,
  // and at a tight angle he stays on his line to protect the near post)
  const threat = clamp(1 - (distGoal - 7) / 11, 0, 1) * clamp(1.5 - wide * 1.1, 0.15, 1);
  const off = CFG.gkTend + CFG.gkAngleStep * threat * (theirs ? 1 : loose ? 0.6 : 0.25) * (0.7 + 0.3 * K);
  const dxk = bx - own;
  const dzk = bz - gz;
  const dlk = Math.hypot(dxk, dzk) || 1;
  let tx = own + (dxk / dlk) * off;
  const tz = clamp(gz + (dzk / dlk) * off, -G - 0.2, G + 0.2);
  tx = side > 0 ? clamp(tx, own + 0.5, own + CFG.sixDepth + 1.5) : clamp(tx, own - CFG.sixDepth - 1.5, own - 0.5);
  _t.set(tx, 0, tz);
  p.goArrive(_t);
  p.faceYaw = Math.atan2(bx - p.position.x, bz - p.position.z);
}
