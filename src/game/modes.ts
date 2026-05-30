import { TEAMS, teamMeta } from '../config/players';
import { match } from './state';
import { returnToMenu, startMatch } from './flow';
import { refreshTeamTags, showFullTime } from '../ui/hud';
import { getSettings, saveSettings } from '../core/settings';

/*
 * Game-mode controller: team selection, the friendly/knockout one-off, and a
 * single-elimination Cup Run. Owns what happens at full time (advance the cup,
 * crown a champion, or drop back to the menu). Drawn knockout/cup ties are
 * settled by the penalty shootout (see flow.fullTime / finishShootout), which
 * then routes back here through {@link presentResult} with the winner.
 */

const ROUND_NAMES = ['ROUND OF 16', 'QUARTER-FINAL', 'SEMI-FINAL', 'FINAL'];

let cupActive = false;
let cupOpponents: string[] = [];
let cupRound = 0;
let pendingContinue = false; // the full-time button should start the next cup tie

const userTeamKey = (): string => getSettings().team;

/** A shuffled set of `n` opponent keys, excluding the user's team. */
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

/** Start a match in the current mode (the menu's KICK OFF). */
export function startGame(): void {
  const mode = getSettings().mode;
  match.settleDraws = mode !== 'friendly'; // knockout & cup must produce a winner
  if (mode === 'cup') {
    cupActive = true;
    cupRound = 0;
    cupOpponents = pickOpponents(userTeamKey(), ROUND_NAMES.length);
  } else {
    cupActive = false;
  }
  const opp = cupActive ? cupOpponents[0] : pickOpponents(userTeamKey(), 1)[0];
  configureTeams(userTeamKey(), opp);
  startMatch();
}

/** The full-time card's primary button — advance the cup tie, or return to menu. */
export function onFullTimeButton(): void {
  if (pendingContinue) {
    pendingContinue = false;
    configureTeams(userTeamKey(), cupOpponents[cupRound]);
    startMatch();
  } else {
    returnToMenu();
  }
}

/**
 * Present the full-time outcome. `penWinner` is the shootout winner when a tie
 * was settled from the spot (else null and the score decides). Resolves the cup
 * (advance / crown / knock out) or shows the plain friendly/knockout result.
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
  const penLine = penWinner !== null && penScore ? `On penalties ${penScore[0]}–${penScore[1]}  ·  ` : '';
  const stat = penLine + stats;

  if (!cupActive) {
    const result = !decided ? 'DRAW' : userWon ? `${homeName} WIN` : `${awayName} WIN`;
    pendingContinue = false;
    showFullTime(h, a, result, stat, motm, 'Full Time', 'PLAY AGAIN ▸');
    return;
  }

  // World Cup tie — the user must win to advance (a level tie is decided on penalties)
  if (!userWon) {
    cupActive = false;
    pendingContinue = false;
    showFullTime(h, a, 'KNOCKED OUT', stat, motm, `World Cup 2026 · ${ROUND_NAMES[cupRound]}`, 'BACK TO MENU ▸');
    return;
  }

  cupRound++;
  if (cupRound >= cupOpponents.length) {
    cupActive = false;
    pendingContinue = false;
    saveSettings({ titles: getSettings().titles + 1 });
    showFullTime(h, a, `${homeName} — WORLD CHAMPIONS 🏆`, stat, motm, 'World Cup 2026 · FINAL', 'BACK TO MENU ▸');
    return;
  }
  pendingContinue = true;
  const next = teamMeta(cupOpponents[cupRound]).name;
  showFullTime(h, a, 'THROUGH TO THE NEXT ROUND', stat, motm, `World Cup 2026 · into the ${ROUND_NAMES[cupRound]}`, `NEXT: ${next} ▸`);
}
