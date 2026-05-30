import { CFG } from '../config/constants';
import { Audio } from '../core/audio';
import { Haptics } from '../core/haptics';
import { ball, match, setReceiver } from './state';
import { setControl } from './control';
import { attackHeading } from '../ai/analysis';
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
  flashToast(i === 0 ? 'STRIKERS SCORE!' : 'UNITED SCORE!');
}

/** Reset all entities to their home positions for a restart. */
export function resetPositions(): void {
  for (const t of match.teams) {
    t.inAttack = false;
    t.bestSpot = null;
    for (const p of t.players) {
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
  setReceiver(null);
  match.timeScale = 1;
  match.celebrateBallT = 0;
  clearTrail();
}

/** Kick off for `team`. */
export function kickOff(team: (typeof match.teams)[number]): void {
  resetPositions();
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

/** A one-line stats summary shared by the half-time and full-time cards. */
function statsLine(): string {
  return `Shots ${match.stats.shots[0]}–${match.stats.shots[1]}  ·  Passes ${match.stats.passes[0]}–${match.stats.passes[1]}`;
}

/** End the match and show the result card. */
export function fullTime(): void {
  match.state = 'fulltime';
  Audio.whistle();
  setTimeout(() => Audio.whistle(), 220);
  const [h, a] = match.score;
  const [home, away] = match.teams;
  const result = h > a ? `${home.name} WIN` : a > h ? `${away.name} WIN` : 'DRAW';
  showFullTime(h, a, result, statsLine());
}

/** Start a fresh match from the menu. */
export function startMatch(): void {
  Audio.resume();
  match.score = [0, 0];
  match.stats = { shots: [0, 0], passes: [0, 0] };
  match.half = 1;
  match.timeLeft = CFG.matchSeconds;
  match.stoppageAccrued = 0;
  match.stoppageLeft = 0;
  for (const t of match.teams) for (const p of t.players) p.stamina = 1;
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
