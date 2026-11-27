import { CFG, DIFF } from '../config/constants';
import { angDiff, clamp, distSq } from '../core/math';
import { emit } from '../core/bus';
import { ball, match } from './state';
import { interceptPoint } from './predict';
import { Steer, type Player } from '../entities/Player';

/*
 * Player locomotion v2.
 *
 * Every player — human or AI — goes through the same body model:
 *
 *   intent  → a desired velocity (stick, or an AI steering target)
 *   body    → the actual velocity chases it under acceleration / braking / grip
 *             limits that come from the player's own athletic profile, so pace,
 *             acceleration and agility are *felt*: a quick winger snaps to top
 *             speed and cuts sharply, a centre-half takes longer to turn
 *   facing  → the body turns at a limited rate toward where it is going (or
 *             toward the ball when jockeying)
 *
 * The ball carrier is additionally bound to the ball: he can only change
 * direction *with* it once it is back within playing reach, which is what makes
 * sprint-dribbling (heavy touches, slow turns) different from close control.
 */

const SPREAD_R2 = CFG.spreadRadius * CFG.spreadRadius;

/** Desired velocity scratch. */
let wx = 0;
let wz = 0;
/** Yaw the player would like to face (NaN = follow velocity). */
let wantYaw = NaN;

function setWant(x: number, z: number): void {
  wx = x;
  wz = z;
}

/** Top speed available right now (stamina, ball at feet, knock-on burst). */
export function topSpeed(p: Player, sprint: boolean): number {
  const sta = 0.86 + 0.14 * p.stamina;
  let v = sprint ? p.ath.sprint * sta : p.ath.run;
  if (match.controlPlayer === p) v *= sprint ? 0.9 + 0.07 * p.ath.control : 0.97;
  if (p.boost > 0) v = Math.max(v, p.ath.sprint * sta * CFG.knockBoost);
  if (p.act === 'stumble') v *= 0.55;
  if (p.act === 'kick') v *= 0.82;
  return v;
}

/** Where should a player who wants the ball run? Fills want* with a velocity. Returns false if he can't get there. */
function chaseBall(p: Player, speed: number): boolean {
  const c = match.controlPlayer;
  if (c && c !== p) {
    // somebody has it: close on the ball, leading the carrier a touch
    const lead = clamp(Math.hypot(ball.position.x - p.position.x, ball.position.z - p.position.z) / (speed + 0.01), 0, 0.5);
    const tx = ball.position.x + c.velocity.x * lead;
    const tz = ball.position.z + c.velocity.z * lead;
    const dx = tx - p.position.x;
    const dz = tz - p.position.z;
    const d = Math.hypot(dx, dz) || 1;
    setWant((dx / d) * speed, (dz / d) * speed);
    return true;
  }
  const hit = interceptPoint(p.position.x, p.position.z, speed * 0.96, 0.05, p.roleType === 'GK' ? CFG.headHigh : CFG.chestHeight);
  let tx = ball.position.x;
  let tz = ball.position.z;
  if (hit) {
    tx = hit.x;
    tz = hit.z;
  } else {
    // can't catch it inside the horizon — run where it is heading
    tx += ball.velocity.x * 0.6;
    tz += ball.velocity.z * 0.6;
  }
  const dx = tx - p.position.x;
  const dz = tz - p.position.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.15) {
    setWant(0, 0);
    return !!hit;
  }
  // ease off when arriving early so he meets the ball instead of overrunning it
  let v = speed;
  if (hit && hit.t > 0.15) v = Math.min(speed, Math.max(p.ath.run * 0.6, d / hit.t + 0.8));
  setWant((dx / d) * v, (dz / d) * v);
  return !!hit;
}

