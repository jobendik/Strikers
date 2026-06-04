/*
 * Weekly card (E4 menu surface) — shows this week's orders + the weekly activity
 * meter ("play 3 days this week") on the start menu, so the player has a medium-
 * term goal visible before kicking off.  Pure presentation over the player save;
 * the reward pipeline (`game/rewards.ts`) does the scoring after matches.
 *
 * Forgiving design (retention.md §3): the activity meter simply shows progress
 * and awards a bonus when the target is hit — it never punishes a missed week.
 */
import { getPlayerData, savePlayerData } from '../core/playerData';
import {
  ensureThisWeek,
  rerollWeeklyOrder,
  weeklyOrderLabel,
  remainingWeeklyOrders,
  WEEKLY_ACTIVITY_TARGET,
  weeklyRerollUsed,
} from '../game/quests';
import { isoWeekId } from '../core/dates';
import { rewarded } from '../platform/crazygames';

const byId = (id: string): HTMLElement | null => document.getElementById(id);

/** Re-render the weekly card from the save (rolls fresh orders on a new ISO week). */
export function refreshWeeklyCard(): void {
  const card = byId('weeklyCard');
  if (!card) return;
  const data = getPlayerData();
  if (ensureThisWeek(data.weekly, isoWeekId())) savePlayerData();

  // activity meter
  const realDays = data.weekly.activeDays.filter((d) => d !== '__rerolled').length;
  const pct = Math.round((Math.min(realDays, WEEKLY_ACTIVITY_TARGET) / WEEKLY_ACTIVITY_TARGET) * 100);
  const lbl = byId('weeklyActivityLbl');
  if (lbl) lbl.textContent = `${Math.min(realDays, WEEKLY_ACTIVITY_TARGET)}/${WEEKLY_ACTIVITY_TARGET} days`;
  const fill = byId('weeklyActivityFill');
  if (fill) fill.style.width = `${pct}%`;

  // order list
  const list = byId('weeklyOrders');
  if (list) {
    list.innerHTML = data.weekly.orders
      .map((q) => {
        const done = q.claimed;
        return (
          `<div class="daily-order${done ? ' done' : ''}">` +
          `<span class="daily-tick">${done ? '✓' : '○'}</span>` +
          `<span class="daily-label">${weeklyOrderLabel(q.id)}</span>` +
          `<span class="daily-prog">${Math.min(q.progress, q.target)}/${q.target}</span></div>`
        );
      })
      .join('');
  }

  const open = remainingWeeklyOrders(data.weekly).length > 0;
  const used = weeklyRerollUsed(data.weekly);
  const reroll = byId('btnWeeklyReroll') as HTMLButtonElement | null;
  if (reroll) reroll.classList.toggle('hidden', !(open && !used));
  const rerollAd = byId('btnWeeklyRerollAd') as HTMLButtonElement | null;
  if (rerollAd) rerollAd.classList.toggle('hidden', !(open && used));
}

/** Wire the weekly reroll buttons. Call once at boot. */
export function initWeeklyCard(): void {
  byId('btnWeeklyReroll')?.addEventListener('click', () => {
    const data = getPlayerData();
    const idx = data.weekly.orders.findIndex((q) => !q.claimed);
    if (idx >= 0 && rerollWeeklyOrder(data.weekly, idx)) {
      savePlayerData();
      refreshWeeklyCard();
    }
  });
  // earned extra reroll (B4): opt-in rewarded ad; no-op in dev
  byId('btnWeeklyRerollAd')?.addEventListener('click', () => {
    rewarded((granted) => {
      if (!granted) return;
      const data = getPlayerData();
      const idx = data.weekly.orders.findIndex((q) => !q.claimed);
      if (idx >= 0 && rerollWeeklyOrder(data.weekly, idx, true)) {
        savePlayerData();
        refreshWeeklyCard();
      }
    });
  });
  refreshWeeklyCard();
}
