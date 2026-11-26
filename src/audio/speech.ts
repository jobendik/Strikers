/*
 * Optional commentary VOICE hook (Web Speech API). OFF by default. It only
 * speaks lines another module hands it — there is no script system here.
 * Rate-limited, never overlapping, never blocking, a no-op where unsupported.
 * (Speech synthesis cannot be routed through Web Audio, so it bypasses the
 * mixer; the 'commentary' volume is applied to the utterance itself.)
 */
export interface SayOpts {
  /** Cut off whatever is being said and say this now (goal calls). */
  urgent?: boolean;
  rate?: number;
  pitch?: number;
}

const MIN_GAP_MS = 2500;

export function createSpeech(): {
  say(text: string, opts?: SayOpts): boolean;
  setEnabled(on: boolean): void;
  setVolume(v: number): void;
  cancel(): void;
  readonly supported: boolean;
  readonly enabled: boolean;
} {
  let enabled = false;
  let volume = 1;
  let lastAt = -1e9;
  const synth = (): SpeechSynthesis | null => {
    try {
      const g = globalThis as unknown as { speechSynthesis?: SpeechSynthesis; SpeechSynthesisUtterance?: unknown };
      return g.speechSynthesis && typeof g.SpeechSynthesisUtterance === 'function' ? g.speechSynthesis : null;
    } catch {
      return null;
    }
  };
  return {
    get supported() {
      return synth() !== null;
    },
    get enabled() {
      return enabled;
    },
    setEnabled(on) {
      enabled = on;
      if (!on) this.cancel();
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 1));
    },
    cancel() {
      try {
        synth()?.cancel();
      } catch {
        /* ignore */
      }
    },
    say(text, opts = {}) {
      const s = synth();
      if (!enabled || !s || !text || volume <= 0) return false;
      try {
        const now = Date.now();
        const busy = s.speaking || s.pending;
        if (opts.urgent) s.cancel();
        else if (busy || now - lastAt < MIN_GAP_MS) return false;
        const u = new SpeechSynthesisUtterance(String(text).slice(0, 160));
        u.volume = volume;
        u.rate = Math.max(0.5, Math.min(2, opts.rate ?? 1.12));
        u.pitch = Math.max(0, Math.min(2, opts.pitch ?? 1));
        lastAt = now;
        s.speak(u);
        return true;
      } catch {
        return false;
      }
    },
  };
}
