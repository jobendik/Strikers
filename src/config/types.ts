import type { Vector3 } from 'yuka';

/** A player's fixed positional role within the formation. */
export type RoleType = 'GK' | 'DEF' | 'ATT';

/** The dynamic, per-frame tactical role assigned by the team AI. */
export type PlayerRole = 'POSITION' | 'CHASER' | 'CARRIER' | 'SUPPORT' | 'GK';

/** High-level match flow state. */
export type MatchStateName = 'menu' | 'play' | 'celebrate' | 'fulltime';

/** One slot in a team formation: a defensive and an attacking home position. */
export interface FormationEntry {
  role: RoleType;
  def: Vector3;
  att: Vector3;
}

/** Difficulty tuning block. */
export interface DiffSetting {
  label: string;
  aiSpd: number;
  react: number;
  passSafe: number;
  shootBias: number;
  keeper: number;
}

/** Resolved per-frame input (joystick + keyboard merged). */
export interface InputState {
  x: number;
  z: number;
  sprint: boolean;
}
