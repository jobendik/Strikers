import {
  ArriveBehavior,
  MemorySystem,
  MovingEntity,
  PursuitBehavior,
  Regulator,
  SeekBehavior,
  SeparationBehavior,
  StateMachine,
  Vector3,
  Vehicle,
} from 'yuka';
import type { Group } from 'three';
import { CFG } from '../config/constants';
import { attrMul, SQUADS } from '../config/players';
import { V3, clamp } from '../core/math';
import { attackHeading } from '../ai/analysis';
import { PLAYER_STATES } from '../ai/states';
import { initPerception } from '../ai/perception';
import { makePlayerMesh } from '../rendering/meshes';
import type { FormationEntry, PlayerAttributes, PlayerRole, RoleType, SquadPlayer } from '../config/types';
import type { Team } from './Team';

/** An outfield player or goalkeeper — a Yuka Vehicle driven by steering + an FSM. */
export class Player extends Vehicle {
  team: Team;
  idx: number;
  entry: FormationEntry;
  roleType: RoleType;
  baseSpeed: number;

  /** Squad identity + attributes (pace, shooting, passing, tackling, composure). */
  override name: string;
  num: number;
  attr: PlayerAttributes;

  /** Slide-tackle timer: >0 while committed to a slide (cannot steer). */
  slide = 0;
  /** Cooldown before this player can slide again. */
  slideCd = 0;

  /** Goalkeeper dive timer: >0 while flinging himself at a shot (cannot steer). */
  dive = 0;
  /** Cooldown before the keeper can dive again. */
  diveCd = 0;
  /** Point the keeper is diving toward (predicted shot crossing point). */
  diveTarget: Vector3 = V3();

  /** Knock-on burst timer: >0 grants a brief speed explosion after a knock-on. */
  boost = 0;

  /** Per-frame tactical role assigned by the team AI. */
  role: PlayerRole = 'POSITION';
  isHuman = false;
  heading: number;
  kickCooldown = 0;
  decideT = 0;
  pressure = 0;
  stamina = 1;
  marking = false;
  markTarget: Vector3 | null = null;
  supportTarget: Vector3 = V3();

  /** Per-match contribution tally — feeds the Man-of-the-Match rating. */
  statGoals = 0;
  statAssists = 0;
  statTackles = 0;
  statSaves = 0;

  /** Disciplinary state (Sim rules only): bookings, and whether sent off. */
  yellows = 0;
  sentOff = false;

  // steering behaviors
  arrive: ArriveBehavior;
  seek: SeekBehavior;
  pursuit: PursuitBehavior;
  /** Group-steering separation that keeps team-mates from clumping (Yuka). */
  separation: SeparationBehavior;

  // AI brain support
  memory: MemorySystem;
  /** Throttles expensive carrier decision-making (~7 Hz). */
  decisionRegulator = new Regulator(7);
  fsm: StateMachine<Player>;

  mesh: Group;

  constructor(team: Team, idx: number, entry: FormationEntry) {
    super();
    this.team = team;
    this.idx = idx;
    this.entry = entry;
    this.roleType = entry.role;

    // resolve squad identity, with a safe fallback if a roster slot is missing
    const roster = SQUADS[team.name] ?? SQUADS.STRIKERS;
    const squad: SquadPlayer = roster[idx] ?? {
      name: `P${idx + 1}`,
      num: idx + 1,
      attr: { pace: 70, shooting: 70, passing: 70, tackling: 70, composure: 70 },
    };
    this.name = squad.name;
    this.num = squad.num;
    this.attr = squad.attr;

    // pace scales the base running speed; keepers stay on the GK baseline.
    const raw = this.roleType === 'GK' ? CFG.spd.gk : CFG.spd.out;
    this.baseSpeed = this.roleType === 'GK' ? raw : raw * attrMul(this.attr.pace);
    this.maxSpeed = this.baseSpeed;
    this.maxForce = CFG.force;
    this.mass = 1;
    this.updateOrientation = false; // we drive heading manually for crisp facing
    this.heading = attackHeading(team.side);

    this.position.copy(this.homePos());
    this.mesh = makePlayerMesh(team.color);
    if (this.roleType === 'GK') {
      // keepers get a distinct kit
      (this.mesh.userData.body as { material: { color: { set(c: string): void } } }).material.color.set(
        team.side > 0 ? '#ffd23e' : '#19e0c0',
      );
    }

    this.arrive = new ArriveBehavior(V3(), 2, 0.4);
    this.arrive.active = false;
    this.seek = new SeekBehavior(V3());
    this.seek.active = false;
    this.pursuit = new PursuitBehavior(null, 1.3);
    this.pursuit.active = false;
    // Separation blends *on top of* whichever target behaviour is active, so it
    // is added last (the SteeringManager prioritises by insertion order — the
    // move-to-target force is satisfied first, separation nudges with what's
    // left). Neighbours are populated each frame in movePlayers().
    this.separation = new SeparationBehavior();
    this.separation.weight = CFG.spreadWeight;
    this.separation.active = false;
    this.steering.add(this.arrive);
    this.steering.add(this.seek);
    this.steering.add(this.pursuit);
    this.steering.add(this.separation);

    this.memory = new MemorySystem(this);
    initPerception(this);

    this.fsm = new StateMachine<Player>(this);
    for (const id of Object.keys(PLAYER_STATES) as PlayerRole[]) {
      this.fsm.add(id, PLAYER_STATES[id]);
    }
  }

  homePos(): Vector3 {
    const e = this.entry;
    const b = this.team.inAttack ? e.att : e.def;
    // mentality shifts outfielders up/down the pitch (the keeper stays home)
    const push = this.roleType === 'GK' ? 0 : this.team.mentalityPush();
    const x = (this.team.side > 0 ? b.x : -b.x) + this.team.side * push;
    return V3(clamp(x, -CFG.halfL + 2, CFG.halfL - 2), 0, b.z);
  }

  /** Deactivates every steering behavior. */
  deact(): void {
    this.arrive.active = false;
    this.seek.active = false;
    this.pursuit.active = false;
  }

  goArrive(t: Vector3): void {
    this.deact();
    this.arrive.active = true;
    this.arrive.target.copy(t);
  }
  goSeek(t: Vector3): void {
    this.deact();
    this.seek.active = true;
    this.seek.target.copy(t);
  }
  goPursue(e: MovingEntity): void {
    this.deact();
    this.pursuit.active = true;
    this.pursuit.evader = e;
  }
}
