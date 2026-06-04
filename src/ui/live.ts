/*
 * Live-service UI (K1 leaderboard · K2 activity feed · K4 region goal) + the
 * weekly-event banner (K3). Everything here is an honest, clearly-labelled local
 * simulation — the headers say "Simulated" and the player's own numbers are real.
 */
import { getPlayerData } from '../core/playerData';
import { activeEvent } from '../game/events';
import { weeklyLeaderboard, activityFeed, regionGoal } from '../game/rivals';
import { teamMeta } from '../config/players';

const byId = (id: string): HTMLElement | null => document.getElementById(id);

/** Refresh the menu's weekly-event banner (K3). */
export function refreshEventBanner(): void {
  const banner = byId('eventBanner');
  if (!banner) return;
  const ev = activeEvent();
  banner.classList.remove('hidden');
  const em = byId('eventEm');
  if (em) em.textContent = ev.emoji;
  const name = byId('eventName');
  if (name) name.textContent = ev.name;
  const blurb = byId('eventBlurb');
  if (blurb) blurb.textContent = ` · ${ev.blurb}`;
}

function renderLive(): void {
  const body = byId('liveBody');
  if (!body) return;
  const data = getPlayerData();
  const lb = weeklyLeaderboard(data);
  const feed = activityFeed();
  const region = regionGoal(data);

  const board =
    `<div class="lv-h">WEEKLY LEADERBOARD <span class="lv-sim">simulated · local</span></div>` +
    `<div class="lv-rank">You're <b>#${lb.rank}</b> of ${lb.total} · ${lb.tier}</div>` +
    `<div class="lv-list">` +
    lb.rows
      .slice(0, 10)
      .map((r, i) => `<div class="lv-row${r.you ? ' you' : ''}"><span class="lv-pos">${i + 1}</span><span class="lv-name">${r.name}</span><span class="lv-nat">${teamMeta(r.nation).short ?? ''}</span><span class="lv-score">${r.score}</span></div>`)
      .join('') +
    `</div>`;

  const goalPct = Math.round(region.pct * 100);
  const reg =
    `<div class="lv-h">REGION GOAL <span class="lv-sim">community simulation</span></div>` +
    `<div class="lv-region">${region.label}</div>` +
    `<div class="daily-meter"><div class="daily-fill season-fill" style="width:${goalPct}%"></div></div>` +
    `<div class="lv-region-sub">${goalPct}% · your goals contributed: ${region.yourContribution}</div>`;

  const river =
    `<div class="lv-h">SIMULATION FEED <span class="lv-sim">not real players</span></div>` +
    `<div class="lv-feed">` +
    feed.map((f) => `<div class="lv-feed-item lv-${f.tone}">${f.text}</div>`).join('') +
    `</div>`;

  body.innerHTML = board + reg + river;
}

function setVisible(v: boolean): void {
  byId('live')?.classList.toggle('hidden', !v);
}

export function openLive(): void {
  renderLive();
  setVisible(true);
}

export function closeLive(): void {
  setVisible(false);
}

/** Wire the live overlay + event banner. Call once at boot. */
export function initLive(): void {
  byId('btnLive')?.addEventListener('click', openLive);
  byId('btnLiveDone')?.addEventListener('click', closeLive);
  refreshEventBanner();
}
