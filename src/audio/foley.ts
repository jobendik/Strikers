/*
 * Ball + body foley and the referee's whistle. Physically-motivated recipes
 * (resonant thump + broadband contact noise + optional air), every parameter
 * scaled by the event's own data (launch speed, impact speed, force…).
 *
 * Each function builds ONE pooled voice; all envelopes are scheduled on the
 * context clock. Noise always comes from the mixer's shared buffers.
 */
import type { KickKind } from '../core/bus';
import { Mixer, perc, type Voice } from './mixer';
import { clamp, lerp, smoothstep } from './rng';

/** Stereo placement of a pitch event relative to the broadcast camera. */
export interface Place {
  pan: number;
  /** Distance attenuation 0..1. */
  att: number;
}

export const CENTRE: Place = { pan: 0, att: 1 };

// ---- small building blocks --------------------------------------------------------

/** Pitched body thump: sine gliding f0 → f1 with a percussive envelope. */
function thump(m: Mixer, v: Voice, t: number, f0: number, f1: number, dur: number, gain: number, type: OscillatorType = 'sine'): OscillatorNode {
  const o = m.osc(v, type, f0, t, t + dur);
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = m.gain(v, 0);
  perc(g.gain, t, gain, 0.0025, dur);
  o.connect(g);
  g.connect(v.out);
  return o;
}

/** Filtered noise burst. Returns the filter so callers can sweep it. */
function burst(
  m: Mixer,
  v: Voice,
  t: number,
  kind: 'white' | 'pink' | 'brown',
  ftype: BiquadFilterType,
  freq: number,
  q: number,
  attack: number,
  decay: number,
  gain: number,
): BiquadFilterNode {
  const s = m.noiseSrc(v, kind, t, t + attack + decay);
  const f = m.biquad(v, ftype, freq, q);
  const g = m.gain(v, 0);
  perc(g.gain, t, gain, attack, decay);
  s.connect(f);
  f.connect(g);
  g.connect(v.out);
  return f;
}

// ---- boot / head on ball --------------------------------------------------------------

interface KickSpec {
  /** Low thump weight. */
  body: number;
  /** Leather slap (broadband contact) weight. */
  slap: number;
  /** Pitch multiplier of the thump. */
  pitch: number;
  /** Air whoosh tail weight (only audible on hard strikes). */
  whoosh: number;
  /** Upward-gliding "scooped" thump (chip / lob). */
  scoop?: boolean;
  /** Dull contact (header): slap moved down, no click. */
  dull?: boolean;
}

const KICKS: Record<KickKind, KickSpec> = {
  pass: { body: 0.7, slap: 0.35, pitch: 1.15, whoosh: 0 },
  through: { body: 0.8, slap: 0.45, pitch: 1.1, whoosh: 0 },
  cross: { body: 0.95, slap: 0.6, pitch: 1.0, whoosh: 0.4 },
  lob: { body: 0.7, slap: 0.2, pitch: 1.1, whoosh: 0.25, scoop: true },
  shot: { body: 1.15, slap: 1.0, pitch: 0.9, whoosh: 1 },
  finesse: { body: 0.8, slap: 0.55, pitch: 1.05, whoosh: 0.6 },
  chip: { body: 0.6, slap: 0.15, pitch: 1.2, whoosh: 0.2, scoop: true },
  clear: { body: 1.2, slap: 0.8, pitch: 0.85, whoosh: 0.7 },
  header: { body: 0.8, slap: 0.3, pitch: 1.55, whoosh: 0, dull: true },
  volley: { body: 1.0, slap: 1.25, pitch: 0.95, whoosh: 1 },
  touch: { body: 0.5, slap: 0.3, pitch: 1.4, whoosh: 0 },
  knock: { body: 0.7, slap: 0.4, pitch: 1.2, whoosh: 0 },
};

