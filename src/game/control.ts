import type { Vector3 } from 'yuka';
import { CFG, DIFF } from '../config/constants';
import { V3, distSq, headingVec, rand } from '../core/math';
import { Audio } from '../core/audio';
import { Haptics } from '../core/haptics';
import { ball, match, oppOf, teamIndex } from './state';
import { findBestPass, nearestOpp } from '../ai/analysis';
import { flashToast } from '../ui/hud';
import { setPiece } from './physics';
import type { Player } from '../entities/Player';

/** Give (or clear) ball possession. */
export function setControl(p: Player | null): void {
  match.controlPlayer = p;
  match.controlTeam = p ? p.team : null;
  if (p) {
    p.kickCooldown = 0;
    ball.lastTouch = p.team;
    if (p.roleType === 'GK') match.gkHold = 0.9;
  }
}

/** Strike the ball in `dir` with `power`. type 'pass' tags it for stats/audio. */
export function kick(p: Player, dir: Vector3, power: number, type: 'kick' | 'pass'): void {
  const d = V3(dir.x, 0, dir.z);
  if (d.length() < 1e-3) d.set(p.team.side, 0, 0);
  d.normalize();
  ball.velocity.set(d.x * power, 0, d.z * power); // mass=1 -> speed=power (Buckland kick)
  ball.lastTouch = p.team;
  p.kickCooldown = 0.32;
  match.controlPlayer = null;
  match.controlTeam = null;
  match.controlCooldown = 0.22;
  match.gkHold = 0;
  if (type === 'pass') {
    Audio.pass();
    match.stats.passes[teamIndex(p.team)]++;
  } else {
    Audio.kick();
  }
  if (p.isHuman) Haptics.kick();
}

/** Hoof the ball clear, upfield and slightly randomised. */
export function clearBall(p: Player): void {
  kick(p, V3(p.team.side, 0, rand(-0.5, 0.5)), CFG.clearPow, 'kick');
}

/** Resolve who is in possession: gain, lose, or steal the ball. */
export function resolveControl(dt: number): void {
  if (match.controlCooldown > 0) match.controlCooldown -= dt;
  const blocked = match.controlCooldown > 0;

  let near: Player | null = null;
  let nd = Infinity;
  for (const t of match.teams)
    for (const p of t.players) {
      const reach = p.roleType === 'GK' ? CFG.controlR * 1.7 * DIFF[CFG.diff].keeper : CFG.controlR;
      const d = p.position.distanceTo(ball.position);
      if (d < reach && d < nd) {
        nd = d;
        near = p;
      }
    }

  const c = match.controlPlayer;
  if (c) {
    const cd = c.position.distanceTo(ball.position);
    if (cd > CFG.controlR * 1.9) {
      setControl(null);
    } else if (!blocked && near && near.team !== c.team && nd < cd - 0.25) {
      setControl(near);
      Audio.tackle();
      if (near.team.isUser) Haptics.tackle();
      flashToast(near.team.isUser ? 'BALL WON' : 'INTERCEPTED');
    }
  } else if (!blocked && near) {
    if (near.roleType === 'GK' && ball.velocity.length() > 10) Audio.save();
    setControl(near);
  }
}

/** Build pressure on the carrier; resolve into a tackle or (rarely) a foul. */
export function updatePressure(dt: number): void {
  const c = match.controlPlayer;
  if (!c || c.roleType === 'GK') return;
  const o = nearestOpp(c);
  if (o && distSq(o.position, c.position) < 1.05 * 1.05) c.pressure += dt;
  else c.pressure = Math.max(0, c.pressure - dt * 1.6);

  if (c.pressure > 0.45 + DIFF[CFG.diff].react * 1.2) {
    c.pressure = 0;
    // foul check: a tackler coming through from behind may concede a free kick
    let foul = false;
    if (o) {
      const ovd = V3(o.velocity ? o.velocity.x : 0, 0, o.velocity ? o.velocity.z : 0);
      const ol = ovd.length();
      if (ol > 2) {
        const hv = headingVec(c.heading);
        const dot = (ovd.x / ol) * hv.x + (ovd.z / ol) * hv.z;
        if (dot > 0.25 && Math.random() < CFG.foulChance) foul = true;
      }
    }
    if (foul) {
      Audio.whistle();
      Haptics.whistle();
      setPiece(V3(ball.position.x, 0, ball.position.z), c.team, 'FREE KICK', false);
      return;
    }
    setControl(null);
    const ax = ball.position.x - (o ? o.position.x : 0);
    const az = ball.position.z - (o ? o.position.z : 0);
    const al = Math.hypot(ax, az) || 1;
    ball.velocity.set((ax / al) * 8, 0, (az / al) * 8);
    match.controlCooldown = 0.18;
    Audio.tackle();
    if (c.team.isUser) Haptics.tackle();
    flashToast(c.team.isUser ? 'DISPOSSESSED' : 'TACKLE!');
  }
}

/** A keeper who has gathered the ball holds briefly, then distributes. */
export function updateGkHold(dt: number): void {
  if (match.gkHold > 0 && match.controlPlayer && match.controlPlayer.roleType === 'GK') {
    match.gkHold -= dt;
    if (match.gkHold <= 0) {
      const gk = match.controlPlayer;
      const opp = oppOf(gk.team);
      const pass = findBestPass(gk, CFG.passLong, CFG.minPassDist, opp);
      if (pass) kick(gk, V3(pass.target.x - ball.position.x, 0, pass.target.z - ball.position.z), CFG.passLong, 'pass');
      else clearBall(gk);
    }
  }
}
