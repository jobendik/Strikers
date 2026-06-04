/*
 * Season Track (F1 Free Track + F2 earned Elite Track) — the medium-horizon
 * "World Cup 2026 Season" progression spine.
 *
 * Pure logic over the `season` block of the player save: a fixed ladder of tiers,
 * each granting a Free reward (always available) and most also an Elite reward
 * (earned by completing a week's orders, never paid — retention.md §F/§3). Match
 * play feeds the track Season XP, which rolls the player up tiers; rewards are
 * *claimed* on the season screen (the claim is the dopamine, battle-pass style) —
 * nothing auto-grants. Unlocking Elite is retroactive: every Elite tier already
 * reached becomes claimable at once.
 *
 * No storage/DOM/render here. The reward pipeline (`game/rewards.ts`) advances the
 * track and persists; the season UI (`ui/season.ts`) reads state + drives claims.
 * Reached only via `rewards`/`main`, both stubbed/excluded from the headless sim,
 * so this stays out of the balance bundle.
 */
import type { PlayerData, SeasonState } from '../core/playerData';
import { grantCosmetic } from './collection';

/** The active season's id (the save heals onto this on load). */
export const SEASON_ID = 'wc2026';
/** Player-facing season name. */
export const SEASON_NAME = 'World Cup 2026 Season';
/** Number of tiers on the track. */
export const SEASON_TIERS = 30;

/** Cosmetic/reward rarities (shared with the future collection album, F3). */
export type Rarity = 'common' | 'rare' | 'epic' | 'mythic';

/** One claimable reward on a tier (free or elite column). */
export interface TierReward {
  /** What the reward pays out as. `cosmetic`/`title` deposit an id into the collection. */
  kind: 'coins' | 'gems' | 'shards' | 'cosmetic' | 'title';
  /** Amount for coins/gems/shards. */
  amount?: number;
  /** Cosmetic/title id (also the shard family for `shards`). Deposited into `collection.owned`. */
  id?: string;
  /** Short display label (e.g. "120 coins", "Golden Boot ball"). */
  label: string;
  /** Rarity for cosmetics/titles (drives the UI tint + the future collection). */
  rarity?: Rarity;
}

/** A tier on the track: its free reward, and (usually) an earned elite reward. */
export interface SeasonTier {
  /** 1-based tier number. */
  tier: number;
  free: TierReward;
  /** Elite-column reward (omitted on a few tiers). */
  elite?: TierReward;
}

// --- which reward "track" a claim belongs to --------------------------------
export type Track = 'free' | 'elite';

// ---- Season XP curve --------------------------------------------------------
// Early tiers are cheap (first reward fast — retention.md §20), then the cost
// rises so a full 30-tier run spans a ~2–6 week season at a few matches a day.
const XP_EARLY = 400; // tiers 1–5
const XP_MID = 700; // tiers 6–15
const XP_LATE = 1100; // tiers 16–29 (tier 30 is the cap)

/**
 * Season XP required to advance *out of* `tier` (1-based) into the next.
 * Returns `Infinity` at/above the final tier so the track can't overflow.
 */
export function seasonXpForTier(tier: number): number {
  if (tier >= SEASON_TIERS) return Infinity;
  if (tier <= 5) return XP_EARLY;
  if (tier <= 15) return XP_MID;
  return XP_LATE;
}

// ---- the tier ladder --------------------------------------------------------
const coins = (amount: number): TierReward => ({ kind: 'coins', amount, label: `${amount} coins` });
const gems = (amount: number): TierReward => ({ kind: 'gems', amount, label: `${amount} gems` });
const shards = (amount: number, rarity: Rarity = 'rare'): TierReward => ({
  kind: 'shards',
  amount,
  id: rarity,
  rarity,
  label: `${amount} ${rarity} shards`,
});
const cosmetic = (id: string, label: string, rarity: Rarity): TierReward => ({ kind: 'cosmetic', id, label, rarity });
const title = (id: string, label: string, rarity: Rarity = 'epic'): TierReward => ({ kind: 'title', id, label, rarity });