export function kick(m: Mixer, kind: KickKind, power: number, human: boolean, pl: Place): void {
  const k = KICKS[kind] ?? KICKS.pass;
  const r = m.rand;
  if (kind === 'touch' || kind === 'knock') {
    // dribble touch: a very quiet tick, rate-limited so close control doesn't machine-gun
    if (!m.gate('touch', kind === 'touch' ? 0.09 : 0.05)) return;
    const p = clamp((power - 2) / 10, 0, 1);
    const amp = (kind === 'touch' ? 0.035 + 0.05 * p : 0.07 + 0.1 * p) * (human ? 1.15 : 1) * pl.att;
    const v = m.voice({ bus: 'sfx', dur: 0.09, pan: pl.pan, gain: amp, send: 0.05, prio: 0, tag: 'touch' });
    if (!v) return;
    const f = (250 - 60 * p) * k.pitch * (0.93 + 0.14 * r());
    thump(m, v, v.t0, f * 1.5, f * 0.8, 0.035, 0.9);
    burst(m, v, v.t0, 'white', 'bandpass', 1300 + 500 * r(), 0.9, 0.001, 0.016, 0.5);
    return;
  }

  const p = clamp((power - 4) / 30, 0, 1);
  const amp = (0.16 + 0.84 * Math.pow(p, 1.2)) * (human ? 1.1 : 1) * pl.att;
  const whoosh = k.whoosh * smoothstep(17, 29, power);
  const v = m.voice({
    bus: 'sfx',
    dur: whoosh > 0.05 ? 0.8 : 0.32,
    pan: pl.pan,
    gain: amp,
    send: 0.08 + 0.3 * p,
    prio: p > 0.55 ? 5 : 3,
    tag: 'kick',
  });
  if (!v) return;
  const t = v.t0;

  // 1) body: the ball + foot mass. Harder = lower, longer, heavier.
  const f0 = (165 - 70 * p) * k.pitch * (0.96 + 0.08 * r());
  const bd = 0.065 + 0.1 * p;
  const o = m.osc(v, 'sine', f0, t, t + bd);
  if (k.scoop) {
    // the boot slides under the ball: pitch scoops upward
    o.frequency.setValueAtTime(f0 * 0.8, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.5, t + bd * 0.85);
  } else {
    o.frequency.setValueAtTime(f0 * 2.3, t);
    o.frequency.exponentialRampToValueAtTime(f0, t + 0.016);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.72, t + bd);
  }
  const og = m.gain(v, 0);
  perc(og.gain, t, 0.95 * k.body, 0.0025, bd);
  o.connect(og);
  og.connect(v.out);

  // 2) the ball's own short "pock" (pressurised shell)
  if (!k.dull) thump(m, v, t, (430 - 90 * p) * (0.95 + 0.1 * r()), 300, 0.032, 0.28 * k.body, 'triangle');

  // 3) leather slap: broadband contact noise, brighter + louder with power
  const fc = k.dull ? 520 + 300 * p : 1500 + 2600 * p;
  burst(m, v, t, 'white', 'bandpass', fc * (0.9 + 0.2 * r()), k.dull ? 0.7 : 0.9, 0.001, 0.02 + 0.03 * p, 0.55 * k.slap * (0.3 + 0.7 * p));
  if (k.scoop) {
    // grass + boot brush under the ball
    const f = burst(m, v, t, 'pink', 'bandpass', 700, 1.2, 0.012, 0.1, 0.5);
    f.frequency.setValueAtTime(700, t);
    f.frequency.exponentialRampToValueAtTime(2200, t + 0.1);
  }

  // 4) air: the ball tearing away from a laced strike
  if (whoosh > 0.05) {
    const s = m.noiseSrc(v, 'pink', t, t + 0.75);
    const f = m.biquad(v, 'bandpass', 420, 1.3);
    f.frequency.setValueAtTime(420, t);
    f.frequency.exponentialRampToValueAtTime(1500 + 500 * p, t + 0.13);
    f.frequency.exponentialRampToValueAtTime(560, t + 0.7);
    const g = m.gain(v, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * whoosh, t + 0.07);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.72);
    s.connect(f);
    f.connect(g);
    g.connect(v.out);
  }
}

