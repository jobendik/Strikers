/*
 * Graphics quality tiers.
 *
 * One table drives every scalable cost in the environment renderer: resolution,
 * shadows, crowd density, grass shader detail, post-processing, environment-map
 * resolution and particle counts. The module is deliberately free of renderer /
 * scene imports — systems subscribe with {@link onQualityChange} and re-configure
 * themselves, so there are no import cycles and the settings UI can call
 * {@link applyQualityTier} before the stadium has even been built.
 */

export type QualityTier = 'lite' | 'standard' | 'high' | 'ultra';

export const QUALITY_TIERS: readonly QualityTier[] = ['lite', 'standard', 'high', 'ultra'];

export interface QualityProfile {
  tier: QualityTier;
  /** Upper bound on devicePixelRatio. */
  pixelRatioCap: number;
  /** Lowest pixel ratio the dynamic-resolution scaler may drop to. */
  pixelRatioFloor: number;
  /** Dynamic resolution scaling enabled. */
  dynamicRes: boolean;
  /** Real-time shadow maps (off → the game falls back to blob shadows). */
  shadows: boolean;
  shadowMapSize: number;
  /** true = PCFSoft (wider, smoother kernel), false = PCF. */
  shadowSoft: boolean;
  /** A second shadow-casting floodlight in the floodlit presets (crossed shadows). */
  secondShadow: boolean;
  /** How many of the three auxiliary directional lights stay enabled. */
  auxLights: number;
  /** Fraction of seats that get a spectator instance. */
  crowdDensity: number;
  /** Waving flags in the crowd. */
  crowdFlags: boolean;
  /** 0 = flat albedo, 1 = + detail texture, 2 = + normal/roughness detail. */
  grassDetail: 0 | 1 | 2;
  /** Near-camera instanced grass blades (pitch-level cameras). */
  grassBlades: number;
  /** HDR post chain: bloom + colour grade + vignette (+ MSAA on the HDR target). */
  postFx: boolean;
  /** MSAA samples on the HDR target when postFx is on. */
  msaa: number;
  /** Bloom resolution scale (fraction of the frame). */
  bloomScale: number;
  /** Cube-map face size the sky is captured at before PMREM filtering. */
  envMapSize: number;
  /** Maximum texture edge for procedurally generated textures. */
  maxTexture: number;
  anisotropy: number;
  /** Rain streak instances (rain preset only). */
  rainCount: number;
  /** Sky shader cloud octaves. */
  skyOctaves: number;
  /** Goal-net cloth solver iterations. */
  netIterations: number;
}

const PROFILES: Record<QualityTier, QualityProfile> = {
  lite: {
    tier: 'lite',
    pixelRatioCap: 1,
    pixelRatioFloor: 0.75,
    dynamicRes: true,
    shadows: false,
    shadowMapSize: 1024,
    shadowSoft: false,
    secondShadow: false,
    auxLights: 1,
    crowdDensity: 0.42,
    crowdFlags: false,
    grassDetail: 0,
    grassBlades: 0,
    postFx: false,
    msaa: 0,
    bloomScale: 0.5,
    envMapSize: 64,
    maxTexture: 1024,
    anisotropy: 4,
    rainCount: 1400,
    skyOctaves: 2,
    netIterations: 2,
  },
  standard: {
    tier: 'standard',
    pixelRatioCap: 1.5,
    pixelRatioFloor: 0.85,
    dynamicRes: true,
    shadows: true,
    shadowMapSize: 1024,
    shadowSoft: false,
    secondShadow: false,
    auxLights: 3,
    crowdDensity: 0.72,
    crowdFlags: false,
    grassDetail: 1,
    grassBlades: 0,
    postFx: false,
    msaa: 0,
    bloomScale: 0.5,
    envMapSize: 128,
    maxTexture: 2048,
    anisotropy: 8,
    rainCount: 3500,
    skyOctaves: 3,
    netIterations: 3,
  },
  high: {
    tier: 'high',
    pixelRatioCap: 2,
    pixelRatioFloor: 1,
    dynamicRes: true,
    shadows: true,
    shadowMapSize: 2048,
    shadowSoft: true,
    secondShadow: false,
    auxLights: 3,
    crowdDensity: 1,
    crowdFlags: true,
    grassDetail: 2,
    grassBlades: 0,
    postFx: true,
    msaa: 4,
    bloomScale: 0.5,
    envMapSize: 256,
    maxTexture: 2048,
    anisotropy: 16,
    rainCount: 7000,
    skyOctaves: 4,
    netIterations: 4,
  },
  ultra: {
    tier: 'ultra',
    pixelRatioCap: 2,
    pixelRatioFloor: 1.25,
    dynamicRes: false,
    shadows: true,
    shadowMapSize: 4096,
    shadowSoft: true,
    secondShadow: true,
    auxLights: 3,
    crowdDensity: 1,
    crowdFlags: true,
    grassDetail: 2,
    grassBlades: 60000,
    postFx: true,
    msaa: 4,
    bloomScale: 0.5,
    envMapSize: 256,
    maxTexture: 2048,
    anisotropy: 16,
    rainCount: 12000,
    skyOctaves: 5,
    netIterations: 5,
  },
};

