import { MovingEntity } from 'yuka';
import * as THREE from 'three';
import { CFG } from '../config/constants';
import { makeBallMesh } from '../rendering/meshes';
import type { Team } from './Team';
import type { Player } from './Player';

/** The match ball — a Yuka MovingEntity with a custom constant-deceleration model. */
export class Ball extends MovingEntity {
  /** Team of the player who last touched the ball (for throw-ins, goal kicks). */
  lastTouch: Team | null = null;
  /** Player who last struck the ball — credits the scorer on a goal. */
  lastKicker: Player | null = null;
  /** Player who played the most recent pass — credits the assist on a goal. */
  passer: Player | null = null;
  /**
   * Signed spin imparted on a strike (rad/s of lateral curve). Drives the Magnus
   * swerve in {@link integrateFreeBall}, letting shots and crosses bend — the
   * "real, physics-driven ball motion" idea from Notblox taken a step further.
   */
  spin = 0;
  mesh: THREE.Mesh;

  constructor() {
    super();
    this.maxSpeed = CFG.ballMax;
    this.mesh = makeBallMesh();
  }
}

/**
 * Closed-form travel time for the ball's constant-deceleration model.
 * With mass = 1 and speed = power: v² = u² − 2·a·s ⇒ t = (u − √(u²−2as))/a.
 * Returns -1 if the ball cannot reach `dist` with the given `power`.
 */
export function timeBall(power: number, dist: number): number {
  const term = power * power - 2 * CFG.ballDecel * dist;
  if (term <= 0) return -1;
  return (power - Math.sqrt(term)) / CFG.ballDecel;
}
