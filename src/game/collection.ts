/*
 * Cosmetic collection (F3) + shards & completion bonuses (F4).
 *
 * The single catalogue of every cosmetic in the game (kits, ball skins, goal
 * celebrations, shot trails, profile banners, net colours, goal stingers, name
 * titles) plus pure helpers to own / equip them and to convert duplicates into
 * shards. Season tiers (F1), chests (F5), the shop (F6) and achievements (G2)
 * all *grant* cosmetics through {@link grantCosmetic}, so duplicate handling and
 * completion bonuses live in exactly one place.
 *
 * Pure logic over the `collection`/`shards`/`flags` blocks of the save — no
 * storage/DOM/render. Reached only via the reward pipeline / UI / main, all of
 * which are stubbed or excluded from the headless sim, so this never enters the
 * balance bundle. Honest (retention §3): everything is earned, duplicates always
 * return value as shards, and completion is real, visible progress.
 */
import type { PlayerData } from '../core/playerData';
import type { Rarity } from './season';

/** Equippable cosmetic slots (mirrors EquippedCosmetics keys). */
export type Slot = 'kit' | 'ball' | 'celebration' | 'trail' | 'banner' | 'net' | 'stinger' | 'title';

/** Where a cosmetic can be obtained (shown in the album for an honest source trail). */
export type Source = 'season' | 'season-elite' | 'chest' | 'shop' | 'achievement' | 'start';

/** One catalogue entry. */
export interface Cosmetic {
  id: string;
  name: string;
  slot: Slot;
  rarity: Rarity;
  source: Source;
}

const c = (id: string, name: string, slot: Slot, rarity: Rarity, source: Source): Cosmetic => ({ id, name, slot, rarity, source });

/**
 * The cosmetic catalogue. Every id the Season Track (`game/season.ts`) grants is
 * present here so it resolves to a real album entry; chests/shop/achievements
 * draw from the wider pool. Default ("Classic") entries per slot are owned from
 * the start so a slot always has something equipped.
 */
export const CATALOGUE: Cosmetic[] = [
  // --- kits (alternate national strips) ---
  c('kit_classic', 'Classic kit', 'kit', 'common', 'start'),
  c('kit_away', 'Away kit', 'kit', 'common', 'shop'),
  c('kit_third_gold', 'Third kit — Gold', 'kit', 'rare', 'shop'),
  c('kit_retro', 'Retro ’94 kit', 'kit', 'epic', 'chest'),
  c('kit_blackout', 'Blackout kit', 'kit', 'epic', 'shop'),
  c('kit_holographic', 'Holographic kit', 'kit', 'mythic', 'chest'),
  // --- ball skins ---
  c('ball_classic', 'Classic ball', 'ball', 'common', 'start'),
  c('ball_classic26', 'Classic ’26 ball', 'ball', 'rare', 'season-elite'),
  c('ball_golden', 'Golden Boot ball', 'ball', 'epic', 'season-elite'),
  c('ball_carbon', 'Carbon ball', 'ball', 'epic', 'season'),
  c('ball_neon', 'Neon ball', 'ball', 'rare', 'shop'),
  c('ball_plasma', 'Plasma ball', 'ball', 'mythic', 'season-elite'),
  c('ball_trophy', 'Trophy ball', 'ball', 'mythic', 'season-elite'),
  // --- goal celebrations ---
  c('cele_classic', 'Classic celebration', 'celebration', 'common', 'start'),
  c('cele_knee_slide', 'Knee-slide celebration', 'celebration', 'rare', 'season'),
  c('cele_backflip', 'Backflip celebration', 'celebration', 'epic', 'season-elite'),
  c('cele_robot', 'Robot celebration', 'celebration', 'epic', 'season-elite'),
  c('cele_somersault', 'Somersault celebration', 'celebration', 'epic', 'season'),
  c('cele_worm', 'The Worm celebration', 'celebration', 'epic', 'season-elite'),
  c('cele_calm', 'Ice-cold celebration', 'celebration', 'rare', 'chest'),
  // --- shot trails (the ball trail is already a feature — make variants cosmetic) ---
  c('trail_classic', 'Classic trail', 'trail', 'common', 'start'),
  c('trail_emerald', 'Emerald shot trail', 'trail', 'rare', 'season-elite'),
  c('trail_magenta', 'Magenta shot trail', 'trail', 'epic', 'season-elite'),
  c('trail_ice', 'Ice shot trail', 'trail', 'rare', 'season'),
  c('trail_aurora', 'Aurora shot trail', 'trail', 'mythic', 'season-elite'),
  c('trail_phoenix', 'Phoenix shot trail', 'trail', 'mythic', 'season'),
  c('trail_mono', 'Mono shot trail', 'trail', 'common', 'shop'),
  // --- profile banners ---
  c('banner_classic', 'Classic banner', 'banner', 'common', 'start'),
  c('banner_host26', 'Host Nation banner', 'banner', 'rare', 'season'),
  c('banner_knockout', 'Knockout Run banner', 'banner', 'epic', 'season-elite'),
  c('banner_finalist', 'Finalist banner', 'banner', 'mythic', 'season-elite'),
  c('banner_streak', 'Win-Streak banner', 'banner', 'epic', 'achievement'),
  // --- net colours ---
  c('net_classic', 'Classic net', 'net', 'common', 'start'),
  c('net_neon', 'Neon net', 'net', 'rare', 'season-elite'),
  c('net_gold', 'Gold net', 'net', 'epic', 'season-elite'),
  c('net_rainbow', 'Rainbow net', 'net', 'epic', 'season-elite'),
  // --- goal stingers (sound) ---
  c('stinger_classic', 'Classic stinger', 'stinger', 'common', 'start'),
  c('stinger_brass', 'Brass-band stinger', 'stinger', 'rare', 'shop'),
  c('stinger_stadium', 'Stadium-roar stinger', 'stinger', 'epic', 'chest'),
  // --- name titles (cosmetic flair; distinct from the level title) ---
  c('title_qualified', 'Qualified', 'title', 'epic', 'season'),
  c('title_finalist', 'Finalist', 'title', 'epic', 'season'),
  c('title_champion26', 'Champion ’26', 'title', 'mythic', 'season'),
  c('title_centurion', 'Centurion', 'title', 'epic', 'achievement'),
];

