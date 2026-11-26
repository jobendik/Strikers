/*
 * Mixer: the static signal graph, shared buffers and the voice pool.
 *
 *   voices ─┬─► sfx bus ──┐
 *           ├─► crowd bus ─┼─► master ─► limiter (compressor) ─► soft clip ─► out
 *           └─► ui bus ───┘                 ▲
 *   voice sends ─► reverb in ─► stadium reverb ─► reverb return ─┘ (into master)
 *
 * Works against any BaseAudioContext, so the identical graph renders offline
 * (OfflineAudioContext) for numeric verification. Nothing here uses timers:
 * every envelope is scheduled on the context clock, and finished voices are
 * retired by comparing their end time with `ctx.currentTime` in `sweep()`.
 */
import { clamp, mulberry32, type Rng } from './rng';

export type Quality = 'full' | 'lite';
export type BusName = 'master' | 'sfx' | 'crowd' | 'ui' | 'commentary';
export type NodeBus = 'sfx' | 'crowd' | 'ui';
export type NoiseKind = 'white' | 'pink' | 'brown';

export interface Voice {
  /** Voice-private level node; everything in the voice sums into it. */
  out: GainNode;
  /** Last node of the voice (panner or `out`), connected to the bus. */
  tail: AudioNode;
  send: GainNode | null;
  srcs: AudioScheduledSourceNode[];
  t0: number;
  end: number;
  prio: number;
  nodes: number;
  tag: string;
}

export interface VoiceOpts {
  bus: NodeBus;
  /** Upper bound on the voice's life in seconds (from `at`). */
  dur: number;
  /** Start time on the context clock (default: now). */
  at?: number;
  pan?: number;
  gain?: number;
  /** Reverb send level (0 = dry). */
  send?: number;
  /** Higher survives voice stealing. 0 = trivial foley … 9 = goal roar / whistle. */
  prio?: number;
  tag?: string;
}

export interface MixerStats {
  voices: number;
  peakVoices: number;
  nodes: number;
  peakNodes: number;
  staticNodes: number;
  started: number;
  stolen: number;
  dropped: number;
}

/** Internal trim per bus (linear) — the mix balance. User volumes multiply these. */
export const BUS_TRIM: Record<NodeBus, number> = { sfx: 0.9, crowd: 0.8, ui: 0.55 };
export const VOICE_CAP: Record<Quality, number> = { full: 28, lite: 14 };
export const REVERB_RETURN = 0.7;

/** Equal-power crossfade the tail of `d` (length n+xf) into its head → seamless loop of n. */
export function seamless(d: Float32Array, n: number, xf: number): Float32Array {
  const o = new Float32Array(n);
  o.set(d.subarray(0, n));
  for (let i = 0; i < xf; i++) {
    const w = i / xf;
    o[i] = d[i] * Math.sqrt(w) + d[n + i] * Math.sqrt(1 - w);
  }
  return o;
}

export function rmsNormalise(chs: Float32Array[], target: number): void {
  let sum = 0;
  let n = 0;
  for (const c of chs) {
    for (let i = 0; i < c.length; i++) sum += c[i] * c[i];
    n += c.length;
  }
  const rms = Math.sqrt(sum / Math.max(1, n));
  if (rms < 1e-9) return;
  const k = target / rms;
  for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= k;
}

function makeNoise(ctx: BaseAudioContext, rand: Rng): Record<NoiseKind, AudioBuffer> {
  const sr = ctx.sampleRate;
  // white: 2 s mono
  const white = ctx.createBuffer(1, Math.floor(sr * 2), sr);
  const w = white.getChannelData(0);
  for (let i = 0; i < w.length; i++) w[i] = rand() * 2 - 1;

  // pink: 5 s stereo, independent channels (Paul Kellet's economy filter)
  const pn = Math.floor(sr * 5);
  const xf = Math.floor(sr * 0.25);
  const pink = ctx.createBuffer(2, pn, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = new Float32Array(pn + xf);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < d.length; i++) {
      const x = rand() * 2 - 1;
      b0 = 0.99765 * b0 + x * 0.099046;
      b1 = 0.963 * b1 + x * 0.2965164;
      b2 = 0.57 * b2 + x * 1.0526913;
      d[i] = b0 + b1 + b2 + x * 0.1848;
    }
    const o = seamless(d, pn, xf);
    rmsNormalise([o], 0.25);
    pink.getChannelData(ch).set(o);
  }

  // brown: 4 s mono (leaky integrator)
  const bn = Math.floor(sr * 4);
  const d = new Float32Array(bn + xf);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    last = (last + 0.02 * (rand() * 2 - 1)) / 1.02;
    d[i] = last;
  }
  const bo = seamless(d, bn, xf);
  rmsNormalise([bo], 0.25);
  const brown = ctx.createBuffer(1, bn, sr);
  brown.getChannelData(0).set(bo);
  return { white, pink, brown };
}

