/*
 * Seeded simulation RNG (sfc32). Every random decision *inside the simulation*
 * draws from here, so a match is a pure function of (seed, inputs): the headless
 * harness can reproduce any match exactly, a bug report can carry a seed, and a
 * balance change can be A/B-tested on identical random streams.
 *
 * Presentation code (camera shake, particles, crowd) must keep using
 * `Math.random()` so it can never perturb the simulation stream.
 */

let a = 0x9e3779b9;
let b = 0x243f6a88;
let c = 0xb7e15162;
let d = 1;
let currentSeed = 1;

/** Re-seed the simulation stream. Call once at the start of a match. */
export function seedRng(seed: number): void {
  currentSeed = seed >>> 0 || 1;
  a = 0x9e3779b9;
  b = 0x243f6a88;
  c = currentSeed;
  d = 1;
  for (let i = 0; i < 16; i++) rng(); // warm up
}

/** The seed the current stream was started from (for logs / bug reports). */
export function rngSeed(): number {
  return currentSeed;
}

/** Uniform float in [0, 1). */
export function rng(): number {
  a |= 0;
  b |= 0;
  c |= 0;
  d |= 0;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  return (t >>> 0) / 4294967296;
}

/** Uniform float in [lo, hi). */
export function rngRange(lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

/** Approximately normal (mean 0, sd 1) — sum of three uniforms, cheap and bounded (|x| ≤ 3). */
export function rngNormal(): number {
  return (rng() + rng() + rng() - 1.5) * 2;
}

/** True with probability `p`. */
export function chance(p: number): boolean {
  return rng() < p;
}

/** Stable 32-bit string hash (FNV-1a) — for deriving per-entity constants. */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
