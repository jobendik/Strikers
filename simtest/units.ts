/*
 * Headless unit tests for the pure progression / economy / meta engines.
 *
 * These modules are deliberately side-effect-light (they take plain save-shaped
 * objects and return data), so they can be exercised under Node with no DOM. This
 * suite is the durable regression gate for everything the balance sim (harness.ts)
 * does NOT cover — XP/titles, daily/weekly quests, the Season Track, the cosmetic
 * collection + shards, chests + pity, the shop, medals/mastery/achievements, the
 * live-service simulations, and save migration.
 *
 * Run:  npm run test   (esbuild bundles this for Node, then runs it)
 * It exits non-zero if any assertion fails, so CI / the dev loop catches breakage.
 */
import { grantXp, titleForLevel, xpToNext, TITLES } from '../src/core/progression';
import {
  rollDailyOrders, progressDaily, ensureToday, rerollOrder, remainingOrders, CHEST_MAX,
  progressWeekly, ensureThisWeek, rerollWeeklyOrder, weeklyRerollUsed, setQuestRng, DAILY_ORDER_COUNT,
} from '../src/game/quests';
import {
  seasonXpForTier, progressSeason, seasonStanding, ensureSeason, unlockElite,
  tierState, countClaimable, claimTier, claimAll, isClaimed, TIERS, SEASON_TIERS, SEASON_ID,
} from '../src/game/season';
import {
  grantCosmetic, equip, equippedIn, isOwned, collectionProgress, checkCompletionBonuses,
  shardValue, cosmeticById, bySlot, CATALOGUE, DEFAULT_COSMETIC,
} from '../src/game/collection';
import {
  openChest, grantChest, chestCount, totalChests, pityStatus, setChestRng, EPIC_PITY, MYTHIC_PITY, CHESTS,
} from '../src/game/chests';
import { dailyOffers, buy, canBuy, toggleWishlist, isWishlisted, SHOP_SIZE } from '../src/game/shop';
import { detectMedals, awardMatchMedals } from '../src/game/medals';
import { grantMastery, masteryStanding, MASTERY_MAX } from '../src/game/mastery';
import { checkAchievements, achievementRows, isComplete, completedCount } from '../src/game/achievements';
import { activeEvent, EVENTS } from '../src/game/events';
import { bumpWeeklyScore, weeklyLeaderboard, activityFeed, regionGoal } from '../src/game/rivals';
import { migratePlayerData, defaultPlayerData } from '../src/core/playerData';

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string): void => {
  if (c) pass++;
  else {
    fail++;
    console.error('  ✗ ' + m);
  }
};
const eq = (a: unknown, b: unknown, m: string): void => ok(Object.is(a, b), `${m} (got ${String(a)}, want ${String(b)})`);
const near = (a: number, b: number, m: string): void => ok(Math.abs(a - b) < 1e-6, `${m} (got ${a}, want ${b})`);
const section = (name: string): void => console.log(`# ${name}`);

// minimal save-shaped fixtures (only the fields the engine under test touches)
const freshSeason = () => ({ id: SEASON_ID, level: 1, xp: 0, eliteUnlocked: false, claimed: [] as number[] });
const freshData = () =>
  ({
    name: 'TESTER', flag: 'USA', level: 1, xp: 0, title: 'Rookie', coins: 0, gems: 1000,
    shards: {} as Record<string, number>, chests: {} as Record<string, number>, pity: {} as Record<string, number>,
    wishlist: [] as string[], records: {} as Record<string, number>, streak: 0, flags: {} as Record<string, boolean>,
    achievements: {} as Record<string, number>, medals: {} as Record<string, number>, mastery: {} as Record<string, number>,
    season: freshSeason(),
    stats: { played: 0, wins: 0, draws: 0, losses: 0, goals: 0, conceded: 0, cleanSheets: 0, cupsWon: 0 },
    collection: { owned: [] as string[], equipped: { kit: null, ball: null, celebration: null, trail: null, banner: null, net: null, stinger: null, title: null } },
  }) as any;
const ctx = (o: any) => ({ win: false, draw: false, loss: false, goalsFor: 0, goalsAgainst: 0, cleanSheet: false, shootoutWon: false, champion: false, onTargetFor: 0, savesFor: 0, ...o });

