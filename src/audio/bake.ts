/*
 * Boot-time "baking" of crowd textures. Still zero audio assets: every buffer
 * here is synthesised on the device, once, then looped/enveloped at run time
 * for the cost of a single buffer source.
 *
 * Why bake: a believable mass of people needs dozens of formant-filtered
 * voices. Running ~200 oscillators/filters live would blow a phone's budget;
 * rendering them once through an OfflineAudioContext (native, off the main
 * thread) costs a few hundred ms and a few MB.
 *
 *  - murmur : many people TALKING  (syllabic sawtooth voices → vowel formants)
 *  - roar   : many people SHOUTING (sustained open-vowel "yeaah" voices + formant noise)
 *  - ooh    : many people going "oooh" (closed vowels; pitched up/down at run time
 *             for anticipation swells, groans, boos)
 *  - applause (dense / sparse): thousands of individual clap grains (pure JS)
 *  - chants : a choir of detuned, badly-timed singers on an ORIGINAL contour + unison claps
 */
import { rmsNormalise, seamless } from './mixer';
import type { Rng } from './rng';

export type TextureName = 'murmur' | 'roar' | 'ooh';
const BAKE_RATE = 24000;

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

function offlineCtor(): OfflineCtor | null {
  const g = globalThis as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  return g.OfflineAudioContext ?? g.webkitOfflineAudioContext ?? null;
}

export function canBake(): boolean {
  return offlineCtor() !== null;
}

function renderOffline(channels: number, seconds: number, build: (oc: OfflineAudioContext) => void): Promise<AudioBuffer | null> {
  const Ctor = offlineCtor();
  if (!Ctor) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const oc = new Ctor(channels, Math.ceil(seconds * BAKE_RATE), BAKE_RATE);
      build(oc);
      let done = false;
      const finish = (b: AudioBuffer | null): void => {
        if (!done) {
          done = true;
          resolve(b);
        }
      };
      oc.oncomplete = (ev) => finish(ev.renderedBuffer);
      const p = oc.startRendering() as Promise<AudioBuffer> | undefined;
      if (p && typeof p.then === 'function') p.then(finish, () => finish(null));
    } catch {
      resolve(null);
    }
  });
}

// [F1, F2] in Hz
const VOWELS: Array<[number, number]> = [
  [730, 1090], // a
  [530, 1840], // e
  [270, 2290], // i
  [570, 840], // o
  [300, 870], // u
  [500, 1500], // schwa
  [660, 1720], // ae
];

interface TexSpec {
  seconds: number;
  /** voices:noise RMS mix. */
  noise: number;
  /** [freq, Q, gain] of the formant-noise bed. */
  bands: Array<[number, number, number]>;
}

const SPECS: Record<TextureName, TexSpec> = {
  murmur: {
    seconds: 9,
    noise: 0.7,
    bands: [
      [480, 0.8, 1],
      [1450, 1.0, 0.4],
    ],
  },
  roar: {
    seconds: 6,
    noise: 1.0,
    bands: [
      [800, 1.3, 1],
      [1300, 1.6, 0.8],
      [2700, 2.0, 0.45],
    ],
  },
  ooh: {
    seconds: 5,
    noise: 0.6,
    bands: [
      [420, 1.6, 1],
      [800, 2.0, 0.6],
    ],
  },
};

