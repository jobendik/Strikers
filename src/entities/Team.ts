import { Vector3 } from 'yuka';
import { SimRegulator, sim } from '../core/time';
import { CFG, DIFF, FORMATION, MENTALITY } from '../config/constants';
import { teamMeta } from '../config/players';
import { V3, clamp, distSq } from '../core/math';
import { ball, match, oppOf } from '../game/state';
import { updatePerception } from '../ai/perception';
import { isPassSafe, ownGoalX } from '../ai/analysis';
import { PC_NX, PC_NZ, arrivalTime, cellX, cellZ, oppArrivalAt, threatAt } from '../ai/pitchControl';
import { updatePassRequest } from '../ai/passRequests';
import { Player } from './Player';
import type { PlayerRole, TeamTactic } from '../config/types';

// scratch vector for the support-spot shoot test
const _scratch = V3();

/** A team of five: GK + 2 DEF + 2 ATT. Owns role assignment and tactics. */
export class Team {
  side: number;
  /** Roster key (indexes into SQUADS). */
  name: string;
  /** Kit colour, 3-letter tag and full display name (from the team registry). */
  color: string;
  short: string;
  fullName: string;
  isUser: boolean;
  inAttack = false;
  /** 0 Defensive · 1 Balanced · 2 Attacking — biases the resting shape's depth. */
  mentality = 1;
  players: Player[];
  gk: Player;
  bestSpot: Vector3 | null = null;
  spots: Vector3[] = [];

  /** What the team is collectively doing right now (see updateTactic). */
  tactic: TeamTactic = 'midBlock';
  /** Sim time possession was last won / lost (drives transitions). */
  wonT = -99;
  lostT = -99;
  private hadBall = false;
  /**
   * Out of possession: how far up the pitch (in our attacking direction, from the
   * halfway line) the first defender engages the ball. Beyond it he only contains.
   */
  engageLine = 6;
  /** Is the nearest defender allowed to go and win it (press), or just hold the carrier up (contain)? */
  engage = true;

  /** Throttles the (relatively expensive) support-spot solver to ~4 Hz. */
  private supportRegulator = new SimRegulator(4);
  /** Throttles Buckland-style pass-request scans to keep mobile AI cheap. */
  private passRequestRegulator = new SimRegulator(3.5, 0.5);

  constructor(side: number, key: string, isUser: boolean) {
    this.side = side;
    this.isUser = isUser;
    const m = teamMeta(key);
    this.name = key;
    this.color = m.color;
    this.short = m.short;
    this.fullName = m.name;
    this.players = FORMATION.map((e, i) => new Player(this, i, e));
    this.gk = this.players[0];

    const xs = side > 0 ? [6, 11, 16, 21, 26] : [-6, -11, -16, -21, -26];
    for (const x of xs) for (const z of [-13, -6.5, 0, 6.5, 13]) this.spots.push(V3(x, 0, z));
  }

  /** Re-skin this team to a new roster/kit (team selection & cup fixtures). */
  setIdentity(key: string): void {
    const m = teamMeta(key);
    this.name = key;
    this.color = m.color;
    this.short = m.short;
    this.fullName = m.name;
    for (const p of this.players) p.applyIdentity();
  }

  /** Force a specific outfield kit colour — used to resolve a clash with the opponent's strip. */
  setKitColor(color: string): void {
    this.color = color;
    for (const p of this.players) p.applyIdentity();
  }

  outfield(): Player[] {
    return this.players.filter((p) => p.roleType !== 'GK' && !p.sentOff);
  }

  /** Resting-shape depth bias (world units) from the current mentality. */
  mentalityPush(): number {
    return MENTALITY[this.mentality]?.push ?? 0;
  }