/** AI steering intent → desired velocity. */
function aiWant(p: Player): void {
  const D = DIFF[CFG.diff];
  wantYaw = p.faceYaw ?? NaN;
  switch (p.steer) {
    case Steer.None:
      setWant(0, 0);
      return;
    case Steer.Seek: {
      const v = topSpeed(p, p.stamina > 0.12) * D.aiSpd;
      const dx = p.steerTarget.x - p.position.x;
      const dz = p.steerTarget.z - p.position.z;
      const d = Math.hypot(dx, dz) || 1;
      setWant((dx / d) * v, (dz / d) * v);
      return;
    }
    case Steer.Intercept: {
      const v = topSpeed(p, p.stamina > 0.12) * (p.roleType === 'GK' ? 1 : D.aiSpd);
      chaseBall(p, v);
      return;
    }
    case Steer.Arrive: {
      const dx = p.steerTarget.x - p.position.x;
      const dz = p.steerTarget.z - p.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.12) {
        setWant(0, 0);
        return;
      }
      const sprint = (p.wantSprint || d > 9) && p.stamina > 0.2 && !p.jockey;
      let top = topSpeed(p, sprint) * (sprint ? D.aiSpd : 1);
      if (p.jockey) top = p.ath.run * 0.78;
      const v = Math.min(top, d * 3.4 + 0.3);
      setWant((dx / d) * v, (dz / d) * v);
      return;
    }
  }
}

/** Add a gentle push away from nearby team-mates so off-ball players spread into space. */
function addSeparation(p: Player): void {
  if (p.roleType === 'GK' || p.role === 'CARRIER' || p.role === 'CHASER' || p.role === 'RECEIVE') return;
  let px = 0;
  let pz = 0;
  for (const m of p.team.players) {
    if (m === p || m.roleType === 'GK' || m.sentOff) continue;
    const d2 = distSq(m.position, p.position);
    if (d2 < SPREAD_R2 && d2 > 1e-4) {
      const d = Math.sqrt(d2);
      const k = (1 - d / CFG.spreadRadius) / d;
      px += (p.position.x - m.position.x) * k;
      pz += (p.position.z - m.position.z) * k;
    }
  }
  wx += px * 3.2;
  wz += pz * 3.2;
}

/** Human stick → desired velocity (with assisted receiving when the stick is idle). */
function humanWant(p: Player): void {
  let ix = match.input.x;
  let iz = match.input.z;
  let l = Math.hypot(ix, iz);
  if (l > 1) {
    ix /= l;
    iz /= l;
    l = 1;
  }
  wantYaw = NaN;
  const sprint = match.input.sprint && l > 0.2 && p.stamina > 0.03;
  if (l < 0.12) {
    // stick idle: if a pass is coming to him (or the ball is loose right by him),
    // run onto it automatically — the player only has to decide what to do next
    const loose = match.controlPlayer === null;
    const mine = match.receivingPlayer === p || (loose && distSq(p.position, ball.position) < 7 * 7);
    if (match.assistReceive && loose && mine) {
      chaseBall(p, topSpeed(p, true));
      p.sprinting = true;
      return;
    }
    setWant(0, 0);
    p.sprinting = false;
    return;
  }
  p.sprinting = sprint;
  if (match.input.jockey && match.controlPlayer !== p) {
    // jockey: stay side-on to the ball, shuffle
    const v = p.ath.run * 0.8 * l;
    setWant(ix * v, iz * v);
    wantYaw = Math.atan2(ball.position.x - p.position.x, ball.position.z - p.position.z);
    p.jockey = true;
    return;
  }
  p.jockey = false;
  const v = topSpeed(p, sprint) * (sprint ? 1 : Math.min(1, l * 1.15));
  setWant(ix * v, iz * v);
  wantYaw = Math.atan2(ix, iz);
}

/**
 * The carrier can only take the ball where it can be played from: if his last
 * touch has run away from him, he must go and get it before he can turn.
 */
function bindToBall(p: Player): void {
  if (match.controlPlayer !== p || p.roleType === 'GK' && match.gkHold > 0) return;
  const bx = ball.position.x - p.position.x;
  const bz = ball.position.z - p.position.z;
  const d = Math.hypot(bx, bz);
  if (d <= CFG.controlR * 0.95) return; // at his feet — free to go anywhere
  // cutting back against the ball's run: within a stretched leg he can already turn
  if (d <= 1.5 && ball.velocity.x * wx + ball.velocity.z * wz < 0) return;
  const want = Math.hypot(wx, wz);
  // chase his own touch (at least at a run), leading it slightly
  const tx = bx + ball.velocity.x * 0.12;
  const tz = bz + ball.velocity.z * 0.12;
  const td = Math.hypot(tx, tz) || 1;
  const v = Math.max(want, Math.min(p.ath.run, d * 5));
  // he will always put in a burst to get his own touch back
  const sp = Math.min(topSpeed(p, true), Math.max(v, Math.hypot(ball.velocity.x, ball.velocity.z) + 1.5));
  setWant((tx / td) * sp, (tz / td) * sp);
}

