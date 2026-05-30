import { TEAMS, teamMeta } from '../config/players';
import { match } from './state';
import { returnToMenu, startMatch } from './flow';
import { refreshTeamTags, showFullTime } from '../ui/hud';
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

/** A compact progress note for the result card (the full animated Result Screen
 *  is D). Honest, immediate XP/level/coins + daily progress + next-best-action. */
function rewardLine(r: MatchRewards): string {
  const parts = [`+${r.xp.total} XP`, `Lv ${r.level} · ${r.xpIntoLevel}/${r.xpForNext}`, `+${r.coins} coins`];
  if (r.levelsGained > 0) parts.push(r.newTitle ? `LEVEL UP → ${r.newTitle}!` : 'LEVEL UP!');
  for (const c of r.daily.completed) parts.push(`✓ ${c}`);
  parts.push(`Daily chest ${r.daily.chestPoints}%${r.daily.chestAwarded ? ' — CHEST!' : ''}`);
  if (r.daily.nextBest) parts.push(r.daily.nextBest);
  return parts.join('  ·  ');
}

/** The World Cup result card: headline + context + button driven by the outcome. */
function presentWorldCupResult(
  o: MatchdayOutcome,
  h: number,
  a: number,
  decided: boolean,
  userWon: boolean,
  stat: string,
  motm: string,
  reward: string,
): void {
  const ctxRound = roundName(o.roundJustPlayed);
  const ctx = o.roundJustPlayed === 'GROUP'
    ? `World Cup 2026 · Group Stage · Matchday ${o.matchdayJustPlayed}`
    : `World Cup 2026 · ${ctxRound}`;
  const nextName = o.nextOpponent ? teamMeta(o.nextOpponent).name : '';
  const nextBtn = o.nextOpponent ? `NEXT: ${nextName} ▸` : 'BACK TO MENU ▸';

  let headline: string;
  switch (o.status) {
    case 'champion':
      headline = `${match.teams[0].fullName} — WORLD CHAMPIONS 🏆`;
      break;
    case 'knocked-out':
      headline = 'KNOCKED OUT';
      break;
    case 'group-out':
      headline = 'GROUP STAGE EXIT';
      break;
    case 'group-through':
      headline = 'THROUGH TO THE KNOCKOUTS';
      break;
    case 'advanced':
      headline = o.nextRound ? `INTO THE ${roundName(o.nextRound).toUpperCase()}` : 'THROUGH';
      break;
    default: // group-continue
      headline = !decided ? 'MATCHDAY DRAWN' : userWon ? 'MATCHDAY WIN' : 'MATCHDAY DEFEAT';
  }

  const advancing = o.status === 'group-continue' || o.status === 'group-through' || o.status === 'advanced';
  pendingContinue = advancing && !!o.nextOpponent;

  if (o.status === 'champion') {
    // record the trophy (settings cup count + career stat)
    saveSettings({ titles: getSettings().titles + 1 });
    getPlayerData().stats.cupsWon++;
    savePlayerData();
  }

  showFullTime(h, a, headline, stat, motm, ctx, pendingContinue ? nextBtn : 'BACK TO MENU ▸', reward);
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
  stats: string,
  motm: string,
): void {
  const [h, a] = match.score;
  const homeName = match.teams[0].fullName;
  const awayName = match.teams[1].fullName;
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

  const penLine = penWinner !== null && penScore ? `On penalties ${penScore[0]}–${penScore[1]}  ·  ` : '';
  const stat = `${penLine}${stats}`;
  const reward = rewardLine(rewards);
  refreshDailyCard(); // the match advanced today's orders/chest — keep the menu card fresh

  // World Cup tournament — feed the result into the engine and advance the bracket
  if (getSettings().mode === 'cup' && wcRun) {
    const penUserWon = penWinner === null ? null : penWinner === 0;
    const outcome = playUserMatchday(wcRun, h, a, penUserWon);
    presentWorldCupResult(outcome, h, a, decided, userWon, stat, motm, reward);
    return;
  }

  // friendly / knockout one-off
  pendingContinue = false;
  const result = !decided ? 'DRAW' : userWon ? `${homeName} WIN` : `${awayName} WIN`;
  showFullTime(h, a, result, stat, motm, 'Full Time', 'PLAY AGAIN ▸', reward);
}
