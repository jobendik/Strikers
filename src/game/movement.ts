import { CFG, DIFF } from '../config/constants';
import { clamp, distSq } from '../core/math';
import { ball, match } from './state';
import type { Player } from '../entities/Player';

const SPREAD_R2 = CFG.spreadRadius * CFG.spreadRadius;

/**
 * Populate a player's Yuka `neighbors` array (consumed by SeparationBehavior)
 * with nearby team-mates, and decide whether separation should push this frame.
 * The ball carrier and keepers don't separate — only off-ball outfielders, so
 * the attack/defence spreads into space instead of stacking on one another.
 */
function updateSpacing(p: Player): void {
  p.neighbors.length = 0;
  const off = p.roleType !== 'GK' && p.role !== 'CARRIER';
  if (!off) {
    p.separation.active = false;
    return;
  }
  for (const m of p.team.players) {
    if (m === p || m.roleType === 'GK') continue;
    if (distSq(m.position, p.position) < SPREAD_R2) p.neighbors.push(m);
  }
  p.separation.active = p.neighbors.length > 0;
}

/** Integrate every player: human input or AI steering, plus stamina + collisions. */
export function movePlayers(dt: number): void {
  const D = DIFF[CFG.diff];
  for (const t of match.teams)
    for (const p of t.players) {
      if (p.sentOff) continue; // a sent-off player takes no further part (Sim rules)
      if (p.slideCd > 0) p.slideCd = Math.max(0, p.slideCd - dt);
      if (p.diveCd > 0) p.diveCd = Math.max(0, p.diveCd - dt);

      // a committed keeper dive overrides steering: fling toward the predicted
      // shot crossing point and decay out (mirrors the slide-tackle lunge).
      if (p.dive > 0) {
        p.dive = Math.max(0, p.dive - dt);
        const dx = p.diveTarget.x - p.position.x;
        const dz = p.diveTarget.z - p.position.z;
        const d = Math.hypot(dx, dz) || 1;
        const sp = p.baseSpeed * CFG.gkDiveSpeed;
        p.velocity.set((dx / d) * sp, 0, (dz / d) * sp);
        p.position.x += p.velocity.x * dt;
        p.position.z += p.velocity.z * dt;
        p.heading = Math.atan2(dx, dz);
        p.position.x = clamp(p.position.x, -CFG.halfL - 1, CFG.halfL + 1);
        p.position.z = clamp(p.position.z, -CFG.halfW + 1, CFG.halfW - 1);
        p.kickCooldown = Math.max(0, p.kickCooldown - dt);
        continue;
      }

      // a committed slide overrides all steering: skate toward the ball, decay out
      if (p.slide > 0) {
        p.slide = Math.max(0, p.slide - dt);
        const dx = ball.position.x - p.position.x;
        const dz = ball.position.z - p.position.z;
        const d = Math.hypot(dx, dz) || 1;
        const sp = p.baseSpeed * CFG.slideSpeed * (p.slide / CFG.slideTime);
        p.velocity.set((dx / d) * sp, 0, (dz / d) * sp);
        p.position.x += p.velocity.x * dt;
        p.position.z += p.velocity.z * dt;
        p.heading = Math.atan2(dx, dz);
        p.position.x = clamp(p.position.x, -CFG.halfL - 3, CFG.halfL + 3);
        p.position.z = clamp(p.position.z, -CFG.halfW - 2, CFG.halfW + 2);
        p.kickCooldown = Math.max(0, p.kickCooldown - dt);
        continue;
      }

      const staF = 0.8 + 0.2 * p.stamina;
      let hard = false;
      if (p.boost > 0) p.boost = Math.max(0, p.boost - dt);
      if (p.isHuman) {
        let vx = match.input.x;
        let vz = match.input.z;
        const l = Math.hypot(vx, vz);
        if (l > 1) {
          vx /= l;
          vz /= l;
        }
        const spr = match.input.sprint && l > 0.1;
        // a knock-on burst overrides sprint with a brief speed explosion
        const boosting = p.boost > 0;
        const speed = p.baseSpeed * (boosting ? CFG.knockBoost : spr ? CFG.spd.sprint : 1) * staF;
        hard = spr || boosting;
        p.velocity.set(vx * speed, 0, vz * speed);
        p.position.x += p.velocity.x * dt;
        p.position.z += p.velocity.z * dt;
        if (Math.hypot(vx, vz) > 0.15) p.heading = Math.atan2(vx, vz);
      } else {
        const callBurst = p === match.callingPlayer ? CFG.passRequestBoost : 1;
        p.maxSpeed = p.baseSpeed * (p.roleType === 'GK' ? 1 : D.aiSpd * callBurst) * staF;
        updateSpacing(p); // refresh separation neighbours before steering integrates
        p.update(dt);
        if (p.getSpeed() > 0.4) p.heading = Math.atan2(p.velocity.x, p.velocity.z);
        hard = p.getSpeed() > p.baseSpeed * 0.7;
      }
      if (p.roleType !== 'GK') {
        p.stamina = clamp(p.stamina + (hard ? -CFG.staminaDrain : CFG.staminaRegen) * dt, 0.55, 1);
      }
      p.position.x = clamp(p.position.x, -CFG.halfL - 3, CFG.halfL + 3);
      p.position.z = clamp(p.position.z, -CFG.halfW - 2, CFG.halfW + 2);
      p.kickCooldown = Math.max(0, p.kickCooldown - dt);
    }

  // soft body-collision resolution
  const all = [...match.teams[0].players, ...match.teams[1].players];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      const dx = b.position.x - a.position.x;
      const dz = b.position.z - a.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.95 && d > 1e-4) {
        const push = (0.95 - d) / 2;
        const nx = dx / d;
        const nz = dz / d;
        a.position.x -= nx * push;
        a.position.z -= nz * push;
        b.position.x += nx * push;
        b.position.z += nz * push;
      }
    }
}

/** Pick which user-team player is human-controlled (closest to the ball / carrier). */
export function selectUserPlayer(dt: number): void {
  const h = match.teams[0];
  if (match.switchLock > 0) match.switchLock -= dt;
  if (match.controlTeam === h && match.controlPlayer && match.controlPlayer.roleType !== 'GK') {
    setUser(match.controlPlayer);
    match.switchLock = 0;
    return;
  }
  if (match.switchLock > 0) return;
  let best: Player | null = null;
  let bd = Infinity;
  for (const p of h.outfield()) {
    const d = distSq(p.position, ball.position);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  if (best) setUser(best);
}

export function setUser(p: Player): void {
  if (match.userPlayer === p) return;
  if (match.userPlayer) match.userPlayer.isHuman = false;
  match.userPlayer = p;
  p.isHuman = true;
}
