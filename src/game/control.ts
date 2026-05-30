import type { Vector3 } from 'yuka';
import { CFG, DIFF } from '../config/constants';
import { attr01 } from '../config/players';
import { V3, distSq, headingVec, rand } from '../core/math';
import { Audio } from '../core/audio';
import { Haptics } from '../core/haptics';
import { ball, match, oppOf, teamIndex } from './state';
import { GROUND_Y, launchLob, planarToBall } from './aerial';
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

/**
 * Strike a lofted ball that arcs to `target` reaching apex `peak` — used for
 * crosses, lofted through-balls and chips over the keeper (Notblox-style aerial
 * play). Shares the bookkeeping of {@link kick} but launches with vertical
 * velocity via {@link launchLob}.
 */
export function lobKick(p: Player, target: Vector3, peak: number, type: 'kick' | 'pass'): void {
  const h = headingVec(p.heading);
  ball.position.set(p.position.x + h.x * 0.4, GROUND_Y, p.position.z + h.z * 0.4);
  launchLob(target, peak);
  ball.lastTouch = p.team;
  p.kickCooldown = 0.32;
  match.controlPlayer = null;
  match.controlTeam = null;
  match.controlCooldown = 0.22;
  match.gkHold = 0;
  if (type === 'pass') {
    Audio.chip();
    match.stats.passes[teamIndex(p.team)]++;
  } else {
    Audio.chip();
  }
  if (p.isHuman) Haptics.kick();
}

/** Header/volley an airborne ball in `dir` with `power` (slightly lofted). */
export function headBall(p: Player, dir: Vector3, power: number): void {
  const d = V3(dir.x, 0, dir.z);
  if (d.length() < 1e-3) d.set(p.team.side, 0, 0);
  d.normalize();
  ball.velocity.set(d.x * power, Math.max(2, ball.velocity.y * 0.3 + 3.5), d.z * power);
  ball.lastTouch = p.team;
  p.kickCooldown = 0.3;
  match.controlPlayer = null;
  match.controlTeam = null;
  match.controlCooldown = 0.2;
  Audio.header();
  if (p.isHuman) Haptics.kick();
}

/** Hoof the ball clear, upfield and slightly randomised. */
export function clearBall(p: Player): void {
  kick(p, V3(p.team.side, 0, rand(-0.5, 0.5)), CFG.clearPow, 'kick');
}

/**
 * Resolve a committed slide tackle's contact with the ball. A sliding defender
 * within reach pokes the ball off the carrier; tackling attribute drives the
 * foul risk. The "slide" action comes from the footballSimulationEngine set.
 */
export function resolveSlides(_dt: number): void {
  for (const t of match.teams)
    for (const p of t.players) {
      if (p.slide <= 0) continue;
      if (ball.position.y > CFG.controlHeight + 0.4) continue;
      if (planarToBall(p) > CFG.slideReach) continue;
      const c = match.controlPlayer;
      if (c && c.roleType === 'GK') continue; // can't slide the keeper off the ball
      if (c && c.team !== p.team) {
        // chance of a foul falls off with the slider's tackling skill
        const foulP = CFG.slideFoulBase * (1.5 - attr01(p.attr.tackling));
        if (Math.random() < foulP) {
          // a foul stops play — cancel every in-progress slide, not just this one
          for (const tt of match.teams) for (const pp of tt.players) pp.slide = 0;
          Audio.whistle();
          Haptics.whistle();
          setPiece(V3(ball.position.x, 0, ball.position.z), c.team, 'FOUL — FREE KICK', false);
          flashToast(p.team.isUser ? 'FOUL GIVEN AWAY' : 'FREE KICK WON');
          return;
        }
        setControl(null);
        ball.lastTouch = p.team; // the tackler got the last touch — credit possession
        const ax = ball.position.x - p.position.x;
        const az = ball.position.z - p.position.z;
        const al = Math.hypot(ax, az) || 1;
        ball.velocity.set((ax / al) * 7 + p.velocity.x * 0.4, 0, (az / al) * 7 + p.velocity.z * 0.4);
        match.controlCooldown = 0.16;
        Audio.tackle();
        if (p.team.isUser) Haptics.tackle();
        flashToast(p.team.isUser ? 'SLIDE TACKLE!' : 'SLIDE TACKLE');
        p.slide = 0;
      } else if (!c) {
        // loose ball: knock it on in the direction the slider is travelling
        const vl = Math.hypot(p.velocity.x, p.velocity.z) || 1;
        ball.velocity.set((p.velocity.x / vl) * 9, 0, (p.velocity.z / vl) * 9);
        ball.lastTouch = p.team;
        Audio.kick();
        p.slide = 0;
      }
    }
}

/** Commit a player to a slide tackle toward the ball (if recovered + not already sliding). */
export function startSlide(p: Player): boolean {
  if (p.slide > 0 || p.slideCd > 0 || p.roleType === 'GK') return false;
  p.slide = CFG.slideTime;
  p.slideCd = CFG.slideCooldown;
  Audio.slide(); // the lunge whoosh; contact plays its own impact sound
  if (p.isHuman) Haptics.tap();
  return true;
}

/** Resolve who is in possession: gain, lose, or steal the ball. */
export function resolveControl(dt: number): void {
  if (match.controlCooldown > 0) match.controlCooldown -= dt;
  const blocked = match.controlCooldown > 0;

  // an airborne ball can't be brought under control by an outfielder; keepers
  // can claim it up to a catchable height (everything else must be headed).
  let near: Player | null = null;
  let nd = Infinity;
  for (const t of match.teams)
    for (const p of t.players) {
      if (p.slide > 0) continue; // committed sliders win the ball via resolveSlides
      const maxH = p.roleType === 'GK' ? CFG.headHigh : CFG.controlHeight;
      if (ball.position.y > maxH) continue;
      const reach = p.roleType === 'GK' ? CFG.controlR * 1.7 * DIFF[CFG.diff].keeper : CFG.controlR;
      const d = planarToBall(p);
      if (d < reach && d < nd) {
        nd = d;
        near = p;
      }
    }

  const c = match.controlPlayer;
  if (c) {
    const cd = planarToBall(c);
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

  // a composed carrier shields the ball for longer before being dispossessed
  const hold = 0.45 + DIFF[CFG.diff].react * 1.2 + attr01(c.attr.composure) * 0.3;
  if (c.pressure > hold) {
    c.pressure = 0;
    // foul check: a tackler coming through from behind may concede a free kick;
    // a better tackler (higher attribute) fouls less often.
    let foul = false;
    if (o) {
      const ovd = V3(o.velocity ? o.velocity.x : 0, 0, o.velocity ? o.velocity.z : 0);
      const ol = ovd.length();
      if (ol > 2) {
        const hv = headingVec(c.heading);
        const dot = (ovd.x / ol) * hv.x + (ovd.z / ol) * hv.z;
        if (dot > 0.25 && Math.random() < CFG.foulChance * (1.4 - attr01(o.attr.tackling))) foul = true;
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
