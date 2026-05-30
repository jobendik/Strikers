/*
 * World Cup tournament engine (A2–A5) — the headline "living tournament".
 *
 * Mirrors the *structure* of the real 2026 event with the curated 16-nation field
 * (expandable toward 32/48): a draw into 4 groups of 4, a round-robin group stage,
 * then a Round-of-8 knockout bracket (Quarter-finals → Semi-finals → Final). The
 * player plays their own nation's fixtures live; every other AI-vs-AI fixture is
 * resolved here by a fast, strength-based simulation (an honest *simulation* of the
 * schedule, never real scores). Matchdays map to real 2026 dates for the "your
 * nation plays today" hook (A5). The whole run lives in the player save so it
 * resumes mid-tournament across days and sessions (A2).
 *
 * This module is pure tournament logic + persistence: it never touches the render
 * loop, audio or DOM, so it is safe to call in-browser and is fully headless-test-
 * able. Live-match integration and the tournament screens (A6) live elsewhere.
 *
 * Fixture resolution note: AI-vs-AI results come from a calibrated statistical
 * model (team strength derived from the same squad attributes the match AI uses),
 * not the full physics sim — it is instant and produces clean, football-realistic
 * tables. The shared `simulateMatch` (A1) can be swapped in here once in-browser
 * headless isolation exists; the interface (`resolveFixture`) is ready for it.
 */
import { SQUADS, TEAMS } from '../config/players';
import { getPlayerData, savePlayerData } from '../core/playerData';

// ---- structure constants ----------------------------------------------------

export const GROUP_NAMES = ['A', 'B', 'C', 'D'] as const;
export const GROUP_SIZE = 4;
/** Teams that advance from each group (top N). */
export const QUALIFY_PER_GROUP = 2;

export type RoundKey = 'GROUP' | 'QF' | 'SF' | 'FINAL';

/** Matchday calendar (A5): real-ish 2026 dates for the daily hook + flavour. */
export interface MatchdayMeta {
  matchday: number;
  round: RoundKey;
  /** Display label, e.g. "Matchday 2" or "Quarter-final". */
  label: string;
  /** Real local date (YYYY-MM-DD) this matchday maps to. */
  date: string;
}

export const CALENDAR: MatchdayMeta[] = [
  { matchday: 1, round: 'GROUP', label: 'Matchday 1', date: '2026-06-11' },
  { matchday: 2, round: 'GROUP', label: 'Matchday 2', date: '2026-06-16' },
  { matchday: 3, round: 'GROUP', label: 'Matchday 3', date: '2026-06-21' },
  { matchday: 4, round: 'QF', label: 'Quarter-final', date: '2026-06-28' },
  { matchday: 5, round: 'SF', label: 'Semi-final', date: '2026-07-05' },
  { matchday: 6, round: 'FINAL', label: 'Final', date: '2026-07-12' },
];

export const FINAL_MATCHDAY = CALENDAR[CALENDAR.length - 1].matchday;

/** Long round name for UI ("Quarter-final" etc.). */
export function roundName(round: RoundKey): string {
  return round === 'GROUP' ? 'Group Stage' : round === 'QF' ? 'Quarter-final' : round === 'SF' ? 'Semi-final' : 'Final';
}

export function matchdayMeta(matchday: number): MatchdayMeta | undefined {
  return CALENDAR.find((c) => c.matchday === matchday);
}

// ---- data model -------------------------------------------------------------

/** One scheduled match. Group fixtures carry a `group`; knockout ties don't. */
export interface Fixture {
  matchday: number;
  round: RoundKey;
  group: string | null;
  home: string;
  away: string;
  homeGoals: number | null;
  awayGoals: number | null;
  /** Knockout decider when level after regulation (penalty winner: 'home'|'away'). */
  pens: 'home' | 'away' | null;
  played: boolean;
  /** The user's nation is in this fixture — it is the playable one. */
  isUser: boolean;
}