function build(oc: OfflineAudioContext, kind: TextureName, nVoices: number, total: number, rand: Rng): void {
  const sr = oc.sampleRate;
  const spec = SPECS[kind];
  // 4-channel master: 0/1 = voices, 2/3 = formant noise — balanced in JS afterwards
  const merger = oc.createChannelMerger(4);
  merger.connect(oc.destination);
  const vBus = oc.createGain();
  const vLp = oc.createBiquadFilter();
  vLp.type = 'lowpass';
  vLp.frequency.value = kind === 'roar' ? 4200 : 3200;
  const vSplit = oc.createChannelSplitter(2);
  vBus.connect(vLp);
  vLp.connect(vSplit);
  vSplit.connect(merger, 0, 0);
  vSplit.connect(merger, 1, 1);

  // shared buffers: white noise + slow jitter (pitch instability of real voices)
  const nb = oc.createBuffer(1, sr * 2, sr);
  const nd = nb.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = rand() * 2 - 1;
  const jb = oc.createBuffer(1, sr * 4, sr);
  const jd = jb.getChannelData(0);
  {
    let a = 0;
    let b = 0;
    const k = 1 - Math.exp((-2 * Math.PI * 5) / sr);
    let peak = 1e-9;
    for (let i = 0; i < jd.length; i++) {
      a += k * (rand() * 2 - 1 - a);
      b += k * (a - b);
      jd[i] = b;
      peak = Math.max(peak, Math.abs(b));
    }
    for (let i = 0; i < jd.length; i++) jd[i] /= peak;
  }
  const jit: AudioBufferSourceNode[] = [];
  for (let i = 0; i < 3; i++) {
    const s = oc.createBufferSource();
    s.buffer = jb;
    s.loop = true;
    s.playbackRate.value = 0.6 + 0.37 * i;
    s.start(0, rand() * 3.5);
    jit.push(s);
  }

  const canPan = typeof oc.createStereoPanner === 'function';
  const at = (t: number): number => Math.max(0, t);
  const a0 = 1 / Math.sqrt(nVoices);

  for (let v = 0; v < nVoices; v++) {
    const osc = oc.createOscillator();
    osc.type = 'sawtooth';
    const bp1 = oc.createBiquadFilter();
    bp1.type = 'bandpass';
    bp1.Q.value = 4;
    const bp2 = oc.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.Q.value = 6;
    const env = oc.createGain();
    env.gain.value = 0;
    osc.connect(bp1);
    osc.connect(bp2);
    bp1.connect(env);
    bp2.connect(env);
    if (canPan) {
      const pan = oc.createStereoPanner();
      // seat everyone well off-centre: keeps the two channels decorrelated (a wide bowl)
      pan.pan.value = (rand() < 0.5 ? -1 : 1) * (0.45 + 0.55 * rand());
      env.connect(pan);
      pan.connect(vBus);
    } else env.connect(vBus);
    const jg = oc.createGain();
    jg.gain.value = (kind === 'murmur' ? 25 : 45) * (0.5 + rand()) * (rand() < 0.5 ? -1 : 1); // cents
    jit[v % 3].connect(jg);
    jg.connect(osc.detune);

    if (kind === 'murmur') {
      const base = rand() < 0.7 ? 95 + 70 * rand() : 170 + 90 * rand();
      const a = a0 * (0.5 + rand());
      let t = -rand() * 3;
      osc.frequency.value = base;
      while (t < total) {
        const phraseEnd = t + 0.7 + 2.4 * rand();
        const pb = base * (0.92 + 0.2 * rand());
        while (t < phraseEnd && t < total) {
          const syl = 0.1 + 0.18 * rand();
          const vw = VOWELS[Math.floor(rand() * VOWELS.length)];
          const p1 = 0.9 + 0.2 * rand();
          const p2 = 0.9 + 0.2 * rand();
          const pf = 0.88 + 0.3 * rand();
          const pa = 0.5 + 0.5 * rand();
          if (t >= 0) {
            bp1.frequency.setTargetAtTime(vw[0] * p1, t, 0.02);
            bp2.frequency.setTargetAtTime(vw[1] * p2, t, 0.02);
            osc.frequency.setTargetAtTime(pb * pf, t, 0.03);
            env.gain.setTargetAtTime(a * pa, t, 0.012);
            env.gain.setTargetAtTime(a * 0.12, t + syl * 0.68, 0.018);
          }
          t += syl;
        }
        if (t >= 0) env.gain.setTargetAtTime(0, t, 0.04);
        t += 0.3 + 2.2 * rand();
      }
    } else {
      const shout = kind === 'roar';
      const base = shout ? 170 + 230 * rand() : 115 + 170 * rand();
      const a = a0 * (0.5 + rand());
      osc.frequency.value = base;
      bp1.frequency.value = shout ? 760 : 400;
      bp2.frequency.value = shout ? 1250 : 800;
      let t = -rand() * 2.5;
      while (t < total) {
        const len = shout ? 0.6 + 2.0 * rand() : 1.2 + 2.6 * rand();
        const r1 = rand();
        const r2 = rand();
        const r3 = rand();
        const r4 = rand();
        const r5 = rand();
        if (t + len > 0) {
          const ts = at(t);
          env.gain.setTargetAtTime(a * (0.6 + 0.4 * r1), ts, shout ? 0.04 + 0.05 * r2 : 0.12);
          if (shout) {
            // a shout: pitch leaps up, then sags as the lungs empty
            osc.frequency.setTargetAtTime(base * (1.02 + 0.12 * r3), ts, 0.07);
            osc.frequency.setTargetAtTime(base * (0.86 + 0.08 * r4), at(t + len * 0.55), 0.35);
            bp1.frequency.setTargetAtTime(680 + 200 * r5, ts, 0.05);
            bp2.frequency.setTargetAtTime(1100 + 400 * r2, ts, 0.05);
          } else {
            osc.frequency.setTargetAtTime(base * (0.97 + 0.08 * r3), ts, 0.15);
            bp1.frequency.setTargetAtTime(360 + 120 * r5, ts, 0.08);
            bp2.frequency.setTargetAtTime(720 + 200 * r4, ts, 0.08);
          }
          env.gain.setTargetAtTime(0, at(t + len), shout ? 0.09 : 0.16);
        }
        t += len + 0.12 + 0.5 * rand();
      }
    }
    osc.start(0);
  }

  // formant-shaped noise: the thousands of voices too far away to resolve
  for (let ch = 0; ch < 2; ch++) {
    const src = oc.createBufferSource();
    src.buffer = nb;
    src.loop = true;
    src.start(0, rand() * 1.9);
    const sum = oc.createGain();
    // slow swell so the far crowd breathes
    const sw = oc.createGain();
    sw.gain.value = 0.3;
    jit[ch].connect(sw);
    sw.connect(sum.gain);
    for (const [f, q, g] of spec.bands) {
      const bp = oc.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * (ch === 0 ? 0.97 : 1.04);
      bp.Q.value = q;
      const bg = oc.createGain();
      bg.gain.value = g;
      src.connect(bp);
      bp.connect(bg);
      bg.connect(sum);
    }
    sum.connect(merger, 0, 2 + ch);
  }
}

