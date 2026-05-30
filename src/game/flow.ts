import { CFG } from '../config/constants';
import { Audio } from '../core/audio';
import { Haptics } from '../core/haptics';
import { ball, match } from './state';
import { setControl } from './control';
import { attackHeading } from '../ai/analysis';
import { flashToast, setFullTimeVisible, setMenuVisible, showFullTime, showGoalFx, updateHUD } from '../ui/hud';

/** Register a goal for team `i` (0 = home) and start the celebration. */
export function scoreGoal(i: number): void {
  match.score[i]++;
  updateHUD();
  Audio.whistle();
  Audio.goal();
  Haptics.goal();
  showGoalFx(i);
  ball.velocity.set(0, 0, 0);
  match.controlPlayer = null;
  match.controlTeam = null;
  match.state = 'celebrate';
  match.celebrateT = 2.2;
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
      p.fsm.currentState = null; // force a fresh state on next tick
    }
  }
  ball.position.set(0, CFG.ballR, 0);
  ball.velocity.set(0, 0, 0);
  ball.lastTouch = null;
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

/** End the match and show the result card. */
export function fullTime(): void {
  match.state = 'fulltime';
  Audio.whistle();
  setTimeout(() => Audio.whistle(), 220);
  const [h, a] = match.score;
  const result = h > a ? 'STRIKERS WIN' : a > h ? 'UNITED WIN' : 'DRAW';
  const stats = `Shots ${match.stats.shots[0]}–${match.stats.shots[1]}  ·  Passes ${match.stats.passes[0]}–${match.stats.passes[1]}`;
  showFullTime(h, a, result, stats);
}

/** Start a fresh match from the menu. */
export function startMatch(): void {
  Audio.resume();
  match.score = [0, 0];
  match.stats = { shots: [0, 0], passes: [0, 0] };
  match.timeLeft = CFG.matchSeconds;
  for (const t of match.teams) for (const p of t.players) p.stamina = 1;
  setMenuVisible(false);
  setFullTimeVisible(false);
  kickOff(match.teams[Math.random() < 0.5 ? 0 : 1]);
  updateHUD();
}

/** Return to the start menu (Play Again). */
export function returnToMenu(): void {
  setFullTimeVisible(false);
  setMenuVisible(true);
  match.state = 'menu';
  resetPositions();
}
