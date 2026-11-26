import { MovingEntity, Vector3 } from 'yuka';
import * as THREE from 'three';
import { CFG } from '../config/constants';
import { makeBallMesh } from '../rendering/meshes';
import type { Team } from './Team';
import type { Player } from './Player';

/**
 * The match ball. Always a free physical body (see game/physics.ts): it is never
 * attached to a player — a dribbler keeps it by *touching* it.
 */
export class Ball extends MovingEntity {
  /** Team of the player who last touched the ball (for throw-ins, goal kicks). */
  lastTouch: Team | null = null;
  /** Player who last struck the ball — credits the scorer on a goal. */
  lastKicker: Player | null = null;
  /** Player who played the most recent pass — credits the assist on a goal. */
  passer: Player | null = null;
  /**
   * Angular velocity (rad/s, world axes). ω.y is side-spin (bends the flight via
   * the Magnus force); the horizontal components are top/back-spin (dip / float,
   * and what the ball does when it lands).
   */
  w: Vector3 = new Vector3();
  /** True while the ball is a live, deliberately-struck shot — gates save / shot stats. */
  shot = false;
  /** The keeper has already got a touch on this shot (stops on-target being double counted). */
  savedOnce = false;
  /** Estimated xG of the live shot (0 when not a shot). */
  shotXg = 0;
  /** Sim time the ball was last struck by anyone. */
  lastKickT = -10;
  /** ±1 once the ball has crossed that goal's mouth (it is inside the net), else 0. */
  inNet = 0;
  /** True while rolling/sliding in contact with the turf. */
  grounded = true;
  mesh: THREE.Mesh;

  constructor() {
    super();
    this.maxSpeed = CFG.ballMax;
    this.mesh = makeBallMesh();
  }

  /** Bring the ball to a dead stop at a point on the turf. */
  place(x: number, z: number): void {
    this.position.set(x, CFG.ballR, z);
    this.velocity.set(0, 0, 0);
    this.w.set(0, 0, 0);
    this.inNet = 0;
    this.grounded = true;
    this.shot = false;
    this.savedOnce = false;
    this.shotXg = 0;
  }
}

/*
 * Rolling-ball kinematics. On the turf the ball decelerates at
 *     dv/dt = −(a + k·v²)       a = CFG.ballDecel (grass), k = CFG.airDrag
 * which integrates in closed form — so the AI can ask exact questions ("how long
 * until a pass struck at v0 has rolled d metres?", "how hard must I hit it to
 * arrive at speed v?") without stepping the simulation.
 */

/** Speed remaining after rolling `dist` metres from launch speed `v0` (0 if it stops short). */
export function rollSpeedAt(v0: number, dist: number): number {
  const a = CFG.ballDecel;
  const k = CFG.airDrag;
  const v2 = (v0 * v0 + a / k) * Math.exp(-2 * k * dist) - a / k;
  return v2 > 0 ? Math.sqrt(v2) : 0;
}

/** Seconds for a ground ball struck at `power` to roll `dist` metres; −1 if it stops short. */
export function timeBall(power: number, dist: number): number {
  const a = CFG.ballDecel;
  const k = CFG.airDrag;
  const v2 = (power * power + a / k) * Math.exp(-2 * k * dist) - a / k;
  if (v2 <= 0) return -1;
  const c = Math.sqrt(k / a);
  return (Math.atan(power * c) - Math.atan(Math.sqrt(v2) * c)) / Math.sqrt(a * k);
}

/** Launch speed needed for a ground ball to still be doing `arrive` m/s after `dist` metres. */
export function rollSpeedFor(dist: number, arrive: number): number {
  const a = CFG.ballDecel;
  const k = CFG.airDrag;
  return Math.sqrt((arrive * arrive + a / k) * Math.exp(2 * k * dist) - a / k);
}

/** Total distance a ground ball struck at `v0` rolls before stopping. */
export function rollRange(v0: number): number {
  const a = CFG.ballDecel;
  const k = CFG.airDrag;
  return Math.log(1 + (k * v0 * v0) / a) / (2 * k);
}
