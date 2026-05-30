import { CFG } from '../config/constants';
import { Ball } from '../entities/Ball';
import { Team } from '../entities/Team';
import type { Player } from '../entities/Player';
import type { InputState, MatchStateName } from '../config/types';

/**
 * Mutable match state. Mirrors the original monolith's `match` object but
 * strongly typed. Shared across modules as a live binding.
 */
export interface MatchState {
  teams: [Team, Team];
  state: MatchStateName;
  timeLeft: number;
  score: [number, number];
  controlPlayer: Player | null;
  controlTeam: Team | null;
  controlCooldown: number;
  gkHold: number;
  userPlayer: Player | null;
  switchLock: number;
  scoredBy: number;
  celebrateT: number;
  input: InputState;
  joy: { x: number; z: number };
  stats: { shots: [number, number]; passes: [number, number] };
}

// Live bindings — populated by createGameState() before the loop starts.
export let ball!: Ball;
export let home!: Team;
export let away!: Team;
export let match!: MatchState;

/** Constructs the ball, both teams and the match state. Call once at boot. */
export function createGameState(): void {
  ball = new Ball();
  home = new Team(+1, '#ff2d55', 'STRIKERS', true);
  away = new Team(-1, '#1e90ff', 'UNITED', false);
  match = {
    teams: [home, away],
    state: 'menu',
    timeLeft: CFG.matchSeconds,
    score: [0, 0],
    controlPlayer: null,
    controlTeam: null,
    controlCooldown: 0,
    gkHold: 0,
    userPlayer: null,
    switchLock: 0,
    scoredBy: 0,
    celebrateT: 0,
    input: { x: 0, z: 0, sprint: false },
    joy: { x: 0, z: 0 },
    stats: { shots: [0, 0], passes: [0, 0] },
  };
  ball.mesh.position.set(0, CFG.ballR, 0);
}

/** Returns the opposing team. */
export function oppOf(team: Team): Team {
  return match.teams[0] === team ? match.teams[1] : match.teams[0];
}

/** 0 if the team is the home/user team, otherwise 1 — used to index stats arrays. */
export function teamIndex(team: Team): 0 | 1 {
  return team === match.teams[0] ? 0 : 1;
}
