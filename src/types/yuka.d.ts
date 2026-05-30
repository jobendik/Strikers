/**
 * Minimal ambient type declarations for yuka@0.7.8.
 *
 * The published package does not ship its own `.d.ts`, so this file declares
 * the subset of the Yuka API used by Yuka Strikers. It is intentionally
 * pragmatic rather than exhaustive — extend it if you reach for more of the
 * library.
 */
declare module 'yuka' {
  export class Vector3 {
    x: number;
    y: number;
    z: number;
    constructor(x?: number, y?: number, z?: number);
    set(x: number, y: number, z: number): this;
    copy(v: Vector3): this;
    clone(): Vector3;
    add(v: Vector3): this;
    sub(v: Vector3): this;
    multiplyScalar(s: number): this;
    length(): number;
    squaredLength(): number;
    normalize(): this;
    distanceTo(v: Vector3): number;
    squaredDistanceTo(v: Vector3): number;
    dot(v: Vector3): number;
  }

  export class Quaternion {
    x: number;
    y: number;
    z: number;
    w: number;
  }

  export class GameEntity {
    name: string;
    position: Vector3;
    rotation: Quaternion;
    forward: Vector3;
    boundingRadius: number;
    active: boolean;
    /** Neighbouring entities used by group steering (Separation/Alignment/Cohesion). */
    neighbors: GameEntity[];
    neighborhoodRadius: number;
    manager: EntityManager | null;
    constructor();
    update(delta: number): this;
    getWorldDirection(result: Vector3): Vector3;
  }

  export class MovingEntity extends GameEntity {
    velocity: Vector3;
    maxSpeed: number;
    getSpeed(): number;
    getSpeedSquared(): number;
  }

  export class SteeringBehavior {
    active: boolean;
    weight: number;
  }

  export class SteeringManager {
    behaviors: SteeringBehavior[];
    add(behavior: SteeringBehavior): this;
    remove(behavior: SteeringBehavior): this;
    clear(): this;
  }

  export class Vehicle extends MovingEntity {
    maxForce: number;
    mass: number;
    updateOrientation: boolean;
    steering: SteeringManager;
    constructor();
  }

  export class ArriveBehavior extends SteeringBehavior {
    target: Vector3;
    deceleration: number;
    tolerance: number;
    constructor(target?: Vector3, deceleration?: number, tolerance?: number);
  }

  export class SeekBehavior extends SteeringBehavior {
    target: Vector3;
    constructor(target?: Vector3);
  }

  export class FleeBehavior extends SteeringBehavior {
    target: Vector3;
    panicDistance: number;
    constructor(target?: Vector3, panicDistance?: number);
  }

  export class PursuitBehavior extends SteeringBehavior {
    evader: MovingEntity | null;
    predictionFactor: number;
    constructor(evader?: MovingEntity | null, predictionFactor?: number);
  }

  export class SeparationBehavior extends SteeringBehavior {
    constructor();
  }

  export class OffsetPursuitBehavior extends SteeringBehavior {
    leader: MovingEntity | null;
    offset: Vector3;
    constructor(leader?: MovingEntity | null, offset?: Vector3);
  }

  export class InterposeBehavior extends SteeringBehavior {
    entity1: MovingEntity | null;
    entity2: MovingEntity | null;
    deceleration: number;
    constructor(entity1?: MovingEntity | null, entity2?: MovingEntity | null, deceleration?: number);
  }

  export class State<T = unknown> {
    enter(owner: T): void;
    execute(owner: T): void;
    exit(owner: T): void;
    onMessage(owner: T, telegram: unknown): boolean;
  }

  export class StateMachine<T = unknown> {
    owner: T | null;
    currentState: State<T> | null;
    previousState: State<T> | null;
    globalState: State<T> | null;
    states: Map<string, State<T>>;
    constructor(owner?: T | null);
    update(): this;
    add(id: string, state: State<T>): this;
    remove(id: string): this;
    get(id: string): State<T> | undefined;
    changeTo(id: string): this;
    revert(): this;
    in(id: string): boolean;
  }

  export class Regulator {
    constructor(updateFrequency?: number);
    ready(): boolean;
  }

  export class MemoryRecord {
    entity: GameEntity | null;
    timeBecameVisible: number;
    timeLastSensed: number;
    lastSensedPosition: Vector3;
    visible: boolean;
    constructor(entity?: GameEntity | null);
  }

  export class MemorySystem {
    owner: GameEntity | null;
    records: MemoryRecord[];
    memorySpan: number;
    constructor(owner?: GameEntity | null);
    createRecord(entity: GameEntity): this;
    deleteRecord(entity: GameEntity): this;
    getRecord(entity: GameEntity): MemoryRecord;
    hasRecord(entity: GameEntity): boolean;
    clear(): this;
    getValidMemoryRecords(currentTime: number, result: MemoryRecord[]): MemoryRecord[];
  }

  export class FuzzyTerm {}
  export class FuzzySet extends FuzzyTerm {
    degreeOfMembership: number;
    representativeValue: number;
  }
  export class LeftShoulderFuzzySet extends FuzzySet {
    constructor(left: number, midpoint: number, right: number);
  }
  export class RightShoulderFuzzySet extends FuzzySet {
    constructor(left: number, midpoint: number, right: number);
  }
  export class TriangularFuzzySet extends FuzzySet {
    constructor(left: number, midpoint: number, right: number);
  }

  export class FuzzyAND extends FuzzyTerm {
    constructor(...terms: FuzzyTerm[]);
  }
  export class FuzzyOR extends FuzzyTerm {
    constructor(...terms: FuzzyTerm[]);
  }

  export class FuzzyVariable {
    fuzzySets: FuzzySet[];
    add(fuzzySet: FuzzySet): this;
    fuzzify(value: number): this;
  }

  export class FuzzyRule {
    constructor(antecedent: FuzzyTerm, consequence: FuzzyTerm);
  }

  export class FuzzyModule {
    flvs: Map<string, FuzzyVariable>;
    rules: FuzzyRule[];
    addFLV(name: string, flv: FuzzyVariable): this;
    removeFLV(name: string): this;
    addRule(rule: FuzzyRule): this;
    fuzzify(name: string, value: number): this;
    defuzzify(name: string, type?: string): number;
  }

  export class Time {
    constructor();
    getDelta(): number;
    getElapsed(): number;
    update(): this;
  }

  export class EntityManager {
    entities: GameEntity[];
    add(entity: GameEntity): this;
    remove(entity: GameEntity): this;
    update(delta: number): this;
  }
}