// ---- progression (C2/C3) ----------------------------------------------------
section('progression');
eq(xpToNext(1), 250, 'xpToNext L1');
eq(xpToNext(10), 600, 'xpToNext L10');
eq(xpToNext(40), 2200, 'xpToNext L40+');
eq(titleForLevel(1), 'Rookie', 'title L1');
eq(titleForLevel(5), 'Pro', 'title L5');
eq(titleForLevel(50), 'Legend', 'title L50');
ok(TITLES.length === 7, 'seven titles');
{
  const o = grantXp(1, 0, 250);
  eq(o.level, 2, 'grant 250 → L2');
  eq(o.levelsGained, 1, 'gained 1');
  eq(o.xpIntoLevel, 0, 'remainder 0');
}
{
  const o = grantXp(1, 0, 10_000_000);
  ok(o.level > 1 && o.levelsGained > 0 && Number.isFinite(o.level), 'huge grant terminates');
  ok(o.newTitle === 'Legend', 'huge grant reaches Legend');
}
eq(grantXp(3, 100, -50).xpIntoLevel, 100, 'negative grant clamped (no change)');

// ---- quests (E2/E3/E4) ------------------------------------------------------
section('quests');
setQuestRng(() => 0.42); // deterministic
{
  const daily = { date: '', orders: [], rerollUsed: false, chestPoints: 0, firstWin: false } as any;
  ok(ensureToday(daily, '2026-06-04'), 'ensureToday rolls on new day');
  eq(daily.orders.length, DAILY_ORDER_COUNT, 'rolled DAILY_ORDER_COUNT orders');
  ok(new Set(daily.orders.map((o: any) => o.id)).size === daily.orders.length, 'daily orders distinct');
  ok(!ensureToday(daily, '2026-06-04'), 'ensureToday idempotent same day');

  const dp = progressDaily(daily, { win: true, draw: false, loss: false, goalsFor: 3, goalsAgainst: 0, cleanSheet: true });
  ok(daily.chestPoints > 0, 'chest meter advanced');
  ok(dp.chestPoints <= CHEST_MAX, 'chest within max');

  // reroll once, then forced (ad) reroll bypasses the spent flag
  const open = daily.orders.findIndex((o: any) => !o.claimed);
  if (open >= 0) {
    ok(rerollOrder(daily, open), 'first reroll works');
    ok(daily.rerollUsed, 'reroll marked used');
    const open2 = daily.orders.findIndex((o: any) => !o.claimed);
    ok(!rerollOrder(daily, open2), 'second free reroll blocked');
    ok(rerollOrder(daily, open2, true), 'forced (ad) reroll bypasses the flag');
  }
}
{
  const weekly = { weekId: '', orders: [], activeDays: [] } as any;
  ok(ensureThisWeek(weekly, '2026-W23'), 'ensureThisWeek rolls on new week');
  const wp1 = progressWeekly(weekly, { win: true, draw: false, loss: false, goalsFor: 1, goalsAgainst: 0, cleanSheet: true }, '2026-06-01');
  eq(wp1.activeDays, 1, 'one active day');
  progressWeekly(weekly, { win: true, draw: false, loss: false, goalsFor: 1, goalsAgainst: 0, cleanSheet: false }, '2026-06-02');
  const wp3 = progressWeekly(weekly, { win: true, draw: false, loss: false, goalsFor: 1, goalsAgainst: 0, cleanSheet: false }, '2026-06-03');
  eq(wp3.activeDays, 3, 'three active days');
  ok(wp3.activityBonusAwarded, 'activity bonus at 3 days');
  ok(wp3.activityBonusXp > 0 && wp3.activityBonusCoins > 0, 'activity bonus pays');
  const wp4 = progressWeekly(weekly, { win: false, draw: true, loss: false, goalsFor: 0, goalsAgainst: 0, cleanSheet: false }, '2026-06-04');
  ok(!wp4.activityBonusAwarded, 'activity bonus only once');
  const oi = weekly.orders.findIndex((o: any) => !o.claimed);
  if (oi >= 0) {
    ok(rerollWeeklyOrder(weekly, oi), 'weekly reroll works');
    ok(weeklyRerollUsed(weekly), 'weekly reroll marked');
    const oi2 = weekly.orders.findIndex((o: any) => !o.claimed);
    ok(rerollWeeklyOrder(weekly, oi2, true), 'forced weekly reroll bypasses');
  }
}
setQuestRng(Math.random);

