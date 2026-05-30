/*
 * Daily card (E2/E3 menu surface) — shows today's orders + the daily-chest meter
 * on the start menu so the player sees what to chase before kicking off, and can
 * reroll one order. Pure presentation over the player save; the reward pipeline
 * (`game/rewards.ts`) does the scoring after matches.
 */
import { getPlayerData, savePlayerData } from '../core/playerData';
import { ensureToday, rerollOrder, orderLabel, remainingOrders, CHEST_MAX } from '../game/quests';

const byId = (id: string): HTMLElement | null => document.getElementById(id);

/** Re-render the daily card from the save (rolls fresh orders on a new day). */
export function refreshDailyCard(): void {
  const card = byId('dailyCard');
  if (!card) return;
  const data = getPlayerData();
  if (ensureToday(data.daily)) savePlayerData(); // a new day rolled fresh orders

  const pct = Math.round((data.daily.chestPoints / CHEST_MAX) * 100);
  const lbl = byId('dailyChestLbl');
  if (lbl) lbl.textContent = `Chest ${pct}%`;
  const fill = byId('dailyChestFill');
  if (fill) fill.style.width = `${pct}%`;

  const list = byId('dailyOrders');
  if (list) {
    list.innerHTML = data.daily.orders
      .map((q) => {
        const done = q.claimed;
        return (
          `<div class="daily-order${done ? ' done' : ''}">` +
          `<span class="daily-tick">${done ? '✓' : '○'}</span>` +
          `<span class="daily-label">${orderLabel(q.id)}</span>` +
          `<span class="daily-prog">${Math.min(q.progress, q.target)}/${q.target}</span></div>`
        );
      })
      .join('');
  }

  const reroll = byId('btnReroll') as HTMLButtonElement | null;
  if (reroll) {
    const canReroll = !data.daily.rerollUsed && remainingOrders(data.daily).length > 0;
    reroll.classList.toggle('hidden', !canReroll);
  }
}

/** Wire the reroll button. Call once at boot. */
export function initDailyCard(): void {
  byId('btnReroll')?.addEventListener('click', () => {
    const data = getPlayerData();
    // reroll the first still-open order (keeps the interaction one-tap simple)
    const idx = data.daily.orders.findIndex((q) => !q.claimed);
    if (idx >= 0 && rerollOrder(data.daily, idx)) {
      savePlayerData();
      refreshDailyCard();
    }
  });
  refreshDailyCard();
}
