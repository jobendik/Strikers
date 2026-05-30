import { V3 } from '../core/math';
import type { DiffSetting, FormationEntry } from './types';

/**
 * Central gameplay configuration. Pitch is modelled in world units with the
 * home team attacking +X. Tunable from one place so balance is easy to iterate.
 */
export const CFG = {
  halfL: 30,
  halfW: 20,
  goalHalf: 4.4,
  goalH: 4.0,
  goalDepth: 2.2,
  boxDepth: 11,
  boxHalfW: 13,
  sixDepth: 3.6,
  sixHalfW: 7,
  ballR: 0.42,
  playerR: 0.46,
  playerH: 1.7,
  controlR: 1.35,
  carryDist: 1.05,
  tackleEdge: 0.35,
  ballDecel: 8,
  ballMax: 40,
  ballStop: 0.5,
  spd: { out: 9.4, gk: 8.2, sprint: 1.34 },
  force: 130,
  shootRange: 20,
  shootPow: 30,
  passShort: 18,
  passLong: 24,
  clearPow: 24,
  shootAttempts: 6,
  potShot: 0.02,
  passInterceptScale: 0.22,
  comfortZone: 3.0,
  minPassDist: 5,
  gkInterceptR: 9,
  gkTend: 2.4,
  staminaDrain: 0.05,
  staminaRegen: 0.06,
  foulChance: 0.07,
  matchSeconds: 180,
  diff: 1, // 0 easy · 1 pro · 2 legend
};

/** Per-difficulty AI tuning. Indexed by CFG.diff. */
export const DIFF: DiffSetting[] = [
  { label: 'EASY', aiSpd: 0.88, react: 0.34, passSafe: 2.6, shootBias: 0.55, keeper: 0.74 },
  { label: 'PRO', aiSpd: 0.97, react: 0.22, passSafe: 2.1, shootBias: 0.78, keeper: 0.78 },
  { label: 'LEGEND', aiSpd: 1.05, react: 0.12, passSafe: 1.7, shootBias: 0.95, keeper: 0.82 },
];

/** Formation: GK + 2 DEF + 2 ATT. Home attacks +X; away is mirrored at build time. */
export const FORMATION: FormationEntry[] = [
  { role: 'GK', def: V3(-27, 0, 0), att: V3(-25, 0, 0) },
  { role: 'DEF', def: V3(-18, 0, -9), att: V3(-9, 0, -9) },
  { role: 'DEF', def: V3(-18, 0, 9), att: V3(-9, 0, 9) },
  { role: 'ATT', def: V3(-9, 0, -7), att: V3(9, 0, -7) },
  { role: 'ATT', def: V3(-9, 0, 7), att: V3(11, 0, 6) },
];