let current: QualityTier = 'high';
const listeners: Array<(q: QualityProfile) => void> = [];

export function isQualityTier(v: unknown): v is QualityTier {
  return typeof v === 'string' && (QUALITY_TIERS as readonly string[]).includes(v);
}

/** The active tier. */
export function getQualityTier(): QualityTier {
  return current;
}

/** The full parameter set of the active tier (or of a named one). */
export function getQuality(tier: QualityTier = current): QualityProfile {
  return PROFILES[tier];
}

/** Switch tier and notify every subscribed rendering system. */
export function applyQualityTier(tier: QualityTier): void {
  if (!isQualityTier(tier)) return;
  const changed = tier !== current;
  current = tier;
  if (!changed && applied) return;
  applied = true;
  const q = PROFILES[tier];
  for (let i = 0; i < listeners.length; i++) listeners[i](q);
}
let applied = false;

/**
 * Subscribe to tier changes. The callback is NOT invoked immediately — read
 * {@link getQuality} for the initial state.
 */
export function onQualityChange(fn: (q: QualityProfile) => void): void {
  listeners.push(fn);
}

/**
 * Sensible first-run default: phones/tablets start on `standard`, everything else
 * on `high`. (A stored preference always wins — see core/settings.)
 */
export function defaultQualityTier(): QualityTier {
  try {
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    if (coarse && mem !== undefined && mem <= 2) return 'lite';
    if (coarse) return 'standard';
  } catch {
    /* ignore */
  }
  return 'high';
}

/* ------------------------- dynamic resolution scaler ------------------------ */

/**
 * Frame-time driven resolution governor. Feed it real frame deltas; it returns a
 * new pixel ratio when (and only when) the resolution should change. Uses an EMA
 * of frame time, a dead band and a cooldown so it cannot oscillate.
 */
export class DynamicResolution {
  private ema = 1 / 60;
  private cooldown = 2;
  private warm = 0;
  private climbWait = 6;
  private lastWasClimb = false;
  scale = 1;

  reset(): void {
    this.ema = 1 / 60;
    this.cooldown = 2;
    this.warm = 0;
    this.climbWait = 6;
    this.lastWasClimb = false;
    this.scale = 1;
  }

  /**
   * @param dt     real seconds since the previous frame
   * @param cap    the tier's pixel-ratio cap (already min'd with devicePixelRatio)
   * @param floor  lowest allowed pixel ratio
   * @returns the pixel ratio to apply, or -1 for "no change"
   */
  update(dt: number, cap: number, floor: number): number {
    // Ignore hitches (tab switch, shader compile) — they are not a steady state.
    if (dt <= 0 || dt > 0.25) return -1;
    this.ema += (dt - this.ema) * 0.05;
    this.warm += dt;
    this.cooldown -= dt;
    if (this.warm < 3 || this.cooldown > 0) return -1;
    const minScale = Math.min(1, floor / cap);
    let next = this.scale;
    if (this.ema > 1 / 52 && this.scale > minScale) {
      // Over budget (< ~52 fps): step down. If the previous change was a climb it
      // evidently failed, so wait twice as long before trying to climb again.
      next = Math.max(minScale, this.scale - 0.1);
      if (this.lastWasClimb) this.climbWait = Math.min(48, this.climbWait * 2);
      this.lastWasClimb = false;
      this.cooldown = 1.5;
    } else if (this.ema < 1 / 57 && this.scale < 1) {
      // Holding vsync: probe one small step back up after a long quiet period.
      next = Math.min(1, this.scale + 0.05);
      this.lastWasClimb = true;
      this.cooldown = this.climbWait;
    }
    if (next === this.scale) return -1;
    this.scale = next;
    return cap * next;
  }
}
