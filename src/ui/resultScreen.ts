/*
 * The Result Screen (D) — the retention engine's most important surface.
 *
 * Rebuilds the full-time `#ft` overlay into an animated, sequenced reveal:
 * an emotional headline + star rating (D1), a per-team stat grid (D1), an
 * animated progress stack — account XP, daily chest, daily orders (D2) — a
 * staggered reward-chip reveal + "next best action" copy (D3), and a clear
 * button hierarchy with a always-available exit (D4).
 *
 * Pure presentation: `game/modes.ts` (the result-screen owner, stubbed out of
 * the headless balance harness) builds a {@link ResultScreenData} from the
 * reward pipeline and the live match stats and hands it here. Honest framing —
 * every number shown is real and earned (retention §4). Respects the player's
 * reduced-motion / reduced-effects setting: animations collapse to final state.
 */
import { setFullTimeVisible } from './hud';
import { getPlayerData } from '../core/playerData';

/** One per-team stat row in the result grid (e.g. Possession 56% / 44%). */
export interface ResultStat {
  label: string;
  home: string;
  away: string;
}

/** A reward pill revealed in sequence (XP, coins, a bonus). */
export interface ResultChip {
  text: string;
  tone?: 'xp' | 'coin' | 'bonus';
}

/** An animated bar in the progress stack (account XP, chest, a daily order). */
export interface ResultBar {
  label: string;
  /** Start fill 0–1 (where the bar animates from). */
  from: number;
  /** End fill 0–1 (where the bar animates to). */
  to: number;
  /** Caption on the right (e.g. "1240 / 2200 XP"). */
  text: string;
  /** Optional emphasis tag (e.g. "LEVEL UP → Pro", "CHEST!"). */
  badge?: string;
  tone: 'xp' | 'chest' | 'order' | 'season' | 'ach';
  /** Completed this match (tints the bar). */
  done?: boolean;
}

/** Everything the result screen renders for one finished match. */
export interface ResultScreenData {
  kicker: string;
  headline: string;
  tone: 'win' | 'loss' | 'draw' | 'champion';
  homeScore: number;
  awayScore: number;
  /** "On penalties 4–3" line (or undefined). */
  penLine?: string;
  /** 1–3 performance stars. */
  stars: number;
  motm: string;
  stats: ResultStat[];
  chips: ResultChip[];
  bars: ResultBar[];
  nextBest: string;
  primaryLabel: string;
  /** Secondary (menu/exit) — hidden when empty. */
  secondaryLabel: string;
}

const byId = (id: string): HTMLElement | null => document.getElementById(id);
const setText = (id: string, text: string): void => {
  const n = byId(id);
  if (n) n.textContent = text;
};
const pct = (v: number): number => Math.max(0, Math.min(100, v * 100));

/** A monotonically rising token so a fresh reveal cancels any in-flight one. */
let reveal = 0;

/** True if the player asked for reduced motion / effects (§3 accessibility). */
function reducedMotion(): boolean {
  const s = getPlayerData().settings;
  return s.reducedMotion || s.effects === 'reduced';
}

/** Wire the result-screen buttons once at boot. */
export function initResultScreen(cb: { onPrimary: () => void; onSecondary: () => void }): void {
  byId('btnAgain')?.addEventListener('click', cb.onPrimary);
  byId('btnFtMenu')?.addEventListener('click', cb.onSecondary);
}

function renderStars(stars: number): HTMLElement[] {
  const wrap = byId('ftStars');
  if (!wrap) return [];
  wrap.innerHTML = '';
  const els: HTMLElement[] = [];
  for (let i = 0; i < 3; i++) {
    const s = document.createElement('span');
    s.className = 'ft-star';
    s.textContent = '★';
    s.dataset.on = i < stars ? '1' : '0';
    wrap.appendChild(s);
    els.push(s);
  }
  return els;
}

