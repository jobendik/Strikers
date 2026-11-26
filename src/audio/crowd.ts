/*
 * The stadium: an always-alive layered bed + event one-shots + chants.
 *
 * Bed layers (all persistent, all slowly and independently modulated so the
 * bed never sits still like static):
 *   rumble  brown noise < 150 Hz                          — the weight of the bowl
 *   body    stereo pink noise, band-limited, L/R wandering — the far, unresolved mass
 *   murmur  2 × baked "talking" texture at different rates — people, near enough to hear
 *   shout   baked "shouting" texture                        — replaces murmur as arousal rises
 *   ooh     baked "oooh" texture, pitch follows anticipation — the swell as a chance develops
 *   away    murmur again, thin, panned to the away end
 *
 * The CrowdMix from the pure emotion model sets every layer gain / cutoff. The
 * "ooh" layer deliberately bypasses the bed's level node: when the house holds
 * its breath the broadband bed DUCKS while the pitched "oooh" rises.
 */
import { CHANTS, bakeChant, type TextureName } from './bake';
import type { CrowdCue, CrowdMix } from './emotion';
import { Mixer, ahr, perc, type Voice } from './mixer';
import { clamp } from './rng';

/** Layer reference gains (linear, before the bed level and the crowd bus trim). */
export const CROWD_LEVELS = {
  bed: 1.0,
  rumble: 0.5,
  body: 0.16,
  murmur: 0.42,
  shout: 0.6,
  ooh: 0.55,
  away: 0.2,
  /** crowd bus → stadium reverb. */
  send: 0.16,
  /** one-shot master. */
  shot: 1.0,
} as const;

/** Stereo position of the away end. */
const AWAY_PAN = 0.68;

export interface CrowdTextures {
  murmur: AudioBuffer | null;
  roar: AudioBuffer | null;
  ooh: AudioBuffer | null;
  applause: AudioBuffer | null;
  sparse: AudioBuffer | null;
}

interface ShotOpts {
  buf: AudioBuffer;
  at: number;
  attack: number;
  hold: number;
  release: number;
  gain: number;
  rate0: number;
  rate1: number;
  ftype: BiquadFilterType;
  f0: number;
  f1: number;
  q?: number;
  pan?: number;
  send?: number;
  prio?: number;
  tag: string;
}

export class Crowd {
  readonly tex: CrowdTextures = { murmur: null, roar: null, ooh: null, applause: null, sparse: null };
  private m: Mixer;
  private nodes: AudioNode[] = [];
  private srcs: AudioScheduledSourceNode[] = [];
  private built = false;
  private bed: GainNode | null = null;
  private send: GainNode | null = null;
  private gRumble: GainNode | null = null;
  private gBody: GainNode | null = null;
  private fBody: BiquadFilterNode | null = null;
  private gMurmur: GainNode | null = null;
  private fVoice: BiquadFilterNode | null = null;
  private gShout: GainNode | null = null;
  private gOoh: GainNode | null = null;
  private sOoh: AudioBufferSourceNode | null = null;
  private gAway: GainNode | null = null;
  private layers = new Set<string>();
  private chants = new Map<number, AudioBuffer | null>();
  private chantPending = new Set<number>();
  private wantChant = -1;
  private wantChantCue: CrowdCue | null = null;
  private lastMix: CrowdMix | null = null;

  constructor(m: Mixer) {
    this.m = m;
  }

  // ---- persistent bed -----------------------------------------------------------------