/** A team's running group-table line. */
export interface Standing {
  key: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  /** Goal difference (gf − ga). */
  gd: number;
  points: number;
}

export interface Group {
  name: string;
  teams: string[];
  fixtures: Fixture[];
}

/** The full in-memory tournament run (serialised into the player save). */
export interface WorldCupRun {
  active: boolean;
  userNation: string;
  matchday: number;
  field: string[];
  groups: Group[];
  /** Knockout ties (QF→SF→Final), filled as rounds resolve. */
  knockout: Fixture[];
  champion: string | null;
  userOut: boolean;
}

// ---- team strength ----------------------------------------------------------

/**
 * A single 0–100-ish rating for a nation, derived from the same squad attributes
 * the live match AI uses, so simulated results correlate with how a side plays.
 * The field is deliberately a tight band (see players.ts), so upsets are common.
 */
export function teamStrength(key: string): number {
  const squad = SQUADS[key];
  if (!squad || !squad.length) return 70;
  let sum = 0;
  for (const p of squad) {
    const a = p.attr;
    sum += a.pace * 0.22 + a.shooting * 0.26 + a.passing * 0.22 + a.tackling * 0.12 + a.composure * 0.18;
  }
  return sum / squad.length;
}

// ---- RNG (injectable for deterministic tests) -------------------------------

let rng: () => number = Math.random;
/** Override the RNG (tests use a seeded generator for reproducibility). */
export function setWorldCupRng(fn: () => number): void {
  rng = fn;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Sample a Poisson-distributed goal count for an expected-goals value (Knuth). */
function poisson(lambda: number): number {
  const L = Math.exp(-Math.max(0, lambda));
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L && k < 30);
  return k - 1;
}

// ---- fixture resolution -----------------------------------------------------

const BASE_XG = 1.35; // expected goals per side before strength/home adjustment
const STRENGTH_XG = 0.06; // xG shift per rating point of difference
const HOME_XG = 0.25; // home-edge xG bump (group fixtures have a nominal home side)

/**
 * Resolve a single AI-vs-AI fixture to a scoreline. `neutral` knockout ties drop
 * the home edge. Pure aside from the module RNG.
 */
export function resolveFixture(home: string, away: string, neutral = false): { homeGoals: number; awayGoals: number } {
  const diff = teamStrength(home) - teamStrength(away);
  const homeEdge = neutral ? 0 : HOME_XG;
  const homeXg = Math.max(0.15, BASE_XG + diff * STRENGTH_XG + homeEdge);
  const awayXg = Math.max(0.12, BASE_XG - diff * STRENGTH_XG);
  return { homeGoals: poisson(homeXg), awayGoals: poisson(awayXg) };
}

/** A penalty-shootout winner for a level knockout tie, lightly strength-weighted. */
function shootoutWinner(home: string, away: string): 'home' | 'away' {
  const diff = teamStrength(home) - teamStrength(away);
  const pHome = Math.min(0.7, Math.max(0.3, 0.5 + diff * 0.01));
  return rng() < pHome ? 'home' : 'away';
}

// ---- schedule ---------------------------------------------------------------

/**
 * Round-robin pairings for a group via the circle method: for N teams, N−1
 * rounds; here N=4 → 3 rounds of 2 fixtures, one per matchday (1..3).
 */
function roundRobin(teams: string[]): { round: number; home: string; away: string }[] {
  const n = teams.length;
  const list = teams.slice();
  if (n % 2 === 1) list.push('BYE');
  const m = list.length;
  const rounds: { round: number; home: string; away: string }[] = [];
  for (let r = 0; r < m - 1; r++) {
    for (let i = 0; i < m / 2; i++) {
      const a = list[i];
      const b = list[m - 1 - i];
      if (a === 'BYE' || b === 'BYE') continue;
      // alternate home/away by round so the "home" edge is shared out fairly
      const home = (r + i) % 2 === 0 ? a : b;
      const away = home === a ? b : a;
      rounds.push({ round: r + 1, home, away });
    }
    // rotate all but the first
    list.splice(1, 0, list.pop()!);
  }
  return rounds;
}

