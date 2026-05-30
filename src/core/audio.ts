import { rand } from './math';

/**
 * Tiny procedural Web Audio engine — every sound is synthesised at runtime so
 * the game ships with zero audio assets. Lazily initialised on first user
 * gesture to satisfy mobile autoplay policies.
 */
function createAudio() {
  let ctx: AudioContext | null = null;
  let muted = false;
  let master: GainNode | null = null;
  let crowdGain: GainNode | null = null;
  let crowdStarted = false;

  function ensure(): void {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    startCrowd();
  }

  /**
   * A continuous, procedurally-generated crowd murmur — a looping bed of
   * low-passed brown noise. Its level is driven by the action (see setCrowd),
   * swelling as the ball nears a goal, which gives the match a living-stadium
   * atmosphere on a phone speaker. (Atmosphere idea from open-football's
   * autonomous "living world".)
   */
  function startCrowd(): void {
    if (crowdStarted || muted || !ctx || !master) return;
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02; // integrate toward brown noise
      d[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 640;
    crowdGain = ctx.createGain();
    crowdGain.gain.value = 0.0;
    src.connect(lp);
    lp.connect(crowdGain);
    crowdGain.connect(master);
    src.start();
    crowdStarted = true;
  }

  function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.4, slideTo: number | null = null): void {
    if (muted) return;
    ensure();
    if (!ctx || !master) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g);
    g.connect(master);
    o.start();
    o.stop(ctx.currentTime + dur);
  }

  function noise(dur: number, vol = 0.4, filt = 1200): void {
    if (muted) return;
    ensure();
    if (!ctx || !master) return;
    const n = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    n.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = filt;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    n.connect(f);
    f.connect(g);
    g.connect(master);
    n.start();
    n.stop(ctx.currentTime + dur);
  }

  return {
    kick(): void {
      tone(rand(150, 210), 0.09, 'triangle', 0.5, 90);
      noise(0.05, 0.25, 2400);
    },
    pass(): void {
      tone(rand(260, 320), 0.07, 'sine', 0.3, 180);
    },
    tackle(): void {
      noise(0.12, 0.4, 800);
    },
    save(): void {
      noise(0.14, 0.45, 500);
      tone(120, 0.12, 'sine', 0.3);
    },
    whistle(): void {
      if (muted) return;
      ensure();
      tone(2100, 0.18, 'square', 0.22, 2400);
      setTimeout(() => tone(2200, 0.14, 'square', 0.2, 2100), 120);
    },
    goal(): void {
      if (muted) return;
      ensure();
      [392, 523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.4, 'sawtooth', 0.34), i * 90));
      noise(1.4, 0.18, 900);
    },
    post(): void {
      tone(900, 0.08, 'square', 0.3, 300);
    },
    bounce(): void {
      tone(rand(120, 160), 0.06, 'sine', 0.22, 70);
    },
    header(): void {
      tone(rand(180, 230), 0.07, 'triangle', 0.4, 120);
      noise(0.04, 0.18, 1600);
    },
    chip(): void {
      tone(rand(420, 500), 0.1, 'sine', 0.3, 260);
    },
    slide(): void {
      noise(0.22, 0.4, 600);
    },
    /** Set crowd ambience level (0..1) — eased so swells feel natural. */
    setCrowd(level: number): void {
      if (muted || !ctx || !crowdGain) return;
      const t = 0.02 + Math.max(0, Math.min(1, level)) * 0.075;
      crowdGain.gain.setTargetAtTime(t, ctx.currentTime, 0.35);
    },
    /** A short crowd swell for a big moment (shot, save, goal). */
    roar(big = false): void {
      if (muted) return;
      ensure();
      if (!ctx || !master) return;
      if (crowdGain) {
        crowdGain.gain.cancelScheduledValues(ctx.currentTime);
        crowdGain.gain.setValueAtTime(crowdGain.gain.value, ctx.currentTime);
        crowdGain.gain.linearRampToValueAtTime(big ? 0.22 : 0.13, ctx.currentTime + 0.12);
        crowdGain.gain.setTargetAtTime(0.05, ctx.currentTime + 0.2, big ? 0.9 : 0.45);
      }
      noise(big ? 1.1 : 0.5, big ? 0.16 : 0.09, 800);
    },
    setMute(m: boolean): void {
      muted = m;
      if (m && crowdGain && ctx) crowdGain.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    },
    resume(): void {
      ensure();
    },
  };
}

export const Audio = createAudio();
