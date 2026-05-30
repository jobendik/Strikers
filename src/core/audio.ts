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

  function ensure(): void {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
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
    setMute(m: boolean): void {
      muted = m;
    },
    resume(): void {
      ensure();
    },
  };
}

export const Audio = createAudio();
