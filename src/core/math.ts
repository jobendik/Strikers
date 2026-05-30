import { Vector3 } from 'yuka';

/** Shorthand for constructing a Yuka Vector3. */
export const V3 = (x = 0, y = 0, z = 0): Vector3 => new Vector3(x, y, z);

/** Clamp `v` into the inclusive range [a, b]. */
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** Linear interpolation between a and b by t. */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Random float in [a, b). */
export const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/** Squared planar (x/z) distance between two vectors — avoids a sqrt. */
export const distSq = (a: Vector3, b: Vector3): number => {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
};

/** Unit heading vector on the ground plane for a given yaw. */
export const headingVec = (yaw: number): Vector3 => V3(Math.sin(yaw), 0, Math.cos(yaw));