/** A heavy / clumsy first touch — only audible when the control was poor. */
export function clumsyTouch(m: Mixer, quality: number, human: boolean, pl: Place): void {
  const k = clamp((0.4 - quality) / 0.4, 0, 1);
  if (k <= 0 || !m.gate('ftouch', 0.12)) return;
  const v = m.voice({ bus: 'sfx', dur: 0.12, pan: pl.pan, gain: (0.08 + 0.2 * k) * (human ? 1.1 : 1) * pl.att, send: 0.08, prio: 1, tag: 'ftouch' });
  if (!v) return;
  thump(m, v, v.t0, 250, 140, 0.05, 0.9);
  burst(m, v, v.t0, 'white', 'bandpass', 1200, 0.8, 0.001, 0.022, 0.5);
}

export function bounce(m: Mixer, speed: number, pl: Place): void {
  const p = clamp((speed - 2) / 14, 0, 1);
  if (!m.gate('bounce', 0.05)) return;
  const v = m.voice({ bus: 'sfx', dur: 0.14, pan: pl.pan, gain: (0.07 + 0.42 * p) * pl.att, send: 0.1, prio: 1, tag: 'bounce' });
  if (!v) return;
  const t = v.t0;
  const f = (150 - 35 * p) * (0.94 + 0.12 * m.rand());
  thump(m, v, t, f, f * 0.55, 0.055 + 0.03 * p, 0.9);
  burst(m, v, t, 'pink', 'lowpass', 1100 + 600 * p, 0.6, 0.003, 0.045, 1.4); // turf
}

// ---- woodwork: modal metallic clang ------------------------------------------------

export function woodwork(m: Mixer, bar: boolean, speed: number, pl: Place): void {
  const p = clamp((speed - 4) / 26, 0, 1);
  const r = m.rand;
  const dur = bar ? 2.6 : 2.0;
  const v = m.voice({ bus: 'sfx', dur, pan: pl.pan, gain: (0.2 + 0.8 * p) * pl.att, send: 0.6, prio: 8, tag: 'post' });
  if (!v) return;
  const t = v.t0;
  // Hollow aluminium section. Free-bar-like inharmonic series; the 7.32 m bar is
  // tuned lower and rings longer than the 2.44 m upright.
  const base = (bar ? 208 : 327) * (0.985 + 0.03 * r());
  const ratios = bar ? [1, 2.71, 5.15, 8.3, 12.2, 16.9] : [1, 2.76, 5.4, 8.93, 13.34, 18.64];
  const decs = bar ? [1.9, 1.5, 1.0, 0.65, 0.4, 0.25] : [1.4, 1.1, 0.75, 0.5, 0.3, 0.18];
  const amps = [1, 0.62, 0.5, 0.34, 0.22, 0.13];
  const nyq = m.ctx.sampleRate * 0.45;
  const bright = lerp(0.4, 1, p); // a harder hit excites the upper modes
  for (let i = 0; i < ratios.length; i++) {
    const f = base * ratios[i];
    if (f > nyq) continue;
    const a = amps[i] * (i < 2 ? 1 : Math.pow(bright, (i - 1) * 0.7)) * 0.2;
    const o = m.osc(v, 'sine', f, t, t + decs[i]);
    const g = m.gain(v, 0);
    perc(g.gain, t, a, 0.0012, decs[i]);
    o.connect(g);
    g.connect(v.out);
    if (i < 3) {
      // the section is not perfectly round: each low mode is a close pair → slow beating shimmer
      const o2 = m.osc(v, 'sine', f * (1.004 + 0.006 * r()), t, t + decs[i]);
      const g2 = m.gain(v, 0);
      perc(g2.gain, t, a * 0.6, 0.0012, decs[i] * 0.9);
      o2.connect(g2);
      g2.connect(v.out);
    }
  }
  // the ball itself + the strike transient
  thump(m, v, t, 130, 70, 0.05, 0.75);
  burst(m, v, t, 'white', 'bandpass', 3200, 0.7, 0.0008, 0.014, 0.45 + 0.35 * p);
}

// ---- net -------------------------------------------------------------------------------

