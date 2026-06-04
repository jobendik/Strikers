/*
 * Clean exit / pause (J3) — surfaces live progress + claimables on the pause
 * overlay so quitting is never a loss, with neutral, non-manipulative copy
 * (retention §3: RESUME primary, "Progress saved · come back anytime").
 *
 * Decoupled from the gameplay path: it just reads the save and fills `#pauseInfo`
 * when the pause button is pressed (the actual pause toggle stays in `flow.ts`).
 */
import { getPlayerData } from '../core/playerData';
import { CHEST_MAX } from '../game/quests';
import { seasonStanding, countClaimable } from '../game/season';
import { totalChests } from '../game/chests';

const byId = (id: string): HTMLElement | null => document.getElementById(id);

/** Fill the pause card with the player's current progress + anything claimable. */
export function refreshPauseInfo(): void {
  const box = byId('pauseInfo');
  if (!box) return;
  const data = getPlayerData();
  const chest = Math.round((data.daily.chestPoints / CHEST_MAX) * 100);
  const st = seasonStanding(data.season);
  const claimable = countClaimable(data.season);
  const chests = totalChests(data);

  const lines: string[] = [
    `<div class="pi-row"><span>Daily chest</span><b>${chest}%</b></div>`,
    `<div class="pi-row"><span>Season</span><b>Tier ${st.tier}</b></div>`,
  ];
  if (claimable > 0) lines.push(`<div class="pi-row claim"><span>Rewards to claim</span><b>${claimable}</b></div>`);
  if (chests > 0) lines.push(`<div class="pi-row claim"><span>Chests to open</span><b>${chests}</b></div>`);
  box.innerHTML = lines.join('');
}

/** Wire the pause-info refresh. Call once at boot. */
export function initPause(): void {
  // refresh whenever the player opens the pause menu (the button also toggles pause in flow.ts)
  byId('pauseBtn')?.addEventListener('pointerdown', refreshPauseInfo);
  refreshPauseInfo();
}