  private reg<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    this.m.addStatic(1);
    return n;
  }

  private loop(buffer: AudioBuffer, rate: number): AudioBufferSourceNode {
    const s = this.reg(this.m.ctx.createBufferSource());
    s.buffer = buffer;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(this.m.now, this.m.rand() * Math.max(0, buffer.duration - 0.1));
    this.srcs.push(s);
    return s;
  }

  private gainNode(v: number): GainNode {
    const g = this.reg(this.m.ctx.createGain());
    g.gain.value = v;
    return g;
  }

  private filter(type: BiquadFilterType, f: number, q: number): BiquadFilterNode {
    const b = this.reg(this.m.ctx.createBiquadFilter());
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  /** A unity gain whose level wanders ±depth with a slow random LFO. */
  private wanderGain(depth: number): GainNode {
    const g = this.gainNode(1);
    const lfo = this.loop(this.m.wander, 0.55 + 1.1 * this.m.rand());
    const d = this.gainNode(depth);
    lfo.connect(d);
    d.connect(g.gain);
    return g;
  }

  /** Build the noise layers. Safe to call again after `teardown()`. */
  start(): void {
    if (this.built) return;
    this.built = true;
    const m = this.m;
    const full = m.quality === 'full';
    const bus = m.buses.crowd;
    this.send = this.gainNode(CROWD_LEVELS.send);
    bus.connect(this.send);
    this.send.connect(m.reverbIn);

    this.bed = this.gainNode(0);
    this.bed.connect(bus);

    // rumble
    const rs = this.loop(m.noise.brown, 0.8);
    const rlp = this.filter('lowpass', 150, 0.7);
    const rmod = this.wanderGain(0.3);
    this.gRumble = this.gainNode(CROWD_LEVELS.rumble * 0.5);
    rs.connect(rlp);
    rlp.connect(rmod);
    rmod.connect(this.gRumble);
    this.gRumble.connect(this.bed);

    // body: stereo pink → speech-band tilt → brightness low-pass
    const bs = this.loop(m.noise.pink, 0.93);
    const bbp = this.filter('bandpass', 620, 0.45);
    this.fBody = this.filter('lowpass', 1200, 0.5);
    this.gBody = this.gainNode(CROWD_LEVELS.body);
    bs.connect(bbp);
    bbp.connect(this.fBody);
    if (full) {
      // independent wander per side: waves of noise roll around the bowl
      const split = this.reg(m.ctx.createChannelSplitter(2));
      const merge = this.reg(m.ctx.createChannelMerger(2));
      const l = this.wanderGain(0.35);
      const r = this.wanderGain(0.35);
      this.fBody.connect(split);
      split.connect(l, 0);
      split.connect(r, 1);
      l.connect(merge, 0, 0);
      r.connect(merge, 0, 1);
      merge.connect(this.gBody);
    } else this.fBody.connect(this.gBody);
    this.gBody.connect(this.bed);

    for (const k of ['murmur', 'roar', 'ooh'] as TextureName[]) if (this.tex[k]) this.addLayer(k);
    if (this.lastMix) this.apply(this.lastMix, 0.5);
  }

  /** Hand over a freshly baked texture; its bed layer joins in. */
  setTexture(name: keyof CrowdTextures, buf: AudioBuffer | null): void {
    this.tex[name] = buf;
    if (buf && this.built && (name === 'murmur' || name === 'roar' || name === 'ooh')) {
      this.addLayer(name);
      if (this.lastMix) this.apply(this.lastMix, 0.6);
    }
  }

  private addLayer(name: TextureName): void {
    if (this.layers.has(name) || !this.bed) return;
    const buf = this.tex[name];
    if (!buf) return;
    this.layers.add(name);
    const m = this.m;
    const full = m.quality === 'full';
    if (name === 'murmur') {
      this.fVoice = this.filter('lowpass', 1800, 0.5);
      this.gMurmur = this.gainNode(0);
      const a = this.loop(buf, 0.94);
      const am = this.wanderGain(0.3);
      a.connect(am);
      am.connect(this.fVoice);
      if (full) {
        // a second pass at another speed: doubles the density and hides the loop
        const b = this.loop(buf, 1.09);
        const bm = this.wanderGain(0.3);
        b.connect(bm);
        bm.connect(this.fVoice);
        // the away end: same people, thinner, off to one side
        const c = this.loop(buf, 1.21);
        const hp = this.filter('highpass', 380, 0.7);
        this.gAway = this.gainNode(0);
        c.connect(hp);
        if (typeof m.ctx.createStereoPanner === 'function') {
          const p = this.reg(m.ctx.createStereoPanner());
          p.pan.value = AWAY_PAN;
          hp.connect(p);
          p.connect(this.gAway);
        } else hp.connect(this.gAway);
        this.gAway.connect(m.buses.crowd);
      }
      this.fVoice.connect(this.gMurmur);
      this.gMurmur.connect(this.bed);
    } else if (name === 'roar') {
      if (!full) return;
      const s = this.loop(buf, 0.97);
      const sm = this.wanderGain(0.3);
      this.gShout = this.gainNode(0);
      s.connect(sm);
      sm.connect(this.gShout);
      this.gShout.connect(this.bed);
    } else {
      if (!full) return;
      this.sOoh = this.loop(buf, 0.9);
      this.gOoh = this.gainNode(0);
      this.sOoh.connect(this.gOoh);
      this.gOoh.connect(m.buses.crowd); // NOT through the bed: it must rise while the bed ducks
    }
  }

  /** Remove the whole bed (quality switch / dispose). */
  teardown(): void {
    const t = this.m.now;
    for (const s of this.srcs) {
      try {
        s.stop(t);
      } catch {
        /* ignore */
      }
    }
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    if (this.send) {
      try {
        this.m.buses.crowd.disconnect(this.send);
      } catch {
        /* ignore */
      }
    }
    this.m.addStatic(-this.nodes.length);
    this.nodes = [];
    this.srcs = [];
    this.layers.clear();
    this.built = false;
    this.bed = this.send = this.gRumble = this.gBody = this.gMurmur = this.gShout = this.gOoh = this.gAway = null;
    this.fBody = this.fVoice = null;
    this.sOoh = null;
  }

  /** Push the emotion model's mix onto the bed. `tau` = smoothing time constant. */
  apply(mix: CrowdMix, tau = 0.12): void {
    this.lastMix = mix;
    if (!this.built || !this.bed) return;
    const t = this.m.now;
    const L = CROWD_LEVELS;
    const set = (p: AudioParam | undefined, v: number, k = tau): void => {
      if (p && Number.isFinite(v)) p.setTargetAtTime(v, t, k);
    };
    const hasMurmur = this.layers.has('murmur');
    const hasShout = this.gShout !== null;
    set(this.bed.gain, L.bed * mix.level);
    set(this.gRumble?.gain, L.rumble * mix.rumble);
    // without baked voices the noise body has to carry the bed on its own
    set(this.gBody?.gain, L.body * (hasMurmur ? 1 : 2.2) * (hasShout ? 1 : 1 + 0.8 * mix.shout));
    set(this.fBody?.frequency, clamp(mix.cutoff * 1.15, 300, 9000), 0.3);
    set(this.gMurmur?.gain, L.murmur * mix.murmur);
    set(this.fVoice?.frequency, clamp(mix.cutoff * 1.5, 400, 9000), 0.3);
    set(this.gShout?.gain, L.shout * mix.shout);
    set(this.gOoh?.gain, L.ooh * mix.ooh, 0.09);
    set(this.sOoh?.playbackRate, mix.oohRate, 0.15);
    set(this.gAway?.gain, L.away * mix.away, 0.5);
  }

  // ---- one-shots ------------------------------------------------------------------------

  private texOr(name: keyof CrowdTextures): AudioBuffer {
    return this.tex[name] ?? this.m.noise.pink;
  }

  /** One enveloped, swept pass over a texture. */
  private shot(o: ShotOpts): Voice | null {
    const m = this.m;
    const total = o.attack + o.hold + o.release * 1.6;
    const v = m.voice({ bus: 'crowd', at: o.at, dur: total, pan: o.pan ?? 0, gain: o.gain * CROWD_LEVELS.shot, send: o.send ?? 0.3, prio: o.prio ?? 6, tag: o.tag });
    if (!v) return null;
    const t = v.t0;
    const s = m.bufSrc(v, o.buf, t, t + total, o.rate0, true);
    s.playbackRate.setValueAtTime(o.rate0, t);
    s.playbackRate.linearRampToValueAtTime(o.rate1, t + o.attack + o.hold + o.release);
    const f = m.biquad(v, o.ftype, o.f0, o.q ?? 0.6);
    f.frequency.setValueAtTime(o.f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, o.f1), t + o.attack + o.hold + o.release);
    const g = m.gain(v, 0);
    ahr(g.gain, t, 1, o.attack, o.hold, o.release);
    s.connect(f);
    f.connect(g);
    g.connect(v.out);
    return v;
  }

  cue(c: CrowdCue): void {
    const m = this.m;
    const at = m.now + Math.max(0, c.delay);
    const I = clamp(c.intensity, 0, 1);
    const r = m.rand;
    switch (c.kind) {
      case 'roar':
        this.roar(at, I, c.dur, c.variant === 1);
        break;
      case 'awayRoar':
        // a few thousand in one corner: thinner, narrower, off to the side
        this.shot({ buf: this.texOr('roar'), at, attack: 0.14, hold: c.dur * 0.3, release: c.dur * 0.7, gain: 0.42 * I, rate0: 1.12, rate1: 0.98, ftype: 'bandpass', f0: 1500, f1: 1000, q: 0.5, pan: AWAY_PAN, send: 0.4, prio: 7, tag: 'awayRoar' });
        break;
      case 'groan':
        // "ooohhh": pitch and brightness sag together
        this.shot({ buf: this.texOr('ooh'), at, attack: 0.1, hold: c.dur * 0.25, release: c.dur * 0.75, gain: 1.5 * I, rate0: 1.06, rate1: 0.72, ftype: 'lowpass', f0: 2400, f1: 650, send: 0.35, prio: 7, tag: 'groan' });
        break;
      case 'ooh':
        // rising "ooooOOH" as the shot leaves the boot
        this.shot({ buf: this.texOr('ooh'), at, attack: 0.2, hold: 0.22, release: 0.45, gain: 1.3 * I, rate0: 0.92, rate1: 1.24, ftype: 'lowpass', f0: 1700, f1: 3400, send: 0.3, prio: 6, tag: 'ooh' });
        break;
      case 'sigh':
        this.shot({ buf: this.texOr('ooh'), at, attack: 0.15, hold: 0.15, release: c.dur, gain: 0.7 * I, rate0: 0.95, rate1: 0.7, ftype: 'lowpass', f0: 1100, f1: 480, send: 0.3, prio: 4, tag: 'sigh' });
        break;
      case 'cheer':
        this.shot({ buf: this.texOr('roar'), at, attack: 0.07, hold: c.dur * 0.25, release: c.dur * 0.75, gain: 1.3 * I, rate0: 1.04, rate1: 0.93, ftype: 'lowpass', f0: 4200, f1: 2200, send: 0.35, prio: 6, tag: 'cheer' });
        break;
      case 'boo':
        // the "oooh" texture dragged down an octave-ish: a low, sour drone
        this.shot({ buf: this.texOr('ooh'), at, attack: 0.35, hold: c.dur * 0.5, release: c.dur * 0.5, gain: 1.7 * I, rate0: 0.66, rate1: 0.56, ftype: 'lowpass', f0: 900, f1: 600, send: 0.35, prio: 6, tag: 'boo' });
        break;
      case 'ole':
        this.shot({ buf: this.texOr('roar'), at, attack: 0.09, hold: 0.1, release: 0.26, gain: 0.9 * I, rate0: 0.84, rate1: 1.16, ftype: 'lowpass', f0: 1500, f1: 3200, send: 0.3, prio: 3, tag: 'ole' });
        break;
      case 'gasp': {
        // a stadium's worth of sharp in-breaths: airy band sweeping up, gone in 300 ms
        const v = m.voice({ bus: 'crowd', at, dur: 0.5, gain: 0.5 * I * CROWD_LEVELS.shot, send: 0.3, prio: 6, tag: 'gasp' });
        if (!v) break;
        const t = v.t0;
        const s = m.noiseSrc(v, 'pink', t, t + 0.4);
        const f = m.biquad(v, 'bandpass', 1400, 0.9);
        f.frequency.setValueAtTime(1400, t);
        f.frequency.exponentialRampToValueAtTime(3600, t + 0.14);
        const g = m.gain(v, 0);
        perc(g.gain, t, 1, 0.06, 0.28);
        s.connect(f);
        f.connect(g);
        g.connect(v.out);
        break;
      }
      case 'applause': {
        const dense = this.tex.applause;
        const sparse = this.tex.sparse;
        if (!dense || !sparse) break;
        const k = clamp((I - 0.2) / 0.4, 0, 1);
        if (k < 1) this.shot({ buf: sparse, at, attack: 0.4, hold: c.dur * 0.45, release: c.dur * 0.55, gain: (0.5 + 0.5 * I) * (1 - 0.6 * k), rate0: 0.97 + 0.06 * r(), rate1: 0.95, ftype: 'highpass', f0: 500, f1: 450, send: 0.3, prio: 4, tag: 'applause' });
        if (k > 0) this.shot({ buf: dense, at, attack: 0.5, hold: c.dur * 0.45, release: c.dur * 0.55, gain: 1.1 * I * k, rate0: 0.97 + 0.06 * r(), rate1: 0.94, ftype: 'highpass', f0: 500, f1: 420, send: 0.3, prio: 5, tag: 'applause' });
        break;
      }
      case 'jeer':
        this.jeer(at, I, c.dur);
        break;
      case 'chantStart':
        this.chantStart(c);
        break;
      case 'chantStop':
        this.wantChant = -1;
        this.wantChantCue = null;
        m.stopTag('chant', Math.max(0.2, c.dur));
        break;
      default:
        break;
    }
  }

  /**
   * GOAL. Three stages, all scheduled now on the context clock:
   *   1. burst   — broadband shock + sub thump, peaks inside 40 ms
   *   2. roar    — two passes of the shouting texture ("yeaaah"), pitch and brightness
   *                sagging as lungs empty; a second wave when the house is delirious
   *   3. ovation — applause creeps in underneath and outlasts the roar
   */
  private roar(at: number, I: number, dur: number, delirious: boolean): void {
    const m = this.m;
    const A = CROWD_LEVELS.shot;
    // 1) burst
    const b = m.voice({ bus: 'crowd', at, dur: 1.1, gain: 0.9 * I * A, send: 0.4, prio: 9, tag: 'roar' });
    if (b) {
      const t = b.t0;
      const s = m.noiseSrc(b, 'pink', t, t + 0.9);
      const f = m.biquad(b, 'bandpass', 1100, 0.5);
      const g = m.gain(b, 0);
      perc(g.gain, t, 1.6, 0.03, 0.75);
      s.connect(f);
      f.connect(g);
      g.connect(b.out);
      const s2 = m.noiseSrc(b, 'brown', t, t + 1.0);
      const lp = m.biquad(b, 'lowpass', 160, 0.7);
      const g2 = m.gain(b, 0);
      perc(g2.gain, t, 2.6, 0.02, 0.9);
      s2.connect(lp);
      lp.connect(g2);
      g2.connect(b.out);
    }
    // 2) sustained roar
    const v = m.voice({ bus: 'crowd', at, dur: dur * 1.6, gain: 2.3 * Math.pow(I, 0.8) * A, send: 0.4, prio: 9, tag: 'roar' });
    if (v) {
      const t = v.t0;
      const buf = this.texOr('roar');
      const lp = m.biquad(v, 'lowpass', 5200, 0.5);
      lp.frequency.setValueAtTime(5200, t);
      lp.frequency.exponentialRampToValueAtTime(1900, t + dur);
      // "yeaaah": a broad vowel peak that opens (≈1.2 kHz) then closes as the roar tires
      const pk = m.biquad(v, 'peaking', 1250, 0.9);
      pk.gain.value = 5;
      pk.frequency.setValueAtTime(900, t);
      pk.frequency.linearRampToValueAtTime(1300, t + 0.35);
      pk.frequency.linearRampToValueAtTime(950, t + dur);
      const g = m.gain(v, 0);
      const env = g.gain;
      env.setValueAtTime(0, t);
      env.linearRampToValueAtTime(1, t + 0.16);
      env.linearRampToValueAtTime(0.82, t + 1.0);
      if (delirious) {
        // it dawns on them: a second, bigger wave
        env.linearRampToValueAtTime(1.15, t + 1.9);
        env.linearRampToValueAtTime(0.9, t + dur * 0.5);
      } else env.linearRampToValueAtTime(0.7, t + dur * 0.45);
      env.setTargetAtTime(0, t + dur * 0.5, dur * 0.22);
      for (let i = 0; i < 2; i++) {
        const r0 = i === 0 ? 1.1 : 1.01;
        const s = m.bufSrc(v, buf, t, t + dur * 1.6, r0, true);
        s.playbackRate.setValueAtTime(r0, t);
        s.playbackRate.linearRampToValueAtTime(r0 * 0.86, t + dur);
        s.connect(lp);
      }
      lp.connect(pk);
      pk.connect(g);
      g.connect(v.out);
    }
    // 3) ovation
    const app = this.tex.applause;
    if (app) {
      this.shot({ buf: app, at: at + 0.7, attack: 1.3, hold: dur * 0.5, release: dur * 0.7, gain: 0.8 * I, rate0: 1.0, rate1: 0.94, ftype: 'highpass', f0: 500, f1: 420, send: 0.3, prio: 6, tag: 'applause' });
    }
  }

  /** Derisive whistles scattered round the bowl: high gliding sines, far away, wet. */
  private jeer(at: number, I: number, dur: number): void {
    const m = this.m;
    const r = m.rand;
    const n = Math.round(3 + 6 * I);
    const v = m.voice({ bus: 'crowd', at, dur: dur + 1.2, gain: (0.5 + 0.5 * I) * CROWD_LEVELS.shot, send: 0.7, prio: 5, tag: 'jeer' });
    if (!v) return;
    const pans = [m.panner(v, -0.6), m.panner(v, 0.55)];
    for (const p of pans) p.connect(v.out);
    for (let i = 0; i < n; i++) {
      const t = v.t0 + r() * dur * 0.7;
      const len = 0.45 + 0.6 * r();
      const f = 2500 + 1300 * r();
      const o = m.osc(v, 'sine', f, t, t + len);
      o.frequency.setValueAtTime(f * 0.8, t);
      o.frequency.linearRampToValueAtTime(f, t + len * 0.3);
      o.frequency.linearRampToValueAtTime(f * (0.72 + 0.1 * r()), t + len);
      const g = m.gain(v, 0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.035 + 0.03 * r(), t + 0.05);
      g.gain.setTargetAtTime(0, t + len * 0.6, len * 0.12);
      o.connect(g);
      g.connect(pans[i % 2]);
    }
  }

  // ---- chants -------------------------------------------------------------------------------

  private chantStart(c: CrowdCue): void {
    const id = clamp(Math.round(c.variant), 0, CHANTS.length - 1);
    this.wantChant = id;
    this.wantChantCue = c;
    const have = this.chants.get(id);
    if (have) {
      this.playChant(have, c);
      return;
    }
    if (have === null || this.chantPending.has(id)) return; // failed before / already baking
    this.chantPending.add(id);
    const m = this.m;
    void bakeChant(m.ctx, CHANTS[id], m.quality === 'full' ? 22 : 10, m.rand).then(
      (buf) => {
        this.chantPending.delete(id);
        this.chants.set(id, buf);
        // still wanted? (the model may have stopped it while we were baking)
        if (buf && this.wantChant === id && this.wantChantCue) this.playChant(buf, this.wantChantCue);
      },
      () => {
        this.chantPending.delete(id);
        this.chants.set(id, null);
      },
    );
  }

  /** Pre-bake a chant so its first use starts on time (tests / warm-up). */
  async prebakeChant(id: number): Promise<void> {
    if (this.chants.has(id) || !CHANTS[id]) return;
    const m = this.m;
    this.chants.set(id, await bakeChant(m.ctx, CHANTS[id], m.quality === 'full' ? 22 : 10, m.rand));
  }

  private playChant(buf: AudioBuffer, c: CrowdCue): void {
    const m = this.m;
    if (m.hasTag('chant')) return;
    const v = m.voice({ bus: 'crowd', dur: c.dur + 4, pan: c.away ? AWAY_PAN : 0, gain: (c.away ? 0.55 : 1.25) * c.intensity * CROWD_LEVELS.shot, send: 0.4, prio: 7, tag: 'chant' });
    if (!v) return;
    const t = v.t0;
    // a few start it, the rest join over the first phrase or two
    const s = m.bufSrc(v, buf, t, t + c.dur + 3.5, c.away ? 1.06 : 1, true, 0);
    const lp = m.biquad(v, c.away ? 'bandpass' : 'lowpass', c.away ? 1300 : 3000, 0.5);
    const g = m.gain(v, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.45, t + 1.2);
    g.gain.linearRampToValueAtTime(1, t + Math.min(8, buf.duration * 1.5));
    g.gain.setTargetAtTime(0, t + c.dur, 0.6);
    s.connect(lp);
    lp.connect(g);
    g.connect(v.out);
  }
}
