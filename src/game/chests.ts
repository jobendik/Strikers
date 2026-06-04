/*
 * Free chests (F5) — earned, honest loot with visible odds + pity.
 *
 * Chests drop from play (the daily-chest meter, account level-ups) and the shop
 * (F6). Opening one always pays coins + one cosmetic, whose rarity is rolled from
 * a *published* odds table (shown in the UI before opening) under a pity system:
 * an Epic is guaranteed within {@link EPIC_PITY} opens and a Mythic within
 * {@link MYTHIC_PITY}, so a run of bad luck always ends. Duplicates convert to
 * shards via the collection (F4) — no dead drops, no fake near-miss (retention §3).
 *
 * Pure logic over the `chests`/`pity` blocks of the save (+ the collection). No
 * storage/DOM/render; reached only via the reward pipeline / UI, both outside the
 * headless sim. RNG is injectable for deterministic tests.
 */
import type { PlayerData } from '../core/playerData';
import type { Rarity } from './season';
import { CATALOGUE, grantCosmetic, isOwned, shardValue, RARITY_ORDER, type GrantResult } from './collection';

/** Pity guarantees (an Epic within this many opens, a Mythic within this many). */
export const EPIC_PITY = 10;
export const MYTHIC_PITY = 50;

/** A chest definition with its published rarity odds. */
export interface ChestDef {
  id: string;
  name: string;
  /** Coin payout range [min, max] (inclusive). */
  coins: [number, number];
  /** Rarity odds (sum ≈ 1). The Mythic slice is the floor — pity can still force one earlier. */
  odds: Record<Rarity, number>;
}

export const CHESTS: ChestDef[] = [
  { id: 'daily', name: 'Daily Chest', coins: [80, 160], odds: { common: 0.6, rare: 0.3, epic: 0.09, mythic: 0.01 } },
  { id: 'levelup', name: 'Level-Up Chest', coins: [60, 120], odds: { common: 0.55, rare: 0.33, epic: 0.1, mythic: 0.02 } },
  { id: 'gold', name: 'Gold Chest', coins: [150, 300], odds: { common: 0.3, rare: 0.45, epic: 0.2, mythic: 0.05 } },
];

const BY_ID = new Map(CHESTS.map((d) => [d.id, d]));

/** Look up a chest definition. */
export function chestDef(id: string): ChestDef | undefined {
  return BY_ID.get(id);
}

let rng: () => number = Math.random;
/** Override the RNG (deterministic tests). */
export function setChestRng(fn: () => number): void {
  rng = fn;
}

const randInt = (min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));

/** Grant `n` chests of a type into the inventory. */
export function grantChest(data: PlayerData, id: string, n = 1): void {
  if (!BY_ID.has(id)) return;
  data.chests[id] = (data.chests[id] ?? 0) + n;
}

/** Unopened chests of a type. */
export function chestCount(data: PlayerData, id: string): number {
  return data.chests[id] ?? 0;
}

/** Total unopened chests across all types. */
export function totalChests(data: PlayerData): number {
  return CHESTS.reduce((a, d) => a + chestCount(data, d.id), 0);
}

/** Opens remaining until the next guaranteed Epic / Mythic. */
export function pityStatus(data: PlayerData): { epicIn: number; mythicIn: number } {
  return {
    epicIn: Math.max(0, EPIC_PITY - (data.pity.epic ?? 0)),
    mythicIn: Math.max(0, MYTHIC_PITY - (data.pity.mythic ?? 0)),
  };
}

/** Roll a rarity from a chest's odds (no pity). */
function rollOdds(def: ChestDef): Rarity {
  let r = rng();
  for (const rarity of RARITY_ORDER) {
    r -= def.odds[rarity];
    if (r <= 0) return rarity;
  }
  return 'common';
}

/** Pick a cosmetic of `rarity`, preferring one not yet owned; null if none exist. */
function pickCosmetic(data: PlayerData, rarity: Rarity): string | null {
  const pool = CATALOGUE.filter((x) => x.rarity === rarity);
  if (pool.length === 0) return null;
  const unowned = pool.filter((x) => !isOwned(data, x.id));
  const from = unowned.length ? unowned : pool;
  return from[Math.floor(rng() * from.length)].id;
}

/** The result of opening a chest, for the reveal UI. */
export interface ChestOpen {
  chest: string;
  coins: number;
  rarity: Rarity;
  cosmetic: GrantResult;
  /** Set when pity forced this rarity (honest "guaranteed" callout). */
  pityForced?: 'epic' | 'mythic';
}

/**
 * Open one chest of `id` if the player has one. Decrements the inventory, rolls a
 * rarity (respecting pity), pays coins and grants a cosmetic (duplicate → shards).
 * Mutates the save; the caller persists. Returns null if none are owned.
 */
export function openChest(data: PlayerData, id: string): ChestOpen | null {
  const def = BY_ID.get(id);
  if (!def || chestCount(data, id) <= 0) return null;
  data.chests[id] = chestCount(data, id) - 1;

  // advance pity, then decide rarity (pity can force an upgrade)
  data.pity.epic = (data.pity.epic ?? 0) + 1;
  data.pity.mythic = (data.pity.mythic ?? 0) + 1;

  let rarity = rollOdds(def);
  let pityForced: ChestOpen['pityForced'];
  if (data.pity.mythic >= MYTHIC_PITY && rarity !== 'mythic') {
    rarity = 'mythic';
    pityForced = 'mythic';
  } else if (data.pity.epic >= EPIC_PITY && rarity !== 'epic' && rarity !== 'mythic') {
    rarity = 'epic';
    pityForced = 'epic';
  }

  // reset pity counters the drop satisfies (a Mythic also satisfies Epic pity)
  if (rarity === 'epic' || rarity === 'mythic') data.pity.epic = 0;
  if (rarity === 'mythic') data.pity.mythic = 0;

  const coins = randInt(def.coins[0], def.coins[1]);
  data.coins += coins;

  const pick = pickCosmetic(data, rarity);
  const cosmetic: GrantResult = pick
    ? grantCosmetic(data, pick)
    : // no cosmetic exists at this rarity → pay its shard value instead (never a dead drop)
      (() => {
        const s = shardValue(rarity);
        data.shards[rarity] = (data.shards[rarity] ?? 0) + s;
        return { id: '', name: `${rarity} shards`, rarity, newlyOwned: false, shards: s };
      })();

  return { chest: id, coins, rarity, cosmetic, pityForced };
}
