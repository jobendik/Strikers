import type { Vector3 } from 'yuka';

/** A player's fixed positional role within the formation. */
export type RoleType = 'GK' | 'DEF' | 'ATT';

/** The dynamic, per-frame tactical role assigned by the team AI. */
export type PlayerRole = 'POSITION' | 'CHASER' | 'CARRIER' | 'SUPPORT' | 'RECEIVE' | 'GK';

/** High-level match flow state. */
export type MatchStateName = 'menu' | 'play' | 'celebrate' | 'halftime' | 'fulltime';

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

/**
 * Per-player attributes (0–100), inspired by the manager-engine sources
 * (Openfoot Manager / open-football). They give each player a distinct
 * identity that feeds movement speed, finishing, passing range, tackling and
 * decision quality, so a team is no longer five identical clones.
 */
export interface PlayerAttributes {
  /** Movement speed multiplier source. */
  pace: number;
  /** Shot power and accuracy. */
  shooting: number;
  /** Pass range and accuracy. */
  passing: number;
  /** Tackle success and foul avoidance. */
  tackling: number;
  /** Decision quality under pressure — lowers aiming noise, raises shot nerve. */
  composure: number;
}

/** One named squad member with a shirt number and an attribute block. */
export interface SquadPlayer {
  name: string;
  num: number;
  attr: PlayerAttributes;
}
