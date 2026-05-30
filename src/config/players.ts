import type { SquadPlayer, TeamMeta } from './types';

/**
 * Named squads with per-player attributes — the manager-engine idea (Openfoot
 * Manager / open-football) distilled to an arcade scale. Index order matches
 * `FORMATION`: 0 = GK, 1–2 = DEF, 3–4 = ATT. Attributes are 0–100 and are wired
 * into speed, finishing, passing, tackling and decision-making across the AI.
 *
 * Every squad has a deliberately distinct character so matches read differently
 * and team selection is a real choice: the Strikers are quick and clinical,
 * United are a physical wall, Galaxy are technical, Ironside sit deep and hit
 * hard, Rovers are pure pace on the counter, and Frost are a polished all-round.
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
  GALAXY: [
    { name: 'OSEI', num: 1, attr: { pace: 64, shooting: 42, passing: 80, tackling: 58, composure: 86 } },
    { name: 'PARK', num: 2, attr: { pace: 80, shooting: 54, passing: 84, tackling: 76, composure: 82 } },
    { name: 'LUNA', num: 8, attr: { pace: 82, shooting: 66, passing: 90, tackling: 64, composure: 88 } },
    { name: 'ZICO', num: 10, attr: { pace: 84, shooting: 82, passing: 88, tackling: 50, composure: 86 } },
    { name: 'AMAH', num: 11, attr: { pace: 88, shooting: 76, passing: 86, tackling: 52, composure: 82 } },
  ],
  IRONSIDE: [
    { name: 'STON', num: 1, attr: { pace: 58, shooting: 36, passing: 64, tackling: 66, composure: 86 } },
    { name: 'BANE', num: 4, attr: { pace: 68, shooting: 50, passing: 64, tackling: 94, composure: 84 } },
    { name: 'WOLF', num: 5, attr: { pace: 66, shooting: 48, passing: 66, tackling: 92, composure: 82 } },
    { name: 'GROM', num: 9, attr: { pace: 76, shooting: 86, passing: 66, tackling: 64, composure: 80 } },
    { name: 'TUSK', num: 7, attr: { pace: 80, shooting: 74, passing: 70, tackling: 70, composure: 76 } },
  ],
  ROVERS: [
    { name: 'FLYN', num: 1, attr: { pace: 66, shooting: 40, passing: 68, tackling: 58, composure: 78 } },
    { name: 'DASH', num: 3, attr: { pace: 86, shooting: 52, passing: 70, tackling: 78, composure: 72 } },
    { name: 'COLE', num: 6, attr: { pace: 84, shooting: 54, passing: 72, tackling: 80, composure: 74 } },
    { name: 'BOLT', num: 9, attr: { pace: 97, shooting: 80, passing: 72, tackling: 46, composure: 78 } },
    { name: 'ZAYN', num: 11, attr: { pace: 95, shooting: 76, passing: 74, tackling: 48, composure: 76 } },
  ],
  FROST: [
    { name: 'HOLT', num: 1, attr: { pace: 63, shooting: 42, passing: 74, tackling: 62, composure: 85 } },
    { name: 'YUKI', num: 4, attr: { pace: 78, shooting: 58, passing: 78, tackling: 82, composure: 82 } },
    { name: 'KARI', num: 5, attr: { pace: 79, shooting: 60, passing: 80, tackling: 80, composure: 83 } },
    { name: 'NORD', num: 10, attr: { pace: 85, shooting: 82, passing: 82, tackling: 56, composure: 85 } },
    { name: 'SAGA', num: 9, attr: { pace: 88, shooting: 80, passing: 80, tackling: 54, composure: 83 } },
  ],
};

/**
 * Selectable teams with their identity (display name, 3-letter tag, kit colour).
 * The first two preserve the original Crimson Strikers vs Azure United fixture.
 */
export const TEAMS: TeamMeta[] = [
  { key: 'STRIKERS', name: 'CRIMSON STRIKERS', short: 'STR', color: '#ff2d55' },
  { key: 'UNITED', name: 'AZURE UNITED', short: 'UTD', color: '#1e90ff' },
  { key: 'GALAXY', name: 'VIOLET GALAXY', short: 'GLX', color: '#a855f7' },
  { key: 'IRONSIDE', name: 'IRONSIDE FC', short: 'IRN', color: '#ff7a18' },
  { key: 'ROVERS', name: 'EMERALD ROVERS', short: 'RVR', color: '#22c55e' },
  { key: 'FROST', name: 'FROST ATHLETIC', short: 'FRS', color: '#38e0d0' },
];

/** Look up a team's metadata by key (falls back to the Strikers). */
export function teamMeta(key: string): TeamMeta {
  return TEAMS.find((t) => t.key === key) ?? TEAMS[0];
}

/** Normalises an attribute (0–100) to a multiplier centred on 1.0. */
export function attrMul(value: number, spread = 0.18): number {
  return 1 + ((value - 70) / 30) * spread;
}

/** Normalises an attribute (0–100) to a 0–1 fraction. */
export function attr01(value: number): number {
  return value < 0 ? 0 : value > 100 ? 1 : value / 100;
}