const BY_ID = new Map(CATALOGUE.map((x) => [x.id, x]));

/** Default cosmetic per slot — owned from the start, equipped if nothing else is. */
export const DEFAULT_COSMETIC: Record<Slot, string> = {
  kit: 'kit_classic',
  ball: 'ball_classic',
  celebration: 'cele_classic',
  trail: 'trail_classic',
  banner: 'banner_classic',
  net: 'net_classic',
  stinger: 'stinger_classic',
  title: '', // no default title (falls back to the level title)
};

/** Shard value of a duplicate, by rarity (F4). */
const SHARD_VALUE: Record<Rarity, number> = { common: 5, rare: 15, epic: 40, mythic: 120 };

export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'mythic'];

/** Look up a cosmetic by id. */
export function cosmeticById(id: string): Cosmetic | undefined {
  return BY_ID.get(id);
}

/** All cosmetics in a slot. */
export function bySlot(slot: Slot): Cosmetic[] {
  return CATALOGUE.filter((x) => x.slot === slot);
}

/** Is the cosmetic owned (defaults count as owned)? */
export function isOwned(data: PlayerData, id: string): boolean {
  return id === DEFAULT_COSMETIC[cosmeticById(id)?.slot ?? 'kit'] || data.collection.owned.includes(id);
}

/** The shard reward for a duplicate of `rarity`. */
export function shardValue(rarity: Rarity): number {
  return SHARD_VALUE[rarity];
}

/** Outcome of granting a cosmetic. */
export interface GrantResult {
  id: string;
  name: string;
  rarity: Rarity;
  /** First time owned (vs a duplicate). */
  newlyOwned: boolean;
  /** Shards paid for a duplicate (0 if newly owned). */
  shards: number;
}

/**
 * Grant a cosmetic into the collection. A new cosmetic is added to `owned`; a
 * duplicate is converted to shards of its rarity (F4). Mutates the save; the
 * caller persists. Unknown ids are treated as common (still pay shards rather
 * than vanish). Returns what happened for the reveal UI.
 */
export function grantCosmetic(data: PlayerData, id: string): GrantResult {
  const def = cosmeticById(id);
  const rarity: Rarity = def?.rarity ?? 'common';
  const name = def?.name ?? id;
  if (!isOwned(data, id)) {
    data.collection.owned.push(id);
    return { id, name, rarity, newlyOwned: true, shards: 0 };
  }
  const s = shardValue(rarity);
  data.shards[rarity] = (data.shards[rarity] ?? 0) + s;
  return { id, name, rarity, newlyOwned: false, shards: s };
}