/** A slow random "wander" signal in −1..1 used as an LFO source for the crowd bed. */
function makeWander(ctx: BaseAudioContext, rand: Rng): AudioBuffer {
  const sr = 8000;
  const n = sr * 32;
  const xf = sr * 2;
  const d = new Float32Array(n + xf);
  let a = 0;
  let b = 0;
  const k = 1 - Math.exp((-2 * Math.PI * 0.45) / sr);
  for (let i = 0; i < d.length; i++) {
    a += k * (rand() * 2 - 1 - a);
    b += k * (a - b);
    d[i] = b;
  }
  const o = seamless(d, n, xf);
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(o[i]));
  for (let i = 0; i < n; i++) o[i] /= peak;
  const buf = ctx.createBuffer(1, n, sr);
  buf.getChannelData(0).set(o);
  return buf;
}

/**
 * Procedural stadium impulse response: an open bowl. No close walls, so the
 * early field is a few discrete slap-backs off the far stands, followed by a
 * long, diffuse, fairly bright tail whose highs die faster than its lows.
 */
export function makeStadiumIR(ctx: BaseAudioContext, rand: Rng, seconds = 2.8): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const ir = ctx.createBuffer(2, n, sr);
  const pre = 0.022;
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr - pre;
      if (t < 0) continue;
      // diffuse build-up (40 ms) then a two-slope decay: T60 ≈ 2.5 s on the tail
      const build = 1 - Math.exp(-t / 0.035);
      const env = build * (0.55 * Math.exp(-t / 0.16) + 0.45 * Math.exp(-t / 0.37));
      // time-varying one-pole low-pass: 9 kHz → ~1.4 kHz
      const fc = 1400 + 7600 * Math.exp(-t / 0.7);
      const a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      lp += a * (rand() * 2 - 1 - lp);
      d[i] = lp * env;
    }
    // far-stand slap-backs (different path lengths per ear)
    const taps = ch === 0 ? [0.083, 0.171, 0.262] : [0.097, 0.157, 0.289];
    const gains = [0.5, 0.36, 0.24];
    for (let k = 0; k < taps.length; k++) {
      const i0 = Math.floor(taps[k] * sr);
      const len = Math.floor(0.004 * sr);
      for (let i = 0; i < len && i0 + i < n; i++) {
        d[i0 + i] += (rand() * 2 - 1) * gains[k] * 0.35 * (1 - i / len);
      }
    }
    // fade the very end to exact silence
    const fade = Math.floor(sr * 0.2);
    for (let i = 0; i < fade; i++) d[n - 1 - i] *= i / fade;
    // unit energy: a noise-like input leaves at the same RMS
    let e = 0;
    for (let i = 0; i < n; i++) e += d[i] * d[i];
    const g = 1 / Math.sqrt(Math.max(1e-12, e));
    for (let i = 0; i < n; i++) d[i] *= g;
  }
  return ir;
}

function makeClipCurve(): Float32Array {
  // identity up to ±0.85, then a tanh knee that tops out at ±0.956
  const n = 2049;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const ax = Math.abs(x);
    const y = ax <= 0.85 ? ax : 0.85 + 0.13 * Math.tanh((ax - 0.85) / 0.13);
    c[i] = Math.sign(x) * y;
  }
  return c;
}

export class Mixer {
  readonly ctx: BaseAudioContext;
  readonly rand: Rng;
  quality: Quality;
  readonly master: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly clip: WaveShaperNode;
  readonly buses: Record<NodeBus, GainNode>;
  readonly reverbIn: GainNode;
  readonly reverbOut: GainNode;
  readonly noise: Record<NoiseKind, AudioBuffer>;
  readonly wander: AudioBuffer;
  readonly vol: Record<BusName, number> = { master: 1, sfx: 1, crowd: 1, ui: 1, commentary: 1 };
  readonly stats: MixerStats = { voices: 0, peakVoices: 0, nodes: 0, peakNodes: 0, staticNodes: 0, started: 0, stolen: 0, dropped: 0 };
  muted = false;
  private voices: Voice[] = [];
  private reverbNodes: AudioNode[] = [];
  private irFull: AudioBuffer | null = null;
  private gates = new Map<string, number>();
  private voiceNodes = 0;

