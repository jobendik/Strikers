/*
 * Match reward pipeline (C2) — the spine of "every match grants visible progress".
 *
 * Called once when a match is decided (from `modes.presentResult`, which is the
 * result-screen owner and is stubbed out of the headless balance harness — so the
 * pipeline never runs during balance sims). Computes XP/coins from the result and
 * performance, applies the first-match-of-day bonus, rolls the account level/title
 * (C2/C3), updates lifetime stats, persists the save, and returns a structured
 * {@link MatchRewards} for the result screen (D) to reveal in order.
 *
 * Reward reveal order (retention §25.3) is the caller's job; this just produces the
 * data. Daily orders / chest / season / achievements (E/F/G) will extend the same
 * pipeline here as those systems land.
 */
import { getPlayerData, savePlayerData } from '../core/playerData';
import { grantXp, titleForLevel } from '../core/progression';
import { localDateString } from '../core/dates';

/** What happened in the match, from the *user team's* perspective. */
export interface MatchOutcome {
  win: boolean;
  draw: boolean;
  loss: boolean;
  goalsFor: number;
  goalsAgainst: number;
}

/** Itemised XP grant (for the result screen's breakdown). */
export interface XpBreakdown {
  base: number;
  firstMatch: number;
  goals: number;
  cleanSheet: number;
  margin: number;
  total: number;
}

/** Everything the result screen needs to reveal after a match. */
export interface MatchRewards {
  result: 'win' | 'draw' | 'loss';
  goalsFor: number;
  goalsAgainst: number;
  cleanSheet: boolean;
  xp: XpBreakdown;
  coins: number;
  // post-grant account standing:
  level: number;
  xpIntoLevel: number;
  xpForNext: number;
  levelsGained: number;
  newTitle: string | null;
  firstMatchOfDay: boolean;
  firstWinOfDay: boolean;
}

// --- tunables (retention §3.1) ----------------------------------------------
const XP_WIN = 140;
const XP_DRAW = 90;
const XP_LOSS = 60; // a loss still pays
const XP_FIRST_MATCH = 100; // once per local day
const XP_PER_GOAL = 30;
const XP_GOALS_CAP = 120;
const XP_CLEAN_SHEET = 80;
const XP_BIG_WIN = 50; // win by 3+
const BIG_WIN_MARGIN = 3;

const COINS_WIN = 50;
const COINS_DRAW = 25;
const COINS_LOSS = 12;
const COINS_PER_GOAL = 5;
const COINS_FIRST_MATCH = 25;

/**
 * Run the reward pipeline for a decided match and persist the result. Mutates the
 * live player save; returns the breakdown for the UI.
 */
export function applyMatchRewards(o: MatchOutcome): MatchRewards {
  const data = getPlayerData();
  const today = localDateString();
  const result: 'win' | 'draw' | 'loss' = o.win ? 'win' : o.loss ? 'loss' : 'draw';
  const cleanSheet = o.goalsAgainst === 0;

  // first match of a new local day → roll the daily block's date + bonus
  const firstMatchOfDay = data.daily.date !== today;
  if (firstMatchOfDay) {
    data.daily.date = today;
    data.daily.firstWin = false;
    // note: daily orders / chest reset (E) will hook in here once those land
  }

  // first *win* of the day (E rewards it; we just flag it honestly here)
  const firstWinOfDay = o.win && !data.daily.firstWin;
  if (firstWinOfDay) data.daily.firstWin = true;

  // --- XP ---
  const base = o.win ? XP_WIN : o.draw ? XP_DRAW : XP_LOSS;
  const firstMatch = firstMatchOfDay ? XP_FIRST_MATCH : 0;
  const goalsXp = Math.min(XP_GOALS_CAP, o.goalsFor * XP_PER_GOAL);
  const cleanSheetXp = cleanSheet && !o.loss ? XP_CLEAN_SHEET : 0;
  const marginXp = o.win && o.goalsFor - o.goalsAgainst >= BIG_WIN_MARGIN ? XP_BIG_WIN : 0;
  const totalXp = base + firstMatch + goalsXp + cleanSheetXp + marginXp;

  const xp: XpBreakdown = {
    base,
    firstMatch,
    goals: goalsXp,
    cleanSheet: cleanSheetXp,
    margin: marginXp,
    total: totalXp,
  };

  // --- coins ---
  const coins = (o.win ? COINS_WIN : o.draw ? COINS_DRAW : COINS_LOSS) + o.goalsFor * COINS_PER_GOAL + (firstMatchOfDay ? COINS_FIRST_MATCH : 0);

  // --- apply to the save ---
  const out = grantXp(data.level, data.xp, totalXp);
  data.level = out.level;
  data.xp = out.xpIntoLevel;
  data.title = titleForLevel(out.level);
  data.coins += coins;

  data.stats.played++;
  if (o.win) data.stats.wins++;
  else if (o.draw) data.stats.draws++;
  else data.stats.losses++;
  data.stats.goals += o.goalsFor;
  data.stats.conceded += o.goalsAgainst;
  if (cleanSheet) data.stats.cleanSheets++;

  savePlayerData();

  return {
    result,
    goalsFor: o.goalsFor,
    goalsAgainst: o.goalsAgainst,
    cleanSheet,
    xp,
    coins,
    level: out.level,
    xpIntoLevel: out.xpIntoLevel,
    xpForNext: out.xpForNext,
    levelsGained: out.levelsGained,
    newTitle: out.newTitle,
    firstMatchOfDay,
    firstWinOfDay,
  };
}
