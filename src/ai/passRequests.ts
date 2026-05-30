import type { Vector3 } from 'yuka';
import { CFG } from '../config/constants';
import { attr01 } from '../config/players';
import { V3, clamp, distSq } from '../core/math';
import { ball, match, oppOf, setPassRequest } from '../game/state';
import { getBestPassToReceiver, goalX, isInside, isPassSafe } from './analysis';
import type { Player } from '../entities/Player';
import type { Team } from '../entities/Team';

interface RequestCandidate {
  runner: Player;
  target: Vector3;
  score: number;
}

const _lead = V3();
const _bestPass = V3();

/** Distance from a proposed target to the nearest defender. */
function nearestDefenderDistSq(team: Team, target: Vector3): number {
  let best = Infinity;
  for (const o of oppOf(team).players) {
    if (o.sentOff) continue;
    const d = distSq(o.position, target);
    if (d < best) best = d;
  }
  return best;
}

/** A runner's preferred lane: mostly forward, curling inside if already wide. */
function runTarget(carrier: Player, runner: Player, out: Vector3): void {
  const side = carrier.team.side;
  const ahead = runner.roleType === 'ATT' ? 6.4 : 4.2;
  const pullInside = Math.abs(runner.position.z) > 10 ? -Math.sign(runner.position.z) * 2.3 : 0;
  out.set(
    clamp(runner.position.x + side * ahead, -CFG.halfL + 3, CFG.halfL - 3),
    0,
    clamp(runner.position.z + pullInside, -CFG.halfW + 3, CFG.halfW - 3),
  );
}

/**
 * Score an off-ball teammate asking for the pass. This borrows Simple Soccer's
 * `RequestPass` idea without adding a full message bus: the player only calls
 * when the lane is safe, the target is useful, and the run will be visible.
 */
function evaluateRunner(carrier: Player, runner: Player): RequestCandidate | null {
  const team = carrier.team;
  const opp = oppOf(team);
  const power = CFG.passLong * (0.82 + attr01(carrier.attr.passing) * 0.22);
  const toRunner = runner.position.distanceTo(carrier.position);
  if (toRunner < CFG.minPassDist * 0.75 || toRunner > 26) return null;

  runTarget(carrier, runner, _lead);
  let target = _lead;
  let laneBonus = 1.2;
  if (!isInside(target) || !isPassSafe(ball.position, target, runner, power, opp, true)) {
    if (!getBestPassToReceiver(carrier, runner, power, opp, _bestPass)) return null;
    target = _bestPass;
    laneBonus = 0.4;
  }

  const ahead = (target.x - carrier.position.x) * team.side;
  if (ahead < -1.0) return null;
  const goalDist = Math.hypot(goalX(team) - target.x, target.z);
  const defenderSpace = Math.sqrt(nearestDefenderDistSq(team, target));
  const inputThreat = match.controlPlayer === carrier && match.controlTeam === team ? 1 : 0;
  const roleBonus = runner.roleType === 'ATT' ? 1.4 : 0;
  const paceBonus = attr01(runner.attr.pace) * 1.4;
  const passSkill = attr01(carrier.attr.passing) * 1.2;
  const angleToCarrier = Math.abs(target.z - carrier.position.z);

  const score =
    laneBonus +
    roleBonus +
    paceBonus +
    passSkill +
    clamp(ahead / 6, -0.8, 2.2) +
    clamp((24 - goalDist) / 7, -0.4, 2.2) +
    clamp(defenderSpace / 4, 0, 1.8) +
    clamp(angleToCarrier / 12, 0, 0.8) +
    inputThreat;

  return { runner, target: target.clone(), score };
}

/** Pick and advertise the best current pass request for the carrier's team. */
export function updatePassRequest(carrier: Player): void {
  if (carrier.roleType === 'GK' || !match.controlTeam || match.controlTeam !== carrier.team) {
    setPassRequest(null);
    return;
  }

  let best: RequestCandidate | null = null;
  for (const runner of carrier.team.outfield()) {
    if (runner === carrier || runner.sentOff) continue;
    const candidate = evaluateRunner(carrier, runner);
    if (!candidate) continue;
    if (!best || candidate.score > best.score) best = candidate;
  }

  if (best && best.score >= CFG.passRequestMinScore) {
    setPassRequest(best.runner, best.target);
  } else {
    setPassRequest(null);
  }
}

