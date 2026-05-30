import { CFG } from '../config/constants';
import { Audio } from '../core/audio';
import { Haptics } from '../core/haptics';
import { ball, freshStats, match, setReceiver, teamIndex } from './state';
import { setControl } from './control';
import { startShootout } from './penalty';
import { resetReplayBuffer } from './replay';
import { attackHeading } from '../ai/analysis';
import type { Player } from '../entities/Player';
import { addShake, clearTrail } from './render';
import {
  flashToast,
  setFullTimeVisible,
  setHalfTimeVisible,
  setMenuVisible,
  showFullTime,
  showHalfTime,
  showGoalFx,
  updateHUD,
} from '../ui/hud';

/** Which team kicked off the first half — the other team kicks off the second. */
let firstHalfKicker = 0;

/**
 * Accrue added time for the current half (a goal or stoppage in play). Capped at
 * `CFG.stoppageMax`. If we're already playing added time, extend it a little too.
 */
export function addStoppage(seconds: number): void {
  if (match.state === 'menu' || match.state === 'fulltime') return;
  match.stoppageAccrued = Math.min(CFG.stoppageMax, match.stoppageAccrued + seconds);
  if (match.stoppageLeft > 0) match.stoppageLeft = Math.min(CFG.stoppageMax, match.stoppageLeft + seconds * 0.5);
}

/** Register a goal for team `i` (0 = home) and start the celebration. */
export function scoreGoal(i: number): void {
  match.score[i]++;
  addStoppage(CFG.stoppagePerGoal);
  match.stats.onTarget[i]++;
  // credit the scorer (last toucher of the scoring team) and, if the prior pass
  // came from a team-mate, the assist — both feed the Man-of-the-Match rating.
  const scorer = ball.lastKicker && teamIndex(ball.lastKicker.team) === i ? ball.lastKicker : null;
  if (scorer) {
    scorer.statGoals++;
    if (ball.passer && ball.passer !== scorer && teamIndex(ball.passer.team) === i) ball.passer.statAssists++;
  }
  updateHUD();
  Audio.whistle();
  Audio.goal();
  Audio.roar(true);
  Haptics.goal();
  showGoalFx(i);
  addShake(1.2); // the net ripples — punch the camera
  match.controlPlayer = null;
  match.controlTeam = null;
  setReceiver(null);
  match.state = 'celebrate';
  match.celebrateT = 2.2;
  match.celebrateBallT = 0.7; // keep the ball flying into the net in slow motion
  match.timeScale = CFG.goalSlowmo;
  match.scoredBy = i;
  flashToast(scorer ? `${scorer.name} SCORES!` : `${match.teams[i].name} SCORE!`);
}

/** Reset all entities to their home positions for a restart. */
export function resetPositions(): void {
  for (const t of match.teams) {
    t.inAttack = false;
    t.bestSpot = null;
    for (const p of t.players) {
      if (p.sentOff) continue; // a dismissed player stays off the pitch
      const h = p.homePos();
      p.position.set(h.x, 0, h.z);
      p.velocity.set(0, 0, 0);
      p.heading = attackHeading(t.side);
      p.deact();
      p.pressure = 0;
      p.slide = 0;
      p.slideCd = 0;
      p.dive = 0;
      p.diveCd = 0;
      p.separation.active = false;
      p.neighbors.length = 0;
      p.mesh.rotation.x = 0;
      p.fsm.currentState = null; // force a fresh state on next tick
    }
  }
  ball.position.set(0, CFG.ballR, 0);
  ball.velocity.set(0, 0, 0);
  ball.spin = 0;
  ball.lastTouch = null;
  ball.lastKicker = null;
  ball.passer = null;
  setReceiver(null);
  match.timeScale = 1;
  match.celebrateBallT = 0;
  clearTrail();
}

/** Kick off for `team`. */
export function kickOff(team: (typeof match.teams)[number]): void {
  resetPositions();
  resetReplayBuffer(); // a new clip starts from the kickoff
  const taker = team.players[3];
  taker.position.set(team.side * -1.4, 0, 0);
  taker.heading = attackHeading(team.side);
  match.controlPlayer = null;
  match.controlTeam = null;
  match.controlCooldown = 0;
  match.gkHold = 0;
  setControl(taker);
  match.gkHold = 0;
  match.state = 'play';
  Audio.whistle();
  flashToast('KICK OFF');
}

/**
 * Advance the match clock and resolve the end of each half. Counts the half down
 * to 0, then plays any accrued added time before ending the half. Called from the
 * loop while in the `play` state (real time, not slow-mo).
 */
export function tickClock(dt: number): void {
  if (match.timeLeft > 0) {
    match.timeLeft -= dt;
    if (match.timeLeft <= 0) {
      match.timeLeft = 0;
      if (match.stoppageAccrued > 0) {
        match.stoppageLeft = match.stoppageAccrued; // into added time
        flashToast(`+${Math.ceil(match.stoppageAccrued)}s ADDED`);
      } else endHalf();
    }
  } else if (match.stoppageLeft > 0) {
    match.stoppageLeft -= dt;
    if (match.stoppageLeft <= 0) {
      match.stoppageLeft = 0;
      endHalf();
    }
  }
}

/** End the current half: into half-time (after the 1st) or full-time (after the 2nd). */
function endHalf(): void {
  if (match.half >= 2) fullTime();
  else halfTime();
}

