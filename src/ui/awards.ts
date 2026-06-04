/*
 * Awards UI (G1 medals · G2 achievements · G3 mastery) — the `#awards` overlay
 * with three tabs + a menu badge of completed achievements.
 *
 * Pure presentation over the save: achievements show live partial progress and
 * rewards (hidden ones masked until earned), medals show lifetime counts, mastery
 * shows a per-nation bar. The engines (`game/achievements|medals|mastery.ts`) own
 * detection + grants; this only reads + renders.
 */
import { getPlayerData } from '../core/playerData';
import { getSettings } from '../core/settings';
import { achievementRows, completedCount, ACHIEVEMENTS } from '../game/achievements';
import { MEDALS } from '../game/medals';
import { masteryStanding, masteredNations } from '../game/mastery';

const byId = (id: string): HTMLElement | null => document.getElementById(id);
type Tab = 'ach' | 'medals' | 'mastery';
let activeTab: Tab = 'ach';

/** Update the menu "achievements completed" badge. */
export function refreshAwardsBadge(): void {
  const badge = byId('awardsBadge');
  if (!badge) return;
  const n = completedCount(getPlayerData());
  badge.textContent = `${n}/${ACHIEVEMENTS.length}`;
  badge.classList.toggle('hidden', n === 0);
}

const bar = (v: number, t: number): string =>
  `<div class="aw-track"><div class="aw-fill" style="width:${t > 0 ? Math.round((Math.min(v, t) / t) * 100) : 0}%"></div></div>`;

function renderAch(): string {
  const data = getPlayerData();
  return achievementRows(data)
    .map((r) => {
      const reward = r.reward ? ` · <span class="aw-reward">${r.reward}</span>` : '';
      return (
        `<div class="aw-row${r.done ? ' done' : ''}${r.hidden ? ' hidden-ach' : ''}">` +
        `<div class="aw-top"><span class="aw-name">${r.done ? '✓ ' : ''}${r.label}</span>` +
        `<span class="aw-prog">${Math.min(r.value, r.target)}/${r.target}</span></div>` +
        `<div class="aw-desc">${r.desc}${reward}</div>` +
        bar(r.value, r.target) +
        `</div>`
      );
    })
    .join('');
}

function renderMedals(): string {
  const data = getPlayerData();
  return (
    `<div class="aw-medals">` +
    MEDALS.map((m) => {
      const n = data.medals[m.id] ?? 0;
      return (
        `<div class="aw-medal${n > 0 ? ' earned' : ''}">` +
        `<span class="aw-medal-em">${m.emoji}</span>` +
        `<span class="aw-medal-l">${m.label}</span>` +
        `<span class="aw-medal-n">${n > 0 ? `×${n}` : '—'}</span></div>`
      );
    }).join('') +
    `</div>`
  );
}

function renderMastery(): string {
  const data = getPlayerData();
  const current = masteryStanding(data, getSettings().team);
  const others = masteredNations(data).filter((m) => m.nation !== current.nation);
  const rows = [current, ...others];
  return rows
    .map((m) => {
      const cap = m.atMax ? 'MAX' : `${Math.round(m.into)}/${m.forNext}`;
      return (
        `<div class="aw-row">` +
        `<div class="aw-top"><span class="aw-name">${m.name} <span class="aw-mlvl">LV ${m.level}</span></span>` +
        `<span class="aw-prog">${cap}</span></div>` +
        bar(m.into, m.forNext || 1) +
        `</div>`
      );
    })
    .join('');
}

function render(): void {
  for (const t of ['ach', 'medals', 'mastery'] as Tab[]) {
    byId('awTabs')?.querySelector(`[data-tab="${t}"]`)?.classList.toggle('on', t === activeTab);
  }
  const body = byId('awardsBody');
  if (body) body.innerHTML = activeTab === 'ach' ? renderAch() : activeTab === 'medals' ? renderMedals() : renderMastery();
}

function setVisible(v: boolean): void {
  byId('awards')?.classList.toggle('hidden', !v);
}

export function openAwards(): void {
  render();
  setVisible(true);
}

export function closeAwards(): void {
  setVisible(false);
}

/** Wire the awards overlay. Call once at boot. */
export function initAwards(): void {
  byId('btnAwards')?.addEventListener('click', openAwards);
  byId('btnAwardsDone')?.addEventListener('click', closeAwards);
  byId('awTabs')?.addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined;
    if (tab) {
      activeTab = tab;
      render();
    }
  });
  refreshAwardsBadge();
}
