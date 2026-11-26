/*
 * Simulation → presentation boundary.
 *
 * The match simulation never calls audio, haptics, DOM or rendering directly.
 * It *emits* typed events onto this bus and keeps a tiny {@link pulse} block of
 * "how the match feels right now" up to date. Presentation modules (audio,
 * feedback/HUD, camera, net ripple, crowd, the dev lab) subscribe.
 *
 * Why: (1) the headless harness runs the identical sim with zero stubs for these
 * paths, (2) a deterministic sim cannot depend on wall-clock presentation code,
 * (3) every new presentation system (commentary, crowd emotion, match-story
 * recognition, stats) gets the same honest feed of what actually happened.
 *
 * Events are dispatched synchronously in emit() order. Handlers must not mutate
 * simulation state.
 */

/** World-space position attached to events that have one (for spatial audio/VFX). */
export interface At {
  x: number;
  y: number;
  z: number;
}

export type KickKind = 'pass' | 'through' | 'cross' | 'lob' | 'shot' | 'finesse' | 'chip' | 'clear' | 'header' | 'volley' | 'touch' | 'knock';

export type SimEvent =
  /** A player struck the ball. `power` is launch speed (u/s). `touch` = dribble touch (quiet). */
  | ({ t: 'kick'; kind: KickKind; power: number; team: 0 | 1; human: boolean } & At)
  /** A deliberate attempt on goal left a boot/head. `xg` is an estimate in 0..1. */
  | ({ t: 'shot'; team: 0 | 1; power: number; xg: number; human: boolean } & At)
  /** The ball hit the turf hard enough to matter. `speed` = vertical impact speed. */
  | ({ t: 'bounce'; speed: number } & At)
  /** Woodwork. `bar` true = crossbar, false = post. `speed` = impact speed. */
  | ({ t: 'post'; speed: number; bar: boolean } & At)
  /** The ball hit a goal net. `side` +1 = the +X goal, −1 = the −X goal. Velocity at impact. */
  | ({ t: 'net'; side: 1 | -1; speed: number; vx: number; vy: number; vz: number; goal: boolean } & At)
  /** Goal for `team` (0 = home/user). */
  | { t: 'goal'; team: 0 | 1; big: boolean; scorer: string | null; assist: string | null; score: [number, number]; lastGasp: boolean }
  /** Keeper stopped a shot. `team` = the keeper's team. */
  | ({ t: 'save'; team: 0 | 1; parry: boolean; diving: boolean; speed: number } & At)
  /** A shot missed the frame narrowly (within ~1.5 m of the woodwork). `team` = shooter's team. */
  | ({ t: 'nearmiss'; team: 0 | 1 } & At)
  /** Ball won in a challenge. `team` = the winner's team. */
  | ({ t: 'tackle'; team: 0 | 1; slide: boolean; human: boolean } & At)
  /** Ball deflected off a body (block). */
  | ({ t: 'block'; team: 0 | 1; speed: number } & At)
  /** Two players collided. `force` ~ closing speed (u/s). */
  | ({ t: 'collide'; force: number } & At)
  /** A player received the ball. `quality` 0 (heavy, bounced off) .. 1 (killed dead). */
  | ({ t: 'firstTouch'; team: 0 | 1; quality: number; human: boolean } & At)
  /** A slide tackle or keeper dive was launched. */
  | ({ t: 'slide'; team: 0 | 1 } & At)
  | ({ t: 'dive'; team: 0 | 1 } & At)
  /** Free kick given against `team`. card: 0 none · 1 yellow · 2 red. */
  | { t: 'foul'; team: 0 | 1; card: 0 | 1 | 2; player: string }
  | { t: 'offside'; team: 0 | 1; player: string }
  /** Restart awarded to `team`. */
  | ({ t: 'setpiece'; kind: 'throw' | 'corner' | 'goalkick' | 'freekick' | 'kickoff'; team: 0 | 1 } & At)
  /** Referee whistle. */
  | { t: 'whistle'; kind: 'kickoff' | 'half' | 'full' | 'foul' | 'goal' | 'offside' | 'restart' }
  /** Possession changed hands between teams (null = loose ball → team). */
  | { t: 'turnover'; team: 0 | 1 }
  /** A short on-screen call-out (replaces direct toast calls from the sim). */
  | { t: 'toast'; text: string };

export type SimEventType = SimEvent['t'];
type Handler<K extends SimEventType> = (e: Extract<SimEvent, { t: K }>) => void;

const handlers = new Map<SimEventType, Array<(e: SimEvent) => void>>();
const anyHandlers: Array<(e: SimEvent) => void> = [];
let muted = false;

/** Subscribe to one event type. Returns an unsubscribe function. */
export function on<K extends SimEventType>(type: K, fn: Handler<K>): () => void {
  let list = handlers.get(type);
  if (!list) handlers.set(type, (list = []));
  const h = fn as (e: SimEvent) => void;
  list.push(h);
  return () => {
    const i = list!.indexOf(h);
    if (i >= 0) list!.splice(i, 1);
  };
}

/** Subscribe to every event (stats recorders, the dev lab, commentary). */
export function onAny(fn: (e: SimEvent) => void): () => void {
  anyHandlers.push(fn);
  return () => {
    const i = anyHandlers.indexOf(fn);
    if (i >= 0) anyHandlers.splice(i, 1);
  };
}

/** Emit an event from the simulation. */
export function emit(e: SimEvent): void {
  if (muted) return;
  const list = handlers.get(e.t);
  if (list) for (let i = 0; i < list.length; i++) list[i](e);
  for (let i = 0; i < anyHandlers.length; i++) anyHandlers[i](e);
}

/**
 * Silence the bus (used while the World Cup resolves AI-vs-AI fixtures in a
 * burst on the live page, so a hundred simulated goals don't roar at once).
 */
export function setBusMuted(v: boolean): void {
  muted = v;
}

/**
 * A continuously-updated summary of the match "temperature", written by the sim
 * once per tick and read by presentation (crowd emotion, music, camera, HUD).
 * Plain numbers only — cheap to read every frame.
 */
export const pulse = {
  /** True while a match is being played (not menu / full time). */
  live: false,
  /** 'menu' | 'play' | 'celebrate' | 'halftime' | 'shootout' | 'fulltime' */
  state: 'menu' as string,
  ballX: 0,
  ballY: 0,
  ballZ: 0,
  ballSpeed: 0,
  /** Team index in possession (0 home/user, 1 away) or −1 for a loose ball. */
  possession: -1,
  /**
   * Attacking threat 0..1 for each team: how dangerous the current situation is
   * for the *opponent's* goal (ball proximity + possession + open shooting lane).
   */
  threat: [0, 0] as [number, number],
  score: [0, 0] as [number, number],
  /** Seconds left in the half (excluding stoppage) and current half (1|2). */
  timeLeft: 0,
  half: 1,
  /** True during added time. */
  stoppage: false,
  /** Half-length of the pitch along X / Z in world units (for spatial panning). */
  halfL: 30,
  halfW: 20,
};