// ---- draw -------------------------------------------------------------------

/**
 * Seed the field into {@link GROUP_NAMES.length} pots by strength, then draw one
 * team per pot into each group (so every group gets a spread of strengths, like a
 * real World Cup draw). The user's nation is always present (it is in the field).
 */
function drawGroups(field: string[]): Group[] {
  const byStrength = field.slice().sort((a, b) => teamStrength(b) - teamStrength(a));
  const groupCount = GROUP_NAMES.length;
  // pots: pot 0 = strongest `groupCount`, etc.
  const pots: string[][] = [];
  for (let i = 0; i < field.length; i += groupCount) pots.push(shuffle(byStrength.slice(i, i + groupCount)));

  const groups: Group[] = GROUP_NAMES.map((name) => ({ name, teams: [], fixtures: [] }));
  for (const pot of pots) {
    pot.forEach((key, gi) => {
      if (groups[gi]) groups[gi].teams.push(key);
    });
  }

  return groups;
}

// ---- run construction -------------------------------------------------------

/** The default field: the full curated 16 (later expandable toward 32/48). */
export function defaultField(): string[] {
  return TEAMS.map((t) => t.key);
}

/**
 * Build a fresh World Cup run for `nation` and persist it. The field defaults to
 * the full curated 16; the user's nation is guaranteed in it.
 */
export function startWorldCup(nation: string, field: string[] = defaultField()): WorldCupRun {
  const teams = field.includes(nation) ? field.slice() : [nation, ...field.filter((k) => k !== nation)];
  const groups = drawGroups(teams);

  // attach round-robin fixtures (with home/away + isUser flags) to each group
  for (const g of groups) {
    const pairings = roundRobin(g.teams);
    g.fixtures = pairings.map((p) => ({
      matchday: p.round, // group rounds map to matchdays 1..3
      round: 'GROUP' as RoundKey,
      group: g.name,
      home: p.home,
      away: p.away,
      homeGoals: null,
      awayGoals: null,
      pens: null,
      played: false,
      isUser: p.home === nation || p.away === nation,
    }));
  }

  const run: WorldCupRun = {
    active: true,
    userNation: nation,
    matchday: 1,
    field: teams,
    groups,
    knockout: [],
    champion: null,
    userOut: false,
  };
  saveRun(run);
  return run;
}

// ---- standings --------------------------------------------------------------

/** Compute a group's table from its played fixtures, sorted to ranking order. */
export function groupStandings(group: Group): Standing[] {
  const table = new Map<string, Standing>();
  for (const key of group.teams) {
    table.set(key, { key, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 });
  }
  for (const f of group.fixtures) {
    if (!f.played || f.homeGoals === null || f.awayGoals === null) continue;
    const h = table.get(f.home)!;
    const a = table.get(f.away)!;
    h.played++;
    a.played++;
    h.gf += f.homeGoals;
    h.ga += f.awayGoals;
    a.gf += f.awayGoals;
    a.ga += f.homeGoals;
    if (f.homeGoals > f.awayGoals) {
      h.won++;
      a.lost++;
      h.points += 3;
    } else if (f.homeGoals < f.awayGoals) {
      a.won++;
      h.lost++;
      a.points += 3;
    } else {
      h.drawn++;
      a.drawn++;
      h.points++;
      a.points++;
    }
  }
  const standings = [...table.values()];
  for (const s of standings) s.gd = s.gf - s.ga;
  standings.sort(
    (x, y) => y.points - x.points || y.gd - x.gd || y.gf - x.gf || x.key.localeCompare(y.key),
  );
  return standings;
}

// ---- matchday resolution ----------------------------------------------------

