/*
 * Season Track UI (F1 Free Track + F2 Elite Track) — the menu card + the full
 * season screen (`#season` overlay).
 *
 * The card on the start menu shows the player's tier, progress to the next tier
 * and a "rewards to claim" badge. The screen lists every tier's Free and Elite
 * rewards with their claim state (claimed / claimable / locked) and lets the
 * player claim them — the claim is the dopamine (battle-pass style), so nothing
 * auto-grants. Pure presentation over the player save; `game/season.ts` owns the
 * ladder + claim logic and `game/rewards.ts` advances the track after a match.
 *
 * Honest framing (retention.md §3): every reward is earned in-game, the Elite
 * track is unlocked by completing weekly orders (never paid), and a locked tier
 * states plainly why it's locked. No fake scarcity, no countdowns.
 */
import { getPlayerData, savePlayerData } from '../core/playerData';
import { refreshCollectionBadge } from './collection';
import { refreshProfileCard } from './profile';
import {
  SEASON_TIERS,
  TIERS,
  ensureSeason,
  seasonStanding,
  seasonXpForTier,
  tierState,
  countClaimable,
  claimTier,
  claimAll,
  type Track,
  type TierReward,
  type TierClaimState,
} from '../game/season';

const byId = (id: string): HTMLElement | null => document.getElementById(id);

// ---- menu card --------------------------------------------------------------

/** Re-render the menu season card from the save (heals onto the current season). */
export function refreshSeasonCard(): void {
  const card = byId('seasonCard');
  if (!card) return;
  const data = getPlayerData();
  if (ensureSeason(data.season)) savePlayerData(); // a new season reset the track

  const st = seasonStanding(data.season);
  const claimable = countClaimable(data.season);

  const lbl = byId('seasonTierLbl');
  if (lbl) lbl.textContent = st.atMax ? `Tier ${st.tier} · MAX` : `Tier ${st.tier} / ${SEASON_TIERS}`;

  const fill = byId('seasonFill');
  if (fill) fill.style.width = `${st.atMax ? 100 : Math.round((st.into / (st.forNext || 1)) * 100)}%`;

  const badge = byId('seasonClaimBadge');
  if (badge) {
    badge.textContent = claimable > 0 ? `● ${claimable} TO CLAIM` : data.season.eliteUnlocked ? 'ELITE ✓' : '';
    badge.classList.toggle('hidden', claimable === 0 && !data.season.eliteUnlocked);
    badge.classList.toggle('ready', claimable > 0);
  }
}

// ---- season screen ----------------------------------------------------------

function setSeasonVisible(v: boolean): void {
  byId('season')?.classList.toggle('hidden', !v);
}

/** Rarity → CSS modifier (matches the .rar-* tints in style.css). */
function rarClass(r?: TierReward): string {
  return r?.rarity ? ` rar-${r.rarity}` : '';
}

/** One reward cell (free or elite column) with its claim state. */
function rewardCell(tier: number, track: Track, reward: TierReward | undefined, state: TierClaimState): string {
  if (!reward) return `<div class="se-cell se-empty"></div>`;
  const tick = state === 'claimed' ? '✓' : state === 'claimable' ? '＋' : '🔒';
  const clickable = state === 'claimable' ? ' se-can' : '';
  const attrs = state === 'claimable' ? ` data-tier="${tier}" data-track="${track}" role="button" tabindex="0"` : '';
  const hint = state === 'locked-elite' ? '<span class="se-hint">Elite</span>' : '';
  return (
    `<div class="se-cell se-${state}${clickable}${rarClass(reward)}"${attrs}>` +
    `<span class="se-tick">${tick}</span>` +
    `<span class="se-rwd">${reward.label}</span>${hint}</div>`
  );
}

/** Render the scrollable tier list into the screen body. */
function renderSeasonBody(): void {
  const body = byId('seasonBody');
  if (!body) return;
  const data = getPlayerData();
  const st = seasonStanding(data.season);

  const head =
    `<div class="se-standing">` +
    `<div class="se-stand-l">TIER <b>${st.tier}</b> / ${SEASON_TIERS}</div>` +
    `<div class="se-stand-x">${st.atMax ? 'Track complete' : `${Math.round(st.into)} / ${seasonXpForTier(st.tier)} Season XP`}</div>` +
    `</div>` +
    `<div class="se-track"><div class="se-track-fill" style="width:${st.atMax ? 100 : Math.round((st.into / (st.forNext || 1)) * 100)}%"></div></div>` +
    `<div class="se-elite-status ${data.season.eliteUnlocked ? 'on' : ''}">` +
    (data.season.eliteUnlocked
      ? 'ELITE TRACK UNLOCKED ✓ — earned rewards are yours to claim'
      : 'ELITE TRACK LOCKED — complete all your weekly orders to unlock (no payment)') +
    `</div>` +
    `<div class="se-colhead"><span></span><span>FREE</span><span>ELITE</span></div>`;

  const rows = TIERS.map((t) => {
    const reached = t.tier <= st.tier;
    const free = rewardCell(t.tier, 'free', t.free, tierState(data.season, t.tier, 'free'));
    const elite = rewardCell(t.tier, 'elite', t.elite, tierState(data.season, t.tier, 'elite'));
    return `<div class="se-row${reached ? ' reached' : ''}"><span class="se-tier">${t.tier}</span>${free}${elite}</div>`;
  }).join('');

  body.innerHTML = head + `<div class="se-rows">${rows}</div>`;

  const claimAllBtn = byId('btnSeasonClaimAll') as HTMLButtonElement | null;
  if (claimAllBtn) {
    const n = countClaimable(data.season);
    claimAllBtn.textContent = n > 0 ? `CLAIM ALL (${n}) ▸` : 'NOTHING TO CLAIM';
    claimAllBtn.disabled = n === 0;
  }
}

/** Open the season screen. */
export function openSeason(): void {
  renderSeasonBody();
  setSeasonVisible(true);
}

/** Close the season screen (and refresh the menu card behind it). */
export function closeSeason(): void {
  setSeasonVisible(false);
  refreshSeasonCard();
  refreshProfileCard(); // claimed coins/gems/cosmetics
}

/** Claim a single tier reward (from a body click), then re-render. */
function claimOne(tier: number, track: Track): void {
  const data = getPlayerData();
  if (claimTier(data, tier, track)) {
    savePlayerData();
    renderSeasonBody();
    refreshCollectionBadge(); // a cosmetic/title reward may have entered the album
  }
}

/** Wire the season card + screen controls. Call once at boot. */
export function initSeasonCard(): void {
  byId('btnSeasonView')?.addEventListener('click', openSeason);
  byId('btnSeasonDone')?.addEventListener('click', closeSeason);

  byId('btnSeasonClaimAll')?.addEventListener('click', () => {
    const data = getPlayerData();
    const res = claimAll(data);
    if (res.rewards.length) {
      savePlayerData();
      renderSeasonBody();
      refreshCollectionBadge();
    }
  });

  // delegated claim of a single tier reward (only claimable cells carry the data)
  const body = byId('seasonBody');
  const claimFromTarget = (target: EventTarget | null): void => {
    const cell = (target as HTMLElement | null)?.closest<HTMLElement>('.se-can');
    const tier = Number(cell?.dataset.tier);
    const track = cell?.dataset.track as Track | undefined;
    if (cell && track && Number.isFinite(tier)) claimOne(tier, track);
  };
  body?.addEventListener('click', (e) => claimFromTarget(e.target));
  body?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      claimFromTarget(e.target);
    }
  });

  refreshSeasonCard();
}
