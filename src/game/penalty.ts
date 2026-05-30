import { CFG } from '../config/constants';
import { attr01 } from '../config/players';
import { V3, clamp, rand } from '../core/math';
import { Audio } from '../core/audio';
import { Haptics } from '../core/haptics';
import { ball, match } from './state';
import { GROUND_Y } from './aerial';
import { updateBall } from './physics';
import { addShake } from './render';
import { finishShootout } from './flow';
import { flashToast } from '../ui/hud';
import { showShootout, updateShootoutBoard } from '../ui/hud';
import type { Player } from '../entities/Player';
import type { Team } from '../entities/Team';

/*
 * Penalty shootout — settles a drawn knockout tie. It reuses the diving keeper
 * and the aerial/free-ball physics, but runs as a self-contained 1-v-1 mini-game
 * (`match.state === 'shootout'`) driven entirely from here so the team FSMs stay
 * out of the way. Best-of-five alternating kicks, then sudden death. The user
 * both takes their kicks (aim with the joystick, SHOOT for power) and keeps the
 * other side's (flick the joystick to a corner and SHOOT to dive); when it isn't
 * the user, the AI takes or keeps.
 */

/** Where the kicks are taken (always the home team's attacking goal, +X). */
const GOAL_X = CFG.halfL;
const SPOT = V3(GOAL_X - CFG.pen.spotOut, 0, 0);
const CORNER = CFG.goalHalf - 0.5; // furthest a placed shot is aimed inside the post

type PenPhase = 'setup' | 'aim' | 'flight' | 'result';

interface ShootoutState {
  starter: number; // team index that takes first
  current: number; // team index taking the current kick
  goals: [number, number];
  taken: [number, number];
  marks: [Array<'goal' | 'miss'>, Array<'goal' | 'miss'>];
  suddenDeath: boolean;
  phase: PenPhase;
  timer: number;
  taker: Player;
  keeper: Player;
  /** Resolved at strike: keeper's committed corner (z) and whether he has dived. */
  diving: boolean;
  diveZ: number;
  power01: number;
  resolved: boolean;
}

let SO: ShootoutState | null = null;

/** True while a penalty shootout is in progress. */
export function inShootout(): boolean {
  return SO !== null;
}

/** Tear down a shootout in progress (e.g. on quit to menu). */
export function abortShootout(): void {
  if (!SO) return;
  SO.keeper.dive = 0;
  SO.keeper.mesh.rotation.x = 0;
  SO = null;
  showShootout(false);
}

/** Begin a shootout between the two teams (called from `fullTime` on a drawn tie). */
export function startShootout(): void {
  const starter = Math.random() < 0.5 ? 0 : 1;
  SO = {
    starter,
    current: starter,
    goals: [0, 0],
    taken: [0, 0],
    marks: [[], []],
    suddenDeath: false,
    phase: 'setup',
    timer: CFG.pen.setupTime,
    taker: match.teams[starter].outfield()[0],
    keeper: match.teams[1 - starter].gk,
    diving: false,
    diveZ: 0,
    power01: 0,
    resolved: false,
  };
  match.state = 'shootout';
  match.controlPlayer = null;
  match.controlTeam = null;
  match.gkHold = 0;
  match.timeScale = 1;
  // no player is "human-driven" during the mini-game (we move the actors by hand);
  // clearing this avoids leaving multiple players flagged human for the next match
  for (const t of match.teams) for (const p of t.players) p.isHuman = false;
  match.userPlayer = null;
  Audio.whistle();
  showShootout(true);
  flashToast('PENALTY SHOOTOUT');
  setupKick();
}

/** Park every non-actor player tidily on the halfway line so the box is clear. */
function parkBystanders(): void {
  if (!SO) return;
  let i = 0;
  for (const t of match.teams)
    for (const p of t.players) {
      if (p === SO.taker || p === SO.keeper) continue;
      p.velocity.set(0, 0, 0);
      p.dive = 0;
      p.slide = 0;
      p.mesh.rotation.x = 0;
      const z = (-2 + (i % 4) * 1.3) * (t.side > 0 ? 1 : -1) - t.side * 0.5;
      p.position.set(t.side * 2.2, 0, z + (t.side > 0 ? -7 : 7));
      i++;
    }
}