/** All fixtures (group + knockout) scheduled for a given matchday. */
export function fixturesForMatchday(run: WorldCupRun, matchday: number): Fixture[] {
  if (matchday <= 3) {
    const out: Fixture[] = [];
    for (const g of run.groups) for (const f of g.fixtures) if (f.matchday === matchday) out.push(f);
    return out;
  }
  return run.knockout.filter((f) => f.matchday === matchday);
}

/** The user's playable fixture this matchday, if their nation is still in it. */
export function userFixture(run: WorldCupRun, matchday: number): Fixture | null {
  return fixturesForMatchday(run, matchday).find((f) => f.isUser && !f.played) ?? null;
}

/** The opponent's team key in a fixture, from the user's perspective. */
export function opponentOf(f: Fixture, userNation: string): string {
  return f.home === userNation ? f.away : f.home;
}

/**
 * Start a fresh run, or resume the saved one if it belongs to the current nation
 * and is still live and playable. Switching nations (or a finished/abandoned run)
 * starts a new tournament.
 */
export function startOrResumeRun(nation: string): WorldCupRun {
  const saved = loadRun();
  if (saved && saved.active && saved.userNation === nation && !saved.champion && !saved.userOut) {
    return saved;
  }
  return startWorldCup(nation);
}

/** What a just-played user matchday meant for the player's tournament run. */
export type OutcomeStatus =
  | 'group-continue' // group stage, more group games to come
  | 'group-through' // topped/placed in the group → into the knockouts
  | 'group-out' // failed to qualify from the group
  | 'advanced' // won a knockout tie → next round
  | 'knocked-out' // lost a knockout tie
  | 'champion'; // won the Final 🏆

/** The result of {@link playUserMatchday}, for the result card + UI. */
export interface MatchdayOutcome {
  status: OutcomeStatus;
  /** The round the user just played. */
  roundJustPlayed: RoundKey;
  /** The matchday the user just played. */
  matchdayJustPlayed: number;
  champion: string | null;
  userOut: boolean;
  /** Next user opponent's key (null if the run is over for the user). */
  nextOpponent: string | null;
  nextRound: RoundKey | null;
  nextMatchday: number | null;
}

/**
 * Apply the user's live result for the current matchday, resolve the rest of the
 * field, advance the tournament and report what it meant. This is the single entry
 * point the live-match flow calls at full time. Pure logic — no UI.
 *
 * `userGoals`/`oppGoals` are from the user's perspective; `penUserWon` settles a
 * level knockout tie (the live game's shootout result).
 */
export function playUserMatchday(
  run: WorldCupRun,
  userGoals: number,
  oppGoals: number,
  penUserWon: boolean | null = null,
): MatchdayOutcome {
  const mdPlayed = run.matchday;
  const round = matchdayMeta(mdPlayed)?.round ?? 'GROUP';
  const f = userFixture(run, mdPlayed);

  if (f) {
    const userHome = f.home === run.userNation;
    const hg = userHome ? userGoals : oppGoals;
    const ag = userHome ? oppGoals : userGoals;
    let pens: 'home' | 'away' | null = null;
    if (penUserWon !== null) pens = userHome === penUserWon ? 'home' : 'away';
    recordUserResult(run, hg, ag, pens);
  }

  resolveMatchday(run);

  // figure out the outcome before advancing
  let status: OutcomeStatus;
  if (run.champion === run.userNation) status = 'champion';
  else if (run.userOut) status = mdPlayed <= 3 ? 'group-out' : 'knocked-out';
  else status = mdPlayed <= 2 ? 'group-continue' : mdPlayed === 3 ? 'group-through' : 'advanced';

  const stillIn = status === 'group-continue' || status === 'group-through' || status === 'advanced';
  if (stillIn && mdPlayed < FINAL_MATCHDAY) advanceMatchday(run);

  const next = stillIn ? userFixture(run, run.matchday) : null;
  return {
    status,
    roundJustPlayed: round,
    matchdayJustPlayed: mdPlayed,
    champion: run.champion,
    userOut: run.userOut,
    nextOpponent: next ? opponentOf(next, run.userNation) : null,
    nextRound: next ? next.round : null,
    nextMatchday: next ? next.matchday : null,
  };
}

