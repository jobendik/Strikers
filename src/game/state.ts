import { CFG } from '../config/constants';
import { Ball } from '../entities/Ball';
import { Team } from '../entities/Team';
import type { Player } from '../entities/Player';
import { flagOffside } from './rules';
import type { InputState, MatchStateName } from '../config/types';
import type { PendingRestart } from './physics';
import { resetSimClock } from '../core/time';
import type { Vector3 } from 'yuka';

/**
 * Mutable match state. Mirrors the original monolith's `match` object but
 * strongly typed. Shared across modules as a live binding.
 */
export interface MatchState {
  teams: [Team, Team];
  state: MatchStateName;
  timeLeft: number;
  /** A drawn match must be settled by a penalty shootout (knockout / cup tie). */
  settleDraws: boolean;
  /** Sim rules on: offside + yellow/red cards (default off = pure arcade). */
  simRules: boolean;
  /** Match paused (pause menu open) — the loop freezes the simulation. */
  paused: boolean;
  /** Current half (1 or 2). */
  half: number;
  /** Added time accrued for the current half (seconds); played once timeLeft hits 0. */
  stoppageAccrued: number;
  /** Added-time seconds still to play; >0 only while in stoppage. */
  stoppageLeft: number;
  score: [number, number];
  controlPlayer: Player | null;
  controlTeam: Team | null;
  controlCooldown: number;
  gkHold: number;
  /** Intended pass receiver — Simple Soccer's `m_pReceivingPlayer`; runs onto the ball. */
  receivingPlayer: Player | null;
  /** Countdown for the receiving assignment before it lapses. */
  receiveTimer: number;
  /** Teammate actively requesting a pass into space (Simple Soccer `RequestPass`). */
  callingPlayer: Player | null;
  /** The lane/pocket the requesting teammate wants the ball played into. */
  callTarget: Vector3 | null;
  /** Countdown for the pass request cue before it lapses. */
  callTimer: number;
  userPlayer: Player | null;
  switchLock: number;
  scoredBy: number;
  celebrateT: number;
  /** Seconds left of slow-motion ball-into-net flight after a goal. */
  celebrateBallT: number;
  /** Global simulation time scale (1 = normal); dips for goal slow-motion. */
  timeScale: number;
  input: InputState;
  joy: { x: number; z: number };
  stats: MatchStats;
  /** A restart that has been awarded but not yet taken — the ball is dead. */
  restart: PendingRestart | null;
  /** >0 while a restart is being taken: only the taker may play the ball. */
  setPieceT: number;
  setPieceTaker: Player | null;
  /** Team that last had the ball under control (possession for the pulse / turnovers). */
  lastPossession: Team | null;
  /** The passer of a pass that has not yet been received or cut out. */
  pendingPass: Player | null;
  /** Every shot of the match (for shot maps / xG). */
  shotLog: ShotRecord[];
  /** Assist: with the stick idle, the user's player runs onto passes automatically. */
  assistReceive: boolean;
  /** Assist: the user's player makes a standing tackle automatically when he gets to the ball. */
  assistTackle: boolean;
  /** Assist: after a spell with the controls untouched, the AI plays the user's man until input resumes. */
  assistIdle: boolean;
  /** Seconds since the user last touched the controls. */
  userIdleT: number;
  /** Presentation is showing a goal replay: don't kick off until it releases the hold. */
  holdKickoff: boolean;
  /** Seed the current match's simulation RNG stream was started from. */
  seed: number;
}

/** One attempt on goal. */
export interface ShotRecord {
  team: 0 | 1;
  x: number;
  z: number;
  xg: number;
  goal: boolean;
  t: number;
}

/** Accumulated team match statistics (for the half-time / full-time cards). */
export interface MatchStats {
  shots: [number, number];
  onTarget: [number, number];
  passes: [number, number];
  tackles: [number, number];
  saves: [number, number];
  /** Possession measured as seconds in control; rendered as a percentage. */
  possession: [number, number];
  /** Passes that reached a team-mate. */
  passesDone: [number, number];
  /** Opposition passes cut out. */
  interceptions: [number, number];
  /** Accumulated expected goals (an estimate). */
  xg: [number, number];
}

/** A fresh, zeroed stats block. */
export function freshStats(): MatchStats {
  return {
    shots: [0, 0],
    onTarget: [0, 0],
    passes: [0, 0],
    tackles: [0, 0],
    saves: [0, 0],
    possession: [0, 0],
    passesDone: [0, 0],
    interceptions: [0, 0],
    xg: [0, 0],
  };
}

// Live bindings — populated by createGameState() before the loop starts.
export let ball!: Ball;
export let home!: Team;
export let away!: Team;
export let match!: MatchState;

/** Constructs the ball, both teams and the match state. Call once at boot. */
export function createGameState(): void {
  resetSimClock();
  ball = new Ball();
  home = new Team(+1, 'USA', true);
  away = new Team(-1, 'BRAZIL', false);
  match = {
    teams: [home, away],
    state: 'menu',
    timeLeft: CFG.matchSeconds,
    settleDraws: false,
    simRules: false,
    paused: false,
    half: 1,
    stoppageAccrued: 0,
    stoppageLeft: 0,
    score: [0, 0],
    controlPlayer: null,
    controlTeam: null,
    controlCooldown: 0,
    gkHold: 0,
    receivingPlayer: null,
    receiveTimer: 0,
    callingPlayer: null,
    callTarget: null,
    callTimer: 0,
    userPlayer: null,
    switchLock: 0,
    scoredBy: 0,
    celebrateT: 0,
    celebrateBallT: 0,
    timeScale: 1,
    input: { x: 0, z: 0, sprint: false, jockey: false },
    joy: { x: 0, z: 0 },
    stats: freshStats(),
    restart: null,
    setPieceT: 0,
    setPieceTaker: null,
    lastPossession: null,
    pendingPass: null,
    shotLog: [],
    assistReceive: true,
    assistTackle: true,
    assistIdle: true,
    userIdleT: 0,
    holdKickoff: false,
    seed: 1,
  };
  ball.mesh.position.set(0, CFG.ballR, 0);
}

/**
 * Mark (or clear) the intended receiver of a pass — Simple Soccer's
 * `m_pReceivingPlayer`. The receiver enters a RECEIVE state and runs onto the
 * ball, producing real combination play instead of waiting to be found.
 */
export function setReceiver(p: Player | null): void {
  match.receivingPlayer = p;
  match.receiveTimer = p ? CFG.receiveSpan : 0;
  flagOffside(p); // Sim rules: judge the receiver's offside position at the pass
}

/**
 * Mark (or clear) an off-ball teammate's pass request. This is the lightweight
 * arcade equivalent of Simple Soccer's `RequestPass` telegram: a teammate
 * evaluates that they are open, runs into the lane and advertises the option to
 * the carrier/HUD for a short window.
 */
export function setPassRequest(p: Player | null, target: Vector3 | null = null): void {
  match.callingPlayer = p;
  match.callTarget = p && target ? target.clone() : null;
  match.callTimer = p && target ? CFG.passRequestSpan : 0;
}

/** Returns the opposing team. */
export function oppOf(team: Team): Team {
  return match.teams[0] === team ? match.teams[1] : match.teams[0];
}

/** 0 if the team is the home/user team, otherwise 1 — used to index stats arrays. */
export function teamIndex(team: Team): 0 | 1 {
  return team === match.teams[0] ? 0 : 1;
}