/** Bake one loopable stereo crowd texture (RMS-normalised). Resolves null if baking is impossible. */
export async function bakeTexture(ctx: BaseAudioContext, kind: TextureName, voices: number, rand: Rng, targetRms = 0.12): Promise<AudioBuffer | null> {
  const spec = SPECS[kind];
  const xfS = 0.7;
  const rendered = await renderOffline(4, spec.seconds + xfS, (oc) => build(oc, kind, voices, spec.seconds + xfS, rand));
  if (!rendered || rendered.numberOfChannels < 4) return null;
  const n = Math.floor(spec.seconds * BAKE_RATE);
  const xf = Math.floor(xfS * BAKE_RATE);
  const ch = [0, 1, 2, 3].map((i) => seamless(rendered.getChannelData(i), n, xf));
  rmsNormalise([ch[0], ch[1]], 1);
  rmsNormalise([ch[2], ch[3]], spec.noise);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = ch[0][i] + ch[2][i];
    R[i] = ch[1][i] + ch[3][i];
  }
  rmsNormalise([L, R], targetRms);
  const buf = ctx.createBuffer(2, n, BAKE_RATE);
  buf.getChannelData(0).set(L);
  buf.getChannelData(1).set(R);
  return buf;
}

// ---- applause (pure JS) --------------------------------------------------------------

/** One hand-clap: an exponentially-decaying noise burst through a 2-pole resonance (the cupped hands). */
function clapGrain(L: Float32Array, R: Float32Array, sr: number, t0: number, rand: Rng, gain: number, fc: number, wrap: boolean): void {
  const r = 0.9 + 0.06 * rand();
  const w = (2 * Math.PI * fc) / sr;
  const a1 = 2 * r * Math.cos(w);
  const a2 = -r * r;
  const tau = (0.004 + 0.006 * rand()) * sr;
  const n = Math.floor(0.035 * sr);
  const pr = rand();
  const pan = rand() < 0.5 ? pr * 0.3 : 1 - pr * 0.3;
  const gl = gain * Math.cos((pan * Math.PI) / 2);
  const gr = gain * Math.sin((pan * Math.PI) / 2);
  const len = L.length;
  let y1 = 0;
  let y2 = 0;
  const i0 = Math.floor(t0 * sr);
  for (let i = 0; i < n; i++) {
    const x = (rand() * 2 - 1) * Math.exp(-i / tau);
    const y = x + a1 * y1 + a2 * y2;
    y2 = y1;
    y1 = y;
    const o = y * (1 - r) * 3 + x * 0.3;
    let idx = i0 + i;
    if (idx >= len) {
      if (!wrap) break;
      idx %= len;
    }
    if (idx < 0) continue;
    L[idx] += o * gl;
    R[idx] += o * gr;
  }
}

