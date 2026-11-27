import type { Vector3 } from 'yuka';
import { CFG, DIFF } from '../config/constants';
import { clamp, distSq, headingVec } from '../core/math';
import { chance, rng, rngNormal, rngRange } from '../core/rng';
import { sim } from '../core/time';
import { emit, type KickKind } from '../core/bus';
import { ball, match, oppOf, setPassRequest, setReceiver, teamIndex } from './state';
import { GROUND_Y, planarToBall } from './aerial';
import { findBestPass, goalX, nearestOpp, ownGoalX, passWeight } from '../ai/analysis';
import { addStoppage } from './flow';
import { foulCard, resolveOffside } from './rules';
import { awardRestart, ballStruck, makeBallState, stepBallState, type BallState } from './physics';
import { invalidateTrajectory } from './predict';
import { dribbleWant } from './movement';
import type { KickSpec, Player } from '../entities/Player';

/*
 * Possession v2 — the ball is never attached to anyone.
 *
 *   dribbling    the carrier keeps the ball by touching it: each touch gives it
 *                a velocity a little faster than he is running. Jogging = many
 *                small touches (tight control, instant turns); sprinting =
 *                heavier touches that run 1–2 m ahead (fast, but he must catch
 *                the ball up before he can turn, and a defender can nick it).
 *   first touch  a ball arriving faster than a player can cushion bounces off
 *                him; a good touch kills it or takes it in his stride. What he
 *                can cushion depends on his control rating, body shape, speed,
 *                the height of the ball and whether he was expecting it.
 *   strikes      every kick has a wind-up and is resolved against the ball's
 *                real position at the moment of contact.
 *   challenges   a tackle wins the ball by *reaching the ball*; mistime it and
 *                the tackler is beaten; go through the man and it's a foul.
 *   keeping      saves come from the keeper's body/arm line meeting the ball —
 *                caught, parried, or tipped by the fingertips.
 */

const D = (): (typeof DIFF)[number] => DIFF[CFG.diff];

/* ------------------------------------------------------------------ stats helpers */

function creditTackle(p: Player): void {
  p.statTackles++;
  match.stats.tackles[teamIndex(p.team)]++;
}

function creditSave(gk: Player): void {
  gk.statSaves++;
  match.stats.saves[teamIndex(gk.team)]++;
  if (!ball.savedOnce) match.stats.onTarget[teamIndex(oppOf(gk.team))]++;
  ball.savedOnce = true;
}

/** Is the ball, as it flies now, heading into this keeper's goal mouth? */
function headingForGoal(gk: Player, margin = 0.5): boolean {
  const ownX = ownGoalX(gk.team);
  const vx = ball.velocity.x;
  if ((ownX - ball.position.x) * vx <= 0) return false;
  const t = (ownX - ball.position.x) / vx;
  if (t < 0 || t > 2.5) return false;
  const z = ball.position.z + ball.velocity.z * t;
  const y = ball.position.y + ball.velocity.y * t - 0.5 * CFG.gravity * t * t;
  return Math.abs(z) < CFG.goalHalf + margin && y < CFG.crossbarH + margin;
}

export function inOwnBox(p: Player, x = p.position.x, z = p.position.z): boolean {
  return Math.abs(x - ownGoalX(p.team)) < CFG.boxDepth && Math.abs(z) < CFG.boxHalfW;
}

/** 0..1 — how closely the nearest opponent is pressing this player. */
export function pressureOn(p: Player): number {
  const o = nearestOpp(p);
  if (!o) return 0;
  return clamp(1 - Math.sqrt(distSq(o.position, p.position)) / 3.6, 0, 1);
}

/** A rough expected-goals estimate for a shot from (x,z) by `team` (distance, angle, pressure). */
export function estimateXg(team: Player['team'], x: number, z: number, pressure = 0, header = false): number {
  const gx = goalX(team);
  const dx = Math.abs(gx - x);
  const dist = Math.hypot(dx, z);
  // angle subtended by the goal mouth
  const a1 = Math.atan2(CFG.goalHalf - z, dx);
  const a2 = Math.atan2(-CFG.goalHalf - z, dx);
  const ang = Math.abs(a1 - a2);
  // falls away with distance, and sharply as the angle closes
  const af = clamp(ang / 0.7, 0, 1);
  let xg = 0.02 + 0.9 * Math.exp(-dist / 8.5) * Math.pow(af, 1.2);
  xg *= 1 - 0.45 * pressure;
  if (header) xg *= 0.6;
  return clamp(xg, 0.01, 0.92);
}

/* ------------------------------------------------------------------ possession */

/** Give (or clear) possession. */
export function setControl(p: Player | null): void {
  const prevTeam = match.controlTeam;
  match.controlPlayer = p;
  match.controlTeam = p ? p.team : null;
  setPassRequest(null);
  if (p) {
    ball.shot = false; // gathered — no longer a live shot
    ball.savedOnce = false;
    ball.lastTouch = p.team;
    ball.lastKicker = p;
    p.kickCooldown = 0;
    p.gotBallT = sim.elapsed;
    if (ball.passer && ball.passer.team !== p.team) ball.passer = null; // assist void on a turnover
    if (p.roleType === 'GK' && inOwnBox(p)) match.gkHold = 1.1;
    if (prevTeam !== p.team && match.lastPossession !== p.team) emit({ t: 'turnover', team: teamIndex(p.team) });
    match.lastPossession = p.team;
    setReceiver(null);
    if (resolveOffside(p)) return;
  }
}

/* ------------------------------------------------------------------ strikes */

const WINDUP: Record<KickKind, number> = {
  pass: 0.075,
  through: 0.09,
  cross: 0.12,
  lob: 0.12,
  shot: 0.13,
  finesse: 0.16,
  chip: 0.13,
  clear: 0.085,
  header: 0,
  volley: 0.05,
  touch: 0,
  knock: 0.04,
};
const BASE_ERR: Record<KickKind, number> = {
  pass: 1.4,
  through: 2.0,
  cross: 3.0,
  lob: 2.8,
  shot: 5.2,
  finesse: 3.6,
  chip: 4.0,
  clear: 7,
  header: 6,
  volley: 6,
  touch: 0,
  knock: 3,
};

/** Build a strike description. Execution error is derived from the kicker and his situation. */
export function makeKick(
  p: Player,
  kind: KickKind,
  mode: KickSpec['mode'],
  tx: number,
  ty: number,
  tz: number,
  speed: number,
  o: { apex?: number; curl?: number; backspin?: number; receiver?: Player | null; shot?: boolean; pass?: boolean; human?: boolean } = {},
): KickSpec {
  const isShot = o.shot ?? (kind === 'shot' || kind === 'finesse' || kind === 'chip');
  const skill = isShot || kind === 'header' || kind === 'volley' ? 0.65 * p.ath.shooting + 0.35 * p.ath.composure : 0.75 * p.ath.passing + 0.25 * p.ath.composure;
  const press = pressureOn(p);
  const sp = Math.hypot(p.velocity.x, p.velocity.z) / p.ath.sprint;
  // striking across the body / on the turn is harder
  const h = headingVec(p.heading);
  const dx = tx - p.position.x;
  const dz = tz - p.position.z;
  const dl = Math.hypot(dx, dz) || 1;
  const facing = (h.x * dx + h.z * dz) / dl;
  const turn = clamp((0.3 - facing) / 1.3, 0, 1);
  const human = o.human ?? p.isHuman;
  let err = BASE_ERR[kind] * (1.5 - skill) * (1 + 0.45 * sp * sp + (isShot ? 1.5 : 0.7) * press * (1.15 - p.ath.composure) + 0.7 * turn);
  err *= human ? 0.85 : D().noise;
  return {
    kind,
    pass: o.pass ?? (kind === 'pass' || kind === 'through' || kind === 'cross' || kind === 'lob'),
    mode,
    tx,
    ty,
    tz,
    speed,
    apex: o.apex ?? 0,
    curl: o.curl ?? 0,
    backspin: o.backspin ?? 0,
    receiver: o.receiver ?? null,
    shot: isShot,
    err,
    human,
  };
}

