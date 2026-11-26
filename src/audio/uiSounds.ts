/*
 * Menu / HUD sounds. Dry (no stadium reverb), short, tonal — they must read as
 * "interface", clearly apart from the pitch and the crowd.
 */
import { Mixer, perc, type Voice } from './mixer';

export type UiSound = 'click' | 'confirm' | 'back' | 'reward' | 'error';

function note(m: Mixer, v: Voice, t: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
  const o = m.osc(v, type, freq, t, t + dur);
  const g = m.gain(v, 0);
  perc(g.gain, t, gain, 0.004, dur);
  o.connect(g);
  g.connect(v.out);
}

export function uiSound(m: Mixer, kind: UiSound): void {
  if (!m.gate('ui:' + kind, 0.04)) return;
  switch (kind) {
    case 'click': {
      const v = m.voice({ bus: 'ui', dur: 0.08, gain: 0.5, prio: 7, tag: 'ui' });
      if (!v) return;
      const o = m.osc(v, 'sine', 1250, v.t0, v.t0 + 0.05);
      o.frequency.exponentialRampToValueAtTime(820, v.t0 + 0.04);
      const g = m.gain(v, 0);
      perc(g.gain, v.t0, 0.8, 0.001, 0.045);
      o.connect(g);
      g.connect(v.out);
      break;
    }
    case 'confirm': {
      const v = m.voice({ bus: 'ui', dur: 0.36, gain: 0.5, prio: 7, tag: 'ui' });
      if (!v) return;
      note(m, v, v.t0, 659.3, 0.12, 0.6, 'triangle');
      note(m, v, v.t0 + 0.075, 987.8, 0.22, 0.7, 'triangle');
      break;
    }
    case 'back': {
      const v = m.voice({ bus: 'ui', dur: 0.3, gain: 0.45, prio: 7, tag: 'ui' });
      if (!v) return;
      note(m, v, v.t0, 523.3, 0.1, 0.6, 'triangle');
      note(m, v, v.t0 + 0.07, 392, 0.18, 0.6, 'triangle');
      break;
    }
    case 'reward': {
      const v = m.voice({ bus: 'ui', dur: 1.3, gain: 0.5, prio: 8, tag: 'ui' });
      if (!v) return;
      const notes = [523.3, 659.3, 784, 1046.5];
      notes.forEach((f, i) => {
        const t = v.t0 + i * 0.085;
        note(m, v, t, f, 0.5, 0.5, 'triangle');
        note(m, v, t, f * 2.01, 0.35, 0.12); // bell shimmer
      });
      note(m, v, v.t0 + 0.34, 1568, 0.8, 0.22);
      break;
    }
    case 'error': {
      const v = m.voice({ bus: 'ui', dur: 0.3, gain: 0.5, prio: 7, tag: 'ui' });
      if (!v) return;
      const lp = m.biquad(v, 'lowpass', 900, 0.7);
      const g = m.gain(v, 0);
      perc(g.gain, v.t0, 0.6, 0.004, 0.22);
      for (const f of [155, 163]) {
        const o = m.osc(v, 'square', f, v.t0, v.t0 + 0.24);
        o.connect(lp);
      }
      lp.connect(g);
      g.connect(v.out);
      break;
    }
    default:
      break;
  }
}
