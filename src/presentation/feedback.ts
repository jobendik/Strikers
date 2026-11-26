import { on } from '../core/bus';
import { Haptics } from '../core/haptics';
import { match } from '../game/state';
import { addShake } from '../game/camera';
import { flashToast, goalCommentary, showGoalFx, showScorerFlash, updateHUD, commentate } from '../ui/hud';

/*
 * Bus → player feedback (toasts, goal graphics, haptics, camera kicks,
 * commentary captions). The simulation only emits events; everything the player
 * *feels* about them is decided here. (Sound is owned by core/audio.ts, which
 * subscribes to the same bus.)
 */

let wired = false;

export function initFeedback(): void {
  if (wired) return;
  wired = true;

  on('toast', (e) => flashToast(e.text));

  on('goal', (e) => {
    updateHUD();
    showGoalFx(e.team);
    const team = match.teams[e.team];
    showScorerFlash(e.scorer ?? `${team.short} SCORE`, team.color, e.big);
    flashToast(e.scorer ? `${e.scorer} SCORES!` : `${team.short} SCORE!`);
    addShake(e.big ? 0.9 : 0.6);
    Haptics.goal();
    goalCommentary({ forGoals: e.score[e.team], againstGoals: e.score[1 - e.team], isUser: team.isUser, lastGasp: e.lastGasp });
  });

  on('kick', (e) => {
    if (e.kind === 'touch') return;
    if (e.human) Haptics.kick();
    if (e.power > 25) addShake(0.12);
  });

  on('post', (e) => {
    addShake(0.3 + Math.min(0.4, e.speed / 60));
    Haptics.tap();
    flashToast(e.bar ? 'OFF THE BAR!' : 'OFF THE POST!');
    commentate(e.bar ? 'RATTLES THE CROSSBAR!' : 'OFF THE WOODWORK!', 'save');
  });

  on('net', (e) => {
    if (e.goal) addShake(Math.min(0.5, e.speed / 50));
  });

  on('save', (e) => {
    addShake(e.diving ? 0.35 : 0.2);
    if (match.teams[e.team].isUser) Haptics.tackle();
    if (e.diving && e.speed > 20) commentate(e.parry ? 'BRILLIANT STOP!' : 'WHAT A SAVE!', 'save');
  });

  on('tackle', (e) => {
    if (e.human) Haptics.tackle();
    if (e.slide) addShake(0.22);
  });

  on('slide', (e) => {
    if (match.teams[e.team].isUser) Haptics.tap();
  });

  on('collide', (e) => {
    if (e.force > 6) addShake(0.1);
  });

  on('foul', () => {
    Haptics.whistle();
  });

  on('nearmiss', (e) => {
    commentate(match.teams[e.team].isUser ? 'SO CLOSE!' : 'JUST WIDE!', 'drama');
  });
}