/**
 * Ask a player to strike the ball. If it is at his feet the wind-up starts now;
 * if it is on its way to him the strike is queued and played first-time as it
 * arrives. Returns false if he is in no state to kick.
 */
export function requestKick(p: Player, spec: KickSpec): boolean {
  if (p.busy() || p.act === 'kick' || p.sentOff) return false;
  p.queued = spec;
  p.queuedT = 0.55;
  return true;
}

function strikeReach(p: Player): number {
  return 1.05 + Math.hypot(p.velocity.x, p.velocity.z) * 0.025;
}

/** Advance queued strikes and wind-ups; resolve contact. Call once per tick, before control resolution. */
export function updateKicks(dt: number): void {
  for (const t of match.teams)
    for (const p of t.players) {
      if (p.sentOff) continue;
      if (p.queued) {
        p.queuedT -= dt;
        if (p.busy() || p.queuedT <= 0 || match.restart) {
          p.queued = null;
        } else if (p.act === 'none') {
          const spec = p.queued;
          const header = spec.kind === 'header';
          const wind = match.controlPlayer === p ? WINDUP[spec.kind] : Math.min(WINDUP[spec.kind], 0.06);
          // will the ball be playable when the foot (or head) arrives?
          const rx = ball.position.x + ball.velocity.x * wind - (p.position.x + p.velocity.x * wind);
          const rz = ball.position.z + ball.velocity.z * wind - (p.position.z + p.velocity.z * wind);
          const ry = ball.position.y + ball.velocity.y * wind - 0.5 * CFG.gravity * wind * wind;
          const okH = header ? ry >= CFG.headLow - 0.15 && ry <= CFG.headHigh : ry <= CFG.volleyHigh + 0.15;
          const reach = header ? CFG.headReach : strikeReach(p);
          if (okH && Math.hypot(rx, rz) <= reach) {
            p.kickSpec = spec;
            p.queued = null;
            p.startAction(header ? 'header' : 'kick', wind + 0.24, wind);
            // the keeper reads the shape of a shot as the leg goes back
            if (spec.shot) {
              const gk = oppOf(p.team).gk;
              if (gk.shotSeenT < 0) {
                gk.shotSeenT = sim.elapsed;
                gk.shotReact = -1; // set when the ball is actually struck (see goalkeeper.ts)
              }
            }
            const dl = Math.hypot(spec.tx - p.position.x, spec.tz - p.position.z) || 1;
            p.actDirX = (spec.tx - p.position.x) / dl;
            p.actDirZ = (spec.tz - p.position.z) / dl;
          }
        }
      }
      if ((p.act === 'kick' || p.act === 'header') && !p.actHit && p.actT >= p.actContact) {
        p.actHit = true;
        const spec = p.kickSpec;
        p.kickSpec = null;
        if (!spec || match.restart) continue;
        const header = spec.kind === 'header';
        const d = planarToBall(p);
        const y = ball.position.y;
        const ok = header ? d <= CFG.headReach + 0.25 && y >= CFG.headLow - 0.3 && y <= CFG.headHigh + 0.1 : d <= strikeReach(p) + 0.3 && y <= CFG.volleyHigh + 0.3;
        // someone else took it off his toe during the wind-up
        const c = match.controlPlayer;
        if (!ok || (c && c !== p)) continue;
        strike(p, spec);
      }
    }
}

const SIMS: BallState = makeBallState();

/** Solve the launch velocity for a spec from the ball's current position (writes into `out`). */
function solveLaunch(spec: KickSpec, out: { vx: number; vy: number; vz: number; wx: number; wy: number; wz: number }): void {
  const bx = ball.position.x;
  const by = ball.position.y;
  const bz = ball.position.z;
  let dx = spec.tx - bx;
  let dz = spec.tz - bz;
  let d = Math.hypot(dx, dz);
  if (d < 1e-3) {
    dx = 1;
    dz = 0;
    d = 1;
  }
  let yaw = Math.atan2(dz, dx);
  const g = CFG.gravity;
  const wy = -spec.curl; // +curl bends right of travel ⇒ ω.y negative
  let speed = spec.speed;
  let pitch = 0;

  if (spec.mode === 'ground') {
    pitch = 0;
  } else if (spec.mode === 'lob') {
    const vy0 = Math.sqrt(2 * g * Math.max(0.4, spec.apex));
    const flight = (vy0 + Math.sqrt(Math.max(0, vy0 * vy0 + 2 * g * (by - CFG.ballR)))) / g;
    let hs = d / flight;
    hs *= 1 + 0.0105 * d; // first-order drag compensation, refined below
    speed = Math.min(CFG.ballMax, Math.hypot(hs, vy0));
    pitch = Math.atan2(vy0, hs);
  } else {
    // 'aim': low trajectory through (d, ty) at the requested speed (vacuum first guess)
    const hgt = spec.ty - by;
    const v2 = speed * speed;
    const disc = v2 * v2 - g * (g * d * d + 2 * hgt * v2);
    pitch = disc > 0 ? Math.atan((v2 - Math.sqrt(disc)) / (g * d)) : Math.PI / 4;
  }

  // Refine yaw/pitch (and lob speed) against the real integrator so drag and
  // Magnus are accounted for: fly it, measure the miss at the target distance, correct.
  if (spec.mode !== 'ground' || Math.abs(wy) > 1) {
    for (let it = 0; it < 4; it++) {
      const ch = Math.cos(pitch);
      const hx = Math.cos(yaw);
      const hz = Math.sin(yaw);
      SIMS.px = bx;
      SIMS.py = by;
      SIMS.pz = bz;
      SIMS.vx = hx * ch * speed;
      SIMS.vy = Math.sin(pitch) * speed;
      SIMS.vz = hz * ch * speed;
      SIMS.wx = -hz * spec.backspin;
      SIMS.wy = wy;
      SIMS.wz = hx * spec.backspin;
      SIMS.grounded = spec.mode === 'ground';
      const tdx = dx / d;
      const tdz = dz / d;
      let along = 0;
      let lastAlong = 0;
      let lastY = by;
      let lat = 0;
      let yAt = by;
      let landed = -1;
      const h = 1 / 60;
      for (let i = 0; i < 240; i++) {
        lastAlong = along;
        lastY = SIMS.py;
        const b = stepBallState(SIMS, h);
        along = (SIMS.px - bx) * tdx + (SIMS.pz - bz) * tdz;
        if (spec.mode === 'lob' && (b > 0 || SIMS.grounded) && landed < 0) {
          landed = along;
          lat = -(SIMS.px - bx) * tdz + (SIMS.pz - bz) * tdx;
          break;
        }
        if (spec.mode !== 'lob' && along >= d) {
          const f = along === lastAlong ? 0 : (d - lastAlong) / (along - lastAlong);
          yAt = lastY + (SIMS.py - lastY) * f;
          lat = -(SIMS.px - bx) * tdz + (SIMS.pz - bz) * tdx;
          break;
        }
      }
      yaw -= Math.atan2(lat, d) * 0.9;
      if (spec.mode === 'lob') {
        if (landed > 0.5) speed = Math.min(CFG.ballMax, speed * clamp(Math.sqrt(d / landed), 0.7, 1.4));
      } else if (spec.mode === 'aim') {
        pitch += Math.atan2(spec.ty - yAt, d) * 0.9;
        pitch = clamp(pitch, -0.05, 1.1);
      }
    }
  }

  const ch = Math.cos(pitch);
  out.vx = Math.cos(yaw) * ch * speed;
  out.vy = Math.sin(pitch) * speed;
  out.vz = Math.sin(yaw) * ch * speed;
  out.wx = -Math.sin(yaw) * spec.backspin;
  out.wy = wy;
  out.wz = Math.cos(yaw) * spec.backspin;
}

