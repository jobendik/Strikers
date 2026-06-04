/*
 * In-match medals (G1) — instant-dopamine awards for standout match moments.
 *
 * Detected from a finished match's facts + team stats (no live in-match hook, so
 * this stays out of the gameplay/sim path). Each medal pays a small coin bonus,
 * tallies into `data.medals` (feeding achievements G2) and is surfaced on the
 * result screen. Detection is pure; awarding mutates the save (caller persists).
 *
 * Note: medals needing live event detail (screamer / curler / wonder-save /
 * last-minute) await an in-match capture hook and are deliberately omitted here
 * to keep this sim-safe — see work_ahead H/G follow-ups.
 */
import type { PlayerData } from '../core/playerData';

/** Context for medal detection, gathered by `modes.presentResult`. */
export interface MedalContext {
  win: boolean;
  draw: boolean;
  loss: boolean;
  goalsFor: number;
  goalsAgainst: number;
  cleanSheet: boolean;
  shootoutWon: boolean;
  champion: boolean;
  /** Shots on target by the user team (from match.stats). */
  onTargetFor: number;
  /** Saves made by the user keeper (from match.stats). */
  savesFor: number;
}

export interface MedalDef {
  id: string;
  label: string;
  emoji: string;
  coins: number;
  /** True when this match earned it. */
  when: (c: MedalContext) => boolean;
}

export const MEDALS: MedalDef[] = [
  { id: 'first_goal', label: 'On the Scoresheet', emoji: '⚽', coins: 10, when: (c) => c.goalsFor >= 1 },
  { id: 'brace', label: 'Brace', emoji: '⚽⚽', coins: 20, when: (c) => c.goalsFor >= 2 },
  { id: 'hattrick', label: 'Hat-trick Hero', emoji: '🎩', coins: 40, when: (c) => c.goalsFor >= 3 },
  { id: 'rout', label: 'Goal Avalanche', emoji: '🌋', coins: 60, when: (c) => c.goalsFor >= 5 },
  { id: 'clean_sheet', label: 'Clean Sheet', emoji: '🧤', coins: 25, when: (c) => c.cleanSheet && !c.loss },
  { id: 'no_sweat', label: 'No Sweat', emoji: '😎', coins: 30, when: (c) => c.win && c.cleanSheet },
  { id: 'big_win', label: 'Statement Win', emoji: '💪', coins: 30, when: (c) => c.win && c.goalsFor - c.goalsAgainst >= 3 },
  { id: 'marksman', label: 'Marksman', emoji: '🎯', coins: 25, when: (c) => c.onTargetFor >= 10 },
  { id: 'wonder_keeper', label: 'Wall', emoji: '🧱', coins: 25, when: (c) => c.savesFor >= 8 },
  { id: 'shootout_hero', label: 'Shootout Hero', emoji: '🥅', coins: 40, when: (c) => c.shootoutWon },
  { id: 'world_champion', label: 'World Champion', emoji: '🏆', coins: 200, when: (c) => c.champion },
];

const BY_ID = new Map(MEDALS.map((m) => [m.id, m]));

/** A human label for a medal id (for achievements / UI). */
export function medalLabel(id: string): string {
  return BY_ID.get(id)?.label ?? id;
}

/** Detect which medals a match earned (pure). */
export function detectMedals(c: MedalContext): MedalDef[] {
  return MEDALS.filter((m) => m.when(c));
}

/** Outcome of awarding a match's medals. */
export interface MedalAward {
  medals: MedalDef[];
  coins: number;
}

/**
 * Detect + award a match's medals: tally each into `data.medals` and pay the coin
 * bonuses. Mutates the save; the caller persists. Returns the list for the result
 * screen.
 */
export function awardMatchMedals(data: PlayerData, c: MedalContext): MedalAward {
  const medals = detectMedals(c);
  let coins = 0;
  for (const m of medals) {
    data.medals[m.id] = (data.medals[m.id] ?? 0) + 1;
    coins += m.coins;
  }
  data.coins += coins;
  return { medals, coins };
}
