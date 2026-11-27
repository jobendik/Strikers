import { Vector3 } from 'yuka';
import { rng } from './rng';

/** Shorthand for constructing a Yuka Vector3. */
export const V3 = (x = 0, y = 0, z = 0): Vector3 => new Vector3(x, y, z);

/** Clamp `v` into the inclusive range [a, b]. */
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** Linear interpolation between a and b by t. */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Random float in [a, b) from the seeded *simulation* stream (see core/rng.ts). */
export const rand = (a: number, b: number): number => a + rng() * (b - a);

/** Squared planar (x/z) distance between two vectors — avoids a sqrt. */
export const distSq = (a: Vector3, b: Vector3): number => {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
};

/** Unit heading vector on the ground plane for a given yaw. */
export const headingVec = (yaw: number): Vector3 => V3(Math.sin(yaw), 0, Math.cos(yaw));

/** Shortest signed angular difference a→b, in (−π, π]. */
export const angDiff = (a: number, b: number): number => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
};

/** Move `v` toward `target` by at most `maxDelta`. */
export const approach = (v: number, target: number, maxDelta: number): number =>
  v < target ? Math.min(target, v + maxDelta) : Math.max(target, v - maxDelta);

/** Smoothstep 0..1 between edges. */
export const smooth01 = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