/** The direction + speed the carrier wants to take the ball (read by the dribble model). */
export const dribbleWant = { x: 0, z: 0, speed: 0 };

/** Integrate every player one tick. */
export function movePlayers(dt: number): void {
  for (const t of match.teams)
    for (const p of t.players) {
      if (p.sentOff) continue;
      if (p.slideCd > 0) p.slideCd = Math.max(0, p.slideCd - dt);
      if (p.diveCd > 0) p.diveCd = Math.max(0, p.diveCd - dt);
      if (p.tackleCd > 0) p.tackleCd = Math.max(0, p.tackleCd - dt);
      if (p.kickCooldown > 0) p.kickCooldown = Math.max(0, p.kickCooldown - dt);
      if (p.touchCd > 0) p.touchCd = Math.max(0, p.touchCd - dt);
      if (p.boost > 0) p.boost = Math.max(0, p.boost - dt);

      // ---- committed actions override steering ----
      let accelOverride = 0;
      wantYaw = NaN;
      if (p.act !== 'none') {
        p.actT += dt;
        if (p.actT >= p.actDur) {
          if (p.act === 'slide') p.startAction('recover', CFG.slideRecover);
          else if (p.act === 'dive') p.startAction('recover', CFG.gkDiveRecover);
          else p.clearAction();
        }
      }
      if (p.act === 'slide') {
        const k = 1 - p.actT / p.actDur;
        const sp = p.ath.sprint * CFG.slideSpeed * (0.25 + 0.75 * k);
        setWant(p.actDirX * sp, p.actDirZ * sp);
        wantYaw = Math.atan2(p.actDirX, p.actDirZ);
        accelOverride = 60;
      } else if (p.act === 'dive') {
        const dx = p.diveTarget.x - p.position.x;
        const dz = p.diveTarget.z - p.position.z;
        const d = Math.hypot(dx, dz);
        // launch hard, then glide: most of the distance is covered early
        const k = p.actT / p.actDur;
        const sp = d > 0.05 ? Math.min(CFG.gkDiveSpeed * (k < 0.75 ? 1 : 0.35), d / dt) : 0;
        setWant(d > 0 ? (dx / d) * sp : 0, d > 0 ? (dz / d) * sp : 0);
        wantYaw = p.heading; // the body stays square to the shot while he flies
        accelOverride = 30; // the push-off takes a moment: ~0.11 s to full dive speed
      } else if (p.act === 'recover') {
        setWant(0, 0);
        wantYaw = p.heading;
        accelOverride = 14;
      } else if (p.act === 'tackle') {
        const sp = p.actT < p.actContact + 0.05 ? p.ath.run * 1.05 : 0.6;
        setWant(p.actDirX * sp, p.actDirZ * sp);
        wantYaw = Math.atan2(p.actDirX, p.actDirZ);
        accelOverride = 40;
      } else {
        // ---- free movement ----
        if (p.isHuman && !p.autopilot) humanWant(p);
        else {
          aiWant(p);
          addSeparation(p);
          const ws = Math.hypot(wx, wz);
          p.sprinting = ws > p.ath.run * 1.06;
        }
        if (match.controlPlayer === p) {
          dribbleWant.speed = Math.hypot(wx, wz);
          if (dribbleWant.speed > 0.05) {
            dribbleWant.x = wx / dribbleWant.speed;
            dribbleWant.z = wz / dribbleWant.speed;
          }
          bindToBall(p);
        }
      }

      // ---- body: chase the desired velocity under acceleration limits ----
      const vx = p.velocity.x;
      const vz = p.velocity.z;
      const cur = Math.hypot(vx, vz);
      const dvx = wx - vx;
      const dvz = wz - vz;
      const dv = Math.hypot(dvx, dvz);
      if (dv > 1e-5) {
        let amax: number;
        if (accelOverride > 0) amax = accelOverride;
        else {
          const A = p.ath;
          const top = A.sprint;
          const sta = 0.78 + 0.22 * p.stamina;
          const fwdA = A.accel * sta * (1 - 0.55 * Math.min(1, cur / top));
          const turnA = A.decel * (0.5 + 0.5 * A.agility);
          const cosb = cur > 0.2 ? (dvx * vx + dvz * vz) / (dv * cur) : 1;
          amax = cosb < 0 ? turnA + (A.decel - turnA) * -cosb : turnA + (fwdA - turnA) * cosb;
          if (match.controlPlayer === p) amax *= 0.8 + 0.2 * A.control;
          if (p.jockey) amax *= 1.25;
          if (p.act === 'stumble') amax *= 0.5;
        }
        const k = Math.min(1, (amax * dt) / dv);
        p.velocity.x = vx + dvx * k;
        p.velocity.z = vz + dvz * k;
      }
      p.velocity.y = 0;
      p.position.x += p.velocity.x * dt;
      p.position.z += p.velocity.z * dt;
      p.position.y = 0;

      // ---- facing ----
      const sp = Math.hypot(p.velocity.x, p.velocity.z);
      let yaw = wantYaw;
      if (Number.isNaN(yaw)) {
        const ws = Math.hypot(wx, wz);
        if (ws > 0.4) yaw = Math.atan2(wx, wz);
        else if (sp > 0.8) yaw = Math.atan2(p.velocity.x, p.velocity.z);
      }
      if (!Number.isNaN(yaw)) {
        const diff = angDiff(p.heading, yaw);
        const rate = p.ath.turn * (sp < 2.5 ? 1.5 : 1) * (p.isHuman ? 1.2 : 1);
        p.heading += clamp(diff, -rate * dt, rate * dt);
      }

      // ---- stride + stamina + distance ----
      p.stride += (sp * dt) / (0.75 + sp * 0.14); // step length grows with speed (≈1.0 m walking → 1.9 m sprinting)
      p.statDist += sp * dt;
      if (p.roleType !== 'GK') {
        const hard = p.sprinting && sp > p.ath.run * 1.04;
        const drain = CFG.staminaDrain * (1.25 - 0.5 * p.ath.stamina);
        const regen = CFG.staminaRegen * (0.8 + 0.4 * p.ath.stamina) * (sp < 1.5 ? 1.8 : 1);
        p.stamina = clamp(p.stamina + (hard ? -drain : regen) * dt, 0, 1);
      }

      // a keeper never ends up behind his own goal line (he'd carry the ball over it)
      const mx = p.roleType === 'GK' ? -0.3 : 3.5;
      p.position.x = clamp(p.position.x, -CFG.halfL - mx, CFG.halfL + mx);
      p.position.z = clamp(p.position.z, -CFG.halfW - 2.5, CFG.halfW + 2.5);
    }

  resolveBodyContacts();
}