  constructor(ctx: BaseAudioContext, opts: { quality: Quality; seed: number; output?: AudioNode }) {
    this.ctx = ctx;
    this.quality = opts.quality;
    this.rand = mulberry32(opts.seed);

    this.master = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -10;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.2;
    this.clip = ctx.createWaveShaper();
    this.clip.curve = makeClipCurve();
    this.master.connect(this.limiter);
    this.limiter.connect(this.clip);
    this.clip.connect(opts.output ?? ctx.destination);

    const mk = (name: NodeBus): GainNode => {
      const g = ctx.createGain();
      g.gain.value = BUS_TRIM[name];
      g.connect(this.master);
      return g;
    };
    this.buses = { sfx: mk('sfx'), crowd: mk('crowd'), ui: mk('ui') };

    this.reverbIn = ctx.createGain();
    this.reverbOut = ctx.createGain();
    this.reverbOut.gain.value = REVERB_RETURN;
    this.reverbOut.connect(this.master);
    this.stats.staticNodes = 8;

    this.noise = makeNoise(ctx, this.rand);
    this.wander = makeWander(ctx, this.rand);
    this.buildReverb();
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  get cap(): number {
    return VOICE_CAP[this.quality];
  }

  /** Count persistent nodes created outside the voice pool (the crowd bed). */
  addStatic(n: number): void {
    this.stats.staticNodes += n;
  }

  /** (Re)build the reverb section for the current quality tier. */
  buildReverb(): void {
    for (const n of this.reverbNodes) {
      try {
        n.disconnect();
      } catch {
        /* already gone */
      }
    }
    try {
      this.reverbIn.disconnect();
    } catch {
      /* not connected yet */
    }
    this.stats.staticNodes -= this.reverbNodes.length;
    this.reverbNodes = [];
    const ctx = this.ctx;
    if (this.quality === 'full') {
      if (!this.irFull) this.irFull = makeStadiumIR(ctx, this.rand);
      const conv = ctx.createConvolver();
      conv.normalize = false;
      conv.buffer = this.irFull;
      this.reverbIn.connect(conv);
      conv.connect(this.reverbOut);
      this.reverbNodes = [conv];
    } else {
      // lite: one filtered feedback slap-back instead of a convolver
      const delay = ctx.createDelay(0.5);
      delay.delayTime.value = 0.127;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2400;
      const fb = ctx.createGain();
      fb.gain.value = 0.42;
      const wet = ctx.createGain();
      wet.gain.value = 0.5;
      this.reverbIn.connect(delay);
      delay.connect(lp);
      lp.connect(fb);
      fb.connect(delay);
      lp.connect(wet);
      wet.connect(this.reverbOut);
      this.reverbNodes = [delay, lp, fb, wet];
    }
    this.stats.staticNodes += this.reverbNodes.length;
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.buildReverb();
  }

  setVolume(bus: BusName, v: number): void {
    const val = clamp(Number.isFinite(v) ? v : 1, 0, 1.5);
    this.vol[bus] = val;
    const t = this.now;
    if (bus === 'master') this.master.gain.setTargetAtTime(this.muted ? 0 : val, t, 0.03);
    else if (bus !== 'commentary') this.buses[bus].gain.setTargetAtTime(BUS_TRIM[bus] * val, t, 0.03);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.master.gain.setTargetAtTime(m ? 0 : this.vol.master, this.now, 0.04);
  }

  /** Per-tag rate limiter: true if at least `gap` seconds passed since the last accepted call. */
  gate(tag: string, gap: number): boolean {
    const t = this.now;
    const last = this.gates.get(tag);
    if (last !== undefined && t - last < gap && t >= last) return false;
    this.gates.set(tag, t);
    return true;
  }

  // ---- voice pool ---------------------------------------------------------------

  voice(o: VoiceOpts): Voice | null {
    if (this.muted) return null;
    const ctx = this.ctx;
    const t0 = Math.max(o.at ?? ctx.currentTime, ctx.currentTime);
    const prio = o.prio ?? 1;
    this.sweep();
    if (this.voices.length >= this.cap) {
      // steal the lowest-priority, then oldest, voice that is not more important than us
      let pick = -1;
      for (let i = 0; i < this.voices.length; i++) {
        const v = this.voices[i];
        if (v.prio > prio) continue;
        if (pick < 0 || v.prio < this.voices[pick].prio || (v.prio === this.voices[pick].prio && v.t0 < this.voices[pick].t0)) pick = i;
      }
      if (pick < 0) {
        this.stats.dropped++;
        return null;
      }
      this.kill(this.voices[pick]);
      this.voices.splice(pick, 1);
      this.stats.stolen++;
    }
    const out = ctx.createGain();
    out.gain.value = o.gain ?? 1;
    let tail: AudioNode = out;
    let nodes = 1;
    const pan = o.pan ?? 0;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      out.connect(p);
      tail = p;
      nodes++;
    }
    tail.connect(this.buses[o.bus]);
    let send: GainNode | null = null;
    if (o.send && o.send > 0) {
      send = ctx.createGain();
      send.gain.value = o.send;
      tail.connect(send);
      send.connect(this.reverbIn);
      nodes++;
    }
    const v: Voice = { out, tail, send, srcs: [], t0, end: t0 + o.dur, prio, nodes, tag: o.tag ?? '' };
    this.voices.push(v);
    this.voiceNodes += nodes;
    this.stats.started++;
    this.account();
    return v;
  }