// ---- season (F1/F2) ---------------------------------------------------------
section('season');
eq(seasonXpForTier(1), 400, 'tier1 cost');
eq(seasonXpForTier(SEASON_TIERS), Infinity, 'cap cost = Infinity');
eq(TIERS.length, SEASON_TIERS, 'ladder length');
{
  const s = freshSeason();
  const p = progressSeason(s, 400);
  eq(p.tier, 2, 'grant 400 → tier 2');
  eq(p.tiersGained, 1, 'gained 1');
  near(p.fillFrom, 0, 'tier-up fills from empty');
  const big = progressSeason(freshSeason(), 10_000_000);
  ok(big.standing.atMax && big.tier === SEASON_TIERS, 'huge grant caps');
}
{
  const d = freshData();
  progressSeason(d.season, 400);
  eq(tierState(d.season, 1, 'free'), 'claimable', 'tier1 free claimable');
  eq(tierState(d.season, 3, 'free'), 'locked-tier', 'tier3 free locked');
  ok(!!claimTier(d, 1, 'free'), 'claim tier1 free');
  eq(claimTier(d, 1, 'free'), null, 'claim idempotent');
  eq(tierState(d.season, 1, 'elite'), 'locked-elite', 'elite locked');
  ok(unlockElite(d.season), 'unlock elite');
  eq(tierState(d.season, 1, 'elite'), 'claimable', 'elite retroactively claimable');
  ok(isClaimed(d.season, 1, 'free'), 'free claim recorded');
}
{
  const d = freshData();
  progressSeason(d.season, 400 * 5);
  unlockElite(d.season);
  const before = countClaimable(d.season);
  ok(before > 0, 'has claimable');
  eq(claimAll(d).rewards.length, before, 'claimAll grants all claimable');
  eq(countClaimable(d.season), 0, 'nothing left');
  eq(claimAll(d).rewards.length, 0, 'claimAll idempotent');
}
{
  const s = { id: 'old', level: 9, xp: 100, eliteUnlocked: true, claimed: [1, 1001] } as any;
  ok(ensureSeason(s), 'season rollover on new id');
  eq(s.level, 1, 'rollover resets level');
  eq(s.claimed.length, 0, 'rollover clears claims');
  ok(!ensureSeason(s), 'ensureSeason idempotent');
  eq(seasonStanding(s).tier, 1, 'standing after rollover');
}

// ---- collection (F3/F4) -----------------------------------------------------
section('collection');
for (const t of TIERS) {
  if (t.free.kind === 'cosmetic' || t.free.kind === 'title') ok(!!cosmeticById(t.free.id!), `season free id ${t.free.id} in catalogue`);
  if (t.elite && (t.elite.kind === 'cosmetic' || t.elite.kind === 'title')) ok(!!cosmeticById(t.elite.id!), `season elite id ${t.elite.id} in catalogue`);
}
{
  const d = freshData();
  ok(isOwned(d, 'ball_classic'), 'default owned');
  let r = grantCosmetic(d, 'ball_golden');
  ok(r.newlyOwned && r.shards === 0, 'first grant new');
  r = grantCosmetic(d, 'ball_golden');
  ok(!r.newlyOwned && r.shards === shardValue('epic'), 'dup → epic shards');
  ok(!equip(d, 'ball', 'ball_plasma'), 'cannot equip unowned');
  ok(equip(d, 'ball', 'ball_golden'), 'equip owned');
  eq(equippedIn(d, 'ball'), 'ball_golden', 'equipped resolves');
  ok(equip(d, 'ball', null), 'clear to default');
  ok(!equip(d, 'ball', 'trail_ice'), 'wrong slot rejected');
}
{
  const d = freshData();
  for (const x of CATALOGUE) grantCosmetic(d, x.id);
  const p = collectionProgress(d);
  eq(p.owned, p.total, 'own all → full');
  ok(checkCompletionBonuses(d).length >= 3, 'completion bonuses awarded');
  eq(checkCompletionBonuses(d).length, 0, 'completion bonuses idempotent');
  ok(d.flags['coll:all'], 'all-complete flag');
}
ok(bySlot('ball').every((x) => x.slot === 'ball'), 'bySlot filters');
for (const s of new Set(CATALOGUE.map((x) => x.slot))) ok(s in DEFAULT_COSMETIC, `default for slot ${s}`);