  /**
   * Off-ball support from pitch control. Each supporter (most advanced first) is
   * sent to the patch of grass that is worth most to us *and* that he gets to
   * before any defender: expected threat there, his time advantage over the
   * nearest opponent, an open passing lane from the ball, a sensible distance
   * from the carrier, and room away from the team-mate already making a run.
   * Defenders by trade offer the safer option behind or level with the ball.
   */
  assignSupport(carrier: Player, others: Player[]): void {
    if (!this.supportRegulator.ready()) return;
    const opp = oppOf(this);
    const side = this.side;
    const taken: Vector3[] = [];
    const countering = this.tactic === 'counter';
    for (const r of others) {
      const cautious = r.roleType === 'DEF';
      let best = -Infinity;
      let bx = r.supportTarget.x;
      let bz = r.supportTarget.z;
      for (let iz = 1; iz < PC_NZ - 1; iz++) {
        const z = cellZ(iz);
        for (let ix = 1; ix < PC_NX - 1; ix++) {
          const x = cellX(ix);
          const ahead = (x - carrier.position.x) * side;
          if (ahead < (cautious ? -12 : -5) || ahead > (cautious ? 9 : 24)) continue;
          const dC = Math.hypot(x - carrier.position.x, z - carrier.position.z);
          if (dC < 6 || dC > 26) continue;
          const tRun = arrivalTime(r, x, z);
          if (tRun > 3.2) continue;
          const margin = oppArrivalAt(this, x, z) - tRun;
          // on the counter the runs are about getting in behind, quickly
          let sc = (cautious ? 1.1 : 2.4) * (countering ? 1.5 : 1) * threatAt(this, x, z) + 1.3 * clamp(margin, -0.8, 1.2);
          sc -= 0.03 * Math.abs(dC - 13); // a comfortable passing distance
          sc -= 0.12 * tRun; // don't promise a run he can't make soon
          for (const t of taken) if (Math.hypot(t.x - x, t.z - z) < 8) sc -= 1.6; // don't run into the same space
          if (Math.hypot(r.supportTarget.x - x, r.supportTarget.z - z) < 3) sc += 0.35; // hysteresis
          if (sc < best - 1.6) continue; // can't win even with an open lane — skip the lane test
          _scratch.set(x, 0, z);
          if (isPassSafe(ball.position, _scratch, r, CFG.passLong, opp, true)) sc += 1.5;
          if (match.simRules && ahead > 0) {
            // stay onside: not beyond the second-last defender while ahead of the ball
            let goalSide = 0;
            for (const o of opp.players) if (!o.sentOff && o.position.x * side >= x * side - 0.3) goalSide++;
            if (goalSide < 2 && x * side > ball.position.x * side) sc -= 3;
          }
          if (sc > best) {
            best = sc;
            bx = x;
            bz = z;
          }
        }
      }
      r.supportTarget.set(bx, 0, bz);
      taken.push(r.supportTarget);
    }
  }

  /**
   * Team tactical state. Possession, where the ball is, how long since the ball
   * changed hands, the scoreline-driven mentality and (for the AI) the pressing
   * quality of the difficulty level decide what the whole side is doing:
   *
   *   in possession    buildUp · attack · counter (just won it with the opposition out of shape)
   *   out of possession counterPress (just lost it — hunt for a few seconds) · pressHigh ·
   *                     midBlock · lowBlock
   */
  updateTactic(): void {
    const opp = oppOf(this);
    const side = this.side;
    const bx = ball.position.x * side; // + = toward the goal we attack
    const has = match.controlTeam === this || (match.controlTeam === null && match.lastPossession === this);
    if (has && !this.hadBall) this.wonT = sim.elapsed;
    if (!has && this.hadBall) this.lostT = sim.elapsed;
    this.hadBall = has;
    const press = this.isUser ? 0.7 : DIFF[CFG.diff].press;

    if (has) {
      // counter: we have just won it and few of their outfielders are goal-side of the ball
      let behindBall = 0;
      for (const o of opp.outfield()) if (o.position.x * side > bx + 1) behindBall++;
      const fresh = sim.elapsed - this.wonT < 5;
      if (fresh && behindBall <= 2 && bx > -18 && this.mentality > 0) this.tactic = 'counter';
      else if (this.tactic === 'counter' && behindBall <= 2 && sim.elapsed - this.wonT < 8) this.tactic = 'counter';
      else this.tactic = bx < -6 ? 'buildUp' : 'attack';
      this.engage = true;
      return;
    }

    // out of possession
    const justLost = sim.elapsed - this.lostT < 1.6 + 1.4 * press;
    const high = this.mentality === 2 || press > 0.85;
    if (justLost && press > 0.45 && bx > -14 && this.mentality > 0) this.tactic = 'counterPress';
    else if (high && bx > -6) this.tactic = 'pressHigh';
    else if (bx < -11 || this.mentality === 0) this.tactic = 'lowBlock';
    else this.tactic = 'midBlock';

    // where the first defender goes to win it rather than just contain
    this.engageLine =
      this.tactic === 'counterPress' || this.tactic === 'pressHigh' ? 40 : this.tactic === 'midBlock' ? 4 + 8 * press : -4 + 6 * press;
    // hysteresis so the presser doesn't dither on the line
    const lim = this.engageLine + (this.engage ? 2.5 : 0);
    this.engage = bx < lim || ball.position.y > 1.2 || match.controlPlayer === null;
  }

