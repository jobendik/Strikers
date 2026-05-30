import { TEAMS, teamMeta } from '../config/players';
import { match } from './state';
import { returnToMenu, startMatch } from './flow';
import { refreshTeamTags } from '../ui/hud';
import { showResultScreen, type ResultScreenData, type ResultStat, type ResultChip, type ResultBar } from '../ui/resultScreen';
import { getSettings, saveSettings } from '../core/settings';
import { applyMatchRewards, type MatchRewards } from './rewards';
import { getPlayerData, savePlayerData } from '../core/playerData';
import {
  startOrResumeRun,
  userFixture,
  opponentOf,
  playUserMatchday,
  roundName,
  type WorldCupRun,
  type MatchdayOutcome,
} from './worldcup';
import { refreshWorldCupUI } from '../ui/worldcup';
import { refreshDailyCard } from '../ui/daily';
import { refreshProfileCard } from '../ui/profile';

/*
 * Game-mode controller: team selection, the friendly/knockout one-off, and the
 * living World Cup tournament. Owns what happens at full time — for the World Cup
 * it feeds the result into the tournament engine (`game/worldcup.ts`), which
 * resolves the rest of the field and advances the bracket, then shows the next
 * fixture / knock-out / trophy. Drawn knockout ties are settled by the penalty
 * shootout (flow.fullTime / finishShootout), routed back here via presentResult.
 */

/** The active World Cup run while the user is playing the tournament. */
let wcRun: WorldCupRun | null = null;
/** The full-time button should kick off the next World Cup fixture. */
let pendingContinue = false;

const userTeamKey = (): string => getSettings().team;

