import { CFG } from '../config/constants';
import { SIM_DT, advanceTick, sim } from '../core/time';
import { pulse } from '../core/bus';
import { V3, clamp, headingVec } from '../core/math';
import { ball, match, setPassRequest, setReceiver, teamIndex } from './state';
import { resolveControl, resolveTackles, startTackle, updateDribble, updateGkHold, updateKicks, updatePressure } from './control';
import { movePlayers, selectUserPlayer } from './movement';
import { updateBall, updateRestart } from './physics';
import { kickOff, tickClock } from './flow';
import { updateShootout } from './penalty';
import { planarToBall } from './aerial';
import { goalX } from '../ai/analysis';

/*
 * One fixed simulation tick — THE match simulation.
 *
 * The rendered game (game/loop.ts) and the headless harness (game/simulate.ts)
 * both advance the match by calling this and nothing else, so what is balanced
 * and tested headlessly is exactly what is played. It takes no delta: the step is
 * always SIM_DT, and outcomes never depend on the display frame rate.
 */

export interface StepOptions {
  /** A human controls a player on team 0 (false for AI-vs-AI). */
  human: boolean;
}

const _t = V3();

/** The user's player steps in with a standing tackle on his own when he gets to the ball (assist). */
function userAssists(): void {
  const u = match.userPlayer;
  const c = match.controlPlayer;
  if (!u || !match.assistTackle || !c || c.team === u.team || u.act !== 'none' || u.tackleCd > 0) return;
  if (c.roleType === 'GK' && match.gkHold > 0) return;
  if (match.setPieceT > 0 || ball.position.y > 0.6) return;
  const d = planarToBall(u);
  if (d > CFG.tackleReach * 0.72) return;
  const h = headingVec(u.heading);
  const facing = (h.x * (ball.position.x - u.position.x) + h.z * (ball.position.z - u.position.z)) / (d || 1);
  if (facing > 0.25) startTackle(u);
}

/** Goal celebration choreography: the scorer wheels away, team-mates chase him, the rest trudge back. */
function celebrateMoves(): void {
  const scorers = match.teams[match.scoredBy];
  const scorer = ball.lastKicker && ball.lastKicker.team === scorers ? ball.lastKicker : null;
  const cx = scorers.side * (CFG.halfL - 4);
  const cz = (scorer ? Math.sign(scorer.position.z || 1) : 1) * (CFG.halfW - 3);
  for (const t of match.teams)
    for (const p of t.players) {
      if (p.sentOff) continue;
      p.isHuman = false;
      if (t === scorers && p.roleType !== 'GK') {
        if (p === scorer || !scorer) p.goArrive(_t.set(cx, 0, cz), true);
        else p.goArrive(_t.set(scorer.position.x - scorers.side * 1.2, 0, scorer.position.z + (p.idx % 2 ? 1.1 : -1.1)), true);
      } else if (p.roleType === 'GK') {
        p.deact();
      } else {
        const h = p.homePos();
        p.goArrive(_t.set(h.x * 0.7, 0, h.z));
      }
    }
}

/** Refresh the match "pulse" read by presentation (crowd, camera, HUD). */
function updatePulse(): void {
  pulse.state = match.state;
  pulse.live = match.state === 'play' || match.state === 'celebrate' || match.state === 'shootout';
  pulse.ballX = ball.position.x;
  pulse.ballY = ball.position.y;
  pulse.ballZ = ball.position.z;
  pulse.ballSpeed = Math.hypot(ball.velocity.x, ball.velocity.y, ball.velocity.z);
  const poss = match.controlTeam ?? match.lastPossession;
  pulse.possession = poss ? teamIndex(poss) : -1;
  pulse.score[0] = match.score[0];
  pulse.score[1] = match.score[1];
  pulse.timeLeft = match.timeLeft;
  pulse.half = match.half;
  pulse.stoppage = match.stoppageLeft > 0;
  pulse.halfL = CFG.halfL;
  pulse.halfW = CFG.halfW;
  for (let i = 0; i < 2; i++) {
    const team = match.teams[i];
    let th = 0;
    if (match.state === 'play' && !match.restart) {
      const d = Math.hypot(goalX(team) - ball.position.x, ball.position.z * 0.8);
      const prox = clamp(1 - (d - 5) / 30, 0, 1);
      const has = match.controlTeam === team ? 1 : match.controlTeam === null && ball.lastTouch === team ? 0.75 : 0.15;
      th = prox * prox * has;
      if (ball.shot && ball.lastTouch === team) th = Math.max(th, 0.6 + 0.4 * prox);
    }
    // ease so presentation never sees a discontinuity
    pulse.threat[i] += (th - pulse.threat[i]) * Math.min(1, SIM_DT * (th > pulse.threat[i] ? 6 : 2.2));
  }
}

/** Advance the match by exactly one tick of SIM_DT seconds. */
export function stepSimulation(opts: StepOptions): void {
  advanceTick();
  const dt = SIM_DT;
  // real seconds this tick represents (slow-motion dilates sim time, not the clock)
  const real = dt / Math.max(0.05, match.timeScale);
  if (match.timeScale < 1) match.timeScale = Math.min(1, match.timeScale + CFG.slowmoRecover * real);

  if (match.state === 'play') {
    tickClock(dt);
    if (match.state !== 'play') {
      updatePulse();
      return; // the half just ended
    }
    if (match.controlTeam) match.stats.possession[teamIndex(match.controlTeam)] += dt;
    else if (match.lastPossession && !match.restart) match.stats.possession[teamIndex(match.lastPossession)] += dt * 0.5;
    if (match.receivingPlayer) {
      match.receiveTimer -= dt;
      if (match.receiveTimer <= 0) setReceiver(null);
    }
    if (match.callingPlayer) {
      match.callTimer -= dt;
      if (match.callTimer <= 0) setPassRequest(null);
    }
    updateRestart(dt);
    updateKicks(dt);
    resolveControl(dt);
    updateGkHold(dt);
    if (opts.human) selectUserPlayer(dt);
    match.teams[0].update(dt);
    match.teams[1].update(dt);
    movePlayers(dt);
    updateDribble(dt);
    resolveTackles(dt);
    if (opts.human) userAssists();
    updatePressure(dt);
    updateBall(dt);
  } else if (match.state === 'celebrate') {
    celebrateMoves();
    movePlayers(dt);
    updateBall(dt);
    if (match.celebrateBallT > 0) match.celebrateBallT -= real;
    match.celebrateT -= real;
    if (match.celebrateT <= 0 && match.celebrateBallT <= 0 && !match.holdKickoff) kickOff(match.teams[1 - match.scoredBy]);
  } else if (match.state === 'shootout') {
    updateShootout(dt);
  }
  updatePulse();
  void sim;
}