export function net(m: Mixer, speed: number, goal: boolean, pl: Place): void {
  const p = clamp(speed / 28, 0.1, 1);
  if (!m.gate('net', 0.25)) return;
  const v = m.voice({ bus: 'sfx', dur: 0.8, pan: pl.pan, gain: (0.12 + 0.5 * p) * pl.att, send: 0.22, prio: 5, tag: 'net' });
  if (!v) return;
  const t = v.t0;
  const dec = 0.2 + 0.3 * p;
  // swish: the mesh bulging — filter flicks up, then relaxes down
  const s = m.noiseSrc(v, 'white', t, t + dec + 0.05);
  const f = m.biquad(v, 'bandpass', 900, 1.1);
  f.frequency.setValueAtTime(900, t);
  f.frequency.exponentialRampToValueAtTime(4200 + 1600 * p, t + 0.055);
  f.frequency.exponentialRampToValueAtTime(1300, t + 0.06 + dec);
  const g = m.gain(v, 0);
  perc(g.gain, t, 0.9, 0.018, dec);
  s.connect(f);
  f.connect(g);
  g.connect(v.out);
  // cords snapping back: a few dry high ticks as the net settles
  const s2 = m.noiseSrc(v, 'white', t, t + 0.5);
  const hp = m.biquad(v, 'bandpass', 4200, 0.8);
  const tg = m.gain(v, 0);
  tg.gain.setValueAtTime(0, t);
  let tt = t + 0.05;
  const ticks = goal ? 5 : 3;
  for (let i = 0; i < ticks; i++) {
    tt += 0.035 + 0.05 * m.rand();
    const a = 0.22 * p * (1 - i / (ticks + 1));
    tg.gain.setValueAtTime(0, tt);
    tg.gain.linearRampToValueAtTime(a, tt + 0.002);
    tg.gain.linearRampToValueAtTime(0, tt + 0.012);
  }
  s2.connect(hp);
  hp.connect(tg);
  tg.connect(v.out);
  // a hard one thumps the stanchion / pulls the whole frame
  if (p > 0.5) thump(m, v, t + 0.02, 95, 58, 0.09, 0.5 * p);
}

// ---- keeper ---------------------------------------------------------------------------

function landing(m: Mixer, v: Voice, t: number, gain: number): void {
  thump(m, v, t, 80, 46, 0.13, 0.75 * gain);
  burst(m, v, t, 'pink', 'lowpass', 420, 0.6, 0.004, 0.11, 1.6 * gain);
}

export function save(m: Mixer, parry: boolean, diving: boolean, speed: number, pl: Place): void {
  const p = clamp(speed / 30, 0.15, 1);
  const v = m.voice({ bus: 'sfx', dur: diving ? 0.8 : 0.3, pan: pl.pan, gain: (0.2 + 0.6 * p) * pl.att, send: 0.25, prio: 6, tag: 'save' });
  if (!v) return;
  const t = v.t0;
  if (parry) {
    // latex slap: sharp, bright, short — the ball leaves again
    burst(m, v, t, 'white', 'bandpass', 2300, 1.1, 0.0008, 0.035, 1.0);
    burst(m, v, t, 'white', 'bandpass', 900, 0.8, 0.001, 0.05, 0.55);
    thump(m, v, t, 190, 120, 0.045, 0.5);
  } else {
    // catch: the ball dies into gloves + chest — muffled, with weight
    burst(m, v, t, 'pink', 'lowpass', 1100, 0.6, 0.003, 0.07, 1.3);
    thump(m, v, t, 130, 80, 0.075, 0.9);
  }
  if (diving) landing(m, v, t + 0.28, 0.5);
}

export function dive(m: Mixer, pl: Place): void {
  if (!m.gate('dive', 0.3)) return;
  const v = m.voice({ bus: 'sfx', dur: 0.6, pan: pl.pan, gain: 0.22 * pl.att, send: 0.12, prio: 2, tag: 'dive' });
  if (!v) return;
  const t = v.t0;
  const f = burst(m, v, t, 'pink', 'bandpass', 480, 1.0, 0.08, 0.2, 1.2);
  f.frequency.setValueAtTime(480, t);
  f.frequency.exponentialRampToValueAtTime(950, t + 0.1);
  f.frequency.exponentialRampToValueAtTime(380, t + 0.28);
  landing(m, v, t + 0.33, 0.6);
}