/** Record the result of the user's just-played fixture for the current matchday. */
export function recordUserResult(run: WorldCupRun, homeGoals: number, awayGoals: number, pens: 'home' | 'away' | null = null): void {
  const f = userFixture(run, run.matchday);
  if (!f) return;
  f.homeGoals = homeGoals;
  f.awayGoals = awayGoals;
  f.pens = pens;
  f.played = true;
  saveRun(run);
}

function applyResult(f: Fixture, neutral: boolean): void {
  if (f.played) return;
  const r = resolveFixture(f.home, f.away, neutral);
  f.homeGoals = r.homeGoals;
  f.awayGoals = r.awayGoals;
  if (neutral && r.homeGoals === r.awayGoals) f.pens = shootoutWinner(f.home, f.away);
  f.played = true;
}

/** The winner of a (played) knockout tie, honouring a penalty decider. */
export function tieWinner(f: Fixture): string | null {
  if (!f.played || f.homeGoals === null || f.awayGoals === null) return null;
  if (f.homeGoals > f.awayGoals) return f.home;
  if (f.awayGoals > f.homeGoals) return f.away;
  return f.pens === 'home' ? f.home : f.pens === 'away' ? f.away : null;
}

/**
 * Resolve every remaining AI-vs-AI fixture of the current matchday, then advance
 * the tournament: build the knockout bracket after the group stage, or seed the
 * next knockout round. The user's fixture must already be recorded unless
 * `forceSimUser` is set (used when the user is out, or chooses to simulate).
 *
 * Returns the run for chaining. Idempotent per matchday.
 */
export function resolveMatchday(run: WorldCupRun, forceSimUser = false): WorldCupRun {
  const md = run.matchday;
  const fixtures = fixturesForMatchday(run, md);
  const neutral = md >= 4; // knockout ties on neutral ground

  for (const f of fixtures) {
    if (f.played) continue;
    if (f.isUser && !forceSimUser) continue; // wait for the user to play it
    applyResult(f, neutral);
  }
  run.userOut = computeUserOut(run);
  saveRun(run);

  // if all of this matchday is resolved, advance the structure (idempotent)
  const allDone = fixtures.length > 0 && fixturesForMatchday(run, md).every((f) => f.played);
  if (allDone) {
    if (md === 3) buildKnockout(run);
    else if (md >= 4 && md < FINAL_MATCHDAY) seedNextKnockoutRound(run);
    else if (md === FINAL_MATCHDAY) finishTournament(run);
    run.userOut = computeUserOut(run);
    saveRun(run);
  }
  return run;
}

/** Move to the next matchday (after the current one is fully resolved). */
export function advanceMatchday(run: WorldCupRun): WorldCupRun {
  if (run.matchday < FINAL_MATCHDAY) run.matchday++;
  // keep the userOut flag current
  run.userOut = computeUserOut(run);
  saveRun(run);
  return run;
}

// ---- knockout ---------------------------------------------------------------

/** Qualifiers: the top {@link QUALIFY_PER_GROUP} of each group, in rank order. */
export function qualifiers(run: WorldCupRun): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const g of run.groups) out[g.name] = groupStandings(g).slice(0, QUALIFY_PER_GROUP).map((s) => s.key);
  return out;
}

/**
 * Seed the Quarter-finals from the group winners/runners-up with the standard
 * cross-group pattern so group winners avoid each other and group-mates can't meet
 * before the Final: W(A)–R(B), W(C)–R(D), W(B)–R(A), W(D)–R(C).
 */
