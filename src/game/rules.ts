import { CFG } from '../config/constants';
import { V3 } from '../core/math';
import { Audio } from '../core/audio';
import { Haptics } from '../core/haptics';
import { ball, match, oppOf } from './state';
import { setPiece } from './physics';
import { addStoppage } from './flow';
import { flashToast } from '../ui/hud';
import type { Player } from '../entities/Player';

/*
 * Opt-in "Sim" rules — offside and yellow/red cards. They are off by default
 * (pure Arcade) so authenticity never frustrates a casual game, and on only when
 * `match.simRules` is set from the menu. Kept here so the arcade core stays clean.
 */

/** The receiver flagged as being in an offside position at the moment of a pass. */
let pendingOffside: Player | null = null;

/**
 * Is `p` in an offside position right now: in the opponent half, ahead of the
 * ball, with fewer than two opponents (keeper + a defender) goal-side of them.
 */
export function isOffside(p: Player): boolean {
  const side = p.team.side;
  const px = p.position.x * side;
  if (px <= 0.5) return false; // in (or behind) the halfway line — never offside
  if (px <= ball.position.x * side + 0.4) return false; // not ahead of the ball
  let goalSide = 0;
  for (const o of oppOf(p.team).players) {
    if (o.sentOff) continue;
    if (o.position.x * side >= px - 0.1) goalSide++;
  }
  return goalSide < 2;
}

/** Note the intended receiver of a pass; flag it if they are caught offside. */
export function flagOffside(receiver: Player | null): void {
  if (!match.simRules) {
    pendingOffside = null;
    return;
  }
  if (!receiver) return; // a null assignment doesn't clear an existing flag
  pendingOffside = isOffside(receiver) ? receiver : null;
}

export function clearPendingOffside(): void {
  pendingOffside = null;
}

/**
 * Called when `p` gains control. If they were the flagged offside receiver, blow
 * up for offside and award a free kick the other way; returns true if so (the
 * caller's possession is overridden). Any other player gaining the ball simply
 * clears the flag (no offside).
 */
export function resolveOffside(p: Player): boolean {
  if (!match.simRules) return false;
  if (pendingOffside !== p) {
    pendingOffside = null;
    return false;
  }
  pendingOffside = null;
  Audio.whistle();
  Haptics.whistle();
  addStoppage(CFG.stoppagePerFoul);
  setPiece(V3(p.position.x, 0, p.position.z), oppOf(p.team), 'OFFSIDE', false);
  flashToast(p.team.isUser ? 'OFFSIDE!' : 'FLAG UP — OFFSIDE');
  return true;
}

/**
 * Disciplinary check after a foul (Sim rules only). A reckless challenge (a slide)
 * is more likely to be carded; a second yellow — or a rare straight red — sends
 * the offender off, leaving their team a player down for the rest of the match.
 */
export function foulCard(fouler: Player, reckless: boolean): void {
  if (!match.simRules || fouler.sentOff) return;
  if (reckless && Math.random() < 0.06) {
    sendOff(fouler, true);
    return;
  }
  const yellowChance = reckless ? 0.42 : 0.18;
  if (Math.random() < yellowChance) {
    fouler.yellows++;
    if (fouler.yellows >= 2) {
      sendOff(fouler, false);
    } else {
      Audio.whistle();
      flashToast(`${fouler.name} BOOKED 🟨`);
    }
  }
}

/** Send a player off: park them off the pitch and take them out of the game. */
function sendOff(p: Player, straightRed: boolean): void {
  p.sentOff = true;
  p.yellows = 2;
  p.velocity.set(0, 0, 0);
  p.slide = 0;
  p.dive = 0;
  p.mesh.visible = false;
  // park well off the field of play so nothing can pick them as a target
  p.position.set(0, 0, p.team.side * (CFG.halfW + 12));
  Audio.whistle();
  Haptics.whistle();
  flashToast(`${straightRed ? '🟥 RED CARD' : '🟨🟥 SECOND YELLOW'} — ${p.name} OFF`);
}
