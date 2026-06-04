/*
 * Achievements (G2) + hidden achievements (G5) — long-horizon goals with visible
 * partial progress and title/cosmetic/coin rewards.
 *
 * Each achievement derives its progress live from the save (career stats, medals,
 * collection, season, records), so there's nothing to keep in sync — only the
 * one-time completion is recorded (in `data.achievements`). Hidden ones stay
 * masked until earned, then reveal as a surprise. Pure detection; awarding mutates
 * the save (caller persists). Reached via the result-screen owner / awards UI,
 * outside the headless sim.
 */
import type { PlayerData } from '../core/playerData';
import { collectionProgress, grantCosmetic } from './collection';
import { SEASON_TIERS } from './season';

export interface AchievementDef {
  id: string;
  label: string;
  desc: string;
  target: number;
  coins: number;
  /** Optional cosmetic/title id awarded on completion. */
  reward?: string;
  /** Hidden until earned (G5). */
  hidden?: boolean;
  /** Current progress value from the save. */
  value: (d: PlayerData) => number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'win10', label: 'Contender', desc: 'Win 10 matches', target: 10, coins: 150, value: (d) => d.stats.wins },
  { id: 'win100', label: 'Centurion', desc: 'Win 100 matches', target: 100, coins: 800, reward: 'title_centurion', value: (d) => d.stats.wins },
  { id: 'goals100', label: 'Sharpshooter', desc: 'Score 100 goals', target: 100, coins: 200, value: (d) => d.stats.goals },
  { id: 'goals500', label: 'Goal Machine', desc: 'Score 500 goals', target: 500, coins: 700, value: (d) => d.stats.goals },
  { id: 'clean25', label: 'Brick Wall', desc: 'Keep 25 clean sheets', target: 25, coins: 250, value: (d) => d.stats.cleanSheets },
  { id: 'clean50', label: 'Fortress', desc: 'Keep 50 clean sheets', target: 50, coins: 500, reward: 'net_gold', value: (d) => d.stats.cleanSheets },
  { id: 'cup1', label: 'World Champions', desc: 'Win the World Cup', target: 1, coins: 400, reward: 'banner_finalist', value: (d) => d.stats.cupsWon },
  { id: 'cup3', label: 'Dynasty', desc: 'Win 3 World Cups', target: 3, coins: 1000, reward: 'ball_trophy', value: (d) => d.stats.cupsWon },
  { id: 'played50', label: 'Regular', desc: 'Play 50 matches', target: 50, coins: 150, value: (d) => d.stats.played },
  { id: 'collector25', label: 'Collector', desc: 'Own 25 cosmetics', target: 25, coins: 250, value: (d) => collectionProgress(d).owned },
  { id: 'season_max', label: 'Season Veteran', desc: `Reach Season Tier ${SEASON_TIERS}`, target: SEASON_TIERS, coins: 400, value: (d) => Math.min(SEASON_TIERS, d.season.level) },
  { id: 'streak5', label: 'On a Roll', desc: 'Win 5 in a row', target: 5, coins: 200, value: (d) => d.records.longestStreak ?? 0 },
  { id: 'streak10', label: 'Unstoppable', desc: 'Win 10 in a row', target: 10, coins: 500, reward: 'banner_streak', value: (d) => d.records.longestStreak ?? 0 },
  { id: 'hat10', label: 'Hat-trick Habit', desc: 'Score 10 hat-tricks', target: 10, coins: 400, value: (d) => d.medals.hattrick ?? 0 },
  // --- hidden (G5) ---
  { id: 'avalanche', label: 'Goal Avalanche', desc: 'Score 5+ in a single match', target: 1, coins: 300, hidden: true, value: (d) => d.medals.rout ?? 0 },
  { id: 'flawless', label: 'Flawless', desc: 'Win 10 matches without conceding', target: 10, coins: 400, hidden: true, reward: 'title_finalist', value: (d) => d.medals.no_sweat ?? 0 },
];

const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

/** Has this achievement been completed (and its reward granted)? */
export function isComplete(data: PlayerData, id: string): boolean {
  return (data.achievements[id] ?? 0) >= 1;
}

/** Outcome of an achievement check. */
export interface AchievementAward {
  id: string;
  label: string;
  coins: number;
  reward?: string;
}

/**
 * Grant any achievements whose progress has reached target and aren't yet
 * recorded. Idempotent (each pays once). Mutates the save (coins + any cosmetic +
 * the completion marker); the caller persists. Returns the newly-earned list.
 */
export function checkAchievements(data: PlayerData): AchievementAward[] {
  const out: AchievementAward[] = [];
  for (const a of ACHIEVEMENTS) {
    if (isComplete(data, a.id)) continue;
    if (a.value(data) < a.target) continue;
    data.achievements[a.id] = 1;
    data.coins += a.coins;
    if (a.reward) grantCosmetic(data, a.reward);
    out.push({ id: a.id, label: a.label, coins: a.coins, reward: a.reward });
  }
  return out;
}

/** A row for the awards UI (hidden + unearned rows are masked). */
export interface AchievementRow {
  id: string;
  label: string;
  desc: string;
  value: number;
  target: number;
  done: boolean;
  hidden: boolean;
  reward?: string;
}

/** Build the achievement list for the UI (completed first, then by progress). */
export function achievementRows(data: PlayerData): AchievementRow[] {
  return ACHIEVEMENTS.map((a) => {
    const value = Math.min(a.value(data), a.target);
    const done = isComplete(data, a.id) || value >= a.target;
    const masked = a.hidden && !done;
    return {
      id: a.id,
      label: masked ? '???' : a.label,
      desc: masked ? 'Hidden achievement' : a.desc,
      value: masked ? 0 : value,
      target: a.target,
      done,
      hidden: !!a.hidden,
      reward: masked ? undefined : a.reward,
    };
  }).sort((x, y) => Number(y.done) - Number(x.done) || y.value / y.target - x.value / x.target);
}

/** Count of completed achievements (for the menu badge). */
export function completedCount(data: PlayerData): number {
  return ACHIEVEMENTS.reduce((n, a) => n + (isComplete(data, a.id) ? 1 : 0), 0);
}

export function achievementLabel(id: string): string {
  return BY_ID.get(id)?.label ?? id;
}