/**
 * Loopable applause: `clappers` people each clapping at their own quasi-steady
 * rate with their own hand resonance, position and distance. Dense (≈150) reads
 * as an ovation; sparse (≈20) as a smattering.
 */
export function bakeApplause(ctx: BaseAudioContext, clappers: number, seconds: number, rand: Rng, targetRms = 0.12): AudioBuffer {
  const sr = BAKE_RATE;
  const n = Math.floor(sr * seconds);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let c = 0; c < clappers; c++) {
    const rate = 2.6 + 2.6 * rand();
    const fc = 900 + 1700 * rand();
    const gain = 0.2 + 0.8 * rand() * rand();
    let t = rand() / rate;
    while (t < seconds) {
      clapGrain(L, R, sr, t, rand, gain, fc * (0.97 + 0.06 * rand()), true);
      t += (1 / rate) * (0.85 + 0.3 * rand());
    }
  }
  rmsNormalise([L, R], targetRms);
  const buf = ctx.createBuffer(2, n, sr);
  buf.getChannelData(0).set(L);
  buf.getChannelData(1).set(R);
  return buf;
}

// ---- chants -------------------------------------------------------------------------------

export interface ChantTemplate {
  name: string;
  bpm: number;
  /** Phrase length in beats (the loop length). */
  beats: number;
  /** Root in Hz. */
  root: number;
  /** [start beat, length in beats, semitones above root, open vowel?] */
  notes: Array<[number, number, number, boolean?]>;
  /** Unison clap beats. */
  claps: number[];
}

/*
 * ORIGINAL contours written for this game — deliberately not transcriptions of
 * any club song, terrace standard or pop riff.
 */
export const CHANTS: ChantTemplate[] = [
  {
    // 0 — "urge": clapped rhythm answered by three shouts. For tight, nervous spells.
    name: 'urge',
    bpm: 116,
    beats: 8,
    root: 147,
    notes: [
      [4, 0.7, 7, true],
      [5, 0.7, 7, true],
      [6, 1.4, 5, true],
    ],
    claps: [0, 0.75, 1.5, 2.5, 3],
  },
  {
    // 1 — minor, rolling "oh-oh-oh" that climbs and falls back
    name: 'terrace-a',
    bpm: 100,
    beats: 16,
    root: 131,
    notes: [
      [0, 1, 0],
      [1, 1, 3],
      [2, 1.5, 5],
      [3.5, 0.5, 3],
      [4, 2, 7, true],
      [6, 1.5, 5],
      [8, 1, 3],
      [9, 1, 5],
      [10, 1.5, 3],
      [11.5, 0.5, 0],
      [12, 2.4, -2, true],
    ],
    claps: [15, 15.5],
  },
  {
    // 2 — major, bouncy call
    name: 'terrace-b',
    bpm: 126,
    beats: 16,
    root: 147,
    notes: [
      [0, 0.5, 4],
      [0.5, 0.5, 4],
      [1, 1, 7],
      [2, 1, 4],
      [3, 1, 2],
      [4, 0.5, 0],
      [4.5, 0.5, 0],
      [5, 1, 4],
      [6, 1.3, 2, true],
      [8, 0.5, 4],
      [8.5, 0.5, 4],
      [9, 1, 7],
      [10, 1, 9, true],
      [11, 1, 7],
      [12, 1, 4],
      [13, 1, 2],
      [14, 1.4, 0, true],
    ],
    claps: [7.5, 15.5],
  },
  {
    // 3 — slow anthem of long "ohhh"s, for when the house is delirious
    name: 'anthem',
    bpm: 76,
    beats: 16,
    root: 123,
    notes: [
      [0, 2.8, 0, true],
      [3, 1, 2],
      [4, 2.8, 4, true],
      [7, 1, 2],
      [8, 2, 7, true],
      [10, 2, 4],
      [12, 3.4, 2, true],
    ],
    claps: [],
  },
];

