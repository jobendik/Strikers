/*
 * On-screen commentary (H1) — broadcast-style shouts on key match events.
 *
 * A lower-third caption layer (`#commentary`) that calls out the big moments:
 * goals (with lead/equaliser/comeback/last-gasp framing), shootout drama and
 * wonder saves. It complements — never duplicates — the small top toast (which
 * names the scorer); together they read like a TV feed (player + context).
 *
 * Pure presentation. It is reached only through already-stubbed modules
 * (`ui/hud`, `game/penalty`), so it never enters the headless sim bundle and
 * never touches the gameplay path. Honest framing — these are the user's own
 * real match events (retention §H). Respects the reduced-motion setting.
 */
import { getPlayerData } from '../core/playerData';

/** Tone drives the caption's accent glow + sizing. */
export type CommentaryTone = 'goal' | 'save' | 'drama' | 'info';

/** Context for a goal call (from the scoring team's perspective, post-goal). */
export interface GoalCtx {
  /** Scoring team's new total. */
  forGoals: number;
  /** Conceding team's total. */
  againstGoals: number;
  /** The user's team scored. */
  isUser: boolean;
  /** Scored in second-half added time to go in front (a winner at the death). */
  lastGasp: boolean;
}

const byId = (id: string): HTMLElement | null => document.getElementById(id);

/** Reduced motion / effects → skip the slide, just show/hide. */
function reduced(): boolean {
  const s = getPlayerData().settings;
  return s.reducedMotion || s.effects === 'reduced';
}

let hideTimer = 0;
/** Token so a fresh shout cancels a previously scheduled hide. */
let token = 0;

const pick = (arr: string[]): string => arr[Math.floor(Math.random() * arr.length)] ?? arr[0];

/** Build the contextual goal shout (pure — no scorer name; the toast names them). */
export function goalCall(c: GoalCtx): string {
  if (c.lastGasp) return pick(['LAST-GASP WINNER!', 'DRAMA AT THE DEATH!', 'WITH THE LAST KICK!']);
  if (c.forGoals === c.againstGoals) return pick(['EQUALISER!', 'LEVEL AGAIN!', "GAME ON — IT'S ALL SQUARE!"]);
  const margin = c.forGoals - c.againstGoals;
  if (margin >= 3) return pick(['RUNAWAY WIN ON THE CARDS!', 'THEY ARE RAMPANT!', 'A ROUT IS ON!']);
  if (margin === 1) {
    // a go-ahead goal: a comeback if they had been behind (conceded at least 1)
    if (c.againstGoals >= 1) return pick(['TURNAROUND COMPLETE!', 'IN FRONT FOR THE FIRST TIME!', 'WHAT A RESPONSE!']);
    return pick(['THEY LEAD!', 'IN FRONT!', 'THE BREAKTHROUGH!']);
  }
  return pick(['GOAL!', 'IT IS THERE!', 'WHAT A STRIKE!']);
}

/** Show a commentary caption for ~2.6s (queue-free — latest wins). */
export function commentate(line: string, tone: CommentaryTone = 'info'): void {
  const root = byId('commentary');
  const span = root?.querySelector('.cm') as HTMLElement | null;
  if (!root || !span || !line) return;

  span.textContent = line;
  root.className = `tone-${tone}`;
  root.style.transition = reduced() ? 'none' : '';

  // restart the slide-in animation
  root.classList.remove('show');
  void root.offsetWidth; // reflow
  root.classList.add('show');

  const mine = ++token;
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (token === mine) root.classList.remove('show');
  }, 2600);
}

/** Clear any caption (call at match start / when leaving). */
export function resetCommentary(): void {
  token++;
  window.clearTimeout(hideTimer);
  const root = byId('commentary');
  root?.classList.remove('show');
}

/** Convenience: a goal shout from context (used by the HUD wrapper). */
export function goalCommentary(c: GoalCtx): void {
  commentate(goalCall(c), c.lastGasp ? 'drama' : 'goal');
}
