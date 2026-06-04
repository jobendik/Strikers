/*
 * Earned-currency shop UI (F6) — the `#shop` overlay.
 *
 * Shows today's deterministic shelf with each offer's cost, a BUY button (dimmed
 * when unaffordable or already owned) and a wishlist star. Honest framing: a
 * plain "New shop tomorrow · items return" line, no fake stock / countdown
 * (retention §3). Pure presentation over the save; `game/shop.ts` owns rotation
 * + purchase.
 */
import { getPlayerData, savePlayerData } from '../core/playerData';
import { dailyOffers, canBuy, buy, toggleWishlist, isWishlisted, type ShopItem } from '../game/shop';
import { refreshCollectionBadge } from './collection';
import { refreshChestsBadge } from './chest';

const byId = (id: string): HTMLElement | null => document.getElementById(id);

function offerRow(item: ShopItem): string {
  const data = getPlayerData();
  const state = canBuy(data, item);
  const star = isWishlisted(data, item.ref) ? '★' : '☆';
  const cur = item.currency === 'gems' ? '💎' : '🪙';
  const btn = state.ok
    ? `<button class="cta small sh-buy" data-buy="${item.id}">${item.cost} ${cur}</button>`
    : state.reason === 'owned'
      ? `<span class="sh-owned">OWNED</span>`
      : `<button class="cta small sh-buy" data-buy="${item.id}" disabled>${item.cost} ${cur}</button>`;
  return (
    `<div class="sh-row${item.rarity ? ' rar-' + item.rarity : ''}">` +
    `<button class="sh-star" data-wish="${item.ref}" aria-label="Wishlist">${star}</button>` +
    `<div class="sh-info"><div class="sh-name">${item.label}</div>` +
    `<div class="sh-kind">${item.kind === 'cosmetic' ? (item.rarity ?? '') + ' cosmetic' : item.kind === 'chest' ? 'chest' : 'shards'}</div></div>` +
    btn +
    `</div>`
  );
}

function render(): void {
  const body = byId('shopBody');
  if (!body) return;
  const data = getPlayerData();
  const offers = dailyOffers();
  const balances = `<div class="sh-balance">🪙 ${data.coins} &nbsp; 💎 ${data.gems}</div>`;
  const note = `<div class="sh-note">New shop tomorrow · every item returns — no fake stock</div>`;
  body.innerHTML = balances + `<div class="sh-list">${offers.map(offerRow).join('')}</div>` + note;
}

function onClick(e: Event): void {
  const target = e.target as HTMLElement | null;
  const wish = target?.closest<HTMLElement>('[data-wish]')?.dataset.wish;
  if (wish) {
    toggleWishlist(getPlayerData(), wish);
    savePlayerData();
    render();
    return;
  }
  const buyId = target?.closest<HTMLElement>('[data-buy]')?.dataset.buy;
  if (buyId) {
    const res = buy(getPlayerData(), buyId);
    if (res.ok) {
      savePlayerData();
      render();
      refreshCollectionBadge();
      refreshChestsBadge();
    }
  }
}

function setVisible(v: boolean): void {
  byId('shop')?.classList.toggle('hidden', !v);
}

export function openShop(): void {
  render();
  setVisible(true);
}

export function closeShop(): void {
  setVisible(false);
}

/** Wire the shop overlay. Call once at boot. */
export function initShop(): void {
  byId('btnShop')?.addEventListener('click', openShop);
  byId('btnShopDone')?.addEventListener('click', closeShop);
  byId('shopBody')?.addEventListener('click', onClick);
}