const _launch = { vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0 };

/** Make contact: launch the ball per the spec, with execution error, and do the bookkeeping. */
export function strike(p: Player, spec: KickSpec): void {
  // a first-time strike of a moving / bouncing ball is harder to keep true
  const rel = Math.hypot(ball.velocity.x - p.velocity.x, ball.velocity.y, ball.velocity.z - p.velocity.z);
  const firstTime = match.controlPlayer !== p;
  let err = spec.err * (1 + (firstTime ? clamp(rel / 22, 0, 1) * 0.9 : 0) + (ball.position.y > 0.5 ? 0.35 : 0));
  if (spec.kind === 'header') err = spec.err; // already loose

  solveLaunch(spec, _launch);
  // execution error: yaw + pitch
  const ey = (rngNormal() * err * Math.PI) / 180;
  const ep = (rngNormal() * err * 0.55 * Math.PI) / 180;
  const hs = Math.hypot(_launch.vx, _launch.vz);
  const yaw = Math.atan2(_launch.vz, _launch.vx) + ey;
  let pitch = Math.atan2(_launch.vy, hs);
  const sp = Math.hypot(hs, _launch.vy);
  if (spec.mode !== 'ground') pitch = Math.max(-0.02, pitch + ep + (spec.shot ? Math.abs(ep) * 0.35 * (spec.speed / CFG.shootPow) : 0));
  ball.velocity.set(Math.cos(yaw) * Math.cos(pitch) * sp, Math.sin(pitch) * sp, Math.sin(yaw) * Math.cos(pitch) * sp);
  ball.w.set(_launch.wx, _launch.wy, _launch.wz);
  if (ball.position.y < GROUND_Y) ball.position.y = GROUND_Y;
  ballStruck();
  invalidateTrajectory();

  const ti = teamIndex(p.team);
  ball.lastTouch = p.team;
  ball.lastKicker = p;
  ball.lastKickT = sim.elapsed;
  ball.savedOnce = false;
  if (spec.pass) {
    ball.passer = p;
    p.statPasses++;
    match.stats.passes[ti]++;
    match.pendingPass = p;
  }
  ball.shot = spec.shot;
  if (spec.shot) {
    (globalThis as { __shotDbg?: (p: Player, s: KickSpec) => void }).__shotDbg?.(p, spec);
    const xg = estimateXg(p.team, ball.position.x, ball.position.z, pressureOn(p), spec.kind === 'header');
    ball.shotXg = xg;
    p.statShots++;
    p.statXg += xg;
    match.stats.shots[ti]++;
    match.stats.xg[ti] += xg;
    match.shotLog.push({ team: ti, x: ball.position.x, z: ball.position.z, xg, goal: false, t: sim.elapsed });
    emit({ t: 'shot', team: ti, power: sp, xg, human: spec.human, x: ball.position.x, y: ball.position.y, z: ball.position.z });
  }
  p.kickCooldown = 0.3;
  p.lastTouchT = sim.elapsed;
  match.controlPlayer = null;
  match.controlTeam = null;
  match.gkHold = 0;
  match.setPieceT = 0;
  setPassRequest(null);
  setReceiver(spec.receiver);
  emit({ t: 'kick', kind: spec.kind, power: sp, team: ti, human: spec.human, x: ball.position.x, y: ball.position.y, z: ball.position.z });
}

/* ---- convenience builders (the vocabulary the AI and the human layer speak) ---- */

/** Roll a ground pass/shot in `dir` at `power`. `curl` > 0 bends it to the kicker's right. */
export function kick(p: Player, dir: Vector3, power: number, type: 'kick' | 'pass', curl = 0, kind?: KickKind, receiver: Player | null = null): boolean {
  const dl = Math.hypot(dir.x, dir.z);
  const ux = dl > 1e-3 ? dir.x / dl : p.team.side;
  const uz = dl > 1e-3 ? dir.z / dl : 0;
  const k: KickKind = kind ?? (type === 'pass' ? 'pass' : 'shot');
  const far = Math.max(8, dl);
  return requestKick(p, makeKick(p, k, 'ground', ball.position.x + ux * far, 0, ball.position.z + uz * far, power, { curl, receiver, pass: type === 'pass' }));
}

/** Loft the ball to land on `target`, peaking `peak` metres up (crosses, chips, balls over the top). */
export function lobKick(p: Player, target: Vector3, peak: number, type: 'kick' | 'pass', curl = 0, kind?: KickKind, receiver: Player | null = null): boolean {
  const k: KickKind = kind ?? (type === 'pass' ? 'lob' : 'chip');
  return requestKick(p, makeKick(p, k, 'lob', target.x, 0, target.z, 0, { apex: peak, curl, backspin: k === 'chip' ? 26 : 12, receiver, pass: type === 'pass', shot: type !== 'pass' }));
}

/** Drive a shot through the point (tx, ty, tz) in the goal mouth at `speed`. */
export function shootAt(p: Player, tx: number, ty: number, tz: number, speed: number, curl = 0, kind: KickKind = 'shot'): boolean {
  const backspin = kind === 'finesse' ? 6 : speed > 26 ? -4 : 2;
  return requestKick(p, makeKick(p, kind, 'aim', tx, ty, tz, speed, { curl, backspin, shot: true, pass: false }));
}

/** Header an airborne ball toward a point. `down` aims it at the turf (on goal); otherwise it is looped clear. */
export function headBall(p: Player, dir: Vector3, power: number, shot = false): boolean {
  const dl = Math.hypot(dir.x, dir.z) || 1;
  const far = 14;
  const spec = makeKick(p, 'header', 'aim', ball.position.x + (dir.x / dl) * far, shot ? 0.6 : 2.6, ball.position.z + (dir.z / dl) * far, power * (0.75 + 0.25 * p.ath.strength), {
    shot,
    pass: false,
  });
  return requestKick(p, spec);
}