  private account(): void {
    const st = this.stats;
    st.voices = this.voices.length;
    st.nodes = st.staticNodes + this.voiceNodes;
    if (st.voices > st.peakVoices) st.peakVoices = st.voices;
    if (st.nodes > st.peakNodes) st.peakNodes = st.nodes;
  }

  private release(v: Voice): void {
    try {
      v.tail.disconnect();
      if (v.send) v.send.disconnect();
    } catch {
      /* ignore */
    }
    this.voiceNodes -= v.nodes;
  }

  /** Fast fade + stop (voice stealing / mute). The voice is released on the next sweep-equivalent. */
  private kill(v: Voice): void {
    const t = this.now;
    try {
      v.out.gain.cancelScheduledValues(t);
      v.out.gain.setTargetAtTime(0, t, 0.006);
      for (const s of v.srcs) s.stop(t + 0.04);
    } catch {
      /* a source may already have stopped */
    }
    // nodes fall silent within 40 ms; drop our accounting now
    this.release(v);
  }

  /** Retire voices whose scheduled life is over. Call once per frame. */
  sweep(): void {
    const t = this.now;
    let w = 0;
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      if (v.end + 0.06 < t) this.release(v);
      else this.voices[w++] = v;
    }
    this.voices.length = w;
    this.account();
  }

  /** Fade out and stop every voice with this tag (e.g. a running chant). */
  stopTag(tag: string, fade: number): void {
    const t = this.now;
    for (const v of this.voices) {
      if (v.tag !== tag) continue;
      try {
        v.out.gain.cancelScheduledValues(t);
        v.out.gain.setTargetAtTime(0, t, Math.max(0.01, fade / 4));
        for (const s of v.srcs) s.stop(t + fade + 0.05);
      } catch {
        /* ignore */
      }
      v.end = Math.min(v.end, t + fade + 0.05);
    }
  }

  hasTag(tag: string): boolean {
    const t = this.now;
    for (const v of this.voices) if (v.tag === tag && v.end > t) return true;
    return false;
  }

  killAll(): void {
    for (const v of this.voices) this.kill(v);
    this.voices.length = 0;
    this.account();
  }

  // ---- node helpers (count into the owning voice) -----------------------------------

  osc(v: Voice, type: OscillatorType, freq: number, t0: number, t1: number): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start(t0);
    o.stop(t1 + 0.03);
    v.srcs.push(o);
    this.grow(v, 1);
    return o;
  }

  /** A looping slice of a shared noise buffer, started at a random offset. */
  noiseSrc(v: Voice, kind: NoiseKind, t0: number, t1: number, rate = 1): AudioBufferSourceNode {
    return this.bufSrc(v, this.noise[kind], t0, t1, rate, true);
  }

  bufSrc(v: Voice, buffer: AudioBuffer, t0: number, t1: number, rate = 1, loop = true, offset = -1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = loop;
    s.playbackRate.value = rate;
    s.start(t0, offset >= 0 ? offset : this.rand() * Math.max(0, buffer.duration - 0.05));
    s.stop(t1 + 0.03);
    v.srcs.push(s);
    this.grow(v, 1);
    return s;
  }

  gain(v: Voice, value: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    this.grow(v, 1);
    return g;
  }

  biquad(v: Voice, type: BiquadFilterType, freq: number, q = 0.707): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    this.grow(v, 1);
    return f;
  }

  panner(v: Voice, pan: number): AudioNode {
    if (typeof this.ctx.createStereoPanner !== 'function') return this.gain(v, 1);
    const p = this.ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    this.grow(v, 1);
    return p;
  }

  private grow(v: Voice, n: number): void {
    v.nodes += n;
    this.voiceNodes += n;
    this.account();
  }
}

// ---- envelope helpers ----------------------------------------------------------------

/** 0 → peak (linear, `a` s) → ~0 (exponential, `d` s). */
export function perc(p: AudioParam, t: number, peak: number, a: number, d: number): void {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.exponentialRampToValueAtTime(Math.max(1e-5, peak * 0.001), t + a + d);
  p.setValueAtTime(0, t + a + d + 0.001);
}

/** Attack / hold / release trapezoid with smooth (time-constant) edges. */
export function ahr(p: AudioParam, t: number, peak: number, a: number, h: number, r: number): void {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.setValueAtTime(peak, t + a + h);
  p.setTargetAtTime(0, t + a + h, r / 4);
}

export function sweepExp(p: AudioParam, t: number, from: number, to: number, dur: number): void {
  p.setValueAtTime(Math.max(1, from), t);
  p.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
}