/**
 * The World Cup 2026 Season ladder. Free column is generous and always claimable;
 * the Elite column (earned via weekly orders) layers cosmetics + premium currency
 * on top. Cosmetic ids seed the collection (F3) — claiming deposits them honestly.
 */
export const TIERS: SeasonTier[] = [
  { tier: 1, free: coins(80), elite: cosmetic('trail_emerald', 'Emerald shot trail', 'rare') },
  { tier: 2, free: coins(100) },
  { tier: 3, free: shards(15), elite: coins(150) },
  { tier: 4, free: coins(120), elite: cosmetic('ball_classic26', 'Classic ’26 ball', 'rare') },
  { tier: 5, free: cosmetic('cele_knee_slide', 'Knee-slide celebration', 'rare'), elite: gems(20) },
  { tier: 6, free: coins(140), elite: cosmetic('net_neon', 'Neon net', 'rare') },
  { tier: 7, free: shards(20), elite: coins(180) },
  { tier: 8, free: coins(160), elite: cosmetic('trail_magenta', 'Magenta shot trail', 'epic') },
  { tier: 9, free: cosmetic('banner_host26', 'Host Nation banner', 'rare'), elite: gems(25) },
  { tier: 10, free: coins(200), elite: cosmetic('ball_golden', 'Golden Boot ball', 'epic') },
  { tier: 11, free: shards(25), elite: coins(220) },
  { tier: 12, free: coins(180), elite: cosmetic('cele_backflip', 'Backflip celebration', 'epic') },
  { tier: 13, free: cosmetic('trail_ice', 'Ice shot trail', 'rare'), elite: gems(30) },
  { tier: 14, free: coins(220), elite: cosmetic('net_gold', 'Gold net', 'epic') },
  { tier: 15, free: title('title_qualified', 'Title: Qualified', 'epic'), elite: coins(260) },
  { tier: 16, free: coins(240), elite: cosmetic('banner_knockout', 'Knockout Run banner', 'epic') },
  { tier: 17, free: shards(30, 'epic'), elite: gems(35) },
  { tier: 18, free: coins(260), elite: cosmetic('cele_robot', 'Robot celebration', 'epic') },
  { tier: 19, free: cosmetic('ball_carbon', 'Carbon ball', 'epic'), elite: coins(300) },
  { tier: 20, free: coins(300), elite: cosmetic('trail_aurora', 'Aurora shot trail', 'mythic') },
  { tier: 21, free: shards(35, 'epic'), elite: gems(40) },
  { tier: 22, free: coins(320), elite: cosmetic('net_rainbow', 'Rainbow net', 'epic') },
  { tier: 23, free: cosmetic('cele_somersault', 'Somersault celebration', 'epic'), elite: coins(340) },
  { tier: 24, free: coins(340), elite: cosmetic('banner_finalist', 'Finalist banner', 'mythic') },
  { tier: 25, free: title('title_finalist', 'Title: Finalist', 'epic'), elite: gems(50) },
  { tier: 26, free: coins(380), elite: cosmetic('ball_plasma', 'Plasma ball', 'mythic') },
  { tier: 27, free: shards(45, 'epic'), elite: coins(420) },
  { tier: 28, free: coins(420), elite: cosmetic('cele_worm', 'The Worm celebration', 'epic') },
  { tier: 29, free: cosmetic('trail_phoenix', 'Phoenix shot trail', 'mythic'), elite: gems(60) },
  { tier: 30, free: title('title_champion26', 'Title: Champion ’26', 'mythic'), elite: cosmetic('ball_trophy', 'Trophy ball', 'mythic') },
];

const tierDef = (tier: number): SeasonTier | undefined => TIERS[tier - 1];

// ---- claim-state encoding ---------------------------------------------------
// `season.claimed` is a flat number[] (schema §5). Free claims store the tier
// number; Elite claims store `ELITE_OFFSET + tier`. Keeps F2 additive — no schema
// bump, self-healed by the existing migration (mirrors the weekly reroll sentinel).
const ELITE_OFFSET = 1000;
const claimKey = (tier: number, track: Track): number => (track === 'elite' ? ELITE_OFFSET + tier : tier);