// ---- challenges -----------------------------------------------------------------------

/** Studs through turf: band-limited noise with a rough (granular) amplitude. */
function scrape(m: Mixer, v: Voice, t: number, dur: number, gain: number, f0: number, f1: number): void {
  const s = m.noiseSrc(v, 'pink', t, t + dur);
  const f = m.biquad(v, 'bandpass', f0, 0.8);
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const rough = m.gain(v, 0.6);
  const lfo = m.osc(v, 'sawtooth', 41 + 14 * m.rand(), t, t + dur);
  const depth = m.gain(v, 0.4);
  lfo.connect(depth);
  depth.connect(rough.gain);
  const g = m.gain(v, 0);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.035);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f);
  f.connect(rough);
  rough.connect(g);
  g.connect(v.out);
}

export function tackle(m: Mixer, slide: boolean, human: boolean, pl: Place): void {
  if (!m.gate('tackle', 0.08)) return;
  const v = m.voice({
    bus: 'sfx',
    dur: slide ? 0.45 : 0.16,
    pan: pl.pan,
    gain: (slide ? 0.5 : 0.36) * (human ? 1.1 : 1) * pl.att,
    send: 0.15,
    prio: 4,
    tag: 'tackle',
  });
  if (!v) return;
  const t = v.t0;
  burst(m, v, t, 'white', 'bandpass', 1700, 1.4, 0.0008, 0.028, 0.8); // shin-pad clack
  thump(m, v, t, 150, 90, 0.06, 0.8); // leg + ball
  if (slide) scrape(m, v, t + 0.01, 0.36, 1.6, 1100, 620);
}

/** A slide tackle being launched (before any contact). */
export function slideStart(m: Mixer, pl: Place): void {
  if (!m.gate('slide', 0.15)) return;
  const v = m.voice({ bus: 'sfx', dur: 0.5, pan: pl.pan, gain: 0.3 * pl.att, send: 0.1, prio: 2, tag: 'slide' });
  if (!v) return;
  scrape(m, v, v.t0, 0.45, 1.6, 1500, 600);
}

export function collide(m: Mixer, force: number, pl: Place): void {
  const p = clamp((force - 2) / 10, 0, 1);
  if (p <= 0 || !m.gate('collide', 0.1)) return;
  const v = m.voice({ bus: 'sfx', dur: 0.16, pan: pl.pan, gain: (0.08 + 0.26 * p) * pl.att, send: 0.1, prio: 2, tag: 'collide' });
  if (!v) return;
  thump(m, v, v.t0, 98, 54, 0.095, 0.9);
  burst(m, v, v.t0, 'pink', 'lowpass', 520, 0.6, 0.003, 0.06, 1.8);
}

/** Ball deflecting off a body. */
export function block(m: Mixer, speed: number, pl: Place): void {
  const p = clamp(speed / 28, 0.1, 1);
  if (!m.gate('block', 0.06)) return;
  const v = m.voice({ bus: 'sfx', dur: 0.14, pan: pl.pan, gain: (0.15 + 0.45 * p) * pl.att, send: 0.12, prio: 3, tag: 'block' });
  if (!v) return;
  thump(m, v, v.t0, 215, 118, 0.055, 0.9);
  burst(m, v, v.t0, 'pink', 'lowpass', 850, 0.6, 0.002, 0.035, 1.6);
}

// ---- referee's whistle: pea-whistle model -------------------------------------------

export type WhistleKind = 'kickoff' | 'half' | 'full' | 'foul' | 'goal' | 'offside' | 'restart';

