/*
 * Profile card (C4) — the player's identity + progression at a glance on the menu.
 *
 * Renders from the live player save (`core/playerData`) + the progression curve
 * (`core/progression`): a kit-coloured flag avatar, an editable name, the tier
 * badge + account level, an XP bar toward the next level, and three career stat
 * tiles (Titles · Win % · Goals). Pure presentation — it reads the save and the
 * chosen nation, and the one thing it writes is the player's chosen name. Honest
 * numbers only (retention §4); nothing here implies an economy.
 */
import { teamMeta } from '../config/players';
import { getPlayerData, savePlayerData } from '../core/playerData';
import { xpToNext } from '../core/progression';

const byId = (id: string): HTMLElement | null => document.getElementById(id);

/** Max characters for the player name (mirrors the save's migrate clamp). */
const NAME_MAX = 16;

/** Re-render the profile card from the save + chosen nation. */
export function refreshProfileCard(): void {
  const card = byId('profileCard');
  if (!card) return;
  const d = getPlayerData();
  const meta = teamMeta(d.flag);

  const avatar = byId('profAvatar');
  if (avatar) {
    avatar.textContent = meta.short;
    avatar.style.borderColor = meta.color;
    avatar.style.color = meta.color;
    avatar.style.background = `${meta.color}22`; // faint kit-tinted fill
  }

  const name = byId('profName') as HTMLInputElement | null;
  // don't clobber what the player is mid-typing
  if (name && document.activeElement !== name) name.value = d.name;

  const badge = byId('profBadge');
  if (badge) badge.textContent = d.title;
  const level = byId('profLevel');
  if (level) level.textContent = `LV ${d.level}`;

  const need = xpToNext(d.level);
  const pct = need > 0 ? Math.max(0, Math.min(100, (d.xp / need) * 100)) : 0;
  const fill = byId('profXpFill');
  if (fill) fill.style.width = `${pct}%`;
  const xpLbl = byId('profXpLbl');
  if (xpLbl) xpLbl.textContent = `${d.xp} / ${need} XP`;

  const s = d.stats;
  const winPct = s.played > 0 ? Math.round((s.wins / s.played) * 100) : 0;
  setTile('profTitles', String(s.cupsWon));
  setTile('profWinPct', `${winPct}%`);
  setTile('profGoals', String(s.goals));
}

function setTile(valId: string, value: string): void {
  const v = byId(valId);
  if (v) v.textContent = value;
}

/** Wire the editable name field. Call once at boot. */
export function initProfileCard(): void {
  const name = byId('profName') as HTMLInputElement | null;
  if (name) {
    name.maxLength = NAME_MAX;
    const commit = (): void => {
      const cleaned = name.value.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
      const d = getPlayerData();
      d.name = cleaned || 'PLAYER';
      savePlayerData();
    };
    name.addEventListener('input', commit);
    name.addEventListener('blur', () => {
      commit();
      refreshProfileCard(); // normalise an empty/whitespace name back to a value
    });
    // Enter confirms (drops focus) rather than submitting anything
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') name.blur();
    });
  }
  refreshProfileCard();
}
