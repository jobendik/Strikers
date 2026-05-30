import type { SquadPlayer } from './types';

/**
 * Named squads with per-player attributes — the manager-engine idea (Openfoot
 * Manager / open-football) distilled to an arcade scale. Index order matches
 * `FORMATION`: 0 = GK, 1–2 = DEF, 3–4 = ATT. Attributes are 0–100 and are wired
 * into speed, finishing, passing, tackling and decision-making across the AI.
 *
 * The two squads are deliberately asymmetric in character so matches feel
 * different: the Strikers are quick and clinical up top, United are physical and
 * defensively solid — giving the player a tactical read on the opposition.
 */

export const SQUADS: Record<string, SquadPlayer[]> = {
  STRIKERS: [
    { name: 'VALE', num: 1, attr: { pace: 62, shooting: 40, passing: 72, tackling: 60, composure: 82 } },
    { name: 'KANE', num: 4, attr: { pace: 74, shooting: 58, passing: 70, tackling: 86, composure: 78 } },
    { name: 'RIOS', num: 5, attr: { pace: 78, shooting: 55, passing: 74, tackling: 82, composure: 76 } },
    { name: 'SOLA', num: 9, attr: { pace: 90, shooting: 88, passing: 76, tackling: 48, composure: 86 } },
    { name: 'FÈNX', num: 11, attr: { pace: 94, shooting: 80, passing: 84, tackling: 50, composure: 80 } },
  ],
  UNITED: [
    { name: 'BORG', num: 1, attr: { pace: 60, shooting: 38, passing: 70, tackling: 62, composure: 84 } },
    { name: 'MARS', num: 3, attr: { pace: 72, shooting: 52, passing: 68, tackling: 90, composure: 80 } },
    { name: 'KOLT', num: 6, attr: { pace: 70, shooting: 50, passing: 72, tackling: 88, composure: 82 } },
    { name: 'DRAX', num: 10, attr: { pace: 86, shooting: 84, passing: 82, tackling: 52, composure: 84 } },
    { name: 'NEVA', num: 7, attr: { pace: 92, shooting: 78, passing: 80, tackling: 54, composure: 78 } },
  ],
};

/** Normalises an attribute (0–100) to a multiplier centred on 1.0. */
export function attrMul(value: number, spread = 0.18): number {
  return 1 + ((value - 70) / 30) * spread;
}

/** Normalises an attribute (0–100) to a 0–1 fraction. */
export function attr01(value: number): number {
  return value < 0 ? 0 : value > 100 ? 1 : value / 100;
}