/** Pick the next taker (rotate through the outfield, then keeper, then loop). */
function pickTaker(team: Team, n: number): Player {
  const line = [...team.outfield(), team.gk];
  return line[n % line.length];
}

/** Position the actors and ball for the next kick. */
function setupKick(): void {
  if (!SO) return;
  const takeTeam = match.teams[SO.current];
  const keepTeam = match.teams[1 - SO.current];
  SO.taker = pickTaker(takeTeam, SO.taken[SO.current]);
  SO.keeper = keepTeam.gk;
  SO.diving = false;
  SO.resolved = false;
  SO.power01 = 0;

  ball.position.set(SPOT.x, GROUND_Y, SPOT.z);
  ball.velocity.set(0, 0, 0);
  ball.spin = 0;
  ball.lastTouch = takeTeam;

  SO.taker.position.set(SPOT.x - 1.5, 0, 0);
  SO.taker.velocity.set(0, 0, 0);
  SO.taker.heading = Math.atan2(1, 0); // face the goal (+X)
  SO.keeper.position.set(GOAL_X - 0.4, 0, 0);
  SO.keeper.velocity.set(0, 0, 0);
  SO.keeper.dive = 0;
  SO.keeper.mesh.rotation.x = 0;
  SO.keeper.heading = Math.atan2(-1, 0); // face the taker (−X)

  // highlight the actor the user is responsible for this kick (ring only — we
  // never set isHuman during the shootout, so movePlayers can't grab them)
  match.userPlayer = takeTeam.isUser ? SO.taker : keepTeam.isUser ? SO.keeper : null;

  parkBystanders();
  updateShootoutBoard(SO.goals, SO.taken, SO.marks, SO.starter, SO.current, SO.suddenDeath);

  SO.phase = 'setup';
  SO.timer = CFG.pen.setupTime;
}

/** Launch the shot toward goal-corner `aimZ` with normalised `power`. */
function strike(aimZ: number, power01: number): void {
  if (!SO) return;
  const speed = CFG.pen.power * (0.8 + 0.45 * power01);
  const dx = GOAL_X - ball.position.x;
  const dz = aimZ - ball.position.z;
  const dl = Math.hypot(dx, dz) || 1;
  ball.velocity.set((dx / dl) * speed, 0, (dz / dl) * speed);
  ball.spin = 0;
  ball.lastTouch = match.teams[SO.current];
  ball.lastKicker = SO.taker;
  SO.taker.heading = Math.atan2(dx, dz);
  SO.power01 = power01;
  SO.phase = 'flight';
  SO.timer = CFG.pen.flightTimeout;
  Audio.kick();
  Audio.roar();
  if (SO.taker.team.isUser) Haptics.kick();
}

/** Commit the keeper to a dive toward corner side `side` (−1/0/+1). */
function keeperDive(side: number): void {
  if (!SO) return;
  SO.diving = true;
  SO.diveZ = side * (CFG.goalHalf - 0.2);
  SO.keeper.dive = 1; // drives the mesh lean in syncMeshes
}

/**
 * SHOOT pressed during the shootout. When the user is taking it strikes (aim from
 * the joystick, `charge` → power); when the user is keeping it commits the dive.
 */
export function penaltyAction(charge = 1): void {
  if (match.paused || !SO || SO.phase !== 'aim') return;
  const takeTeam = match.teams[SO.current];
  const keepTeam = match.teams[1 - SO.current];

  if (takeTeam.isUser) {
    // user takes: aim sideways with the joystick, power from the charge
    const aimZ = clamp(match.input.x, -1, 1) * CORNER;
    const spray = rand(-1, 1) * (0.5 + 0.5 * charge) * (1 - attr01(SO.taker.attr.composure)) * 1.4;
    const aim = clamp(aimZ + spray, -(CFG.goalHalf + 1.2), CFG.goalHalf + 1.2);
    aiKeeperGuess(aim); // AI keeper reads it (imperfectly) as the ball is struck
    strike(aim, charge);
  } else if (keepTeam.isUser) {
    // user keeps: dive to the joystick side, then the AI taker strikes
    const side = Math.abs(match.input.x) < 0.3 ? 0 : Math.sign(match.input.x);
    keeperDive(side);
    Haptics.tap();
    aiStrike();
  }
}