/** Half-time — freeze play and show the interval card. */
function halfTime(): void {
  match.state = 'halftime';
  Audio.whistle();
  setReceiver(null);
  match.controlPlayer = null;
  match.controlTeam = null;
  const [h, a] = match.score;
  showHalfTime(h, a, statsLine());
}

/** Kick off the second half (taken by whoever didn't kick off the first). */
export function startSecondHalf(): void {
  setHalfTimeVisible(false);
  match.half = 2;
  match.timeLeft = CFG.matchSeconds;
  match.stoppageAccrued = 0;
  match.stoppageLeft = 0;
  for (const t of match.teams) for (const p of t.players) p.stamina = 1;
  kickOff(match.teams[1 - firstHalfKicker]);
  updateHUD();
}

/** A concise stats summary for the half-time card. */
function statsLine(): string {
  const [pa, pb] = possessionPct();
  return `Poss ${pa}–${pb}%  ·  Shots ${match.stats.shots[0]}–${match.stats.shots[1]}  ·  Passes ${match.stats.passes[0]}–${match.stats.passes[1]}`;
}

/** Possession as whole-percent shares of the two teams (defaults to 50–50). */
function possessionPct(): [number, number] {
  const [a, b] = match.stats.possession;
  const tot = a + b;
  if (tot < 1) return [50, 50];
  const pa = Math.round((a / tot) * 100);
  return [pa, 100 - pa];
}

/** The fuller stats block shown at full time. */
function fullStatsLine(): string {
  const [pa, pb] = possessionPct();
  const s = match.stats;
  return (
    `Poss ${pa}–${pb}%  ·  Shots ${s.shots[0]}–${s.shots[1]} (on target ${s.onTarget[0]}–${s.onTarget[1]})  ·  ` +
    `Tackles ${s.tackles[0]}–${s.tackles[1]}  ·  Saves ${s.saves[0]}–${s.saves[1]}`
  );
}

/** Arcade player rating: a base lifted by end product and defensive work. */
function playerRating(p: Player): number {
  const winBonus = match.score[teamIndex(p.team)] > match.score[1 - teamIndex(p.team)] ? 0.4 : 0;
  return 6 + winBonus + p.statGoals * 1.6 + p.statAssists * 1.0 + p.statTackles * 0.22 + p.statSaves * 0.5;
}

/** Pick the standout performer across both teams for the Man-of-the-Match line. */
function motmLine(): string {
  let best: Player | null = null;
  let bestR = -Infinity;
  for (const t of match.teams)
    for (const p of t.players) {
      const r = playerRating(p);
      if (r > bestR) {
        bestR = r;
        best = p;
      }
    }
  if (!best) return '';
  const tally: string[] = [];
  if (best.statGoals) tally.push(`${best.statGoals}G`);
  if (best.statAssists) tally.push(`${best.statAssists}A`);
  if (best.statSaves) tally.push(`${best.statSaves} saves`);
  const extra = tally.length ? `  (${tally.join(' · ')})` : '';
  return `★ MOTM  ${best.name} · ${best.team.name} · ${Math.min(10, bestR).toFixed(1)}${extra}`;
}

/** End the match and show the result card (or a shootout, if a knockout is level). */
export function fullTime(): void {
  if (match.score[0] === match.score[1] && match.settleDraws) {
    Audio.whistle();
    startShootout(); // a drawn knockout is settled from the spot
    return;
  }
  match.state = 'fulltime';
  Audio.whistle();
  setTimeout(() => Audio.whistle(), 220);
  const [h, a] = match.score;
  const [home, away] = match.teams;
  const result = h > a ? `${home.name} WIN` : a > h ? `${away.name} WIN` : 'DRAW';
  showFullTime(h, a, result, fullStatsLine(), motmLine());
}

/** Resolve a tie decided on penalties — show the result card with the shootout score. */
export function finishShootout(winner: number, penScore: [number, number]): void {
  match.state = 'fulltime';
  Audio.whistle();
  const result = `${match.teams[winner].name} WIN`;
  const line = `On penalties ${penScore[0]}–${penScore[1]}  ·  ${fullStatsLine()}`;
  showFullTime(match.score[0], match.score[1], result, line, motmLine());
}

/** Start a fresh match from the menu. */
export function startMatch(): void {
  Audio.resume();
  match.score = [0, 0];
  match.stats = freshStats();
  match.half = 1;
  match.timeLeft = CFG.matchSeconds;
  match.stoppageAccrued = 0;
  match.stoppageLeft = 0;
  for (const t of match.teams)
    for (const p of t.players) {
      p.stamina = 1;
      p.statGoals = p.statAssists = p.statTackles = p.statSaves = 0;
      p.yellows = 0;
      p.sentOff = false;
      p.mesh.visible = true; // restore anyone dismissed in a previous match
    }
  setMenuVisible(false);
  setFullTimeVisible(false);
  setHalfTimeVisible(false);
  firstHalfKicker = Math.random() < 0.5 ? 0 : 1;
  kickOff(match.teams[firstHalfKicker]);
  updateHUD();
}

/** Return to the start menu (Play Again). */
export function returnToMenu(): void {
  setFullTimeVisible(false);
  setHalfTimeVisible(false);
  setMenuVisible(true);
  match.state = 'menu';
  resetPositions();
}
