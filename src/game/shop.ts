/*
 * Earned-currency shop (F6) — a small daily rotation of cosmetics, chests and
 * shard bundles bought with coins/gems earned in-game.
 *
 * The rotation is *deterministic per local day* (seeded from the date), so every
 * player sees the same shelf that day and it rotates the next — items always
 * return, so there is no fake stock, no "only N left", no fake countdown
 * (retention §3). Owned cosmetics show as OWNED rather than being sold as dead
 * duplicates. A wishlist just stars items for convenience.
 *
 * Pure logic over the save (+ collection/chests). No DOM/render; reached only via
 * the shop UI, outside the headless sim.
 */
import type { PlayerData } from '../core/playerData';
import type { Rarity } from './season';
import { localDateString } from '../core/dates';
import { CATALOGUE, grantCosmetic, isOwned } from './collection';
import { grantChest, chestDef } from './chests';

export type Currency = 'coins' | 'gems';

/** A purchasable offer. */
export interface ShopItem {
  id: string;
  kind: 'cosmetic' | 'chest' | 'shards';
  /** Cosmetic id / chest id / shard rarity. */
  ref: string;
  /** Chest count or shard amount (cosmetics ignore this). */
  amount: number;
  cost: number;
  currency: Currency;
  label: string;
  rarity?: Rarity;
}

/** Coin price of a cosmetic by rarity (gems are reserved for premium chests/bundles). */
const COSMETIC_PRICE: Record<Rarity, number> = { common: 150, rare: 400, epic: 1200, mythic: 3000 };

/** Fixed consumable offers (always in the pool; repeatable, no stock cap). */
const CONSUMABLES: ShopItem[] = [
  { id: 'buy_gold_chest', kind: 'chest', ref: 'gold', amount: 1, cost: 60, currency: 'gems', label: 'Gold Chest', rarity: 'epic' },
  { id: 'buy_daily_chest', kind: 'chest', ref: 'daily', amount: 1, cost: 400, currency: 'coins', label: 'Daily Chest', rarity: 'rare' },
  { id: 'buy_shards_rare', kind: 'shards', ref: 'rare', amount: 40, cost: 25, currency: 'gems', label: '40 Rare shards', rarity: 'rare' },
  { id: 'buy_shards_epic', kind: 'shards', ref: 'epic', amount: 30, cost: 60, currency: 'gems', label: '30 Epic shards', rarity: 'epic' },
];

/** Build the full offer pool (cosmetics priced by rarity + consumables). */
function pool(): ShopItem[] {
  const cosmetics: ShopItem[] = CATALOGUE.filter((x) => x.source !== 'start').map((x) => ({
    id: `buy_${x.id}`,
    kind: 'cosmetic',
    ref: x.id,
    amount: 1,
    cost: COSMETIC_PRICE[x.rarity],
    currency: 'coins',
    label: x.name,
    rarity: x.rarity,
  }));
  return [...cosmetics, ...CONSUMABLES];
}

/** How many offers a day's shelf shows. */
export const SHOP_SIZE = 6;

// --- deterministic per-day seed ---------------------------------------------
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The shop shelf for a given local day (defaults to today). Deterministic: a
 * date-seeded shuffle picks {@link SHOP_SIZE} offers, always including at least
 * one consumable so chests/shards are reliably available.
 */
export function dailyOffers(dateKey: string = localDateString()): ShopItem[] {
  const rnd = mulberry32(hashStr(`shop:${dateKey}`));
  const items = pool().slice();
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  const picked = items.slice(0, SHOP_SIZE);
  if (!picked.some((x) => x.kind !== 'cosmetic')) {
    picked[picked.length - 1] = CONSUMABLES[Math.floor(rnd() * CONSUMABLES.length)];
  }
  return picked;
}

/** Spend balance of a currency if affordable; returns false if too poor. */
function spend(data: PlayerData, currency: Currency, cost: number): boolean {
  if (data[currency] < cost) return false;
  data[currency] -= cost;
  return true;
}

/** Whether an offer can be bought right now (affordable + not an owned cosmetic). */
export function canBuy(data: PlayerData, item: ShopItem): { ok: boolean; reason?: 'owned' | 'poor' } {
  if (item.kind === 'cosmetic' && isOwned(data, item.ref)) return { ok: false, reason: 'owned' };
  if (data[item.currency] < item.cost) return { ok: false, reason: 'poor' };
  return { ok: true };
}

/** The result of a purchase. */
export interface BuyResult {
  ok: boolean;
  reason?: 'owned' | 'poor' | 'unknown';
  item?: ShopItem;
}

/**
 * Buy an offer from today's shelf. Validates affordability + ownership, spends the
 * currency and grants the item (cosmetic / chest / shards). Mutates the save; the
 * caller persists. Cosmetics are one-time (then OWNED); consumables are repeatable.
 */
export function buy(data: PlayerData, itemId: string, dateKey: string = localDateString()): BuyResult {
  const item = dailyOffers(dateKey).find((x) => x.id === itemId);
  if (!item) return { ok: false, reason: 'unknown' };
  const check = canBuy(data, item);
  if (!check.ok) return { ok: false, reason: check.reason };
  if (!spend(data, item.currency, item.cost)) return { ok: false, reason: 'poor' };

  switch (item.kind) {
    case 'cosmetic':
      grantCosmetic(data, item.ref);
      break;
    case 'chest':
      if (chestDef(item.ref)) grantChest(data, item.ref, item.amount);
      break;
    case 'shards':
      data.shards[item.ref] = (data.shards[item.ref] ?? 0) + item.amount;
      break;
  }
  return { ok: true, item };
}

/** Toggle an item id on the wishlist (a convenience marker only). Returns the new state. */
export function toggleWishlist(data: PlayerData, ref: string): boolean {
  const i = data.wishlist.indexOf(ref);
  if (i >= 0) {
    data.wishlist.splice(i, 1);
    return false;
  }
  data.wishlist.push(ref);
  return true;
}

/** Is this ref on the wishlist? */
export function isWishlisted(data: PlayerData, ref: string): boolean {
  return data.wishlist.includes(ref);
}
