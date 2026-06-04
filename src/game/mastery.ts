/*
 * Nation mastery (G3) — a per-nation progression bar with small rewards.
 *
 * Every match played as a nation grants that nation Mastery XP (stored in
 * `data.mastery[nation]`); crossing a level pays a coin reward and surfaces a
 * "next mastery reward" goal. Pure curve math + a grant helper that mutates the
 * save (caller persists). Reached only via the result-screen owner / awards UI,
 * outside the headless sim.
 */
import type { PlayerData } from '../core/playerData';
import { teamMeta } from '../config/players';

/** XP to advance out of a mastery level (flat band — a nation maxes over ~weeks of play). */
export function masteryXpForLevel(level: number): number {
  if (level <= 3) return 400;
  if (level <= 8) return 800;
  return 1400;
}

/** Highest mastery level (cap). */
export const MASTERY_MAX = 15;

/** Coins paid for reaching a mastery level. */
export function masteryReward(level: number): number {
  return 40 + level * 20;
}

/** Mastery XP granted per match for the nation played (win pays more). */
export function masteryXpForMatch(win: boolean, draw: boolean): number {
  return 120 + (win ? 80 : draw ? 40 : 0);
}

/** Where a nation's mastery sits. */
export interface MasteryStanding {
  nation: string;
  name: string;
  level: number;
  into: number;
  forNext: number;
  atMax: boolean;
  totalXp: number;
}

/** Read a nation's mastery standing (does not mutate). */
export function masteryStanding(data: PlayerData, nation: string): MasteryStanding {
  let xp = Math.max(0, data.mastery[nation] ?? 0);
  let level = 1;
  while (level < MASTERY_MAX && xp >= masteryXpForLevel(level)) {
    xp -= masteryXpForLevel(level);
    level++;
  }
  const atMax = level >= MASTERY_MAX;
  return {
    nation,
    name: teamMeta(nation).name,
    level,
    into: atMax ? 0 : xp,
    forNext: atMax ? 0 : masteryXpForLevel(level),
    atMax,
    totalXp: Math.max(0, data.mastery[nation] ?? 0),
  };
}

/** Outcome of granting mastery XP. */
export interface MasteryGrant {
  nation: string;
  levelsGained: number;
  level: number;
  coins: number;
}

/**
 * Grant mastery XP to a nation and roll up levels (capped). Pays coin rewards for
 * each level crossed. Mutates the save; the caller persists.
 */
export function grantMastery(data: PlayerData, nation: string, win: boolean, draw: boolean): MasteryGrant {
  const before = masteryStanding(data, nation).level;
  data.mastery[nation] = Math.max(0, data.mastery[nation] ?? 0) + masteryXpForMatch(win, draw);
  const after = masteryStanding(data, nation).level;
  let coins = 0;
  for (let l = before; l < after; l++) coins += masteryReward(l);
  data.coins += coins;
  return { nation, levelsGained: after - before, level: after, coins };
}

/** All nations the player has any mastery XP in, best first (for the awards screen). */
export function masteredNations(data: PlayerData): MasteryStanding[] {
  return Object.keys(data.mastery)
    .filter((k) => (data.mastery[k] ?? 0) > 0)
    .map((k) => masteryStanding(data, k))
    .sort((a, b) => b.totalXp - a.totalXp);
}
