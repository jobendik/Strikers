/*
 * Persistent player save (C1) — the spine of the retention systems.
 *
 * One versioned, migration-safe, self-healing record that every progression
 * surface reads and writes: account XP/level/title (C2/C3), profile (C4), the
 * result screen (D), daily/weekly systems (E), season/collection (F), medals &
 * achievements (G) and the active World Cup run (A2). Persisted through the
 * storage abstraction (B5) so it works on localStorage today and a CrazyGames
 * account later, and degrades to in-memory under the headless harness/Node.
 *
 * This module owns the *shape* and persistence only. Reward math, quest rolling,
 * tournament logic etc. live in their own modules and mutate this record via
 * {@link getPlayerData} + {@link savePlayerData}.
 */
import { TEAMS, DEFAULT_TEAM } from '../config/players';
import { readJSON, writeJSON, removeKey } from '../platform/storage';

/** Bump when the schema changes in a non-additive way; add a migration step. */
export const SCHEMA_VERSION = 1;
const KEY = 'yuka-strikers/player';

// ---- sub-schemas ------------------------------------------------------------

/** Lifetime career counters (drive the profile tiles + achievements). */
export interface PlayerStats {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals: number;
  conceded: number;
  cleanSheets: number;
  cupsWon: number;
}

/** An active quest instance (daily or weekly). Behaviour lands in E. */
export interface QuestState {
  id: string;
  /** Units accrued toward {@link target}. */
  progress: number;
  target: number;
  claimed: boolean;
}

/** Today's daily systems (orders, chest meter, first-win flag). Resets per day. */
export interface DailyState {
  /** Local YYYY-MM-DD this block belongs to; a new day re-rolls it. */
  date: string;
  orders: QuestState[];
  rerollUsed: boolean;
  /** 0–100 daily-chest meter. */
  chestPoints: number;
  firstWin: boolean;
}

/** This week's weekly orders + forgiving activity meter. Resets per ISO week. */
export interface WeeklyState {
  weekId: string;
  orders: QuestState[];
  /** Distinct local dates played this week (for the "play 3 days" meter). */
  activeDays: string[];
}

/** Free Season Track progress (F1) + earned Elite unlock (F2). */
export interface SeasonState {
  id: string;
  level: number;
  xp: number;
  eliteUnlocked: boolean;
  /** Tier indices already claimed. */
  claimed: number[];
}

/** Equipped cosmetics by slot (null = default). */
export interface EquippedCosmetics {
  kit: string | null;
  ball: string | null;
  celebration: string | null;
  trail: string | null;
  banner: string | null;
}

/** Cosmetic collection (F3/F4). */
export interface CollectionState {
  owned: string[];
  equipped: EquippedCosmetics;
}

/** The persisted World Cup run (A2) — resume mid-tournament across sessions. */
export interface WorldCupState {
  active: boolean;
  /** Participating team keys (curated field, growing toward 32/48). */
  field: string[];
  /** Opaque group/bracket payloads — typed by `game/worldcup.ts` (A3/A4). */
  groups: unknown[];
  bracket: unknown[];
  matchday: number;
  yourNation: string;
  yourPath: unknown[];
  /** Winner's team key once the Final is decided (else null). */
  champion: string | null;
  /** The user's nation has been knocked out (the run plays on, simulated). */
  userOut: boolean;
}

/** Accessibility/effects prefs scoped to the player save (mirrors §3 guardrails). */
export interface PlayerPrefs {
  reducedMotion: boolean;
  effects: 'full' | 'reduced';
}

/** The complete persisted player record (schema §5 of work_ahead.md). */
export interface PlayerData {
  v: number;
  playerId: string;
  name: string;
  flag: string;
  level: number;
  xp: number;
  title: string;
  coins: number;
  gems: number;
  /** Cosmetic-shard balances keyed by rarity/family. */
  shards: Record<string, number>;
  stats: PlayerStats;
  daily: DailyState;
  weekly: WeeklyState;
  season: SeasonState;
  collection: CollectionState;
  /** Achievement id → progress count. */
  achievements: Record<string, number>;
  /** Medal id → times earned. */
  medals: Record<string, number>;
  /** Nation/playstyle mastery id → xp. */
  mastery: Record<string, number>;
  worldcup: WorldCupState;
  settings: PlayerPrefs;
}