function renderStats(stats: ResultStat[]): void {
  const grid = byId('ftStatGrid');
  if (!grid) return;
  grid.innerHTML = stats
    .map(
      (s) =>
        `<div class="ft-statrow"><span class="ft-sh">${s.home}</span>` +
        `<span class="ft-sl">${s.label}</span><span class="ft-sa">${s.away}</span></div>`,
    )
    .join('');
}

function renderChips(chips: ResultChip[]): HTMLElement[] {
  const wrap = byId('ftChips');
  if (!wrap) return [];
  wrap.innerHTML = '';
  return chips.map((c) => {
    const el = document.createElement('span');
    el.className = `ft-chip${c.tone ? ' ' + c.tone : ''}`;
    el.textContent = c.text;
    wrap.appendChild(el);
    return el;
  });
}

function renderBars(bars: ResultBar[], noAnim: boolean): HTMLElement[] {
  const stack = byId('ftStack');
  if (!stack) return [];
  stack.innerHTML = bars
    .map((b) => {
      const w = noAnim ? pct(b.to) : pct(b.from);
      const badge = b.badge ? ` · <b>${b.badge}</b>` : '';
      return (
        `<div class="ft-bar ft-bar-${b.tone}${b.done ? ' done' : ''}">` +
        `<div class="ft-bar-top"><span class="ft-bar-l">${b.label}</span>` +
        `<span class="ft-bar-x">${b.text}${badge}</span></div>` +
        `<div class="ft-bar-track"><div class="ft-bar-fill" style="width:${w}%"></div></div></div>`
      );
    })
    .join('');
  return Array.from(stack.querySelectorAll<HTMLElement>('.ft-bar-fill'));
}

/** Populate, then play (or, if reduced, snap to) the sequenced reveal. */
export function showResultScreen(d: ResultScreenData): void {
  const myReveal = ++reveal;
  const noAnim = reducedMotion();

  const card = byId('ft')?.querySelector('.card') as HTMLElement | null;
  card?.classList.toggle('no-anim', noAnim);

  setText('ftKicker', d.kicker);
  setText('ftResult', d.headline);
  byId('ftResult')?.setAttribute('data-tone', d.tone);
  setText('ftH', String(d.homeScore));
  setText('ftA', String(d.awayScore));
  setText('ftMotm', d.motm);

  const pen = byId('ftPen');
  if (pen) {
    pen.textContent = d.penLine ?? '';
    pen.classList.toggle('hidden', !d.penLine);
  }
  const next = byId('ftNext');
  if (next) {
    next.textContent = d.nextBest;
    next.classList.toggle('hidden', !d.nextBest);
  }

  const primary = byId('btnAgain');
  if (primary) primary.textContent = d.primaryLabel;
  const secondary = byId('btnFtMenu');
  if (secondary) {
    secondary.textContent = d.secondaryLabel;
    secondary.classList.toggle('hidden', !d.secondaryLabel);
  }

  const stars = renderStars(d.stars);
  renderStats(d.stats);
  const chips = renderChips(d.chips);
  const fills = renderBars(d.bars, noAnim);

  setFullTimeVisible(true);

  if (noAnim) {
    for (let i = 0; i < d.stars && i < stars.length; i++) stars[i].classList.add('on');
    chips.forEach((c) => c.classList.add('in'));
    return; // bars already at final width; nothing to animate
  }

  // Reveal order (retention §25.3): stars → chips → bars → next-best is already shown.
  stars.forEach((el, i) => {
    if (el.dataset.on !== '1') return;
    window.setTimeout(() => {
      if (reveal !== myReveal) return;
      el.classList.add('on', 'pop');
      window.setTimeout(() => el.classList.remove('pop'), 240);
    }, 280 + i * 200);
  });

  chips.forEach((el, i) => {
    window.setTimeout(() => {
      if (reveal !== myReveal) return;
      el.classList.add('in');
    }, 120 * i);
  });

  // Let the bars paint at their `from` width, then transition to `to`, staggered.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (reveal !== myReveal) return;
      fills.forEach((el, i) => {
        el.style.transitionDelay = `${0.12 * i}s`;
        el.style.width = `${pct(d.bars[i]?.to ?? 0)}%`;
      });
    }),
  );
}