/** Hoof the ball clear, upfield and wide of the middle. */
export function clearBall(p: Player): boolean {
  const zs = Math.sign(p.position.z || rngRange(-1, 1)) || 1;
  const tx = p.position.x + p.team.side * 26;
  const tz = clamp(p.position.z + zs * rngRange(3, 9), -CFG.halfW + 2, CFG.halfW - 2);
  return requestKick(p, makeKick(p, 'clear', 'lob', tx, 0, tz, 0, { apex: 5.5, pass: false, shot: false }));
}

/* ------------------------------------------------------------------ dribbling */

/** How far a carrier can stretch to drag the ball back when cutting against its run. */
export const CUT_REACH = 1.55;

/** The carrier keeps the ball by touching it. Call once per tick after movement. */
export function updateDribble(_dt: number): void {
  const p = match.controlPlayer;
  if (!p || p.act === 'kick' || p.queued || p.busy()) return;
  if (p.roleType === 'GK' && match.gkHold > 0) return;
  if (ball.position.y > CFG.controlHeight + 0.25) return; // popped up — wait for it to drop
  const bx = ball.position.x - p.position.x;
  const bz = ball.position.z - p.position.z;
  const d = Math.hypot(bx, bz);
  const A = p.ath;
  const sw = dribbleWant.speed;
  const dxn = dribbleWant.x;
  const dzn = dribbleWant.z;
  // Cutting back against the ball's run he can stretch a leg out to stop it — a
  // longer reach than a normal touch, which is what keeps a turn at pace sharp.
  const cutting = sw > 0.4 && ball.velocity.x * dxn + ball.velocity.z * dzn < -0.5;
  if (d > (cutting ? CUT_REACH : CFG.controlR) || p.touchCd > 0) return;

  if (sw < 0.4) {
    // standing on it: sole of the boot, the ball stops with him
    const bs = Math.hypot(ball.velocity.x, ball.velocity.z);
    if (bs > 0.6 || d > CFG.carryDist + 0.2) {
      const h = headingVec(p.heading);
      // draw it to just in front of his feet
      const tx = p.position.x + h.x * CFG.carryDist - ball.position.x;
      const tz = p.position.z + h.z * CFG.carryDist - ball.position.z;
      ball.velocity.set(p.velocity.x * 0.5 + tx * 4, 0, p.velocity.z * 0.5 + tz * 4);
      ballStruck();
      p.touchCd = 0.1;
      p.lastTouchT = sim.elapsed;
    }
    return;
  }

  const along = bx * dxn + bz * dzn; // how far ahead the ball is in the wanted direction
  const bvAlong = ball.velocity.x * dxn + ball.velocity.z * dzn;
  const bvSide = Math.abs(-ball.velocity.x * dzn + ball.velocity.z * dxn);
  const sprinty = sw > A.run * 1.06;
  // a touch is due when the ball is no longer running ahead of him the way he wants to go
  const due = bvAlong < sw * 0.97 || bvSide > 1.2 || along < 0.15;
  if (!due) return;

  let lead = sprinty ? 2.3 - 0.95 * A.control : 1.2 - 0.5 * A.control;
  // a clumsy heavy touch at full tilt
  if (sprinty && chance(0.02 + 0.1 * (1 - A.control) * (1 - A.control) * 4)) lead += rngRange(1.2, 2.4);
  // shielding / under pressure: keep it tighter
  if (p.pressure > 0.6 && !sprinty) lead *= 0.8;
  const errDeg = (sprinty ? 4.2 : 1.8) * (1.35 - A.control);
  const a = (rngNormal() * errDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const ux = dxn * ca - dzn * sa;
  const uz = dxn * sa + dzn * ca;
  // He can only push the ball as fast as he can follow it: the touch is paced off
  // the speed he is *actually* carrying in the wanted direction (plus what he can
  // add in a stride), not off the speed he is asking for. Setting off from a
  // standstill is a soft touch; cutting back at full tilt is a drag-back, not a
  // 10 m/s pass to nobody.
  const curAlong = Math.max(0, p.velocity.x * dxn + p.velocity.z * dzn);
  const pace = Math.min(sw, curAlong + 1.6);
  lead *= 0.45 + 0.55 * Math.min(1, curAlong / Math.max(1, sw));
  // if the ball has got beside/behind him, the touch also drags it back in front
  const drag = along < 0.2 ? 0.9 : 0;
  const v = pace + lead + drag;
  ball.velocity.set(ux * v, 0, uz * v);
  ball.w.y = 0;
  ballStruck();
  p.touchCd = sprinty ? 0.2 : 0.11;
  p.lastTouchT = sim.elapsed;
  ball.lastTouch = p.team;
  ball.lastKicker = p;
  if (sprinty) emit({ t: 'kick', kind: 'touch', power: v, team: teamIndex(p.team), human: p.isHuman, x: ball.position.x, y: ball.position.y, z: ball.position.z });
}

/* ------------------------------------------------------------------ control resolution */

/** How fast a ball (relative speed, m/s) this player can bring under control right now. */
function controlCapacity(p: Player, hands: boolean): number {
  if (hands) return 22 + 10 * D().keeper;
  let C = 12.5 + 15 * p.ath.control;
  const by = ball.position.y - CFG.ballR;
  if (by > CFG.controlHeight) C *= 0.72; // thigh / chest
  if (ball.velocity.y < -3 || by > 0.15) C *= 0.9; // bouncing
  // arriving from behind him is awkward
  const h = headingVec(p.heading);
  const bs = Math.hypot(ball.velocity.x, ball.velocity.z);
  if (bs > 2) {
    const from = (ball.velocity.x * h.x + ball.velocity.z * h.z) / bs; // +1 = travelling the way he faces
    if (from > 0.35) C *= 0.86;
  }
  const sp = Math.hypot(p.velocity.x, p.velocity.z) / p.ath.sprint;
  C *= 1 - 0.18 * sp * sp;
  if (match.receivingPlayer === p) C *= 1.22; // set for it
  if (p.isHuman) C *= 1.08;
  C *= 1 - 0.12 * pressureOn(p) * (1.1 - p.ath.composure);
  return C;
}

/** A player gets to the ball: trap it, take a heavy touch, or see it bounce off him. */
function attemptControl(p: Player, hands: boolean): void {
  const rvx = ball.velocity.x - p.velocity.x;
  const rvy = ball.velocity.y;
  const rvz = ball.velocity.z - p.velocity.z;
  const vrel = Math.hypot(rvx, rvy, rvz);
  const C = controlCapacity(p, hands);
  const ti = teamIndex(p.team);
  // Anything struck with real venom can't be killed — it hits him and goes
  // somewhere (a block). Only the man it was meant for, set for it, stands a chance.
  const tooHot = hands ? C * 1.25 : Math.min(C * 1.25, (16.5 + 7 * p.ath.control) * (match.receivingPlayer === p ? 1.25 : 1));

  if (vrel > tooHot) {
    // too hot to handle: it cannons off him
    let nx = ball.position.x - p.position.x;
    let nz = ball.position.z - p.position.z;
    let nl = Math.hypot(nx, nz);
    if (nl < 1e-3) {
      nx = -rvx;
      nz = -rvz;
      nl = Math.hypot(nx, nz) || 1;
    }
    nx /= nl;
    nz /= nl;
    const vn = rvx * nx + rvz * nz;
    if (vn < 0) {
      const e = 0.32;
      const a = rngRange(-0.35, 0.35);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      let ox = rvx - (1 + e) * vn * nx;
      let oz = rvz - (1 + e) * vn * nz;
      const k = 0.62;
      ox *= k;
      oz *= k;
      ball.velocity.x = p.velocity.x + ox * ca - oz * sa;
      ball.velocity.z = p.velocity.z + ox * sa + oz * ca;
      ball.velocity.y = Math.abs(rvy) * 0.3 + rngRange(0.5, 3);
      ball.w.set(0, 0, 0);
      ball.position.x = p.position.x + nx * (CFG.controlR * 0.75);
      ball.position.z = p.position.z + nz * (CFG.controlR * 0.75);
      ballStruck();
      invalidateTrajectory();
    }
    if (match.controlPlayer && match.controlPlayer !== p) setControlLoose();
    ball.lastTouch = p.team;
    p.kickCooldown = 0.22;
    p.lastTouchT = sim.elapsed;
    resolvePendingPass(p);
    setReceiver(null);
    emit({ t: 'block', team: ti, speed: vrel, x: ball.position.x, y: ball.position.y, z: ball.position.z });
    return;
  }

  const quality = clamp(1 - (vrel - 0.5 * C) / (0.75 * C), 0, 1);
  const wasPass = match.pendingPass;
  resolvePendingPass(p);
  setControl(p);
  if (match.controlPlayer !== p) return; // offside etc. took it away

  if (hands) {
    emitFirstTouch(p, quality, vrel);
    return;
  }

  // Which way does he want to take it? (directional first touch)
  let wxn = 0;
  let wzn = 0;
  let go = 0; // extra pace on the touch when taking it in his stride
  const s0 = Math.hypot(p.velocity.x, p.velocity.z);
  if (p.isHuman) {
    const il = Math.hypot(match.input.x, match.input.z);
    if (il > 0.3) {
      wxn = match.input.x / il;
      wzn = match.input.z / il;
      go = match.input.sprint ? 1.6 : 0.8;
    }
  } else {
    const o = nearestOpp(p);
    const od = o ? Math.sqrt(distSq(o.position, p.position)) : 99;
    if (o && od < 3.2) {
      // a marker is tight: take the touch away from him (and keep the body between)
      wxn = (p.position.x - o.position.x) / (od || 1);
      wzn = (p.position.z - o.position.z) / (od || 1);
      if (s0 > 1.5) {
        wxn = wxn * 0.6 + (p.velocity.x / s0) * 0.4;
        wzn = wzn * 0.6 + (p.velocity.z / s0) * 0.4;
        const wl = Math.hypot(wxn, wzn) || 1;
        wxn /= wl;
        wzn /= wl;
      }
      go = 0.5;
    } else if (s0 > 2) {
      wxn = p.velocity.x / s0;
      wzn = p.velocity.z / s0;
      go = 0.9;
    }
  }
  if (wxn === 0 && wzn === 0) {
    const h = headingVec(p.heading);
    wxn = h.x;
    wzn = h.z;
  }
  // A good touch brings the ball to his feet in the direction he wants: it ends up
  // a stride in front of him, moving with him. A poor one leaves some of the
  // incoming pace on it and it squirts away.
  const relx = ball.position.x - p.position.x;
  const relz = ball.position.z - p.position.z;
  const tx = wxn * (CFG.carryDist + 0.08) - relx;
  const tz = wzn * (CFG.carryDist + 0.08) - relz;
  let vx = p.velocity.x + tx * 3.6 + wxn * go;
  let vz = p.velocity.z + tz * 3.6 + wzn * go;
  const loose = (1 - quality) * (1 - quality);
  if (loose > 0.02) {
    const a = rngRange(-1.2, 1.2);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const k = loose * 0.5;
    // some of the incoming pace survives, knocked off line
    vx += -(rvx * ca - rvz * sa) * k;
    vz += -(rvx * sa + rvz * ca) * k;
  }
  ball.velocity.set(vx, quality < 0.45 ? rngRange(0.8, 2.4) * (1 - quality) : 0, vz);
  ball.w.set(0, 0, 0);
  ballStruck();
  invalidateTrajectory();
  p.touchCd = 0.1 + (1 - quality) * 0.28;
  p.lastTouchT = sim.elapsed;
  if (wasPass || vrel > 7) emitFirstTouch(p, quality, vrel);
}

function emitFirstTouch(p: Player, quality: number, vrel: number): void {
  if (vrel > 5) emit({ t: 'firstTouch', team: teamIndex(p.team), quality, human: p.isHuman, x: p.position.x, y: 0, z: p.position.z });
}

/** The ball is loose: nobody has it under control. */
function setControlLoose(): void {
  match.controlPlayer = null;
  match.controlTeam = null;
  setPassRequest(null);
}

/** Settle the outstanding pass: completed to a team-mate, or cut out. */
function resolvePendingPass(by: Player): void {
  const passer = match.pendingPass;
  if (!passer) return;
  match.pendingPass = null;
  const ti = teamIndex(passer.team);
  if (by.team === passer.team && by !== passer) {
    passer.statPassesDone++;
    match.stats.passesDone[ti]++;
  } else if (by.team !== passer.team) {
    match.stats.interceptions[teamIndex(by.team)]++;
  }
}

/* ------------------------------------------------------------------ goalkeeping contact */

const _seg = { t: 0, d: 0 };
/** Distance from point P to segment AB (3-D); writes the param t and distance. */
function distToSeg(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number): void {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > 1e-9 ? ((px - ax) * abx + (py - ay) * aby + (pz - az) * abz) / l2 : 0;
  t = clamp(t, 0, 1);
  _seg.t = t;
  _seg.d = Math.hypot(px - (ax + abx * t), py - (ay + aby * t), pz - (az + abz * t));
}

/**
 * The keeper's body/arm line right now: feet→hands when standing (he can jump
 * for a high ball), hips→fingertips along the dive when at full stretch.
 */
function keeperLine(gk: Player, out: { ax: number; ay: number; az: number; bx: number; by: number; bz: number }): void {
  if (gk.act === 'dive') {
    const k = clamp(gk.actT / 0.3, 0, 1); // arms reach full stretch about a third of a second in
    // a high ball is at the end of a diagonal: he can't get as far across for it
    const high = 1 - 0.3 * clamp((gk.diveY - 1.0) / 1.4, 0, 1);
    const reach = (0.35 + CFG.gkArm * k) * high;
    // the body lays out along the dive: trailing hip → fingertips, at the height of the ball
    // the hands get to the ball's height quickly (down to a low one, up to a high one)
    const yHand = 1.1 + (gk.diveY - 1.1) * clamp(gk.actT / 0.14, 0, 1);
    const yHip = 0.95 + (clamp(gk.diveY - 0.45, 0.3, 1.7) - 0.95) * k;
    out.ax = gk.position.x - gk.actDirX * 0.45 * k;
    out.ay = yHip;
    out.az = gk.position.z - gk.actDirZ * 0.45 * k;
    out.bx = gk.position.x + gk.actDirX * reach;
    out.by = clamp(yHand, 0.2, 2.65);
    out.bz = gk.position.z + gk.actDirZ * reach;
  } else {
    out.ax = gk.position.x;
    out.ay = 0.15;
    out.az = gk.position.z;
    out.bx = gk.position.x;
    out.by = 2.05;
    out.bz = gk.position.z;
  }
}
const _line = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0 };