// ---- defaults ---------------------------------------------------------------

function freshStats(): PlayerStats {
  return { played: 0, wins: 0, draws: 0, losses: 0, goals: 0, conceded: 0, cleanSheets: 0, cupsWon: 0 };
}

/** A short, opaque local id. Replaced by the platform id if/when available. */
function makePlayerId(): string {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `local-${Date.now().toString(36)}-${rnd}`;
}

/** A brand-new save. The chosen nation is supplied so the profile flag matches. */
export function defaultPlayerData(nation: string = DEFAULT_TEAM): PlayerData {
  return {
    v: SCHEMA_VERSION,
    playerId: makePlayerId(),
    name: 'PLAYER',
    flag: nation,
    level: 1,
    xp: 0,
    title: 'Rookie',
    coins: 0,
    gems: 0,
    shards: {},
    stats: freshStats(),
    daily: { date: '', orders: [], rerollUsed: false, chestPoints: 0, firstWin: false },
    weekly: { weekId: '', orders: [], activeDays: [] },
    season: { id: 'wc2026', level: 1, xp: 0, eliteUnlocked: false, claimed: [] },
    collection: { owned: [], equipped: { kit: null, ball: null, celebration: null, trail: null, banner: null } },
    achievements: {},
    medals: {},
    mastery: {},
    worldcup: { active: false, field: [], groups: [], bracket: [], matchday: 0, yourNation: nation, yourPath: [], champion: null, userOut: false },
    settings: { reducedMotion: false, effects: 'full' },
  };
}

// ---- migration + self-healing ----------------------------------------------

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const arr = <T>(v: unknown, d: T[]): T[] => (Array.isArray(v) ? (v as T[]) : d);
const rec = (v: unknown): Record<string, number> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, number>) : {};

/**
 * Coerce an arbitrary parsed object into a valid {@link PlayerData}, filling any
 * missing/old/corrupt fields from defaults so a save from a previous build (or a
 * tampered/partial blob) never crashes the game. Future schema bumps add their
 * field migrations here, keyed off `raw.v`.
 */