// ---- chests (F5) ------------------------------------------------------------
section('chests');
for (const def of CHESTS) near(Object.values(def.odds).reduce((a, b) => a + b, 0), 1, `${def.id} odds sum to 1`);
{
  const d = freshData();
  eq(openChest(d, 'daily'), null, 'no chest → null');
  grantChest(d, 'daily', 3);
  eq(totalChests(d), 3, 'inventory total');
  setChestRng(() => 0);
  const r = openChest(d, 'daily')!;
  ok(!!r && r.coins > 0, 'open pays coins');
  eq(chestCount(d, 'daily'), 2, 'inventory decremented');
}
{
  const d = freshData();
  grantChest(d, 'daily', 12);
  setChestRng(() => 0); // never rolls epic from odds
  let forced = -1;
  for (let i = 1; i <= EPIC_PITY; i++) if (openChest(d, 'daily')!.pityForced === 'epic') { forced = i; break; }
  eq(forced, EPIC_PITY, 'epic pity forces on the Nth open');
  eq(pityStatus(d).epicIn, EPIC_PITY, 'epic pity resets');
}
{
  const d = freshData();
  grantChest(d, 'gold', MYTHIC_PITY + 1);
  setChestRng(() => 0);
  let mythic = false;
  for (let i = 1; i <= MYTHIC_PITY; i++) if (openChest(d, 'gold')!.pityForced === 'mythic') { mythic = true; eq(i, MYTHIC_PITY, 'mythic forced on the Nth'); break; }
  ok(mythic, 'mythic pity triggers within cap');
}
setChestRng(Math.random);

// ---- shop (F6) --------------------------------------------------------------
section('shop');
eq(dailyOffers('2026-06-04').map((x) => x.id).join(), dailyOffers('2026-06-04').map((x) => x.id).join(), 'shop deterministic per day');
ok(dailyOffers('2026-06-04').map((x) => x.id).join() !== dailyOffers('2026-06-05').map((x) => x.id).join(), 'shop rotates');
for (const day of ['2026-06-04', '2026-12-25', '2027-03-09']) {
  eq(dailyOffers(day).length, SHOP_SIZE, `${day} shelf size`);
  ok(dailyOffers(day).some((x) => x.kind !== 'cosmetic'), `${day} has a consumable`);
}
{
  const d = freshData();
  d.coins = 100000;
  const day = '2026-06-04';
  const cos = dailyOffers(day).find((x) => x.kind === 'cosmetic')!;
  ok(buy(d, cos.id, day).ok, 'buy cosmetic');
  ok(isOwned(d, cos.ref), 'cosmetic owned after buy');
  eq(buy(d, cos.id, day).reason, 'owned', 'cannot rebuy owned');
  d.coins = 0;
  d.gems = 0;
  // pick a non-cosmetic (or unowned) offer so the rejection is "poor", not "owned"
  const poorOffer = dailyOffers(day).find((x) => x.kind !== 'cosmetic') ?? dailyOffers(day).find((x) => !isOwned(d, x.ref))!;
  eq(buy(d, poorOffer.id, day).reason, 'poor', 'poor rejected');
  ok(!canBuy(d, poorOffer).ok, 'canBuy false when poor');
  ok(toggleWishlist(d, 'ball_neon') && isWishlisted(d, 'ball_neon'), 'wishlist add');
  ok(!toggleWishlist(d, 'ball_neon') && !isWishlisted(d, 'ball_neon'), 'wishlist remove');
}

