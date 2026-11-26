/*
 * The audio engine: one instance per audio context.
 *
 * `createEngine(ctx)` works against a live AudioContext or an
 * OfflineAudioContext — the offline path is how the engine is verified
 * numerically (see docs/AUDIO_DESIGN.md). The engine does not subscribe to the
 * bus itself; `core/audio.ts` forwards bus events and the per-frame update, so
 * tests can drive a private instance with their own events and pulse.
 */
import type { SimEvent } from '../core/bus';
import { bakeApplause, bakeTexture, canBake } from './bake';
import { Crowd } from './crowd';
import { createCrowdModel, type CrowdCue, type CrowdModel, type PulseLike } from './emotion';
import * as foley from './foley';
import { Mixer, type BusName, type MixerStats, type Quality } from './mixer';
import { clamp, mulberry32 } from './rng';
import { uiSound, type UiSound } from './uiSounds';

export interface EngineOpts {
  quality?: Quality;
  /** Seed for every random choice (omit for a fresh one). */
  seed?: number;
  /** Final output node (default: ctx.destination). */
  output?: AudioNode;
  /** Share an existing emotion model (so it can run before audio is unlocked). */
  model?: CrowdModel;
  /** Bake the crowd textures (default true). False = noise-only crowd. */
  bake?: boolean;
}

export interface Engine {
  readonly ctx: BaseAudioContext;
  readonly mixer: Mixer;
  readonly crowd: Crowd;
  readonly model: CrowdModel;
  /** Resolves when the baked crowd textures are in (or baking was skipped / failed). */
  readonly ready: Promise<void>;
  /** Feed one sim event. Never throws. */
  event(e: SimEvent, p: PulseLike): void;
  /** Per-frame update with real seconds. Never throws. */
  update(dt: number, p: PulseLike): void;
  ui(kind: UiSound): void;
  setVolume(bus: BusName, v: number): void;
  setQuality(q: Quality): void;
  setMuted(m: boolean): void;
  stats(): MixerStats;
  dispose(): void;
}

const VOICES: Record<Quality, { murmur: number; roar: number; ooh: number; clappers: number }> = {
  full: { murmur: 44, roar: 36, ooh: 28, clappers: 160 },
  lite: { murmur: 18, roar: 14, ooh: 12, clappers: 70 },
};

/** Seconds between pushes of the bed mix onto AudioParams. */
const MIX_INTERVAL = 0.04;

export function createEngine(ctx: BaseAudioContext, opts: EngineOpts = {}): Engine {
  const seed = opts.seed ?? (Math.floor(Math.random() * 0xffffffff) >>> 0);
  const mixer = new Mixer(ctx, { quality: opts.quality ?? 'full', seed, output: opts.output });
  const crowd = new Crowd(mixer);
  const model = opts.model ?? createCrowdModel();
  let disposed = false;
  let mixT = MIX_INTERVAL;

  crowd.start();
  crowd.apply(model.mix(), 0.8);

  // Baking runs after creation (never inside the unlocking user gesture): applause
  // in plain JS, then the three vocal textures through OfflineAudioContexts. Until a
  // texture lands, its bed layer is absent and one-shots fall back to shaped noise.
  const q = VOICES[mixer.quality];
  const bakeRand = mulberry32(seed ^ 0x9e3779b9);
  const ready: Promise<void> =
    opts.bake === false
      ? Promise.resolve()
      : (async () => {
          await Promise.resolve();
          crowd.setTexture('sparse', bakeApplause(ctx, 20, 4, bakeRand));
          crowd.setTexture('applause', bakeApplause(ctx, q.clappers, 4, bakeRand));
          if (!canBake()) return;
          for (const name of ['murmur', 'roar', 'ooh'] as const) {
            if (disposed) return;
            const buf = await bakeTexture(ctx, name, q[name], bakeRand);
            if (disposed) return;
            crowd.setTexture(name, buf);
          }
        })().catch(() => undefined);

  function place(x: number, z: number, p: PulseLike): foley.Place {
    const hl = p.halfL > 0 ? p.halfL : 30;
    const hw = p.halfW > 0 ? p.halfW : 20;
    const dx = (x - p.ballX) / hl;
    const pan = clamp(dx, -1, 1) * 0.85;
    const att = 1 - 0.22 * Math.min(1, Math.abs(z) / hw) - 0.12 * Math.min(1, Math.abs(dx));
    return { pan: Number.isFinite(pan) ? pan : 0, att: Number.isFinite(att) ? att : 1 };
  }

  function cues(list: CrowdCue[]): void {
    for (const c of list) crowd.cue(c);
  }

  function sfx(e: SimEvent, p: PulseLike): void {
    switch (e.t) {
      case 'kick':
        foley.kick(mixer, e.kind, e.power, e.human, place(e.x, e.z, p));
        break;
      case 'bounce':
        foley.bounce(mixer, e.speed, place(e.x, e.z, p));
        break;
      case 'post':
        foley.woodwork(mixer, e.bar, e.speed, place(e.x, e.z, p));
        break;
      case 'net':
        foley.net(mixer, e.speed, e.goal, place(e.x, e.z, p));
        break;
      case 'save':
        foley.save(mixer, e.parry, e.diving, e.speed, place(e.x, e.z, p));
        break;
      case 'tackle':
        foley.tackle(mixer, e.slide, e.human, place(e.x, e.z, p));
        break;
      case 'block':
        foley.block(mixer, e.speed, place(e.x, e.z, p));
        break;
      case 'collide':
        foley.collide(mixer, e.force, place(e.x, e.z, p));
        break;
      case 'firstTouch':
        foley.clumsyTouch(mixer, e.quality, e.human, place(e.x, e.z, p));
        break;
      case 'slide':
        foley.slideStart(mixer, place(e.x, e.z, p));
        break;
      case 'dive':
        foley.dive(mixer, place(e.x, e.z, p));
        break;
      case 'whistle':
        foley.whistle(mixer, e.kind);
        break;
      default:
        break; // shot / goal / nearmiss / foul / offside / setpiece / turnover / toast: crowd only
    }
  }

  return {
    ctx,
    mixer,
    crowd,
    model,
    ready,
    event(e, p) {
      if (disposed) return;
      try {
        sfx(e, p);
        cues(model.event(e, p));
      } catch {
        /* audio must never break the game */
      }
    },
    update(dt, p) {
      if (disposed) return;
      try {
        const list = model.update(dt, p);
        cues(list);
        mixT += dt;
        if (mixT >= MIX_INTERVAL) {
          mixT = 0;
          crowd.apply(model.mix());
        }
        mixer.sweep();
      } catch {
        /* ignore */
      }
    },
    ui(kind) {
      try {
        uiSound(mixer, kind);
      } catch {
        /* ignore */
      }
    },
    setVolume(bus, v) {
      mixer.setVolume(bus, v);
    },
    setQuality(qq) {
      if (qq === mixer.quality) return;
      crowd.teardown();
      mixer.setQuality(qq);
      crowd.start();
    },
    setMuted(mu) {
      mixer.setMuted(mu);
      if (mu) mixer.killAll();
    },
    stats() {
      return mixer.stats;
    },
    dispose() {
      disposed = true;
      mixer.killAll();
      crowd.teardown();
      try {
        mixer.clip.disconnect();
      } catch {
        /* ignore */
      }
    },
  };
}