/** Does a keeper get something on the ball this tick? Catch, parry or fingertip. Returns true if handled. */
function keeperContact(gk: Player): boolean {
  if (gk.sentOff || gk.act === 'recover' || gk.kickCooldown > 0) return false;
  if (match.controlPlayer === gk) return false;
  if (!inOwnBox(gk, ball.position.x, ball.position.z) && Math.abs(ball.position.x) < CFG.halfL) return false;
  keeperLine(gk, _line);
  distToSeg(ball.position.x, ball.position.y, ball.position.z, _line.ax, _line.ay, _line.az, _line.bx, _line.by, _line.bz);
  const diving = gk.act === 'dive';
  // standing: arms out to the side. Set for a close-range finish he spreads himself —
  // legs and arms wide — which is how keepers actually stop shots they can't react to.
  const spread = !diving && sim.elapsed - gk.spreadT < 0.25 && ball.position.y < 1.35 ? 0.5 * (0.55 + 0.45 * D().keeper) : 0;
  const touchR = CFG.gkTouchR + CFG.ballR + (diving ? 0 : 0.3) + spread;
  if (_seg.d > touchR) return false;

  const speed = Math.hypot(ball.velocity.x, ball.velocity.y, ball.velocity.z);
  const carrier = match.controlPlayer;
  // a save is only a save if it was a strike at goal (or a wicked deflection) — never a dribble touch
  const live = !carrier && (ball.shot || speed > 16) && speed > CFG.gkDiveTrigger && headingForGoal(gk, 1.2);
  if (!live) {
    // the spread stance only blocks shots; for anything else he needs his normal reach
    if (_seg.d > touchR - spread) return false;
    if (carrier && carrier.team !== gk.team) {
      // at an attacker's feet: only a keeper going down at them can smother it,
      // and only while the ball is off the attacker's boot
      if (!diving || planarToBall(carrier) < 0.55) return false;
      if (chance(0.45 + 0.45 * D().keeper)) {
        setControl(gk);
        match.gkHold = 1.5;
        emit({ t: 'save', team: teamIndex(gk.team), parry: false, diving: true, speed, x: ball.position.x, y: ball.position.y, z: ball.position.z });
        emit({ t: 'toast', text: gk.team.isUser ? 'SMOTHERED!' : 'KEEPER SMOTHERS IT' });
      } else {
        // gets something on it: it squirts loose
        const a = rngRange(-1.2, 1.2);
        setControlLoose();
        ball.velocity.set(-Math.sign(ownGoalX(gk.team)) * (2 + rng() * 3) * Math.cos(a), 1 + rng() * 2, Math.sin(a) * 5);
        ball.lastTouch = gk.team;
        gk.kickCooldown = 0.5;
        ballStruck();
        invalidateTrajectory();
      }
      return true;
    }
    if (speed < 16) {
      resolvePendingPass(gk);
      setControl(gk);
      return true;
    }
    return false;
  }

  const K = D().keeper;
  const stretch = diving ? _seg.t : 0;
  const edge = _seg.d / touchR;
  const onTarget = headingForGoal(gk, 0);
  const ti = teamIndex(gk.team);
  const zs = Math.sign(ball.position.z - gk.position.z || gk.actDirZ || 1);

  // fingertips: only a faint touch — it changes course but keeps most of its pace
  if (edge > 0.82 && speed > 13 && diving) {
    const a = zs * rngRange(0.12, 0.3);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const vx = ball.velocity.x;
    const vz = ball.velocity.z;
    // rotate away from goal centre
    const sgn = gk.team.side > 0 ? 1 : -1; // keeps the rotation outward for both ends
    ball.velocity.x = (vx * ca - vz * sa * sgn) * 0.84;
    ball.velocity.z = (vx * sa * sgn + vz * ca) * 0.84;
    ball.velocity.y = ball.velocity.y * 0.8 + rngRange(0.5, 2.5);
    ball.w.multiplyScalar(0.3);
    ball.lastTouch = gk.team;
    gk.kickCooldown = 0.4;
    ballStruck();
    invalidateTrajectory();
    if (onTarget) creditSave(gk);
    emit({ t: 'save', team: ti, parry: true, diving: true, speed, x: ball.position.x, y: ball.position.y, z: ball.position.z });
    emit({ t: 'toast', text: gk.team.isUser ? 'FINGERTIPS!' : 'TIPPED AWAY!' });
    return true;
  }

  // at full stretch against real pace he may get a hand to it and still not keep it out
  if (diving && stretch > 0.7 && onTarget && chance((0.06 + 0.45 * (1 - K)) * clamp(speed / 28, 0.4, 1.2) * (stretch - 0.5) * 2)) {
    ball.velocity.x *= 0.72;
    ball.velocity.z = ball.velocity.z * 0.72 + zs * rngRange(0.5, 2.2);
    ball.velocity.y = ball.velocity.y * 0.6 + rngRange(0, 1.5);
    ball.w.multiplyScalar(0.3);
    ball.lastTouch = gk.team;
    gk.kickCooldown = 0.5;
    ballStruck();
    invalidateTrajectory();
    emit({ t: 'toast', text: gk.team.isUser ? 'GOT A HAND TO IT…' : 'KEEPER GETS A HAND TO IT…' });
    return true;
  }

  const pCatch = clamp(1.2 - speed / 23 - stretch * 0.5 - (diving ? 0.12 : 0) - (spread > 0 ? edge * 0.6 : 0), 0.02, 0.96) * (0.55 + 0.5 * K);
  if (onTarget) creditSave(gk);
  if (chance(pCatch)) {
    resolvePendingPass(gk);
    setControl(gk);
    match.gkHold = diving ? 1.6 : 1.1;
    emit({ t: 'save', team: ti, parry: false, diving, speed, x: ball.position.x, y: ball.position.y, z: ball.position.z });
    if (diving || speed > 20) emit({ t: 'toast', text: gk.team.isUser ? 'KEEPER SAVES!' : 'WHAT A SAVE!' });
    return true;
  }
  // parry: beaten away, wide of the goal and out toward the touchline
  const out = 0.3 + 0.2 * rng();
  const away = -Math.sign(ownGoalX(gk.team)); // +1 = toward +X (away from a −X goal)
  ball.velocity.set(away * (2.5 + speed * out * 0.5), 1.5 + rng() * 3.5, zs * (3.5 + speed * out * 0.7));
  ball.w.set(0, 0, 0);
  ball.lastTouch = gk.team;
  gk.kickCooldown = 0.45;
  ballStruck();
  invalidateTrajectory();
  setReceiver(null);
  match.pendingPass = null;
  emit({ t: 'save', team: ti, parry: true, diving, speed, x: ball.position.x, y: ball.position.y, z: ball.position.z });
  emit({ t: 'toast', text: gk.team.isUser ? 'PARRIED!' : 'GREAT SAVE!' });
  return true;
}

