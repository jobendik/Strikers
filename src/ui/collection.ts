/*
 * Cosmetic collection album UI (F3/F4) — the `#collection` overlay + a menu
 * "owned" badge. Slot tabs (kit / ball / celebration / trail / banner / net /
 * stinger / title) over a rarity-tinted grid; tap an owned item to equip it, see
 * locked items with their honest source, plus a summary of shard balances and
 * set-completion bonuses. Pure presentation over the save; `game/collection.ts`
 * owns the catalogue + equip logic.
 */
import { getPlayerData, savePlayerData } from '../core/playerData';
import {
  CATALOGUE, RARITY_ORDER, bySlot, isOwned, equip, equippedIn, collectionProgress,
  completionBonuses, checkCompletionBonuses, type Slot,
} from '../game/collection';

const byId = (id: string): HTMLElement | null => document.getElementById(id);

const SLOTS: { slot: Slot; label: string }[] = [
  { slot: 'kit', label: 'KITS' },
  { slot: 'ball', label: 'BALLS' },
  { slot: 'celebration', label: 'CELEBS' },
  { slot: 'trail', label: 'TRAILS' },
  { slot: 'banner', label: 'BANNERS' },
  { slot: 'net', label: 'NETS' },
  { slot: 'stinger', label: 'STINGERS' },
  { slot: 'title', label: 'TITLES' },
];

let activeSlot: Slot = 'kit';

/** Update the menu "n owned" badge. */
export function refreshCollectionBadge(): void {
  const badge = byId('collectionBadge');
  if (!badge) return;
  const p = collectionProgress(getPlayerData());
  badge.textContent = `${p.owned}/${p.total}`;
  badge.classList.remove('hidden');
}

function renderTabs(): void {
  const tabs = byId('coTabs');
  if (!tabs) return;
  tabs.innerHTML = SLOTS.map(
    (s) => `<button class="wc-tab${s.slot === activeSlot ? ' on' : ''}" data-slot="${s.slot}">${s.label}</button>`,
  ).join('');
}

function renderSummary(): void {
  const sum = byId('coSummary');
  if (!sum) return;
  const data = getPlayerData();
  const p = collectionProgress(data);
  const shardPills = RARITY_ORDER.filter((r) => (data.shards[r] ?? 0) > 0)
    .map((r) => `<span class="co-shard rar-${r}">${data.shards[r]} ${r}</span>`)
    .join('');
  const bonuses = completionBonuses()
    .map((b) => {
      const done = data.flags[`coll:${b.id}`];
      return `<div class="co-bonus${done ? ' done' : ''}"><span>${done ? '✓' : '○'}</span> ${b.label} <b>+${b.coins}</b></div>`;
    })
    .join('');
  sum.innerHTML =
    `<div class="co-prog">Collected <b>${p.owned}</b> / ${p.total}</div>` +
    `<div class="co-shards">${shardPills || '<span class="co-shard-empty">No shards yet — duplicates convert to shards</span>'}</div>` +
    `<div class="co-bonuses">${bonuses}</div>`;
}

function renderBody(): void {
  const body = byId('coBody');
  if (!body) return;
  const data = getPlayerData();
  const items = bySlot(activeSlot);
  const eq = equippedIn(data, activeSlot);
  body.innerHTML = `<div class="co-grid">${items
    .map((x) => {
      const owned = isOwned(data, x.id);
      const equipped = x.id === eq;
      const cls = ['co-item', `rar-${x.rarity}`, owned ? 'owned' : 'locked', equipped ? 'equipped' : ''].join(' ').trim();
      const attrs = owned ? ` data-id="${x.id}" data-slot="${x.slot}" role="button" tabindex="0"` : '';
      const tag = equipped ? '<span class="co-eqtag">EQUIPPED</span>' : owned ? '<span class="co-eqtag faint">EQUIP</span>' : `<span class="co-src">🔒 ${x.source}</span>`;
      return `<div class="${cls}"${attrs}><span class="co-rar">${x.rarity}</span><span class="co-name">${x.name}</span>${tag}</div>`;
    })
    .join('')}</div>`;
}

function render(): void {
  renderTabs();
  renderSummary();
  renderBody();
}

function equipFrom(target: EventTarget | null): void {
  const item = (target as HTMLElement | null)?.closest<HTMLElement>('.co-item.owned');
  const id = item?.dataset.id;
  const slot = item?.dataset.slot as Slot | undefined;
  if (!id || !slot) return;
  const data = getPlayerData();
  // tapping the equipped item clears back to default; else equip it
  const next = equippedIn(data, slot) === id ? null : id;
  if (equip(data, slot, next)) {
    savePlayerData();
    render();
  }
}

function setVisible(v: boolean): void {
  byId('collection')?.classList.toggle('hidden', !v);
}

/** Open the collection album (pays out any pending set-completion bonus first). */
export function openCollection(): void {
  const data = getPlayerData();
  if (checkCompletionBonuses(data).length) savePlayerData(); // honest catch-up on first open after a set completes
  render();
  setVisible(true);
}

export function closeCollection(): void {
  setVisible(false);
  refreshCollectionBadge();
}

/** Wire the collection album. Call once at boot. */
export function initCollection(): void {
  byId('btnCollection')?.addEventListener('click', openCollection);
  byId('btnCollectionDone')?.addEventListener('click', closeCollection);

  byId('coTabs')?.addEventListener('click', (e) => {
    const slot = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-slot]')?.dataset.slot as Slot | undefined;
    if (slot) {
      activeSlot = slot;
      render();
    }
  });

  const body = byId('coBody');
  body?.addEventListener('click', (e) => equipFrom(e.target));
  body?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      equipFrom(e.target);
    }
  });

  refreshCollectionBadge();
}

// re-export so other modules don't need to import the engine just for the count
export { CATALOGUE };