/**
 * Equip a cosmetic into its slot if it's owned. `id` may be a default (always
 * allowed) or null to clear back to default. Returns true if the equip changed.
 */
export function equip(data: PlayerData, slot: Slot, id: string | null): boolean {
  if (id && id !== DEFAULT_COSMETIC[slot]) {
    if (cosmeticById(id)?.slot !== slot) return false; // wrong slot
    if (!isOwned(data, id)) return false; // not owned
  }
  const next = id && id !== DEFAULT_COSMETIC[slot] ? id : null;
  if (data.collection.equipped[slot] === next) return false;
  data.collection.equipped[slot] = next;
  return true;
}

/** The id equipped in a slot (resolving null → the slot default). */
export function equippedIn(data: PlayerData, slot: Slot): string {
  return data.collection.equipped[slot] || DEFAULT_COSMETIC[slot];
}

/** Album progress for the UI / completion checks. */
export interface CollectionProgress {
  owned: number;
  total: number;
  byRarity: Record<Rarity, { owned: number; total: number }>;
  bySlot: Partial<Record<Slot, { owned: number; total: number }>>;
}

/** Count owned vs total overall, per rarity and per slot (defaults count as owned). */
export function collectionProgress(data: PlayerData): CollectionProgress {
  const byRarity = Object.fromEntries(RARITY_ORDER.map((r) => [r, { owned: 0, total: 0 }])) as CollectionProgress['byRarity'];
  const bySlot: CollectionProgress['bySlot'] = {};
  let owned = 0;
  for (const x of CATALOGUE) {
    const has = isOwned(data, x.id);
    byRarity[x.rarity].total++;
    if (has) byRarity[x.rarity].owned++;
    const s = (bySlot[x.slot] ??= { owned: 0, total: 0 });
    s.total++;
    if (has) s.owned++;
    if (has) owned++;
  }
  return { owned, total: CATALOGUE.length, byRarity, bySlot };
}

/** A completion bonus the player can earn by finishing a set (F4). */
export interface CompletionBonus {
  id: string;
  label: string;
  coins: number;
  /** Cosmetic/title id awarded as the badge (optional). */
  reward?: string;
  /** True once every cosmetic in the set is owned. */
  done: (p: CollectionProgress) => boolean;
}

const COMPLETION_BONUSES: CompletionBonus[] = [
  { id: 'common', label: 'Own every Common cosmetic', coins: 200, done: (p) => p.byRarity.common.owned >= p.byRarity.common.total },
  { id: 'balls', label: 'Collect every ball skin', coins: 250, reward: 'banner_streak', done: (p) => (p.bySlot.ball?.owned ?? 0) >= (p.bySlot.ball?.total ?? 1) },
  { id: 'trails', label: 'Collect every shot trail', coins: 250, done: (p) => (p.bySlot.trail?.owned ?? 0) >= (p.bySlot.trail?.total ?? 1) },
  { id: 'all', label: 'Complete the whole collection', coins: 1000, reward: 'title_champion26', done: (p) => p.owned >= p.total },
];

/** A completion bonus paid out this check. */
export interface AwardedBonus {
  id: string;
  label: string;
  coins: number;
  reward?: string;
}

/**
 * Award any newly-completed set bonuses (idempotent — each pays once, tracked in
 * `flags`). Mutates the save (coins + any badge cosmetic); the caller persists.
 */
export function checkCompletionBonuses(data: PlayerData): AwardedBonus[] {
  const p = collectionProgress(data);
  const out: AwardedBonus[] = [];
  for (const b of COMPLETION_BONUSES) {
    const flag = `coll:${b.id}`;
    if (data.flags[flag]) continue;
    if (!b.done(p)) continue;
    data.flags[flag] = true;
    data.coins += b.coins;
    if (b.reward) grantCosmetic(data, b.reward);
    out.push({ id: b.id, label: b.label, coins: b.coins, reward: b.reward });
  }
  return out;
}

/** The completion-bonus catalogue (for the album's progress panel). */
export function completionBonuses(): CompletionBonus[] {
  return COMPLETION_BONUSES;
}