/** A shuffled set of `n` opponent keys, excluding the user's team (friendly/KO). */
function pickOpponents(exclude: string, n: number): string[] {
  const pool = TEAMS.map((t) => t.key).filter((k) => k !== exclude);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

/** Euclidean RGB distance between two #rrggbb kit colours (0–441). */
function kitDistance(a: string, b: string): number {
  const v = (h: string): [number, number, number] => {
    const n = parseInt(h.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const [r1, g1, b1] = v(a);
  const [r2, g2, b2] = v(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

/** A neutral away strip that contrasts the home kit (dark vs a light home, else light). */
function contrastKit(home: string): string {
  const n = parseInt(home.replace('#', ''), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 140 ? '#222a33' : '#eef2f7';
}

/** Re-skin the two teams for a fixture and refresh the scoreboard. */
function configureTeams(homeKey: string, awayKey: string): void {
  match.teams[0].setIdentity(homeKey);
  match.teams[1].setIdentity(awayKey);
  // if the two nations' kits are too close to tell apart, the away side changes strip
  if (kitDistance(match.teams[0].color, match.teams[1].color) < 90) {
    match.teams[1].setKitColor(contrastKit(match.teams[0].color));
  }
  match.teams[0].mentality = getSettings().mentality; // keep the user's chosen approach
  refreshTeamTags();
}

/**
 * Kick off the user's fixture for the World Cup run's current matchday. The user
 * always plays as the home side (team[0]); group draws stand, knockout ties go to
 * a shootout. Returns false if there's no playable fixture (run over for the user).
 */
function startWorldCupFixture(run: WorldCupRun): boolean {
  const f = userFixture(run, run.matchday);
  if (!f) return false;
  match.settleDraws = f.round !== 'GROUP'; // only knockout ties must produce a winner
  configureTeams(run.userNation, opponentOf(f, run.userNation));
  startMatch();
  return true;
}

/** Start a match in the current mode (the menu's KICK OFF). */
export function startGame(): void {
  const mode = getSettings().mode;

  if (mode === 'cup') {
    wcRun = startOrResumeRun(userTeamKey());
    if (startWorldCupFixture(wcRun)) return;
    // no playable fixture (shouldn't happen for a fresh/resumed run) — start anew
    wcRun = startOrResumeRun(userTeamKey());
    if (startWorldCupFixture(wcRun)) return;
  }

  // friendly / knockout one-off
  wcRun = null;
  match.settleDraws = mode === 'knockout';
  configureTeams(userTeamKey(), pickOpponents(userTeamKey(), 1)[0]);
  startMatch();
}

/** The full-time card's primary button — next World Cup fixture, or back to menu. */
export function onFullTimeButton(): void {
  if (pendingContinue && wcRun) {
    pendingContinue = false;
    if (startWorldCupFixture(wcRun)) return;
  }
  pendingContinue = false;
  refreshWorldCupUI(); // freshen the menu banner / tournament screen on the way back
  returnToMenu();
}

/** The full-time card's secondary button — always returns to the menu (D4 exit). */
export function onResultMenu(): void {
  pendingContinue = false;
  refreshWorldCupUI(); // freshen the menu banner / tournament screen on the way back
  returnToMenu();
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Possession as whole-percent shares of the two teams (defaults to 50–50). */
function possessionPct(): [number, number] {
  const [a, b] = match.stats.possession;
  const tot = a + b;
  if (tot < 1) return [50, 50];
  const pa = Math.round((a / tot) * 100);
  return [pa, 100 - pa];
}

/** The per-team stat grid for the result screen (D1). */
function statTiles(): ResultStat[] {
  const s = match.stats;
  const [pa, pb] = possessionPct();
  return [
    { label: 'Possession', home: `${pa}%`, away: `${pb}%` },
    { label: 'Shots', home: `${s.shots[0]}`, away: `${s.shots[1]}` },
    { label: 'On Target', home: `${s.onTarget[0]}`, away: `${s.onTarget[1]}` },
    { label: 'Saves', home: `${s.saves[0]}`, away: `${s.saves[1]}` },
    { label: 'Tackles', home: `${s.tackles[0]}`, away: `${s.tackles[1]}` },
  ];
}

/** 1–3 performance stars from result + goals + clean sheet (D1). */
function computeStars(o: {
  result: 'win' | 'draw' | 'loss';
  goalsFor: number;
  goalsAgainst: number;
  cleanSheet: boolean;
  champion: boolean;
}): number {
  if (o.champion) return 3;
  let s = o.result === 'win' ? 2 : 1;
  if (o.cleanSheet && o.result !== 'loss') s += 1;
  if (o.goalsFor >= 3 || o.goalsFor - o.goalsAgainst >= 3) s += 1;
  if (o.result === 'loss') s = o.goalsFor >= 2 ? 2 : 1; // fought back in defeat
  return Math.max(1, Math.min(3, s));
}

/** Reward pills, revealed in sequence (D3): XP → coins → bonuses. */
function rewardChips(r: MatchRewards): ResultChip[] {
  const chips: ResultChip[] = [
    { text: `+${r.xp.total} XP`, tone: 'xp' },
    { text: `+${r.coins} coins`, tone: 'coin' },
  ];
  if (r.firstMatchOfDay) chips.push({ text: 'First match of day', tone: 'bonus' });
  if (r.firstWinOfDay) chips.push({ text: 'First-win bonus', tone: 'bonus' });
  return chips;
}

/** The animated progress stack (D2): account XP, daily chest, daily orders. */
function rewardBars(r: MatchRewards): ResultBar[] {
  const bars: ResultBar[] = [];
  const xpTo = r.xpForNext > 0 ? r.xpIntoLevel / r.xpForNext : 0;
  // when a level was gained the final bar fills from empty; otherwise from the
  // pre-grant fill so the player sees this match's XP land.
  const xpFrom = r.levelsGained > 0 || r.xpForNext <= 0 ? 0 : (r.xpIntoLevel - r.xp.total) / r.xpForNext;
  bars.push({
    label: `Level ${r.level}`,
    from: clamp01(xpFrom),
    to: clamp01(xpTo),
    text: `${r.xpIntoLevel} / ${r.xpForNext} XP`,
    badge: r.levelsGained > 0 ? (r.newTitle ? `LEVEL UP → ${r.newTitle}` : 'LEVEL UP') : undefined,
    tone: 'xp',
    done: r.levelsGained > 0,
  });

  const d = r.daily;
  bars.push({
    label: 'Daily chest',
    from: clamp01(d.chestBefore / d.chestMax),
    to: d.chestAwarded ? 1 : clamp01(d.chestPoints / d.chestMax),
    text: d.chestAwarded ? `Filled · ${d.chestPoints}% carried` : `${d.chestPoints}%`,
    badge: d.chestAwarded ? 'CHEST!' : undefined,
    tone: 'chest',
    done: d.chestAwarded,
  });

  for (const o of d.orders) {
    bars.push({
      label: o.label,
      from: 0,
      to: o.target > 0 ? clamp01(o.progress / o.target) : 0,
      text: `${Math.min(o.progress, o.target)} / ${o.target}`,
      tone: 'order',
      done: o.done,
    });
  }
  return bars;
}

/** Show the World Cup result via the animated Result Screen (D). */
function presentWorldCupResult(
  o: MatchdayOutcome,
  h: number,
  a: number,
  decided: boolean,
  userWon: boolean,
  rewards: MatchRewards,
  motm: string,
  penLine: string | undefined,
): void {
  const ctxRound = roundName(o.roundJustPlayed);
  const kicker = o.roundJustPlayed === 'GROUP'
    ? `World Cup 2026 · Group Stage · Matchday ${o.matchdayJustPlayed}`
    : `World Cup 2026 · ${ctxRound}`;
  const nextName = o.nextOpponent ? teamMeta(o.nextOpponent).name : '';
  const nextBtn = o.nextOpponent ? `NEXT: ${nextName} ▸` : 'BACK TO MENU ▸';

  let headline: string;
  let tone: ResultScreenData['tone'];
  switch (o.status) {
    case 'champion':
      headline = `${match.teams[0].fullName} — WORLD CHAMPIONS 🏆`;
      tone = 'champion';
      break;
    case 'knocked-out':
      headline = 'KNOCKED OUT';
      tone = 'loss';
      break;
    case 'group-out':
      headline = 'GROUP STAGE EXIT';
      tone = 'loss';
      break;
    case 'group-through':
      headline = 'THROUGH TO THE KNOCKOUTS';
      tone = 'win';
      break;
    case 'advanced':
      headline = o.nextRound ? `INTO THE ${roundName(o.nextRound).toUpperCase()}` : 'THROUGH';
      tone = 'win';
      break;
    default: // group-continue
      headline = !decided ? 'MATCHDAY DRAWN' : userWon ? 'MATCHDAY WIN' : 'MATCHDAY DEFEAT';
      tone = !decided ? 'draw' : userWon ? 'win' : 'loss';
  }

  const advancing = o.status === 'group-continue' || o.status === 'group-through' || o.status === 'advanced';
  pendingContinue = advancing && !!o.nextOpponent;

  if (o.status === 'champion') {
    // record the trophy (settings cup count + career stat)
    saveSettings({ titles: getSettings().titles + 1 });
    getPlayerData().stats.cupsWon++;
    savePlayerData();
  }

  const result: 'win' | 'draw' | 'loss' = !decided ? 'draw' : userWon ? 'win' : 'loss';
  const stars = computeStars({ result, goalsFor: h, goalsAgainst: a, cleanSheet: a === 0, champion: o.status === 'champion' });

  showResultScreen({
    kicker,
    headline,
    tone,
    homeScore: h,
    awayScore: a,
    penLine,
    stars,
    motm,
    stats: statTiles(),
    chips: rewardChips(rewards),
    bars: rewardBars(rewards),
    nextBest: rewards.daily.nextBest,
    primaryLabel: pendingContinue ? nextBtn : 'BACK TO MENU ▸',
    secondaryLabel: pendingContinue ? 'MENU' : '',
  });
  refreshWorldCupUI(); // run has advanced — keep the banner/screen in sync
}

/**
 * Present the full-time outcome. `penWinner` is the shootout winner when a tie was
 * settled from the spot (else null and the score decides). Routes to the World Cup
 * tournament engine, or shows the plain friendly/knockout result.
 */
export function presentResult(
  penWinner: number | null,
  penScore: [number, number] | null,
  _stats: string,
  motm: string,
): void {
  const [h, a] = match.score;
  const userWon = penWinner !== null ? penWinner === 0 : h > a;
  const decided = penWinner !== null || h !== a;

  // Match reward pipeline (C2): every completed match grants XP/coins and rolls
  // the account level/title. Runs here (the result-screen owner), which is stubbed
  // out of the headless balance harness, so it never fires during balance sims.
  const rewards = applyMatchRewards({
    win: decided && userWon,
    loss: decided && !userWon,
    draw: !decided,
    goalsFor: h,
    goalsAgainst: a,
  });

  const penLine = penWinner !== null && penScore ? `On penalties ${penScore[0]}–${penScore[1]}` : undefined;
  refreshDailyCard(); // the match advanced today's orders/chest — keep the menu card fresh
  refreshProfileCard(); // XP/level/title/stats moved — keep the menu profile fresh (C4)

  // World Cup tournament — feed the result into the engine and advance the bracket
  if (getSettings().mode === 'cup' && wcRun) {
    const penUserWon = penWinner === null ? null : penWinner === 0;
    const outcome = playUserMatchday(wcRun, h, a, penUserWon);
    presentWorldCupResult(outcome, h, a, decided, userWon, rewards, motm, penLine);
    return;
  }

  // friendly / knockout one-off
  pendingContinue = false;
  const result: 'win' | 'draw' | 'loss' = !decided ? 'draw' : userWon ? 'win' : 'loss';
  let headline: string;
  let tone: ResultScreenData['tone'];
  if (penWinner !== null) {
    headline = userWon ? 'SHOOTOUT HERO' : 'SHOOTOUT DEFEAT';
    tone = userWon ? 'win' : 'loss';
  } else if (!decided) {
    headline = 'DRAW';
    tone = 'draw';
  } else if (userWon) {
    headline = 'VICTORY';
    tone = 'win';
  } else {
    headline = 'DEFEAT';
    tone = 'loss';
  }
  const stars = computeStars({ result, goalsFor: h, goalsAgainst: a, cleanSheet: a === 0, champion: false });
  const kicker = getSettings().mode === 'knockout' ? 'Knockout · Full Time' : 'Friendly · Full Time';

  showResultScreen({
    kicker,
    headline,
    tone,
    homeScore: h,
    awayScore: a,
    penLine,
    stars,
    motm,
    stats: statTiles(),
    chips: rewardChips(rewards),
    bars: rewardBars(rewards),
    nextBest: rewards.daily.nextBest,
    primaryLabel: 'PLAY AGAIN ▸',
    secondaryLabel: '',
  });
}