/** Has this tier's free/elite reward already been claimed? */
export function isClaimed(season: SeasonState, tier: number, track: Track): boolean {
  return season.claimed.includes(claimKey(tier, track));
}

// ---- season lifecycle -------------------------------------------------------

/**
 * Ensure the season block belongs to the current season; reset it (level/xp/claims)
 * when a new season starts. Returns true if it rolled over. Single season for now
 * ({@link SEASON_ID}); a future rotation just changes the id (A7).
 */
export function ensureSeason(season: SeasonState): boolean {
  if (season.id !== SEASON_ID) {
    season.id = SEASON_ID;
    season.level = 1;
    season.xp = 0;
    season.eliteUnlocked = false;
    season.claimed = [];
    return true;
  }
  return false;
}

/** Where the season bar sits: current tier, XP into it, XP for the next, capped. */
export interface SeasonStanding {
  tier: number;
  /** XP accrued into the current tier (bar numerator). */
  into: number;
  /** XP to reach the next tier (bar denominator; 0 at the cap). */
  forNext: number;
  /** True once the final tier is reached. */
  atMax: boolean;
}

/** Read the current standing for the UI bar (does not mutate). */
export function seasonStanding(season: SeasonState): SeasonStanding {
  const tier = Math.max(1, Math.min(SEASON_TIERS, Math.floor(season.level)));
  const forNext = seasonXpForTier(tier);
  const atMax = tier >= SEASON_TIERS;
  return { tier, into: atMax ? 0 : Math.max(0, season.xp), forNext: atMax ? 0 : forNext, atMax };
}

/** The outcome of feeding the track Season XP from a match (for the result screen). */
export interface SeasonProgress {
  /** Tier before this grant. */
  tierBefore: number;
  /** Tier after this grant. */
  tier: number;
  /** Tiers gained by this grant (0 if none). */
  tiersGained: number;
  /** Bar fill the result screen animates from (0–1). */
  fillFrom: number;
  /** Bar fill the result screen animates to (0–1). */
  fillTo: number;
  /** Standing after the grant (numerator/denominator for the caption). */
  standing: SeasonStanding;
  /** Claimable rewards waiting after this match (free + unlocked elite). */
  claimable: number;
}

/**
 * Apply a Season XP grant and roll the track up through as many tiers as it covers
 * (capped at the final tier). Mutates `season`; the caller persists. `amount` is
 * clamped to ≥0. Rewards are not granted here — they're claimed on the screen.
 */
export function progressSeason(season: SeasonState, amount: number): SeasonProgress {
  ensureSeason(season);
  const tierBefore = Math.max(1, Math.min(SEASON_TIERS, Math.floor(season.level)));
  const beforeForNext = seasonXpForTier(tierBefore);
  const fillFrom = beforeForNext === Infinity ? 1 : clamp01(Math.max(0, season.xp) / beforeForNext);

  let lvl = tierBefore;
  let xp = Math.max(0, season.xp) + Math.max(0, amount);
  let gained = 0;
  // guard against a runaway loop on absurd inputs while still handling big grants
  while (lvl < SEASON_TIERS && xp >= seasonXpForTier(lvl) && gained < 10000) {
    xp -= seasonXpForTier(lvl);
    lvl++;
    gained++;
  }
  if (lvl >= SEASON_TIERS) xp = 0; // park at the cap

  season.level = lvl;
  season.xp = xp;

  const standing = seasonStanding(season);
  const fillTo = standing.atMax ? 1 : standing.forNext > 0 ? clamp01(standing.into / standing.forNext) : 0;

  return {
    tierBefore,
    tier: lvl,
    tiersGained: gained,
    // on a tier-up the bar visibly fills from empty into the new tier
    fillFrom: gained > 0 ? 0 : fillFrom,
    fillTo,
    standing,
    claimable: countClaimable(season),
  };
}

