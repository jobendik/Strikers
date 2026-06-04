/*
 * Free-chest UI (F5) — the `#chests` overlay + a menu "unopened" badge.
 *
 * Lists each chest the player holds with its *published* rarity odds and the live
 * pity status ("Epic guaranteed in N"), an OPEN button, and an honest reveal of
 * the drop (coins + a cosmetic, or shards for a duplicate). No fake near-miss, no
 * hidden odds (retention §3). Pure presentation over the save; `game/chests.ts`
 * owns the roll + pity.
 */
import { getPlayerData, savePlayerData } from '../core/playerData';
import {
  CHESTS, chestCount, totalChests, pityStatus, openChest, EPIC_PITY, MYTHIC_PITY,
  type ChestOpen,
} from '../game/chests';
import { RARITY_ORDER } from '../game/collection';
import { refreshCollectionBadge } from './collection';
import { refreshProfileCard } from './profile';

const byId = (id: string): HTMLElement | null => document.getElementById(id);

/** Update the menu "unopened chests" badge. */
export function refreshChestsBadge(): void {
  const badge = byId('chestsBadge');
  if (!badge) return;
  const n = totalChests(getPlayerData());
  badge.textContent = String(n);
  badge.classList.toggle('hidden', n === 0);
}

function oddsLine(odds: Record<string, number>): string {
  return RARITY_ORDER.filter((r) => odds[r] > 0)
    .map((r) => `<span class="rar-${r}">${r} ${Math.round(odds[r] * 100)}%</span>`)
    .join(' · ');
}

function renderBody(reveal?: ChestOpen): void {
  const body = byId('chestsBody');
  if (!body) return;
  const data = getPlayerData();
  const pity = pityStatus(data);

  const pityLine =
    `<div class="cx-pity">Pity — Epic guaranteed in <b>${pity.epicIn}</b> · Mythic in <b>${pity.mythicIn}</b> ` +
    `<span class="cx-faint">(within ${EPIC_PITY}/${MYTHIC_PITY})</span></div>`;

  const cards = CHESTS.map((d) => {
    const n = chestCount(data, d.id);
    const disabled = n <= 0 ? ' disabled' : '';
    return (
      `<div class="cx-card-row${n > 0 ? ' has' : ''}">` +
      `<div class="cx-info"><div class="cx-name">${d.name} ${n > 0 ? `<span class="cx-have">×${n}</span>` : ''}</div>` +
      `<div class="cx-odds">${oddsLine(d.odds)}</div></div>` +
      `<button class="cta small cx-open" data-chest="${d.id}"${disabled}>OPEN ▸</button></div>`
    );
  }).join('');

  let revealHtml = '';
  if (reveal) {
    const cz = reveal.cosmetic;
    const got = cz.newlyOwned ? `NEW · ${cz.name}` : cz.shards > 0 ? `Duplicate → +${cz.shards} ${cz.rarity} shards` : cz.name;
    const forced = reveal.pityForced ? `<div class="cx-forced">★ ${reveal.pityForced.toUpperCase()} pity guarantee!</div>` : '';
    revealHtml =
      `<div class="cx-reveal rar-${reveal.rarity}">` +
      forced +
      `<div class="cx-reveal-rar rar-${reveal.rarity}">${reveal.rarity.toUpperCase()}</div>` +
      `<div class="cx-reveal-item">${got}</div>` +
      `<div class="cx-reveal-coins">+${reveal.coins} coins</div></div>`;
  }

  body.innerHTML = pityLine + revealHtml + `<div class="cx-list">${cards}</div>`;
}

function open(id: string): void {
  const data = getPlayerData();
  const result = openChest(data, id);
  if (!result) return;
  savePlayerData();
  renderBody(result);
  refreshChestsBadge();
  refreshCollectionBadge();
}

function setVisible(v: boolean): void {
  byId('chests')?.classList.toggle('hidden', !v);
}

export function openChests(): void {
  renderBody();
  setVisible(true);
}

export function closeChests(): void {
  setVisible(false);
  refreshChestsBadge();
  refreshProfileCard(); // chest coins/cosmetics gained
}

/** Wire the chest overlay. Call once at boot. */
export function initChests(): void {
  byId('btnChests')?.addEventListener('click', openChests);
  byId('btnChestsDone')?.addEventListener('click', closeChests);
  byId('chestsBody')?.addEventListener('click', (e) => {
    const id = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-chest]')?.dataset.chest;
    if (id) open(id);
  });
  refreshChestsBadge();
}