// ---- medals / mastery / achievements (G) ------------------------------------
section('medals/mastery/achievements');
{
  const ids = detectMedals(ctx({ win: true, goalsFor: 3, goalsAgainst: 0, cleanSheet: true })).map((m) => m.id);
  for (const id of ['first_goal', 'brace', 'hattrick', 'clean_sheet', 'no_sweat']) ok(ids.includes(id), `earn ${id}`);
  ok(detectMedals(ctx({ win: true, goalsFor: 5 })).some((m) => m.id === 'rout'), 'rout at 5');
  ok(detectMedals(ctx({ champion: true })).some((m) => m.id === 'world_champion'), 'champion medal');
  const d = freshData();
  const aw = awardMatchMedals(d, ctx({ win: true, goalsFor: 2 }));
  ok(aw.coins > 0 && d.medals.brace === 1, 'medals tallied + paid');
}
{
  const d = freshData();
  for (let i = 0; i < 40; i++) grantMastery(d, 'USA', true, false);
  const st = masteryStanding(d, 'USA');
  ok(st.level > 1 && st.level <= MASTERY_MAX, 'mastery rolls up + caps');
  grantMastery(d, 'BRAZIL', false, true);
  ok(masteryStanding(d, 'BRAZIL').totalXp > 0, 'per-nation mastery');
}
{
  const d = freshData();
  d.stats.wins = 10;
  ok(checkAchievements(d).some((a) => a.id === 'win10'), 'win10 completes');
  ok(isComplete(d, 'win10'), 'win10 recorded');
  eq(checkAchievements(d).length, 0, 'achievements idempotent');
  ok(achievementRows(d).some((r) => r.label === '???'), 'hidden masked');
  d.medals.rout = 1;
  ok(checkAchievements(d).some((a) => a.id === 'avalanche'), 'hidden unlocks');
  ok(achievementRows(d).some((r) => r.id === 'avalanche' && r.label !== '???'), 'hidden revealed');
  ok(completedCount(d) >= 2, 'completed count');
}

// ---- live service (K) -------------------------------------------------------
section('live-service');
eq(activeEvent('2026-W23').id, activeEvent('2026-W23').id, 'event deterministic');
ok(EVENTS.every((e) => e.xpMult > 1 || e.coinMult > 1), 'every event a real bonus');
{
  const d = freshData();
  const lb = weeklyLeaderboard(d);
  ok(lb.rows.some((r) => r.you) && lb.rank >= 1 && lb.rank <= lb.total, 'player placed');
  ok(!!lb.tier, 'participation tier');
  d.records.weekStamp = 1; // stale week
  bumpWeeklyScore(d, 7);
  eq(d.records.weeklyScore, 7, 'weekly score resets on new week');
  eq(activityFeed('2026-W23').map((x) => x.text).join('|'), activityFeed('2026-W23').map((x) => x.text).join('|'), 'feed deterministic');
  const g = regionGoal(d);
  ok(g.progress <= g.target && g.pct >= 0 && g.pct <= 1, 'region goal bounded');
}

// ---- save migration (C1) ----------------------------------------------------
section('playerData migration');
{
  const d = defaultPlayerData('USA');
  ok(d.flag === 'USA' && d.level === 1 && d.season.id === SEASON_ID, 'fresh save shape');
  // corrupt / partial blob heals to a valid save
  const healed = migratePlayerData({ name: 12345, level: -5, coins: 'x', daily: 'nope', collection: { owned: 'bad' }, flag: 'ATLANTIS' });
  ok(typeof healed.name === 'string', 'name coerced to string');
  ok(healed.level >= 1, 'level clamped ≥ 1');
  ok(healed.coins >= 0, 'coins coerced ≥ 0');
  ok(Array.isArray(healed.collection.owned), 'owned coerced to array');
  ok(healed.flag === 'USA', 'unknown nation healed to default');
  // additive economy fields present after migrating an old (pre-economy) save
  const old = migratePlayerData({ v: 1, name: 'OLD', level: 3 });
  ok(old.chests && old.pity && Array.isArray(old.wishlist) && old.records && typeof old.streak === 'number' && old.flags, 'additive fields healed in');
  ok(old.collection.equipped.net === null && old.collection.equipped.title === null, 'new equip slots healed in');
  // garbage in → valid default out (never throws)
  ok(migratePlayerData(null).level === 1 && migratePlayerData('💥' as any).level === 1, 'garbage → default');
}

// ---- report -----------------------------------------------------------------
console.log(`\nunit tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