/** AI keeper commits a dive, reading the (already aimed) shot with difficulty-scaled accuracy. */
function aiKeeperGuess(aimZ: number): void {
  const read = CFG.pen.aiKeeperRead[CFG.diff];
  const side = Math.abs(aimZ) < 0.6 ? 0 : Math.sign(aimZ);
  const guess = Math.random() < read ? side : side === 0 ? (Math.random() < 0.5 ? 1 : -1) : -side;
  keeperDive(guess);
}

/** AI takes a penalty: pick a corner (on target by difficulty) and strike. */
function aiStrike(): void {
  if (!SO) return;
  const comp = attr01(SO.taker.attr.composure);
  const onTarget = Math.random() < CFG.pen.aiOnTarget[CFG.diff] * (0.85 + 0.15 * comp);
  const side = Math.random() < 0.5 ? -1 : 1;
  const aim = onTarget
    ? side * CORNER * (0.7 + 0.3 * comp)
    : side * (CFG.goalHalf + rand(0.4, 1.2)); // sprayed wide
  strike(aim, 0.7 + 0.3 * comp);
}

/** Advance the shootout each frame (called from the loop while `state==='shootout'`). */
export function updateShootout(dt: number): void {
  if (!SO) return;

  if (SO.phase === 'setup') {
    SO.timer -= dt;
    if (SO.timer <= 0) beginAim();
    return;
  }

  if (SO.phase === 'aim') {
    SO.timer -= dt;
    const takeTeam = match.teams[SO.current];
    const keepTeam = match.teams[1 - SO.current];
    if (takeTeam.isUser || keepTeam.isUser) {
      // wait for the user, but auto-resolve if they hang too long
      if (SO.timer <= 0) {
        if (takeTeam.isUser) {
          const aim = rand(-1, 1) * CORNER; // nervy, half-power auto-kick
          aiKeeperGuess(aim);
          strike(aim, 0.5);
        } else {
          keeperDive(0);
          aiStrike();
        }
      }
    }
    return;
  }

  if (SO.phase === 'flight') {
    // drive the keeper toward his committed corner
    if (SO.diving) {
      const dz = SO.diveZ - SO.keeper.position.z;
      const step = Math.sign(dz) * Math.min(Math.abs(dz), CFG.pen.keeperSpeed * dt);
      SO.keeper.position.z += step;
      SO.keeper.heading = Math.atan2(-1, Math.sign(SO.diveZ) || 1);
      SO.keeper.dive = Math.max(0.01, SO.keeper.dive - dt); // keep the lean while diving
    }
    updateBall(dt); // free-ball physics (woodwork/bounds are no-ops outside 'play')
    resolveFlight();
    SO.timer -= dt;
    if (!SO.resolved && SO.timer <= 0) recordKick('miss');
    return;
  }

  if (SO.phase === 'result') {
    SO.timer -= dt;
    if (SO.timer <= 0) nextKick();
  }
}

/** Enter the aim phase: AI side acts immediately, the user gets a prompt. */
function beginAim(): void {
  if (!SO) return;
  SO.phase = 'aim';
  SO.timer = 8; // generous window before an auto-kick
  const takeTeam = match.teams[SO.current];
  const keepTeam = match.teams[1 - SO.current];
  if (!takeTeam.isUser && !keepTeam.isUser) {
    aiStrike(); // AI vs AI (shouldn't happen — the user is always involved)
    aiKeeperGuess(0);
  } else if (takeTeam.isUser) {
    flashToast('AIM + SHOOT TO STRIKE');
  } else {
    flashToast('PICK A CORNER — SHOOT TO DIVE');
  }
}

