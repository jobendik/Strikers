import { MemorySystem, StateMachine, Vector3, Vehicle } from 'yuka';
import type { Group } from 'three';
import { CFG } from '../config/constants';
import { DEFAULT_TEAM, SQUADS } from '../config/players';
import { deriveAthlete, type Athlete } from '../config/attributes';
import { V3, clamp } from '../core/math';
import { SimRegulator } from '../core/time';
import { hashStr } from '../core/rng';
import type { KickKind } from '../core/bus';
import { attackHeading } from '../ai/analysis';
import { PLAYER_STATES } from '../ai/states';
import { initPerception } from '../ai/perception';
import { makeModelPlayerMesh } from '../rendering/meshes';
import type { FormationEntry, PlayerAttributes, PlayerRole, RoleType, SquadPlayer } from '../config/types';
import type { Team } from './Team';

/** What the body is committed to right now (one at a time). */
export type ActionKind =
  | 'none'
  | 'kick' // wind-up → contact → follow-through
  | 'header'
  | 'tackle' // standing tackle lunge
  | 'slide' // slide tackle
  | 'dive' // goalkeeper dive
  | 'recover' // getting up / regaining balance (can't act)
  | 'stumble'; // knocked off stride (slowed)

/** How the AI/human wants this player to move this tick. */
export const enum Steer {
  None = 0,
  Arrive = 1,
  Seek = 2,
  /** Run to where the ball will be (true interception, see game/predict.ts). */
  Intercept = 3,
}

/**
 * A strike that has been decided but not yet made. It is resolved against the
 * ball's *actual* position at the moment of contact, so the animation, the
 * physics and the outcome all agree — and a defender can still get a toe in
 * during the wind-up.
 */
export interface KickSpec {
  kind: KickKind;
  /** Counts as a pass for stats / assist tracking. */
  pass: boolean;
  /** 'ground' rolls it to the target; 'lob' arcs it to land there; 'aim' drives it through a 3-D point. */
  mode: 'ground' | 'lob' | 'aim';
  tx: number;
  ty: number;
  tz: number;
  /** Launch speed (m/s). For 'lob' this is ignored (solved from `apex`). */
  speed: number;
  /** Apex height (m) for 'lob'. */
  apex: number;
  /** Side-spin (rad/s): positive bends the ball to the kicker's right. */
  curl: number;
  /** Back-spin (rad/s, positive = back-spin / float; negative = top-spin / dip). */
  backspin: number;
  receiver: Player | null;
  /** A deliberate attempt on goal. */
  shot: boolean;
  /** Execution error (degrees, 1 sd) applied at contact. */
  err: number;
  /** Was this decided by the human? */
  human: boolean;
}

/** An outfield player or goalkeeper. Yuka supplies the FSM + memory; motion is our own model. */
export class Player extends Vehicle {
  team: Team;
  idx: number;
  entry: FormationEntry;
  roleType: RoleType;
  /** Top sprint speed (m/s) — kept under the old name for AI code that reads it. */
  baseSpeed!: number;

  /** Squad identity + authored ratings. */
  override name: string;
  num: number;
  attr: PlayerAttributes;
  /** Derived athletic profile (speeds, acceleration, agility, control, strength…). */
  ath!: Athlete;

  /* ---- action state ---- */
  act: ActionKind = 'none';
  /** Seconds since the action began. */
  actT = 0;
  /** Total duration of the action. */
  actDur = 0;
  /** Time within the action at which contact happens (kick/tackle). */
  actContact = 0;
  /** Has the contact moment been resolved? */
  actHit = false;
  /** Direction the action is committed along (unit, planar). */
  actDirX = 0;
  actDirZ = 1;
  /** The strike waiting for contact (kick / header). */
  kickSpec: KickSpec | null = null;
  /** A strike requested while the ball was not yet in reach (plays the moment it arrives). */
  queued: KickSpec | null = null;
  queuedT = 0;

