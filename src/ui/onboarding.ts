/*
 * First-run onboarding (J1) — a one-time welcome overlay that teaches the game in
 * ~10 seconds (controls + the honest progression promise) and then never shows
 * again. Skippable, neutral, no pressure. Tracked by `flags.seenIntro` in the save.
 */
import { getPlayerData, savePlayerData } from '../core/playerData';

const byId = (id: string): HTMLElement | null => document.getElementById(id);

/** Show the welcome overlay on a brand-new save; no-op once seen. */
export function initOnboarding(): void {
  const data = getPlayerData();
  const intro = byId('intro');
  const dismiss = (): void => {
    data.flags.seenIntro = true;
    savePlayerData();
    intro?.classList.add('hidden');
  };
  byId('btnIntroGo')?.addEventListener('click', dismiss);
  if (!data.flags.seenIntro && data.stats.played === 0) intro?.classList.remove('hidden');
  else intro?.classList.add('hidden');
}