const BODY_R = CFG.playerR; // 0.46 → bodies touch at ~0.75 m centre distance
const CONTACT = 0.72;

/** Player-vs-player contact: strength-weighted separation, speed scrub, stumbles on big hits. */
function resolveBodyContacts(): void {
  void BODY_R;
  const a0 = match.teams[0].players;
  const a1 = match.teams[1].players;
  const n0 = a0.length;
  const n = n0 + a1.length;
  for (let i = 0; i < n; i++) {
    const a = i < n0 ? a0[i] : a1[i - n0];
    if (a.sentOff) continue;
    for (let j = i + 1; j < n; j++) {
      const b = j < n0 ? a0[j] : a1[j - n0];
      if (b.sentOff) continue;
      const dx = b.position.x - a.position.x;
      const dz = b.position.z - a.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= CONTACT * CONTACT || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const nz = dz / d;
      const pen = CONTACT - d;
      // the stronger (and the one planted on the turf) gives less ground
      const sa = 0.6 + a.ath.strength + (a.act === 'recover' ? 2 : 0);
      const sb = 0.6 + b.ath.strength + (b.act === 'recover' ? 2 : 0);
      const fa = sb / (sa + sb);
      const fb = 1 - fa;
      a.position.x -= nx * pen * fa;
      a.position.z -= nz * pen * fa;
      b.position.x += nx * pen * fb;
      b.position.z += nz * pen * fb;
      // closing speed along the contact normal
      const rel = (a.velocity.x - b.velocity.x) * nx + (a.velocity.z - b.velocity.z) * nz;
      if (rel > 0) {
        // inelastic: share the closing velocity by strength
        a.velocity.x -= nx * rel * fa * 0.9;
        a.velocity.z -= nz * rel * fa * 0.9;
        b.velocity.x += nx * rel * fb * 0.9;
        b.velocity.z += nz * rel * fb * 0.9;
        if (rel > 4.2 && a.team !== b.team) {
          emit({ t: 'collide', force: rel, x: (a.position.x + b.position.x) / 2, y: 1, z: (a.position.z + b.position.z) / 2 });
          // the lighter man is knocked off his stride
          const weak = fa > fb ? a : b;
          if (rel > 5.4 && weak.act === 'none' && weak.roleType !== 'GK') weak.startAction('stumble', 0.32);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ user player */

let switchHold = 0;

/** Who on the user's team is best placed to get to the ball first? */
function bestToBall(exclude: Player | null): Player | null {
  const h = match.teams[0];
  let best: Player | null = null;
  let bt = Infinity;
  const loose = match.controlPlayer === null;
  for (const p of h.outfield()) {
    if (p === exclude || p.busy()) continue;
    let t: number;
    if (loose) {
      const hit = interceptPoint(p.position.x, p.position.z, p.ath.sprint * 0.92, 0.1, CFG.chestHeight);
      t = hit ? hit.t : 9 + Math.sqrt(distSq(p.position, ball.position)) / p.ath.sprint;
    } else {
      // goal-side defenders are worth more than someone chasing from behind
      const d = Math.sqrt(distSq(p.position, ball.position));
      const goalSide = (ball.position.x - p.position.x) * h.side > 0 ? 0 : 0.5;
      t = d / p.ath.sprint + goalSide;
    }
    if (t < bt) {
      bt = t;
      best = p;
    }
  }
  return best;
}

/** Pick which user-team player is human-controlled. */
export function selectUserPlayer(dt: number): void {
  const h = match.teams[0];
  if (match.switchLock > 0) match.switchLock -= dt;
  if (switchHold > 0) switchHold -= dt;
  const c = match.controlPlayer;
  if (match.controlTeam === h && c && c.roleType !== 'GK') {
    setUser(c);
    match.switchLock = 0;
    return;
  }
  // a pass is on its way to a team-mate: take control of the receiver straight away
  const rcv = match.receivingPlayer;
  if (rcv && rcv.team === h && rcv.roleType !== 'GK' && !c) {
    setUser(rcv);
    return;
  }
  if (match.switchLock > 0) return;
  // keep the current man unless someone else is clearly better placed (hysteresis)
  if (match.userPlayer && !match.userPlayer.sentOff && switchHold > 0) return;
  const best = bestToBall(null);
  if (best && best !== match.userPlayer) {
    const cur = match.userPlayer;
    if (cur && !cur.sentOff) {
      const dc = Math.sqrt(distSq(cur.position, ball.position));
      const dn = Math.sqrt(distSq(best.position, ball.position));
      if (dc < dn + 2.5 && dc < 12) return; // not clearly better — don't yank control away
    }
    setUser(best);
    switchHold = 0.6;
  } else if (!match.userPlayer && best) setUser(best);
}

export function setUser(p: Player): void {
  if (match.userPlayer === p) return;
  if (match.userPlayer) match.userPlayer.isHuman = false;
  match.userPlayer = p;
  p.isHuman = true;
}

/** Manual switch: the next-best-placed player (or the one in the stick direction). */
export function nextUserPlayer(dirX = 0, dirZ = 0): Player | null {
  const h = match.teams[0];
  const cur = match.userPlayer;
  const dl = Math.hypot(dirX, dirZ);
  if (cur && dl > 0.4) {
    // directional switch: the team-mate most in line with the stick
    let best: Player | null = null;
    let bs = -Infinity;
    for (const p of h.outfield()) {
      if (p === cur) continue;
      const dx = p.position.x - cur.position.x;
      const dz = p.position.z - cur.position.z;
      const d = Math.hypot(dx, dz) || 1;
      const s = ((dx / d) * dirX + (dz / d) * dirZ) / dl - d * 0.012;
      if (s > bs) {
        bs = s;
        best = p;
      }
    }
    return best;
  }
  return bestToBall(cur) ?? null;
}