  /** Cooldowns. */
  slideCd = 0;
  diveCd = 0;
  tackleCd = 0;
  /** Point + height the keeper is diving toward. */
  diveTarget: Vector3 = V3();
  diveY = 1;

  /** Knock-on burst timer: >0 grants a brief speed lift chasing a knocked-on ball. */
  boost = 0;

  /** Per-frame tactical role assigned by the team AI. */
  role: PlayerRole = 'POSITION';
  isHuman = false;
  heading: number;
  /** >0 for a moment after striking the ball — he can't immediately re-collect his own kick. */
  kickCooldown = 0;
  decideT = 0;
  pressure = 0;
  stamina = 1;
  marking = false;
  /** Covering defender: get on the ball→goal line in front of the carrier and block the shot. */
  cover = false;
  markTarget: Vector3 | null = null;
  supportTarget: Vector3 = V3();

  /* ---- locomotion ---- */
  steer: Steer = Steer.None;
  steerTarget: Vector3 = V3();
  /** AI wants to sprint this tick (humans use the sprint button). */
  wantSprint = false;
  /** Is the player sprinting right now (for stamina + animation)? */
  sprinting = false;
  /** Jockeying: side-on, facing `faceYaw`, slower but quick to shift. */
  jockey = false;
  /** If set, the body faces this yaw instead of the direction of travel. */
  faceYaw: number | null = null;
  /** Stride phase (cycles), advanced by distance run — drives foot-synced animation. */
  stride = 0;
  /** Seconds until the next dribble touch is allowed. */
  touchCd = 0;
  /** Sim time he last took possession (how long he has been on the ball). */
  gotBallT = 0;
  /** Sim time of the last ball touch by this player. */
  lastTouchT = -10;
  /** Reaction clock for the keeper: sim time he first registered the current shot. */
  shotSeenT = -1;
  /** This shot's reaction time (s) — varies shot to shot around the keeper's quality. */
  shotReact = 0.2;

  /** Per-match contribution tally — feeds the Man-of-the-Match rating. */
  statGoals = 0;
  statAssists = 0;
  statTackles = 0;
  statSaves = 0;
  statShots = 0;
  statPasses = 0;
  statPassesDone = 0;
  statXg = 0;
  statDist = 0;

  /** Disciplinary state (Sim rules only): bookings, and whether sent off. */
  yellows = 0;
  sentOff = false;

  // AI brain support
  memory: MemorySystem;
  /** Throttles expensive carrier decision-making (~8 Hz, staggered per player). */
  decisionRegulator: SimRegulator;
  fsm: StateMachine<Player>;

  mesh: Group;

  constructor(team: Team, idx: number, entry: FormationEntry) {
    super();
    this.team = team;
    this.idx = idx;
    this.entry = entry;
    this.roleType = entry.role;

    this.name = '';
    this.num = idx + 1;
    this.attr = { pace: 70, shooting: 70, passing: 70, tackling: 70, composure: 70 };
    this.maxForce = CFG.force;
    this.mass = 1;
    this.updateOrientation = false; // we drive heading manually
    this.heading = attackHeading(team.side);

    this.mesh = makeModelPlayerMesh(team.color);
    this.applyIdentity();
    this.position.copy(this.homePos());

    this.decisionRegulator = new SimRegulator(8, (idx * 0.37 + (team.side > 0 ? 0 : 0.5)) % 1);

    this.memory = new MemorySystem(this);
    initPerception(this);

    this.fsm = new StateMachine<Player>(this);
    for (const id of Object.keys(PLAYER_STATES) as PlayerRole[]) {
      this.fsm.add(id, PLAYER_STATES[id]);
    }
  }

