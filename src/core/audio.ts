/*
 * Audio façade — the game's single entry point to sound.
 *
 * Every sound is synthesised at run time (zero audio assets). The engine lives
 * in src/audio/; this file owns the AudioContext lifecycle and the wiring:
 *
 *   sim ──emit──► core/bus ──onAny──► Audio (here) ──► engine.event()
 *   game loop ──Audio.update(dt)──► engine.update(dt, pulse)   (crowd emotion + bed)
 *
 * ALL gameplay sound is driven by bus events + `pulse`. The legacy imperative
 * methods (kick/pass/whistle/roar/setCrowd…) are kept only so existing call
 * sites compile; they are silent no-ops.
 *
 * Importing this module never touches Web Audio: the context is created lazily
 * in `resume()` (call it from a user gesture — required on iOS). Nothing here
 * throws, including where `AudioContext` does not exist.
 */
import { onAny, pulse, type SimEvent } from './bus';
import { createCrowdModel } from '../audio/emotion';
import { createEngine, type Engine } from '../audio/engine';
import type { BusName, MixerStats, Quality } from '../audio/mixer';
import { createSpeech, type SayOpts } from '../audio/speech';
import type { UiSound } from '../audio/uiSounds';

export type { BusName, Quality, UiSound, SayOpts };

function createAudio() {
  let ctx: AudioContext | null = null;
  let engine: Engine | null = null;
  let failed = false;
  let muted = false;
  let hidden = false;
  let mutedFor = 0;
  let quality: Quality = 'full';
  const volumes: Record<BusName, number> = { master: 1, sfx: 1, crowd: 1, ui: 1, commentary: 1 };
  // The crowd's emotional state is pure and cheap: it runs from the first frame,
  // audio or not, so the stadium is already "in the match" when sound is unlocked.
  const model = createCrowdModel();
  const speech = createSpeech();

  function running(): boolean {
    return !!engine && !!ctx && !muted && ctx.state === 'running';
  }

  function wake(): void {
    if (!ctx || muted || hidden) return;
    try {
      if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    } catch {
      /* ignore */
    }
  }

  function ensure(): void {
    if (failed) return;
    if (!ctx) {
      try {
        const w = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
        const Ctor = w.AudioContext ?? w.webkitAudioContext;
        if (!Ctor) {
          failed = true;
          return;
        }
        ctx = new Ctor({ latencyHint: 'interactive' });
        engine = createEngine(ctx, { quality, model });
        for (const b of Object.keys(volumes) as BusName[]) engine.setVolume(b, volumes[b]);
        engine.setMuted(muted);
      } catch {
        failed = true;
        ctx = null;
        engine = null;
        return;
      }
    }
    // Always resume inside the gesture, even when muted: this is what unlocks iOS.
    // (A muted context is suspended again from update() after a moment.)
    try {
      if (ctx.state !== 'running' && !hidden) void ctx.resume().catch(() => undefined);
    } catch {
      /* ignore */
    }
  }

  function onEvent(e: SimEvent): void {
    try {
      if (e.t === 'toast') return;
      if (running() && engine) engine.event(e, pulse);
      else model.event(e, pulse); // keep the emotional state honest while silent
    } catch {
      /* a presentation handler must never break the sim */
    }
  }
  onAny(onEvent);

  // Tab hidden → the frame loop stops, so stop the stadium too. Any later tap also
  // re-wakes a context the OS interrupted (iOS), without ever creating one.
  try {
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', () => {
        hidden = document.visibilityState === 'hidden';
        try {
          if (hidden) {
            speech.cancel();
            if (ctx && ctx.state === 'running') void ctx.suspend().catch(() => undefined);
          } else wake();
        } catch {
          /* ignore */
        }
      });
      const tap = (): void => wake();
      document.addEventListener('pointerdown', tap, { passive: true });
      document.addEventListener('touchend', tap, { passive: true });
    }
  } catch {
    /* no DOM */
  }

  return {
    // ---- legacy gameplay API: intentionally silent (bus events drive all gameplay sound) ----
    kick(): void {},
    pass(): void {},
    tackle(): void {},
    save(): void {},
    whistle(): void {},
    goal(): void {},
    post(): void {},
    bounce(): void {},
    header(): void {},
    chip(): void {},
    slide(): void {},
    setCrowd(_level: number): void {},
    roar(_big = false): void {},

    // ---- lifecycle ---------------------------------------------------------------------------
    /** Create / resume the AudioContext. Call from a user gesture; safe to call repeatedly. */
    resume(): void {
      ensure();
    },
    setMute(m: boolean): void {
      muted = !!m;
      mutedFor = 0;
      try {
        engine?.setMuted(muted);
        if (muted) speech.cancel();
        else wake();
      } catch {
        /* ignore */
      }
    },
    /** Per-frame update with real seconds: crowd emotion, bed mix, voice housekeeping. */
    update(dt: number): void {
      try {
        if (running() && engine) {
          engine.update(dt, pulse);
          return;
        }
        model.update(dt, pulse);
        if (muted && ctx && ctx.state === 'running') {
          // let the mute fade finish, then stop burning CPU on a silent graph
          mutedFor += dt;
          if (mutedFor > 0.6) void ctx.suspend().catch(() => undefined);
        }
      } catch {
        /* ignore */
      }
    },

    // ---- new API -----------------------------------------------------------------------------
    /** Menu / HUD sounds. */
    ui(kind: UiSound): void {
      try {
        if (running() && engine) engine.ui(kind);
      } catch {
        /* ignore */
      }
    },
    /** Bus volume 0..1 (up to 1.5 allowed). 'commentary' scales the optional speech voice. */
    setVolume(bus: BusName, v: number): void {
      const val = Math.max(0, Math.min(1.5, Number.isFinite(v) ? v : 1));
      volumes[bus] = val;
      try {
        if (bus === 'commentary') speech.setVolume(val);
        engine?.setVolume(bus, val);
      } catch {
        /* ignore */
      }
    },
    getVolume(bus: BusName): number {
      return volumes[bus];
    },
    /** 'lite' drops the convolution reverb, the extra crowd layers and halves the voice cap. */
    setQuality(q: Quality): void {
      quality = q === 'lite' ? 'lite' : 'full';
      try {
        engine?.setQuality(quality);
      } catch {
        /* ignore */
      }
    },
    getQuality(): Quality {
      return quality;
    },
    /** Optional spoken commentary (Web Speech API). OFF by default. */
    setCommentary(on: boolean): void {
      speech.setEnabled(!!on);
    },
    /** Speak a line if commentary is on, nothing is being said and the rate limit allows. Returns whether it was spoken. */
    say(text: string, opts?: SayOpts): boolean {
      if (muted || hidden) return false;
      return speech.say(text, opts);
    },
    /** Diagnostics: context state, voice/node counts, the crowd's emotional state. */
    debug(): { state: string; stats: MixerStats | null; emotion: Readonly<typeof model.state>; speech: boolean } {
      return { state: ctx ? ctx.state : failed ? 'unavailable' : 'none', stats: engine ? { ...engine.stats() } : null, emotion: model.state, speech: speech.supported };
    },
  };
}

export const Audio = createAudio();