// ---- elite unlock (F2) ------------------------------------------------------

/**
 * Unlock the earned Elite track for this season. Idempotent. Retroactive by
 * construction: every Elite tier already reached immediately becomes claimable
 * (see {@link claimableTiers}). Returns true if it flipped from locked this call.
 */
export function unlockElite(season: SeasonState): boolean {
  ensureSeason(season);
  if (season.eliteUnlocked) return false;
  season.eliteUnlocked = true;
  return true;
}

// ---- claiming ---------------------------------------------------------------

/** A tier's claim state for one track (for the UI). */
export type TierClaimState = 'claimed' | 'claimable' | 'locked-tier' | 'locked-elite';

/** The claim state of a tier's free/elite reward given the current standing. */
export function tierState(season: SeasonState, tier: number, track: Track): TierClaimState {
  const def = tierDef(tier);
  if (track === 'elite' && !def?.elite) return 'locked-tier'; // no elite reward on this tier
  if (isClaimed(season, tier, track)) return 'claimed';
  if (tier > Math.floor(season.level)) return 'locked-tier';
  if (track === 'elite' && !season.eliteUnlocked) return 'locked-elite';
  return 'claimable';
}

/** Reached, unclaimed reward count (free always + elite once unlocked). */
export function countClaimable(season: SeasonState): number {
  let n = 0;
  for (const t of TIERS) {
    if (tierState(season, t.tier, 'free') === 'claimable') n++;
    if (t.elite && tierState(season, t.tier, 'elite') === 'claimable') n++;
  }
  return n;
}

/** Deposit a single reward into the save (coins/gems/shards or a collection id). */
function grantReward(data: PlayerData, r: TierReward): void {
  switch (r.kind) {
    case 'coins':
      data.coins += r.amount ?? 0;
      break;
    case 'gems':
      data.gems += r.amount ?? 0;
      break;
    case 'shards': {
      const fam = r.id ?? 'rare';
      data.shards[fam] = (data.shards[fam] ?? 0) + (r.amount ?? 0);
      break;
    }
    case 'cosmetic':
    case 'title':
      // route through the collection so a duplicate converts to shards (F4)
      if (r.id) grantCosmetic(data, r.id);
      break;
  }
}

/**
 * Claim one tier's free/elite reward if it's currently claimable. Mutates the save
 * (deposits the reward, records the claim); the caller persists. Returns the granted
 * reward, or null if it wasn't claimable (already claimed / tier not reached / elite
 * locked). Idempotent — a second call returns null.
 */
export function claimTier(data: PlayerData, tier: number, track: Track): TierReward | null {
  const def = tierDef(tier);
  if (!def) return null;
  const reward = track === 'elite' ? def.elite : def.free;
  if (!reward) return null;
  if (tierState(data.season, tier, track) !== 'claimable') return null;
  grantReward(data, reward);
  data.season.claimed.push(claimKey(tier, track));
  return reward;
}

/** The result of claiming everything available. */
export interface ClaimAllResult {
  rewards: TierReward[];
  coins: number;
  gems: number;
  /** Cosmetic/title ids newly added to the collection. */
  cosmetics: string[];
}

/**
 * Claim every currently-claimable reward (free + unlocked elite), low tier first.
 * Mutates the save; the caller persists. Returns a tally for the UI toast.
 */
export function claimAll(data: PlayerData): ClaimAllResult {
  const out: ClaimAllResult = { rewards: [], coins: 0, gems: 0, cosmetics: [] };
  for (const t of TIERS) {
    for (const track of ['free', 'elite'] as Track[]) {
      const r = claimTier(data, t.tier, track);
      if (!r) continue;
      out.rewards.push(r);
      if (r.kind === 'coins') out.coins += r.amount ?? 0;
      else if (r.kind === 'gems') out.gems += r.amount ?? 0;
      else if ((r.kind === 'cosmetic' || r.kind === 'title') && r.id) out.cosmetics.push(r.id);
    }
  }
  return out;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