export function migratePlayerData(raw: unknown): PlayerData {
  const d = defaultPlayerData();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const rDaily = (r.daily ?? {}) as Record<string, unknown>;
  const rWeekly = (r.weekly ?? {}) as Record<string, unknown>;
  const rSeason = (r.season ?? {}) as Record<string, unknown>;
  const rColl = (r.collection ?? {}) as Record<string, unknown>;
  const rEquip = (rColl.equipped ?? {}) as Record<string, unknown>;
  const rStats = (r.stats ?? {}) as Record<string, unknown>;
  const rWC = (r.worldcup ?? {}) as Record<string, unknown>;
  const rPrefs = (r.settings ?? {}) as Record<string, unknown>;

  const out: PlayerData = {
    v: SCHEMA_VERSION,
    playerId: str(r.playerId, d.playerId),
    name: str(r.name, d.name).slice(0, 16) || d.name,
    flag: str(r.flag, d.flag),
    level: Math.max(1, num(r.level, d.level)),
    xp: Math.max(0, num(r.xp, d.xp)),
    title: str(r.title, d.title),
    coins: Math.max(0, num(r.coins, d.coins)),
    gems: Math.max(0, num(r.gems, d.gems)),
    shards: rec(r.shards),
    stats: {
      played: Math.max(0, num(rStats.played, 0)),
      wins: Math.max(0, num(rStats.wins, 0)),
      draws: Math.max(0, num(rStats.draws, 0)),
      losses: Math.max(0, num(rStats.losses, 0)),
      goals: Math.max(0, num(rStats.goals, 0)),
      conceded: Math.max(0, num(rStats.conceded, 0)),
      cleanSheets: Math.max(0, num(rStats.cleanSheets, 0)),
      cupsWon: Math.max(0, num(rStats.cupsWon, 0)),
    },
    daily: {
      date: str(rDaily.date, ''),
      orders: arr<QuestState>(rDaily.orders, []),
      rerollUsed: bool(rDaily.rerollUsed, false),
      chestPoints: Math.max(0, Math.min(100, num(rDaily.chestPoints, 0))),
      firstWin: bool(rDaily.firstWin, false),
    },
    weekly: {
      weekId: str(rWeekly.weekId, ''),
      orders: arr<QuestState>(rWeekly.orders, []),
      activeDays: arr<string>(rWeekly.activeDays, []),
    },
    season: {
      id: str(rSeason.id, d.season.id),
      level: Math.max(1, num(rSeason.level, 1)),
      xp: Math.max(0, num(rSeason.xp, 0)),
      eliteUnlocked: bool(rSeason.eliteUnlocked, false),
      claimed: arr<number>(rSeason.claimed, []),
    },
    collection: {
      owned: arr<string>(rColl.owned, []),
      equipped: {
        kit: (rEquip.kit as string | null) ?? null,
        ball: (rEquip.ball as string | null) ?? null,
        celebration: (rEquip.celebration as string | null) ?? null,
        trail: (rEquip.trail as string | null) ?? null,
        banner: (rEquip.banner as string | null) ?? null,
      },
    },
    achievements: rec(r.achievements),
    medals: rec(r.medals),
    mastery: rec(r.mastery),
    worldcup: {
      active: bool(rWC.active, false),
      field: arr<string>(rWC.field, []),
      groups: arr<unknown>(rWC.groups, []),
      bracket: arr<unknown>(rWC.bracket, []),
      matchday: Math.max(0, num(rWC.matchday, 0)),
      yourNation: str(rWC.yourNation, d.worldcup.yourNation),
      yourPath: arr<unknown>(rWC.yourPath, []),
      champion: typeof rWC.champion === 'string' ? rWC.champion : null,
      userOut: bool(rWC.userOut, false),
    },
    settings: {
      reducedMotion: bool(rPrefs.reducedMotion, false),
      effects: rPrefs.effects === 'reduced' ? 'reduced' : 'full',
    },
  };

  // heal references to teams that no longer exist in this build
  if (!TEAMS.some((t) => t.key === out.flag)) out.flag = DEFAULT_TEAM;
  if (!TEAMS.some((t) => t.key === out.worldcup.yourNation)) out.worldcup.yourNation = out.flag;

  return out;
}

// ---- singleton + API --------------------------------------------------------

function load(): PlayerData {
  const raw = readJSON<unknown>(KEY);
  const data = raw == null ? defaultPlayerData() : migratePlayerData(raw);
  // persist a brand-new or healed save immediately so the id/shape is stable
  writeJSON(KEY, data);
  return data;
}

let DATA: PlayerData = load();

/** The live player record. Mutate it, then call {@link savePlayerData}. */
export function getPlayerData(): PlayerData {
  return DATA;
}

/** Persist the current player record. Call after any mutation that must survive. */
export function savePlayerData(): void {
  writeJSON(KEY, DATA);
}

/**
 * Re-read the save from the active storage backend. Call after swapping the
 * backend (e.g. once the CrazyGames account is connected in B1/B5).
 */
export function reloadPlayerData(): PlayerData {
  DATA = load();
  return DATA;
}

/** Wipe the save and start fresh (debug / "reset progress"). */
export function resetPlayerData(nation: string = DEFAULT_TEAM): PlayerData {
  removeKey(KEY);
  DATA = defaultPlayerData(nation);
  writeJSON(KEY, DATA);
  return DATA;
}