/** Geometric outcome check once the ball reaches the goal area. */
function resolveFlight(): void {
  if (!SO || SO.resolved) return;
  const onLine = ball.position.x >= GOAL_X - 0.6;
  const stopped = Math.hypot(ball.velocity.x, ball.velocity.z) < 1.5 && ball.position.x < GOAL_X - 0.6;
  if (stopped) {
    recordKick('miss');
    return;
  }
  if (!onLine) return;

  const onTarget = Math.abs(ball.position.z) < CFG.goalHalf - 0.1 && ball.position.y < CFG.crossbarH;
  if (!onTarget) {
    recordKick('miss'); // wide or over — no save to credit
    return;
  }
  const saved = Math.abs(SO.keeper.position.z - ball.position.z) < CFG.pen.keeperReach;
  if (saved) {
    // a hard strike into the very corner can still beat a correct dive
    const cornerCloseness = Math.abs(ball.position.z) / CFG.goalHalf;
    const beat = cornerCloseness > 0.78 && Math.random() < 0.32 * SO.power01;
    recordKick(beat ? 'goal' : 'save');
  } else {
    recordKick('goal');
  }
}

/** Record the kick outcome, update the board, and check for a winner. */
function recordKick(kind: 'goal' | 'save' | 'miss'): void {
  if (!SO || SO.resolved) return;
  SO.resolved = true;
  const t = SO.current;
  SO.taken[t]++;
  if (kind === 'goal') {
    SO.goals[t]++;
    SO.marks[t].push('goal');
    Audio.goal();
    Audio.roar(true);
    addShake(0.8);
    flashToast(match.teams[t].isUser ? 'SCORED!' : 'NETS IT');
  } else {
    SO.marks[t].push('miss');
    Audio.save();
    if (kind === 'save') {
      Audio.roar();
      addShake(0.5);
      flashToast(SO.keeper.team.isUser ? 'YOU SAVE IT!' : 'SAVED!');
    } else flashToast(match.teams[t].isUser ? 'MISSED!' : 'OFF TARGET');
  }
  // ball trickles dead; keeper holds his lean a beat
  ball.velocity.multiplyScalar(0.2);
  updateShootoutBoard(SO.goals, SO.taken, SO.marks, SO.starter, SO.current, SO.suddenDeath);
  SO.phase = 'result';
  SO.timer = CFG.pen.resultTime;
}

/** Either set up the next kick or end the shootout. */
function nextKick(): void {
  if (!SO) return;
  const winner = decideWinner();
  if (winner !== null) {
    end(winner);
    return;
  }
  // both teams level after their 5th pair → into sudden death
  if (SO.taken[0] >= CFG.pen.bestOf && SO.taken[1] >= CFG.pen.bestOf) SO.suddenDeath = true;
  SO.keeper.dive = 0;
  SO.keeper.mesh.rotation.x = 0;
  SO.current = 1 - SO.current;
  setupKick();
}

/** Standard unreachable-lead resolution; returns the winning team index or null. */
function decideWinner(): number | null {
  if (!SO) return null;
  const { goals, taken } = SO;
  const inRegulation = taken[0] < CFG.pen.bestOf || taken[1] < CFG.pen.bestOf;
  if (inRegulation) {
    const rem0 = Math.max(0, CFG.pen.bestOf - taken[0]);
    const rem1 = Math.max(0, CFG.pen.bestOf - taken[1]);
    if (goals[0] > goals[1] + rem1) return 0;
    if (goals[1] > goals[0] + rem0) return 1;
    return null;
  }
  // regulation complete — decide only once both have taken the same number of kicks
  if (taken[0] === taken[1] && goals[0] !== goals[1]) return goals[0] > goals[1] ? 0 : 1;
  return null;
}

/** Wrap up the shootout and hand the result back to the match flow. */
function end(winner: number): void {
  if (!SO) return;
  const score: [number, number] = [SO.goals[0], SO.goals[1]];
  Audio.whistle();
  showShootout(false);
  SO.keeper.dive = 0;
  SO.keeper.mesh.rotation.x = 0;
  SO = null;
  finishShootout(winner, score);
}
