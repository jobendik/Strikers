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
import { createCrowdModel, EMO, type CrowdCue, type CrowdModel, type PulseLike } from '../src/audio/emotion';
import type { SimEvent } from '../src/core/bus';

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

// ---- crowd-emotion model (audio; pure — no Web Audio) --------------------------
section('crowd emotion');
{
  const P = (o: Partial<PulseLike> = {}): PulseLike => ({
    live: true, state: 'play', ballX: 0, ballY: 0, ballZ: 0, ballSpeed: 8, possession: 0,
    threat: [0, 0], score: [0, 0], timeLeft: 120, half: 1, stoppage: false, halfL: 30, halfW: 20, ...o,
  });
  const DT = 1 / 30;
  const run = (m: CrowdModel, p: PulseLike, secs: number): CrowdCue[] => {
    const cues: CrowdCue[] = [];
    for (let i = 0; i < Math.round(secs / DT); i++) cues.push(...m.update(DT, p));
    return cues;
  };
  const kinds = (c: CrowdCue[]): string[] => c.map((x) => x.kind);
  const at = { x: 20, y: 0, z: 0 };
  const shot = (team: 0 | 1, xg = 0.35): SimEvent => ({ t: 'shot', team, power: 28, xg, human: team === 0, ...at });
  const goal = (team: 0 | 1, score: [number, number], lastGasp = false, big = false): SimEvent => ({ t: 'goal', team, big, scorer: null, assist: null, score, lastGasp });
  /** A model settled into a match situation (kick-off + `secs` of calm play). */
  const settled = (o: Partial<PulseLike>, secs = 60): [CrowdModel, PulseLike] => {
    const m = createCrowdModel();
    const p = P(o);
    m.update(DT, P({ ...o, timeLeft: 120 })); // the model learns the half length from the first tick
    run(m, p, secs);
    return [m, p];
  };

  // menu: a quiet, bounded resting state
  {
    const m = createCrowdModel();
    const cues = run(m, P({ live: false, state: 'menu', timeLeft: 0 }), 20);
    near(m.state.arousal, EMO.baseMenu, 'menu arousal rests at its baseline');
    eq(cues.length, 0, 'menu: no cues');
    ok(m.mix().level < 0.4 && m.mix().cutoff < 700, 'menu bed is quiet and dull (distant)');
  }

  // anticipation: fast attack, quick (but slower) release; the attack is not instant either
  {
    const [m, p] = settled({});
    p.threat = [0.9, 0];
    let rise = 0;
    while (m.state.anticipation < 0.6 && rise < 5) { m.update(DT, p); rise += DT; }
    ok(rise > 0.05 && rise < 0.6, `anticipation attacks fast (${rise.toFixed(2)}s to 0.6)`);
    run(m, p, 2);
    ok(m.state.anticipation > 0.9 && m.state.side === 0, 'sustained home threat → high anticipation, side = home');
    p.threat = [0, 0];
    let fall = 0;
    while (m.state.anticipation > 0.3 && fall < 5) { m.update(DT, p); fall += DT; }
    ok(fall > rise && fall < 1.5, `release is quick but slower than the attack (${fall.toFixed(2)}s)`);
    run(m, p, 4);
    ok(m.state.anticipation < 0.05, 'anticipation fully released');
  }

  // held breath: the bed rises with the build-up, then DIPS when the chance is clear
  {
    const [m, p] = settled({});
    const idle = m.mix().level;
    p.threat = [0.5, 0];
    run(m, p, 4);
    const build = m.mix();
    ok(build.level > idle && build.duck < 0.05, 'build-up (threat 0.5) lifts the bed, no duck');
    p.threat = [0.95, 0];
    run(m, p, 3);
    const clear = m.mix();
    ok(clear.duck > 0.5, 'clear chance → held breath (duck > 0.5)');
    ok(clear.level < idle && clear.level < build.level, 'clear chance: bed level falls BELOW idle (not "louder with danger")');
    ok(clear.ooh > 0.8 && clear.oohRate > build.oohRate, 'the pitched "oooh" swell carries the anticipation instead');
    // away attack: fear, not glee — far less "oooh"
    const [m2, p2] = settled({});
    p2.threat = [0, 0.95];
    run(m2, p2, 3);
    ok(m2.state.side === 1 && m2.mix().ooh < clear.ooh * 0.5 && m2.mix().duck > 0.4, 'away chance: hush without the excited swell');
  }

  // a shot holds the breath until something resolves it
  {
    const [m, p] = settled({});
    const c = m.event(shot(0), p);
    ok(kinds(c).includes('ooh'), 'home shot → rising "ooh"');
    run(m, p, 0.3);
    ok(m.state.hold > 0.5 && m.state.anticipation > 0.8, 'shot in the air: breath held');
    const s = m.event({ t: 'save', team: 1, parry: true, diving: true, speed: 26, ...at }, p);
    ok(kinds(s).includes('gasp') && kinds(s).includes('groan') && !kinds(s).includes('roar'), 'away keeper saves → gasp + groan');
    const groan = s.find((x) => x.kind === 'groan')!;
    ok(groan.delay > 0.1, 'the groan follows the gasp');
    run(m, p, 1.5);
    ok(m.state.hold < 0.1, 'breath released after the save');
    // unresolved shot: lets go by itself with a sigh
    const [m3, p3] = settled({});
    m3.event(shot(0), p3);
    const later = run(m3, p3, 2.5);
    ok(kinds(later).includes('sigh') && m3.state.hold < 0.1, 'unresolved shot times out with a sigh');
    // home keeper saves → cheer + applause
    const [m4, p4] = settled({});
    m4.event(shot(1), p4);
    const hs = m4.event({ t: 'save', team: 0, parry: false, diving: true, speed: 26, ...at }, p4);
    ok(kinds(hs).includes('cheer') && kinds(hs).includes('applause') && !kinds(hs).includes('groan'), 'home keeper saves → cheer + applause');
  }

  // goals: context decides the roar
  {
    const roarOf = (o: Partial<PulseLike>, e: SimEvent): CrowdCue | undefined => {
      const [m, p] = settled(o);
      return m.event(e, p).find((x) => x.kind === 'roar');
    };
    const opener = roarOf({ half: 1, timeLeft: 100 }, goal(0, [1, 0]))!;
    const routine = roarOf({ half: 2, timeLeft: 30, score: [3, 0] }, goal(0, [4, 0]))!;
    const lateEq = roarOf({ half: 2, timeLeft: 5, score: [0, 1] }, goal(0, [1, 1]))!;
    const lastGasp = roarOf({ half: 2, timeLeft: 2, score: [1, 1], stoppage: true }, goal(0, [2, 1], true, true))!;
    const consolation = roarOf({ half: 2, timeLeft: 20, score: [0, 3] }, goal(0, [1, 3]))!;
    ok(!!opener && !!routine && !!lateEq && !!lastGasp && !!consolation, 'every home goal roars');
    ok(routine.intensity < opener.intensity && opener.intensity < lateEq.intensity, `4–0 < opener < late equaliser (${routine.intensity.toFixed(2)} < ${opener.intensity.toFixed(2)} < ${lateEq.intensity.toFixed(2)})`);
    ok(consolation.intensity < opener.intensity, 'a consolation at 0–3 is muted');
    eq(lastGasp.intensity, 1, 'last-gasp winner is maximal');
    ok(lateEq.variant === 1 && lastGasp.variant === 1 && opener.variant === 0 && routine.variant === 0, 'only late deciders are delirious');
    ok(lastGasp.dur > opener.dur + 3 && routine.dur < opener.dur, 'bigger goals roar for longer');

    // home goal aftermath
    const [m, p] = settled({ half: 2, timeLeft: 5, score: [0, 1] }, 90);
    ok(m.state.tension > 0.6 && m.state.valence < 0, 'before: 0–1 down late = tense and unhappy');
    p.score = [1, 1];
    p.state = 'celebrate';
    m.event(goal(0, [1, 1]), p);
    run(m, p, 2);
    ok(m.state.arousal > 0.8 && m.state.valence > 0.4, 'late equaliser: delirium (arousal > 0.8, valence flips positive)');
    run(m, p, 2);
    eq(m.state.mood, 'delirious', 'mood becomes delirious');

    // away goal: groan + away end, then stunned quiet
    const [a, pa] = settled({ half: 2, timeLeft: 60 });
    const before = a.mix().level;
    pa.score = [0, 1];
    pa.state = 'celebrate';
    const ac = a.event(goal(1, [0, 1]), pa);
    ok(!kinds(ac).includes('roar') && kinds(ac).includes('groan') && kinds(ac).includes('gasp'), 'away goal: the home end groans, no roar');
    const ar = ac.find((x) => x.kind === 'awayRoar');
    ok(!!ar && ar.away, 'away goal: the away end cheers');
    run(a, pa, 3);
    ok(a.state.stun > 0.5 && a.mix().level < before * 0.75, 'conceding stuns the house (bed well below its pre-goal level)');
    ok(a.state.valence < -0.4, 'valence plunges');
    pa.state = 'play';
    run(a, pa, 25);
    ok(a.state.stun < 0.05, 'the stun wears off');
  }

  // score + clock context
  {
    const [level] = settled({ half: 2, timeLeft: 6, score: [0, 0] }, 120);
    const [down2] = settled({ half: 2, timeLeft: 6, score: [0, 2] }, 120);
    const [up2] = settled({ half: 2, timeLeft: 6, score: [2, 0] }, 120);
    const [early] = settled({ half: 1, timeLeft: 110, score: [0, 0] }, 60);
    ok(level.state.tension > 0.8 && early.state.tension < 0.3, 'tension: late + level is tense, early is not');
    eq(level.state.mood, 'nervous', 'late and level → nervous');
    ok(down2.state.arousal < level.state.arousal - 0.1, '0–2 down late is flatter than 0–0 late');
    ok(down2.state.valence < -0.4 && down2.state.flat > 0.4 && down2.state.mood === 'flat', '0–2 down late: negative, flat');
    ok(down2.mix().cutoff < level.mix().cutoff && down2.mix().away > level.mix().away, 'flat house is duller; the away end is heard more');
    ok(up2.state.valence > 0.4 && up2.state.mood === 'confident', '2–0 up late: confident');
  }

  // chants: start when calm + willing, die on danger, never flutter
  {
    const [m, p] = settled({ half: 2, timeLeft: 80, score: [2, 0] }, 40);
    let guard = 0;
    while (!m.state.chanting && guard++ < 3000) m.update(DT, p);
    ok(m.state.chanting && !m.state.chantAway, 'calm + confident → a home chant starts');
    ok(m.state.chantTemplate >= 0 && m.state.chantTemplate < EMO.chantTemplates, 'valid template');
    p.threat = [0, 0.9];
    const stop = run(m, p, 1.2);
    ok(kinds(stop).includes('chantStop') && !m.state.chanting, 'danger stops the chant inside ~1 s');
    // no chant on the menu
    const idle = createCrowdModel();
    ok(!kinds(run(idle, P({ live: false, state: 'menu' }), 60)).includes('chantStart'), 'no chants on the menu');
    // hysteresis: a threat hovering on the thresholds must not make decisions flap
    const [h, ph] = settled({ half: 2, timeLeft: 80, score: [1, 0] }, 30);
    let starts = 0;
    let stops = 0;
    let moodFlips = 0;
    let sideFlips = 0;
    let mood = h.state.mood;
    let side = h.state.side;
    for (let i = 0; i < 60 * 30; i++) {
      const w = 0.04 * Math.sin(i * DT * 19); // fast jitter around the thresholds
      ph.threat = [0.52 + w, 0.5 - w];
      for (const q of h.update(DT, ph)) {
        if (q.kind === 'chantStart') starts++;
        if (q.kind === 'chantStop') stops++;
      }
      if (h.state.mood !== mood) { moodFlips++; mood = h.state.mood; }
      if (h.state.side !== side) { sideFlips++; side = h.state.side; }
    }
    ok(starts + stops <= 6, `chant decisions do not flap (${starts} starts / ${stops} stops in 60 s)`);
    ok(moodFlips <= 2, `mood does not flutter (${moodFlips} changes in 60 s)`);
    ok(sideFlips <= 2, `attacking side has hysteresis (${sideFlips} flips)`);
  }

  // density: real matches emit a turnover every ~3 s and ~100 first touches — the crowd must not react to each
  {
    const [m, p] = settled({});
    const cues: CrowdCue[] = [];
    for (let i = 0; i < 75; i++) {
      cues.push(...m.event({ t: 'turnover', team: (i % 2) as 0 | 1 }, p));
      cues.push(...m.event({ t: 'firstTouch', team: 0, quality: 0.2, human: false, ...at }, p));
      cues.push(...m.event({ t: 'collide', force: 5, ...at }, p));
      cues.push(...m.event({ t: 'kick', kind: 'pass', power: 14, team: (i % 2) as 0 | 1, human: false, ...at }, p));
      cues.push(...run(m, p, 3));
    }
    const oneShots = cues.filter((x) => x.kind !== 'chantStart' && x.kind !== 'chantStop');
    eq(oneShots.length, 0, 'routine midfield play (turnovers, touches, bumps, passes) draws no crowd one-shots');
    // …and even a burst of dramatic events is rate-limited
    const [b, pb] = settled({});
    const burst: CrowdCue[] = [];
    for (let i = 0; i < 20; i++) {
      burst.push(...b.event({ t: 'nearmiss', team: 0, ...at }, pb));
      burst.push(...run(b, pb, 0.1));
    }
    const gasps = burst.filter((x) => x.kind === 'gasp').length;
    ok(gasps >= 1 && gasps <= 3, `20 near misses in 2 s → ${gasps} gasps (rate-limited)`);
  }

  // fouls, state changes
  {
    const [m, p] = settled({});
    ok(kinds(m.event({ t: 'foul', team: 1, card: 0, player: 'x' }, p)).includes('boo'), 'foul by the away side → boos');
    const [m2, p2] = settled({});
    const j = kinds(m2.event({ t: 'foul', team: 0, card: 1, player: 'x' }, p2));
    ok(j.includes('jeer') && j.includes('boo'), 'home player booked → whistles and boos at the referee');
    const [m3, p3] = settled({ half: 1, timeLeft: 1 });
    p3.state = 'halftime';
    ok(kinds(run(m3, p3, 0.2)).includes('applause'), 'half-time → applause');
    const [w, pw] = settled({ half: 2, timeLeft: 1, score: [2, 1] });
    pw.state = 'fulltime';
    pw.live = false;
    const wc = kinds(run(w, pw, 0.2));
    ok(wc.includes('roar') && wc.includes('applause'), 'full time, won → cheer + ovation');
    const [l, pl] = settled({ half: 2, timeLeft: 1, score: [0, 1] });
    pl.state = 'fulltime';
    pl.live = false;
    const lc = run(l, pl, 0.2);
    ok(!kinds(lc).includes('roar') && lc.some((x) => x.kind === 'awayRoar' && x.away), 'full time, lost → no home roar; the away end celebrates');
    run(l, pl, 20);
    run(w, pw, 20);
    ok(l.state.arousal < 0.2 && w.state.arousal > l.state.arousal + 0.15, 'a defeat deflates the ground, a win keeps it buzzing');
    const k = createCrowdModel();
    run(k, P({ live: false, state: 'menu' }), 1);
    ok(kinds(run(k, P(), 0.1)).includes('cheer'), 'kick-off → cheer');
  }

  // determinism + bounded under fuzz
  {
    let seed = 12345;
    const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const script: Array<{ e?: SimEvent; p: PulseLike }> = [];
    const states = ['play', 'play', 'play', 'celebrate', 'halftime', 'shootout', 'fulltime', 'menu'];
    let cur = P();
    for (let i = 0; i < 4000; i++) {
      cur = { ...cur, threat: [rnd(), rnd()], ballSpeed: rnd() * 40, ballX: (rnd() - 0.5) * 60, timeLeft: Math.max(0, cur.timeLeft - DT), stoppage: rnd() < 0.05 };
      if (rnd() < 0.01) cur = { ...cur, state: states[Math.floor(rnd() * states.length)], live: rnd() < 0.8, half: rnd() < 0.5 ? 1 : 2, timeLeft: rnd() * 120, score: [Math.floor(rnd() * 5), Math.floor(rnd() * 5)] };
      let e: SimEvent | undefined;
      const r = rnd();
      const team = (rnd() < 0.5 ? 0 : 1) as 0 | 1;
      if (r < 0.03) e = shot(team, rnd());
      else if (r < 0.04) e = goal(team, [Math.floor(rnd() * 6), Math.floor(rnd() * 6)], rnd() < 0.3, rnd() < 0.3);
      else if (r < 0.06) e = { t: 'save', team, parry: rnd() < 0.5, diving: rnd() < 0.5, speed: rnd() * 40, ...at };
      else if (r < 0.07) e = { t: 'nearmiss', team, ...at };
      else if (r < 0.08) e = { t: 'post', speed: rnd() * 40, bar: rnd() < 0.5, ...at };
      else if (r < 0.1) e = { t: 'foul', team, card: Math.floor(rnd() * 3) as 0 | 1 | 2, player: 'x' };
      else if (r < 0.14) e = { t: 'tackle', team, slide: rnd() < 0.5, human: false, ...at };
      else if (r < 0.2) e = { t: 'turnover', team };
      else if (r < 0.22) e = { t: 'setpiece', kind: 'corner', team, ...at };
      else if (r < 0.24) e = { t: 'block', team, speed: 20, ...at };
      else if (r < 0.26) e = { t: 'offside', team, player: 'x' };
      else if (r < 0.4) e = { t: 'kick', kind: rnd() < 0.5 ? 'pass' : 'clear', power: 15, team, human: false, ...at };
      script.push({ e, p: cur });
    }
    let bad = 0;
    const play = (): string => {
      const m = createCrowdModel();
      const log: unknown[] = [];
      for (const st of script) {
        const cues = [...(st.e ? m.event(st.e, st.p) : []), ...m.update(DT, st.p)];
        const s = m.state;
        const mx = m.mix();
        const nums = [s.arousal, s.valence, s.anticipation, s.tension, s.hold, s.stun, s.flat, s.late, s.progress, ...Object.values(mx), ...cues.flatMap((c) => [c.intensity, c.delay, c.dur, c.variant])];
        if (nums.some((n) => !Number.isFinite(n))) bad++;
        if (s.arousal < 0 || s.arousal > 1 || s.valence < -1 || s.valence > 1 || s.anticipation < 0 || s.anticipation > 1 || s.tension < 0 || s.tension > 1 || s.hold < 0 || s.hold > 1 || s.stun < 0 || s.stun > 1) bad++;
        if (mx.level < 0 || mx.level > 2 || mx.cutoff < 300 || mx.cutoff > 8000 || mx.murmur < 0 || mx.shout < 0 || mx.ooh < 0 || mx.ooh > 1) bad++;
        if (cues.some((c) => c.intensity < 0 || c.intensity > 1 || c.delay < 0 || c.dur <= 0)) bad++;
        log.push([s.arousal, s.valence, s.mood, s.chanting, cues.map((c) => c.kind)]);
      }
      return JSON.stringify(log);
    };
    const a = play();
    const b = play();
    eq(bad, 0, 'fuzz (4000 steps, random states + events): state, mix and cues stay finite and in range');
    ok(a === b, 'deterministic: same inputs → identical outputs (no wall clock, no Math.random)');
    const g = createCrowdModel();
    g.update(NaN, P());
    g.update(-5, P());
    g.update(1e9, P());
    ok(Number.isFinite(g.state.arousal) && Number.isFinite(g.state.valence), 'NaN / negative / huge dt are tolerated');
  }
}

// ---- report -----------------------------------------------------------------
console.log(`\nunit tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
