import { CFG } from '../config/constants';
import { clamp } from '../core/math';
import { timeBall } from '../entities/Ball';
import { ball, match } from '../game/state';
import { pressureOn } from '../game/control';
import { isInside, isPassSafe, passWeight } from './analysis';
import { arrivalTime, oppArrivalAt, spaceAhead, threatAt } from './pitchControl';
import type { Player } from '../entities/Player';
import type { Team } from '../entities/Team';
import { V3 } from '../core/math';

/*
 * Pass selection as a utility decision.
 *
 * Every team-mate offers up to two balls: to feet (led by his stride) and into
 * the space he is running to. Each is scored by what it would be *worth*
 * (expected threat at the target), how firmly we would own the ball there (the
 * receiver's time advantage over the nearest defender, from pitch control), how
 * far it has to travel, and whether it goes backwards. The carrier compares the
 * best of them with the value of keeping the ball himself — the threat where he
 * stands, the room in front of him, the pressure he is under — and only releases
 * it when the pass is clearly the better football.
 */

export interface PassOption {
  receiver: Player;
  x: number;
  z: number;
  /** A ball into space ahead of the runner (weighted to die there) rather than to feet. */
  space: boolean;
  dist: number;
  utility: number;
}

const _a = V3();
const _b = V3();

function score(passer: Player, m: Player, x: number, z: number, dist: number, space: boolean): number {
  const team = passer.team;
  const margin = oppArrivalAt(team, x, z) - arrivalTime(m, x, z);
  const back = Math.max(0, (passer.position.x - x) * team.side);
  // on the same scale as keepValue(): what the ball is worth there, how firmly the
  // receiver owns it, less a flat cost — every pass can be cut out or miscontrolled
  let u = 2.4 * threatAt(team, x, z) + 0.5 * clamp(margin, -0.6, 1) - 0.2;
  u -= 0.012 * dist;
  u -= 0.02 * back;
  if (dist < 5) u -= 0.4; // a five-yard ball changes nothing
  if (m === match.callingPlayer) u += 0.25; // he has shown for it
  if (m.roleType === 'GK') u -= 0.7;
  // a ball into space is the riskier pass: it has to be weighted, read and won
  if (space) u += 0.1 * clamp(margin, 0, 1) - 0.18;
  return u;
}

/**
 * The best pass available to `passer` right now. Returns false when nothing is on.
 * `out` receives the choice (target point, receiver, utility).
 */
export function chooseBestPass(passer: Player, opp: Team, out: PassOption, allowKeeper = false): boolean {
  const team = passer.team;
  let found = false;
  let best = -Infinity;
  for (const m of team.players) {
    if (m === passer || m.sentOff) continue;
    if (m.roleType === 'GK' && !allowKeeper) continue;
    const d0 = Math.hypot(m.position.x - ball.position.x, m.position.z - ball.position.z);
    if (d0 < CFG.minPassDist * 0.8 || d0 > 34) continue;

    // --- to feet, led by his stride ---
    const pw = passWeight(d0, CFG.passLong);
    let t = timeBall(pw, d0);
    if (t < 0) t = d0 / Math.max(6, pw * 0.7);
    const k = Math.min(t, 1.2) * 0.65;
    _a.set(clamp(m.position.x + m.velocity.x * k, -CFG.halfL + 1, CFG.halfL - 1), 0, clamp(m.position.z + m.velocity.z * k, -CFG.halfW + 1, CFG.halfW - 1));
    const dA = Math.hypot(_a.x - ball.position.x, _a.z - ball.position.z);
    if (isPassSafe(ball.position, _a, m, CFG.passLong, opp)) {
      const u = score(passer, m, _a.x, _a.z, dA, false);
      if (u > best) {
        best = u;
        found = true;
        out.receiver = m;
        out.x = _a.x;
        out.z = _a.z;
        out.space = false;
        out.dist = dA;
        out.utility = u;
      }
    }

    // --- into the space he is running to ---
    if (m.roleType !== 'GK' && (m.role === 'SUPPORT' || m.velocity.x * team.side > 2)) {
      _b.copy(m.supportTarget);
      const lead = Math.hypot(_b.x - m.position.x, _b.z - m.position.z);
      if (lead > 3.5 && lead < 16 && isInside(_b)) {
        const dB = Math.hypot(_b.x - ball.position.x, _b.z - ball.position.z);
        const pwB = passWeight(dB, CFG.throughPow, CFG.passArriveThrough);
        const tBall = timeBall(pwB, dB);
        const tRun = arrivalTime(m, _b.x, _b.z);
        const tOpp = oppArrivalAt(team, _b.x, _b.z);
        // the runner must meet it (give or take a stride) and beat the defenders to it
        if (tBall > 0 && tRun < tBall + 0.45 && tRun < tOpp - 0.15 && (!match.simRules || !wouldBeOffside(m, opp)) && isPassSafe(ball.position, _b, m, pwB, opp, true, false)) {
          const u = score(passer, m, _b.x, _b.z, dB, true);
          if (u > best) {
            best = u;
            found = true;
            out.receiver = m;
            out.x = _b.x;
            out.z = _b.z;
            out.space = true;
            out.dist = dB;
            out.utility = u;
          }
        }
      }
    }
  }
  return found;
}

/** Sim rules only: is `m` beyond the second-last defender and ahead of the ball right now? */
function wouldBeOffside(m: Player, opp: Team): boolean {
  const side = m.team.side;
  const px = m.position.x * side;
  if (px <= 0.5 || px <= ball.position.x * side + 0.4) return false;
  let goalSide = 0;
  for (const o of opp.players) if (!o.sentOff && o.position.x * side >= px - 0.1) goalSide++;
  return goalSide < 2;
}

/**
 * What keeping the ball is worth to the carrier: not just where he stands but
 * where he can *take* it — the threat a few strides ahead, discounted by how much
 * of that grass is his — less the pressure he is under.
 */
export function keepValue(p: Player): number {
  const room = spaceAhead(p);
  const side = p.team.side;
  const carry = 7 * clamp((room - 0.35) / 0.4, 0, 1); // metres he can expect to make
  const ax = clamp(p.position.x + side * carry, -CFG.halfL + 1, CFG.halfL - 1);
  const here = threatAt(p.team, p.position.x, p.position.z);
  const there = threatAt(p.team, ax, p.position.z * 0.85);
  // a good dribbler is less bothered by a man on him
  const dribbler = 0.5 * p.ath.control + 0.3 * p.ath.agility + 0.2 * p.ath.pace;
  return 2.4 * Math.max(here, there) + 0.5 * (room - 0.3) - 1.0 * pressureOn(p) * (1.25 - dribbler);
}

export function makePassOption(): PassOption {
  return { receiver: null as unknown as Player, x: 0, z: 0, space: false, dist: 0, utility: 0 };
}