  /**
   * (Re)resolve this player's squad identity from the team's current roster key
   * and recolour the kit. Called at construction and whenever the team's identity
   * changes (team selection / cup fixtures).
   */
  applyIdentity(): void {
    const roster = SQUADS[this.team.name] ?? SQUADS[DEFAULT_TEAM];
    const squad: SquadPlayer = roster[this.idx] ?? {
      name: `P${this.idx + 1}`,
      num: this.idx + 1,
      attr: { pace: 70, shooting: 70, passing: 70, tackling: 70, composure: 70 },
    };
    this.name = squad.name;
    this.num = squad.num;
    this.attr = squad.attr;
    this.ath = deriveAthlete(this.attr, this.roleType);
    this.baseSpeed = this.ath.sprint;
    this.maxSpeed = this.baseSpeed;
    // outfielders wear the kit colour; keepers a distinct keeper kit per side
    (this.mesh.userData.body as { material: { color: { set(c: string): void } } }).material.color.set(
      this.roleType === 'GK' ? (this.team.side > 0 ? '#ffd23e' : '#19e0c0') : this.team.color,
    );
  }

  /** Stable per-identity seed (looks, small behavioural quirks). */
  identitySeed(): number {
    return hashStr(`${this.team.name}:${this.name}:${this.num}`);
  }

  homePos(): Vector3 {
    const e = this.entry;
    const b = this.team.inAttack ? e.att : e.def;
    // mentality shifts outfielders up/down the pitch (the keeper stays home)
    const push = this.roleType === 'GK' ? 0 : this.team.mentalityPush();
    const x = (this.team.side > 0 ? b.x : -b.x) + this.team.side * push;
    return V3(clamp(x, -CFG.halfL + 2, CFG.halfL - 2), 0, b.z);
  }

  /* ---- steering intents (consumed by game/movement.ts) ---- */

  /** Stop steering (stand still / hold). */
  deact(): void {
    this.steer = Steer.None;
    this.wantSprint = false;
    this.jockey = false;
    this.faceYaw = null;
  }
  /** Run to a point and settle on it. */
  goArrive(t: Vector3, sprint = false): void {
    this.steer = Steer.Arrive;
    this.steerTarget.copy(t);
    this.wantSprint = sprint;
    this.jockey = false;
    this.faceYaw = null;
  }
  /** Run flat-out through a point. */
  goSeek(t: Vector3): void {
    this.steer = Steer.Seek;
    this.steerTarget.copy(t);
    this.wantSprint = true;
    this.jockey = false;
    this.faceYaw = null;
  }
  /** Run onto the ball: predictive interception of its flight. */
  goPursue(_ball?: unknown): void {
    this.steer = Steer.Intercept;
    this.wantSprint = true;
    this.jockey = false;
    this.faceYaw = null;
  }
  /** Shuffle toward a point while staying side-on to `yaw` (defensive jockey). */
  goJockey(t: Vector3, yaw: number): void {
    this.steer = Steer.Arrive;
    this.steerTarget.copy(t);
    this.wantSprint = false;
    this.jockey = true;
    this.faceYaw = yaw;
  }

  /* ---- actions ---- */

  /** Is the body free to start something new? */
  free(): boolean {
    return this.act === 'none';
  }
  /** Committed to something that stops him playing the ball normally. */
  busy(): boolean {
    return this.act === 'slide' || this.act === 'dive' || this.act === 'recover' || this.act === 'tackle' || this.act === 'stumble';
  }
  startAction(kind: ActionKind, dur: number, contact = 0): void {
    this.act = kind;
    this.actT = 0;
    this.actDur = dur;
    this.actContact = contact;
    this.actHit = false;
  }
  clearAction(): void {
    this.act = 'none';
    this.actT = 0;
    this.actDur = 0;
    this.actHit = false;
    this.kickSpec = null;
    this.queued = null;
  }

  /** Legacy views used by AI/presentation code: remaining slide / dive time. */
  get slide(): number {
    return this.act === 'slide' ? Math.max(0.001, this.actDur - this.actT) : 0;
  }
  get dive(): number {
    return this.act === 'dive' ? Math.max(0.001, this.actDur - this.actT) : 0;
  }
}