  /** Assign markers (defending POSITION players) to the most dangerous attackers. */
  assignMarks(): void {
    const opp = oppOf(this);
    const markers = this.outfield().filter((p) => p.role === 'POSITION');
    for (const p of this.players) {
      p.marking = false;
      p.cover = false;
    }
    const ownGoal = V3(ownGoalX(this), 0, 0);
    // Danger: the ball is within shooting range of our goal. The best-placed
    // spare defender leaves his man and gets on the line between ball and goal
    // (second defender: cover + block), instead of ball-watching beside a runner.
    const dGoal = Math.hypot(ball.position.x - ownGoal.x, ball.position.z);
    if (dGoal < 19 && match.controlTeam === opp && markers.length) {
      const gx = ownGoal.x - ball.position.x;
      const gz = -ball.position.z;
      const gl = Math.hypot(gx, gz) || 1;
      const stand = Math.min(3.2, gl * 0.45);
      const cx = ball.position.x + (gx / gl) * stand;
      const cz = ball.position.z + (gz / gl) * stand;
      let best: Player | null = null;
      let bd = Infinity;
      for (const m of markers) {
        const d = Math.hypot(m.position.x - cx, m.position.z - cz);
        if (d < bd) {
          bd = d;
          best = m;
        }
      }
      if (best) {
        best.cover = true;
        best.marking = true;
        best.markTarget = V3(cx, 0, cz);
        markers.splice(markers.indexOf(best), 1);
      }
    }
    const targets = opp
      .outfield()
      .filter((o) => o.position.x * this.side < 8)
      .sort((a, b) => distSq(a.position, ownGoal) - distSq(b.position, ownGoal));
    const used = new Set<Player>();
    for (const m of markers) {
      let best: Player | null = null;
      let bd = Infinity;
      for (const o of targets) {
        if (used.has(o)) continue;
        const d = distSq(o.position, m.position);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      if (best) {
        used.add(best);
        m.marking = true;
        const gx = ownGoalX(this);
        const dx = gx - best.position.x;
        const dz = 0 - best.position.z;
        const dl = Math.hypot(dx, dz) || 1;
        // Near our goal he stays goal-side and touch-tight. Further out he steps
        // toward the ball's side of his man (in the passing lane) — denying the
        // pass is better than letting it be played and then tackling.
        const distGoal = dl;
        const lane = clamp((distGoal - 13) / 12, 0, 0.6) * (this.tactic === 'lowBlock' ? 0.4 : 1);
        const bxr = ball.position.x - best.position.x;
        const bzr = ball.position.z - best.position.z;
        const bl = Math.hypot(bxr, bzr) || 1;
        const off = this.tactic === 'lowBlock' ? 2.2 : 1.8;
        const tx = best.position.x + (dx / dl) * off * (1 - lane) + (bxr / bl) * 2.2 * lane;
        const tz = best.position.z + (dz / dl) * off * (1 - lane) + (bzr / bl) * 2.2 * lane;
        m.markTarget = V3(tx, 0, tz);
      }
    }
  }

  update(_dt: number): void {
    // refresh perception for all players before any decision-making
    for (const p of this.players) if (!p.sentOff) updatePerception(p);

    this.inAttack = match.controlTeam === this;
    this.updateTactic();
    const of = this.outfield();
    const side = this.side;
    for (const p of this.players) p.role = p.roleType === 'GK' ? 'GK' : 'POSITION';

    if (this.inAttack && match.controlPlayer && match.controlPlayer.team === this) {
      const carrier = match.controlPlayer;
      if (this.passRequestRegulator.ready()) updatePassRequest(carrier);
      if (carrier.roleType !== 'GK') carrier.role = 'CARRIER';
      const others = of.filter((p) => p !== carrier).sort((a, b) => b.position.x * side - a.position.x * side);
      // the two most advanced make runs; a third stays as the safe option behind the ball
      const runners = others.slice(0, 2);
      for (const r of runners) r.role = 'SUPPORT';
      this.assignSupport(carrier, runners);

      // A teammate who has actively requested the pass makes the visible run
      // into their advertised target instead of passively holding a generic spot.
      const caller = match.callingPlayer;
      if (caller && caller.team === this && caller !== carrier && !caller.sentOff && match.callTarget) {
        caller.role = 'SUPPORT';
        caller.supportTarget.copy(match.callTarget);
      }
    } else {
      const sorted = of.slice().sort((a, b) => distSq(a.position, ball.position) - distSq(b.position, ball.position));
      if (sorted[0]) sorted[0].role = 'CHASER';
      // Secondary chaser: only commit a second player when the ball is in our
      // half AND the first chaser isn't already close enough to win it alone.
      // If the first chaser is within 4 units the second player holds a covering
      // position behind the play — this blocks counter-attack through-balls
      // instead of leaving the back line exposed with two players committed.
      const hunting = this.tactic === 'counterPress' || this.tactic === 'pressHigh';
      if ((ball.position.x * side < 0 || hunting) && sorted[1]) {
        const firstChaser = sorted[0];
        const firstDist = firstChaser ? Math.hypot(firstChaser.position.x - ball.position.x, firstChaser.position.z - ball.position.z) : Infinity;
        // a second man goes when the first can't get there alone — or, when the
        // team is hunting the ball, to close the nearest way out
        if (firstDist > 4 || (hunting && this.engage)) {
          sorted[1].role = 'CHASER';
        }
        // else sorted[1] stays as POSITION and holds its covering shape
      }
      this.assignMarks();
    }

    // an assigned pass receiver overrides their tactical role to run onto the ball
    const rcv = match.receivingPlayer;
    if (rcv && rcv.team === this && rcv.roleType !== 'GK') rcv.role = 'RECEIVE';

    for (const p of this.players) {
      if (p.sentOff) continue;
      const role: PlayerRole = p.role;
      if (!p.fsm.in(role)) p.fsm.changeTo(role);
      p.fsm.update();
    }
  }
}