/** Commit the keeper to a dive toward (tx, ty, tz). */
export function startGkDive(p: Player, tx: number, tz: number, ty = 1): boolean {
  if (p.act !== 'none' || p.diveCd > 0 || p.roleType !== 'GK') return false;
  const dx = tx - p.position.x;
  const dz = tz - p.position.z;
  const d = Math.hypot(dx, dz) || 1;
  p.startAction('dive', CFG.gkDiveTime);
  p.actDirX = dx / d;
  p.actDirZ = dz / d;
  p.diveCd = CFG.gkDiveCooldown;
  // He throws his *hands* at the ball, so the body travels the distance less most
  // of his reach — and he can only fling himself so far.
  const lunge = clamp(d - (0.35 + CFG.gkArm) * 0.7, 0, CFG.gkDiveLunge * (1 - 0.3 * clamp((ty - 1.0) / 1.4, 0, 1)));
  p.diveTarget.set(p.position.x + (dx / d) * lunge, 0, p.position.z + (dz / d) * lunge);
  p.diveY = clamp(ty, 0.25, 2.5);
  emit({ t: 'dive', team: teamIndex(p.team), x: p.position.x, y: 1, z: p.position.z });
  return true;
}

/* ------------------------------------------------------------------ resolve who has the ball */

/** Resolve possession for this tick: keeper contact, loose-ball collection, first touches, lost control. */
export function resolveControl(dt: number): void {
  if (match.controlCooldown > 0) match.controlCooldown -= dt;
  if (match.setPieceT > 0) match.setPieceT -= dt;
  if (match.restart) return; // dead ball

  const c0 = match.controlPlayer;
  if (c0) {
    c0.pressure = pressureOn(c0);
    if (!(c0.roleType === 'GK' && match.gkHold > 0)) {
      const cd = planarToBall(c0);
      if (cd > CFG.loseControlR || ball.position.y > 2.2) setControlLoose(); // it has got away from him
    }
  }
  const protect = match.setPieceT > 0 ? match.setPieceTaker : null;

  // keepers first: hands beat feet in the box
  if (!protect) {
    for (const t of match.teams) {
      if (keeperContact(t.gk)) return;
    }
  }

  const c = match.controlPlayer;
  if (c && c.roleType === 'GK' && match.gkHold > 0) return;
  const by = ball.position.y - CFG.ballR;
  if (by > CFG.chestHeight) return; // only heads up there

  let near: Player | null = null;
  let nd = Infinity;
  for (const t of match.teams)
    for (const p of t.players) {
      if (p === c || p.sentOff || p.busy() || p.kickCooldown > 0 || p.act === 'kick' || p.act === 'header' || p.queued) continue;
      if (protect && p !== protect) continue;
      const reach = CFG.controlR + (match.receivingPlayer === p ? 0.15 : 0);
      const d = planarToBall(p);
      if (d < reach && d < nd) {
        nd = d;
        near = p;
      }
    }
  if (!near) return;

  if (c) {
    const cd = planarToBall(c);
    if (near.team === c.team) {
      // a team-mate only takes it over if the carrier has really let it go
      if (cd > CFG.closeControlR + 0.5) attemptControl(near, false);
      return;
    }
    // an opponent can simply collect a ball the carrier has let run away from his feet;
    // if it is at his feet it takes a tackle (see resolveTackles)
    if (cd > CFG.closeControlR && nd < cd - 0.2) {
      (globalThis as { __nickDbg?: (c: Player, cd: number) => void }).__nickDbg?.(c, cd);
      creditTackle(near);
      const was = c;
      attemptControl(near, false);
      if (match.controlPlayer === near) {
        emit({ t: 'tackle', team: teamIndex(near.team), slide: false, human: near.isHuman, x: ball.position.x, y: 0, z: ball.position.z });
        emit({ t: 'toast', text: near.team.isUser ? 'BALL WON' : was.team.isUser ? 'DISPOSSESSED' : 'INTERCEPTED' });
      }
    }
    return;
  }
  attemptControl(near, near.roleType === 'GK' && inOwnBox(near, ball.position.x, ball.position.z));
}

