/*
 * Rewarded-ad opt-in surfaces (B4) — honest, never gating progress.
 *
 * The only currently-wired surface is "double this match's XP" on the result
 * screen; the daily/weekly cards add an earned extra reroll (wired in their own
 * modules). Everything is opt-in: the reward applies *only* when a rewarded ad is
 * fully watched (`rewarded(granted)` → true). In local dev / off-platform there's
 * no SDK, so `granted` is false and nothing changes — no penalty, nothing locked
 * (retention §3). The button states say plainly that it's a short ad.
 */
import { rewarded } from '../platform/crazygames';

const byId = (id: string): HTMLElement | null => document.getElementById(id);

let xp = 0;
let onGrant: () => void = () => {};
let claimed = false;

/**
 * Arm the result screen's "double XP" button with this match's XP and the callback
 * that applies the bonus. Call after the result screen is shown. Hides the button
 * when there's no XP to double.
 */
export function armDoubleXp(amount: number, grant: () => void): void {
  xp = amount;
  onGrant = grant;
  claimed = false;
  const b = byId('btnRewardXp') as HTMLButtonElement | null;
  if (!b) return;
  b.textContent = "▶ DOUBLE THIS MATCH'S XP · watch a short ad";
  b.disabled = false;
  b.classList.toggle('hidden', amount <= 0);
}

/** Wire the rewarded buttons once at boot. */
export function initRewardedSurfaces(): void {
  byId('btnRewardXp')?.addEventListener('click', () => {
    if (claimed || xp <= 0) return;
    rewarded((granted) => {
      if (!granted) return; // no SDK / declined / not finished — no change, no penalty
      claimed = true;
      onGrant();
      const b = byId('btnRewardXp') as HTMLButtonElement | null;
      if (b) {
        b.textContent = '✓ DOUBLE XP CLAIMED';
        b.disabled = true;
      }
    });
  });
}
