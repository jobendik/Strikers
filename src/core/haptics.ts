/**
 * Lightweight haptic feedback for mobile. Uses the Vibration API where
 * available; silently no-ops on unsupported platforms (e.g. iOS Safari).
 */
const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

let enabled = true;

export const Haptics = {
  setEnabled(v: boolean): void {
    enabled = v;
  },
  buzz(pattern: number | number[]): void {
    if (!enabled || !canVibrate) return;
    try {
      navigator.vibrate(pattern);
    } catch {
      /* ignore — vibration is best-effort */
    }
  },
  tap(): void {
    this.buzz(12);
  },
  kick(): void {
    this.buzz(22);
  },
  tackle(): void {
    this.buzz([0, 30, 40, 30]);
  },
  goal(): void {
    this.buzz([0, 60, 50, 60, 50, 120]);
  },
  whistle(): void {
    this.buzz(40);
  },
};