/** [blast seconds, gap after] per blast. */
export const WHISTLE_PATTERNS: Record<WhistleKind, { blasts: Array<[number, number]>; level: number }> = {
  kickoff: { blasts: [[0.3, 0]], level: 0.8 },
  restart: { blasts: [[0.14, 0]], level: 0.55 },
  foul: { blasts: [[0.46, 0]], level: 1.0 },
  offside: {
    blasts: [
      [0.13, 0.07],
      [0.15, 0],
    ],
    level: 0.8,
  },
  goal: { blasts: [[0.8, 0]], level: 0.9 },
  half: {
    blasts: [
      [0.42, 0.16],
      [0.85, 0],
    ],
    level: 0.95,
  },
  full: {
    blasts: [
      [0.4, 0.15],
      [0.4, 0.15],
      [1.25, 0],
    ],
    level: 1.0,
  },
};

export function whistle(m: Mixer, kind: WhistleKind): void {
  const pat = WHISTLE_PATTERNS[kind] ?? WHISTLE_PATTERNS.restart;
  let total = 0;
  for (const [d, gap] of pat.blasts) total += d + gap;
  const r = m.rand;
  const v = m.voice({ bus: 'sfx', dur: total + 0.25, pan: (r() - 0.5) * 0.3, gain: 0.26 * pat.level, send: 0.5, prio: 9, tag: 'whistle' });
  if (!v) return;
  const t = v.t0;
  const tEnd = t + total + 0.2;
  // two chambers a semitone apart + a little 2nd harmonic
  const f1 = 2075 * (0.985 + 0.03 * r());
  const f2 = f1 * 1.058;
  const o1 = m.osc(v, 'sine', f1, t, tEnd);
  const o2 = m.osc(v, 'sine', f2, t, tEnd);
  const o3 = m.osc(v, 'sine', f1 * 2, t, tEnd);
  const g1 = m.gain(v, 0.6);
  const g2 = m.gain(v, 0.45);
  const g3 = m.gain(v, 0.07);
  // the pea: it interrupts the jet 30–40 times a second → AM trill + a small FM warble
  const lfo = m.osc(v, 'triangle', 35, t, tEnd);
  const am = m.gain(v, 0.6);
  const amDepth = m.gain(v, 0.4);
  const fmDepth = m.gain(v, 24);
  lfo.connect(amDepth);
  amDepth.connect(am.gain);
  lfo.connect(fmDepth);
  fmDepth.connect(o1.frequency);
  fmDepth.connect(o2.frequency);
  o1.connect(g1);
  o2.connect(g2);
  o3.connect(g3);
  g1.connect(am);
  g2.connect(am);
  g3.connect(am);
  // breath: band-passed air riding under the tone
  const ns = m.noiseSrc(v, 'white', t, tEnd);
  const bp = m.biquad(v, 'bandpass', 3000, 0.6);
  const ng = m.gain(v, 0.1);
  ns.connect(bp);
  bp.connect(ng);
  const env = m.gain(v, 0);
  am.connect(env);
  ng.connect(env);
  env.connect(v.out);

  env.gain.setValueAtTime(0, t);
  let tb = t;
  for (const [d, gap] of pat.blasts) {
    // onset chiff + overshoot, steady blow, quick release
    env.gain.setValueAtTime(0, tb);
    env.gain.linearRampToValueAtTime(1.15, tb + 0.012);
    env.gain.linearRampToValueAtTime(0.92, tb + 0.05);
    env.gain.linearRampToValueAtTime(1.0, tb + d - 0.045);
    env.gain.linearRampToValueAtTime(0, tb + d);
    // pitch: scoops up as pressure builds, sags as it is released
    for (const o of [o1, o2, o3]) {
      o.detune.setValueAtTime(-85, tb);
      o.detune.linearRampToValueAtTime(0, tb + 0.04);
      o.detune.setValueAtTime(0, tb + d - 0.06);
      o.detune.linearRampToValueAtTime(-55, tb + d);
    }
    // the pea spins up then slows
    const rate = 33 + 5 * r();
    lfo.frequency.setValueAtTime(rate + 3, tb);
    lfo.frequency.linearRampToValueAtTime(rate - 2, tb + d);
    tb += d + gap;
  }
}