/* ------------------------------------------------------------------ challenges */

/** Commit to a standing tackle toward the ball. */
export function startTackle(p: Player): boolean {
  if (p.act !== 'none' || p.tackleCd > 0 || p.roleType === 'GK' || p.queued) return false;
  const dx = ball.position.x + ball.velocity.x * CFG.tackleWindup - p.position.x;
  const dz = ball.position.z + ball.velocity.z * CFG.tackleWindup - p.position.z;
  const d = Math.hypot(dx, dz) || 1;
  p.startAction('tackle', CFG.tackleWindup + 0.22, CFG.tackleWindup);
  p.actDirX = dx / d;
  p.actDirZ = dz / d;
  p.tackleCd = CFG.tackleCooldown;
  return true;
}

/** Commit to a slide tackle toward where the ball is going. */
export function startSlide(p: Player): boolean {
  if (p.act !== 'none' || p.slideCd > 0 || p.roleType === 'GK') return false;
  const lead = 0.22;
  const dx = ball.position.x + ball.velocity.x * lead - p.position.x;
  const dz = ball.position.z + ball.velocity.z * lead - p.position.z;
  const d = Math.hypot(dx, dz) || 1;
  p.startAction('slide', CFG.slideTime);
  p.actDirX = dx / d;
  p.actDirZ = dz / d;
  p.slideCd = CFG.slideCooldown;
  p.queued = null;
  emit({ t: 'slide', team: teamIndex(p.team), x: p.position.x, y: 0, z: p.position.z });
  return true;
}

function giveFoul(fouler: Player, victim: Player, reckless: boolean): void {
  for (const tt of match.teams) for (const pp of tt.players) if (pp.act === 'slide' || pp.act === 'tackle') pp.startAction('recover', 0.3);
  addStoppage(CFG.stoppagePerFoul);
  const card = foulCard(fouler, reckless);
  emit({ t: 'foul', team: teamIndex(fouler.team), card, player: fouler.name });
  const x = clamp(ball.position.x, -CFG.halfL + 1, CFG.halfL - 1);
  const z = clamp(ball.position.z, -CFG.halfW + 1, CFG.halfW - 1);
  awardRestart('freekick', x, z, victim.team, fouler.team.isUser ? 'FOUL GIVEN AWAY' : 'FREE KICK WON', 0.7);
}