/** Bake one chant phrase (loopable, dry, RMS-normalised). */
export async function bakeChant(ctx: BaseAudioContext, tpl: ChantTemplate, singers: number, rand: Rng, targetRms = 0.12): Promise<AudioBuffer | null> {
  const beat = 60 / tpl.bpm;
  const seconds = tpl.beats * beat;
  const rendered = await renderOffline(2, seconds, (oc) => {
    const out = oc.createBiquadFilter();
    out.type = 'lowpass';
    out.frequency.value = 3600;
    out.connect(oc.destination);
    const canPan = typeof oc.createStereoPanner === 'function';
    const a0 = 1 / Math.sqrt(singers);
    for (let sIdx = 0; sIdx < singers; sIdx++) {
      const osc = oc.createOscillator();
      osc.type = 'sawtooth';
      const bp1 = oc.createBiquadFilter();
      bp1.type = 'bandpass';
      bp1.Q.value = 4.5;
      bp1.frequency.value = 480;
      const bp2 = oc.createBiquadFilter();
      bp2.type = 'bandpass';
      bp2.Q.value = 6;
      bp2.frequency.value = 850;
      const env = oc.createGain();
      env.gain.value = 0;
      osc.connect(bp1);
      osc.connect(bp2);
      bp1.connect(env);
      bp2.connect(env);
      if (canPan) {
        const pan = oc.createStereoPanner();
        pan.pan.value = (rand() < 0.5 ? -1 : 1) * (0.4 + 0.6 * rand());
        env.connect(pan);
        pan.connect(out);
      } else env.connect(out);
      // every singer is a bit off: own octave, tuning, timing and commitment
      const octave = rand() < 0.35 ? 2 : 1;
      const tune = Math.pow(2, ((rand() - 0.5) * 60) / 1200);
      const lag = (rand() - 0.5) * 0.05;
      const a = a0 * (0.5 + rand()) * (octave === 2 ? 0.7 : 1);
      osc.frequency.value = tpl.root * octave * tune;
      for (const [b, len, semis, open] of tpl.notes) {
        const jitter = (rand() + rand() + rand() - 1.5) * 0.045;
        const wobble = Math.pow(2, ((rand() - 0.5) * 30) / 1200);
        const skip = rand() < 0.08;
        if (skip) continue;
        const ts = Math.max(0, b * beat + lag + jitter);
        const te = Math.min(seconds - 0.12, ts + len * beat - 0.07);
        if (te <= ts) continue;
        const f = tpl.root * octave * tune * wobble * Math.pow(2, semis / 12);
        // scoop into each note from below, like untrained voices do
        osc.frequency.setValueAtTime(f * 0.93, ts);
        osc.frequency.setTargetAtTime(f, ts, 0.035);
        bp1.frequency.setTargetAtTime(open ? 680 : 480, ts, 0.03);
        bp2.frequency.setTargetAtTime(open ? 1120 : 850, ts, 0.03);
        env.gain.setTargetAtTime(a, ts, 0.028);
        env.gain.setTargetAtTime(0, te, 0.04);
      }
      osc.start(0);
    }
  });
  if (!rendered) return null;
  const n = rendered.length;
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  L.set(rendered.getChannelData(0));
  R.set(rendered.getChannelData(rendered.numberOfChannels > 1 ? 1 : 0));
  rmsNormalise([L, R], 1);
  // unison claps: everyone aims at the beat, nobody quite lands on it
  const clappers = Math.max(8, singers * 2);
  for (const b of tpl.claps) {
    for (let c = 0; c < clappers; c++) {
      const t = b * beat + (rand() + rand() + rand() - 1.5) * 0.035;
      if (t < 0 || t > seconds - 0.05) continue;
      clapGrain(L, R, BAKE_RATE, t, rand, (1.6 / Math.sqrt(clappers)) * (0.5 + rand()), 1000 + 1500 * rand(), false);
    }
  }
  rmsNormalise([L, R], targetRms);
  const buf = ctx.createBuffer(2, n, BAKE_RATE);
  buf.getChannelData(0).set(L);
  buf.getChannelData(1).set(R);
  return buf;
}