function buildKnockout(run: WorldCupRun): void {
  if (run.knockout.length) return; // already seeded — idempotent
  const q = qualifiers(run);
  const w = (g: string): string => q[g][0];
  const r = (g: string): string => q[g][1];
  const ties: [string, string][] = [
    [w('A'), r('B')],
    [w('C'), r('D')],
    [w('B'), r('A')],
    [w('D'), r('C')],
  ];
  run.knockout = ties.map(([home, away]) => makeTie(run, 'QF', 4, home, away));
}

/** Build the next knockout round's ties from the prior round's winners. */
function seedNextKnockoutRound(run: WorldCupRun): void {
  const md = run.matchday;
  const prev = run.knockout.filter((f) => f.matchday === md);
  const winners = prev.map(tieWinner).filter((k): k is string => !!k);
  const nextRound: RoundKey = md === 4 ? 'SF' : 'FINAL';
  const nextMd = md + 1;
  if (run.knockout.some((f) => f.matchday === nextMd)) return; // already seeded
  for (let i = 0; i < winners.length; i += 2) {
    if (winners[i + 1] === undefined) break;
    run.knockout.push(makeTie(run, nextRound, nextMd, winners[i], winners[i + 1]));
  }
}

function makeTie(run: WorldCupRun, round: RoundKey, matchday: number, home: string, away: string): Fixture {
  return {
    matchday,
    round,
    group: null,
    home,
    away,
    homeGoals: null,
    awayGoals: null,
    pens: null,
    played: false,
    isUser: !run.userOut && (home === run.userNation || away === run.userNation),
  };
}

function finishTournament(run: WorldCupRun): void {
  const final = run.knockout.find((f) => f.round === 'FINAL');
  run.champion = final ? tieWinner(final) : null;
  run.active = false;
}

/** True once the user's nation can no longer win the trophy. */
function computeUserOut(run: WorldCupRun): boolean {
  if (run.champion) return run.champion !== run.userNation;
  // out if a played knockout tie involving the user was lost
  for (const f of run.knockout) {
    if (!f.played) continue;
    if (f.home !== run.userNation && f.away !== run.userNation) continue;
    if (tieWinner(f) !== run.userNation) return true;
  }
  // once the knockout is seeded (group stage complete), a user who isn't in any
  // tie failed to qualify. Knockout losers are caught by the loop above; a still-
  // alive user is always in their current tie, so this only fires for non-qualifiers.
  if (run.knockout.length) {
    const inKnockout = run.knockout.some((f) => f.home === run.userNation || f.away === run.userNation);
    if (!inKnockout) return true;
  }
  return false;
}

// ---- persistence (serialise the run into the player save's worldcup slot) ----

/** Write the run into the player save and persist. */
export function saveRun(run: WorldCupRun): void {
  const wc = getPlayerData().worldcup;
  wc.active = run.active;
  wc.field = run.field;
  wc.groups = run.groups;
  wc.bracket = run.knockout;
  wc.matchday = run.matchday;
  wc.yourNation = run.userNation;
  wc.champion = run.champion;
  wc.userOut = run.userOut;
  savePlayerData();
}

/** Hydrate the run from the player save, or null if no active/!empty run exists. */
export function loadRun(): WorldCupRun | null {
  const wc = getPlayerData().worldcup;
  if (!wc.groups || !wc.groups.length) return null;
  return {
    active: wc.active,
    userNation: wc.yourNation,
    matchday: wc.matchday || 1,
    field: wc.field.slice(),
    groups: wc.groups as Group[],
    knockout: (wc.bracket as Fixture[]) ?? [],
    champion: wc.champion,
    userOut: wc.userOut,
  };
}

/** Clear any saved run (e.g. start a new tournament or abandon). */
export function clearRun(): void {
  const wc = getPlayerData().worldcup;
  wc.active = false;
  wc.field = [];
  wc.groups = [];
  wc.bracket = [];
  wc.matchday = 0;
  wc.yourPath = [];
  wc.champion = null;
  wc.userOut = false;
  savePlayerData();
}