/** Resolve standing tackles and slides against the ball (and the man). Call once per tick. */
export function resolveTackles(_dt: number): void {
  if (match.restart) return;
  for (const t of match.teams)
    for (const p of t.players) {
      if (p.sentOff || p.actHit) continue;
      const slide = p.act === 'slide';
      if (!slide && !(p.act === 'tackle' && p.actT >= p.actContact)) continue;
      const c = match.controlPlayer;
      if (ball.position.y > 0.75) {
        if (!slide) p.actHit = true;
        continue;
      }
      // the leg: from the body out along the lunge
      const reach = slide ? CFG.slideReach : CFG.tackleReach;
      const ax = p.position.x;
      const az = p.position.z;
      const bx = ax + p.actDirX * reach;
      const bz = az + p.actDirZ * reach;
      distToSeg(ball.position.x, 0, ball.position.z, ax, 0, az, bx, 0, bz);
      const ballT = _seg.t;
      const ballD = _seg.d;
      const touchBall = ballD < (slide ? 0.5 : 0.42);
      if (!slide) p.actHit = true; // a standing tackle is one moment
      const protect = match.setPieceT > 0;

      if (c && c.team !== p.team && !(c.roleType === 'GK' && match.gkHold > 0) && !protect) {
        // is the man in the way of the ball?
        distToSeg(c.position.x, 0, c.position.z, ax, 0, az, bx, 0, bz);
        const manT = _seg.t;
        const manD = _seg.d;
        const hitMan = manD < 0.42;
        const ch = headingVec(c.heading);
        const fromBehind = ch.x * p.actDirX + ch.z * p.actDirZ > 0.45;
        const manFirst = hitMan && (!touchBall || manT < ballT - 0.08);
        if (manFirst && (slide || fromBehind)) {
          // through the back of him / studs into the man
          const pf = (slide ? 0.78 : 0.5) * (1.45 - p.ath.tackling) * (fromBehind ? 1.25 : 0.8);
          p.actHit = true;
          if (chance(clamp(pf, 0.08, 0.95))) {
            giveFoul(p, c, slide);
            return;
          }
          c.startAction('stumble', 0.3);
          if (!slide) p.startAction('recover', CFG.tackleRecover);
          continue;
        }
        if (!touchBall) {
          if (!slide) p.startAction('recover', CFG.tackleRecover * 0.8); // swung and missed — beaten
          continue;
        }
        p.actHit = true;
        // the duel: timing/technique of the tackler vs the control and strength of the carrier
        const loose = planarToBall(c) > 0.85; // a heavy touch is there to be won
        let pWin = 0.55 + 0.6 * (p.ath.tackling - 0.6) - 0.4 * (c.ath.control - 0.6) - 0.2 * (c.ath.strength - 0.6) + (loose ? 0.22 : 0) + (slide ? 0.14 : 0) + (p.jockey ? 0.08 : 0);
        if (fromBehind) pWin -= 0.22;
        pWin = clamp(pWin, 0.1, 0.96);
        if (!chance(pWin)) {
          if (!slide) p.startAction('recover', CFG.tackleRecover);
          continue;
        }
        creditTackle(p);
        match.pendingPass = null;
        const ti = teamIndex(p.team);
        if (!slide && chance(0.3 + 0.55 * p.ath.tackling)) {
          // comes away with it cleanly
          ball.velocity.set(p.velocity.x * 0.7 + p.actDirX * 1.2, 0, p.velocity.z * 0.7 + p.actDirZ * 1.2);
          ballStruck();
          setControl(p);
          p.clearAction();
        } else {
          setControlLoose();
          const pw = slide ? rngRange(7, 10.5) : rngRange(4.5, 7.5);
          const a = rngRange(-0.5, 0.5);
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          ball.velocity.set((p.actDirX * ca - p.actDirZ * sa) * pw, slide ? rngRange(0, 1.6) : 0, (p.actDirX * sa + p.actDirZ * ca) * pw);
          ball.w.set(0, 0, 0);
          ball.lastTouch = p.team;
          ballStruck();
        }
        invalidateTrajectory();
        c.startAction('stumble', 0.34);
        c.queued = null;
        emit({ t: 'tackle', team: ti, slide, human: p.isHuman, x: ball.position.x, y: 0, z: ball.position.z });
        emit({ t: 'toast', text: slide ? (p.team.isUser ? 'SLIDE TACKLE!' : 'SLIDE TACKLE') : p.team.isUser ? 'TACKLE!' : c.team.isUser ? 'DISPOSSESSED' : 'TACKLE' });
      } else if (!c && touchBall && !protect) {
        // loose ball: toe it on in the direction of the lunge
        p.actHit = true;
        const pw = slide ? 9 : 6;
        ball.velocity.set(p.actDirX * pw, 0, p.actDirZ * pw);
        ball.w.set(0, 0, 0);
        ball.lastTouch = p.team;
        ball.lastKicker = p;
        match.pendingPass = null;
        setReceiver(null);
        ballStruck();
        invalidateTrajectory();
        emit({ t: 'kick', kind: 'touch', power: pw, team: teamIndex(p.team), human: p.isHuman, x: ball.position.x, y: 0, z: ball.position.z });
      }
    }
}

/** Kept for call-site compatibility: slides are resolved with the other challenges. */
export function resolveSlides(dt: number): void {
  resolveTackles(dt);
}

/** Refresh pressure on the carrier (the old timer-based auto-dispossession is gone). */
export function updatePressure(_dt: number): void {
  const c = match.controlPlayer;
  if (c) c.pressure = pressureOn(c);
}

/* ------------------------------------------------------------------ keeper distribution */

/** A keeper who has gathered the ball holds briefly, then distributes (throw or kick). */
export function updateGkHold(dt: number): void {
  const gk = match.controlPlayer;
  if (match.gkHold <= 0 || !gk || gk.roleType !== 'GK') return;
  // face upfield while he looks for an outlet
  gk.faceYaw = gk.team.side > 0 ? Math.PI / 2 : -Math.PI / 2;
  match.gkHold -= dt;
  if (match.gkHold > 0) return;
  match.gkHold = 0;
  const opp = oppOf(gk.team);
  // put it down at his feet and play it
  const f = headingVec(gk.heading);
  ball.position.set(gk.position.x + f.x * 0.5, GROUND_Y, gk.position.z + f.z * 0.5);
  ball.velocity.set(0, 0, 0);
  ball.grounded = true;
  const pass = findBestPass(gk, CFG.passLong, CFG.minPassDist, opp);
  if (pass) {
    const dx = pass.target.x - ball.position.x;
    const dz = pass.target.z - ball.position.z;
    const dist = Math.hypot(dx, dz);
    const spec = makeKick(gk, 'pass', 'ground', pass.target.x, 0, pass.target.z, passWeight(dist, CFG.passLong), { receiver: pass.receiver, pass: true });
    strike(gk, spec);
  } else {
    // nothing short on: go long toward the most advanced team-mate
    let best: Player | null = null;
    let adv = -Infinity;
    for (const m of gk.team.outfield()) {
      const a = m.position.x * gk.team.side;
      if (a > adv) {
        adv = a;
        best = m;
      }
    }
    const tx = best ? best.position.x + gk.team.side * 2 : gk.position.x + gk.team.side * 28;
    const tz = best ? best.position.z : rngRange(-8, 8);
    strike(gk, makeKick(gk, 'clear', 'lob', tx, 0, tz, 0, { apex: 7, receiver: best, pass: !!best }));
  }
}
