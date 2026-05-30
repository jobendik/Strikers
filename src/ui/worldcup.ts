/*
 * World Cup tournament UI (A5 menu banner + A6 screens).
 *
 * Reads the live run from the tournament engine (`game/worldcup.ts`) and renders
 * the menu "your nation plays today" banner plus the full tournament overlay:
 * group tables, the knockout bracket, and the player's road to the final. Pure
 * presentation — it never mutates the run, so it is safe to open at any time and
 * always reflects the persisted state (resumes across sessions).
 */
import { teamMeta } from '../config/players';
import { getSettings } from '../core/settings';
import {
  loadRun,
  groupStandings,
  matchdayMeta,
  roundName,
  tieWinner,
  userFixture,
  opponentOf,
  QUALIFY_PER_GROUP,
  GROUP_NAMES,
  type WorldCupRun,
  type Fixture,
  type RoundKey,
} from '../game/worldcup';

type Tab = 'groups' | 'bracket' | 'you';
let activeTab: Tab = 'groups';

const byId = (id: string): HTMLElement | null => document.getElementById(id);

/** Short 3-letter code for a team key. */
const code = (key: string): string => teamMeta(key).short;
const name = (key: string): string => teamMeta(key).name;

// ---- menu banner (A5) -------------------------------------------------------

/** Update the menu's World Cup banner to advertise the next fixture / state. */
function refreshBanner(): void {
  const banner = byId('wcBanner');
  const l1 = byId('wcBannerL1');
  const l2 = byId('wcBannerL2');
  if (!banner || !l1 || !l2) return;

  const team = getSettings().team;
  const run = loadRun();
  const showForMode = getSettings().mode === 'cup';
  const hasRunForTeam = !!run && run.userNation === team && (run.active || !!run.champion);

  // show the banner when World Cup is selected, or when a run for this team exists
  banner.classList.toggle('hidden', !(showForMode || hasRunForTeam));
  if (banner.classList.contains('hidden')) return;

  if (run && run.userNation === team && run.champion === team) {
    l1.textContent = 'WORLD CUP 2026 · CHAMPIONS 🏆';
    l2.textContent = `${name(team)} lifted the trophy. Kick off to start a new run.`;
    return;
  }
  if (run && run.userNation === team && run.active && !run.userOut) {
    const f = userFixture(run, run.matchday);
    const meta = matchdayMeta(run.matchday);
    if (f && meta) {
      const opp = name(opponentOf(f, team));
      const ctx = f.round === 'GROUP' ? `${meta.label} · Group Stage` : roundName(f.round);
      l1.textContent = `WORLD CUP 2026 · ${ctx} · ${meta.date}`;
      l2.textContent = `${name(team)} vs ${opp} — play now`;
      return;
    }
  }
  if (run && run.userNation === team && run.userOut) {
    l1.textContent = 'WORLD CUP 2026 · KNOCKED OUT';
    l2.textContent = `${name(team)}'s run ended. Kick off to start a new tournament.`;
    return;
  }
  // no run yet for this team
  l1.textContent = 'WORLD CUP 2026';
  l2.textContent = `Lead ${name(team)} from the group stage to the trophy.`;
}

// ---- group tables -----------------------------------------------------------

function renderGroups(run: WorldCupRun): string {
  const sign = (n: number): string => (n > 0 ? `+${n}` : `${n}`);
  const groups = GROUP_NAMES.map((gName) => {
    const g = run.groups.find((x) => x.name === gName);
    if (!g) return '';
    const standings = groupStandings(g);
    const rows = standings
      .map((s, i) => {
        const cls = [i < QUALIFY_PER_GROUP ? 'wc-q' : '', s.key === run.userNation ? 'wc-you' : ''].join(' ').trim();
        return (
          `<tr class="${cls}"><td>${i + 1}</td><td class="wc-tname">${code(s.key)}</td>` +
          `<td>${s.played}</td><td>${s.won}</td><td>${s.drawn}</td><td>${s.lost}</td>` +
          `<td>${s.gf}</td><td>${s.ga}</td><td>${sign(s.gd)}</td><td class="wc-pts">${s.points}</td></tr>`
        );
      })
      .join('');
    return (
      `<div class="wc-group"><div class="wc-group-h">GROUP ${gName}</div>` +
      `<table class="wc-table"><thead><tr><th></th><th></th><th>P</th><th>W</th><th>D</th><th>L</th>` +
      `<th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead><tbody>${rows}</tbody></table></div>`
    );
  }).join('');
  return `<div class="wc-groups">${groups}</div><div class="wc-legend">Top ${QUALIFY_PER_GROUP} advance · your nation highlighted</div>`;
}

// ---- bracket ----------------------------------------------------------------

function tieHtml(run: WorldCupRun, f: Fixture | null): string {
  if (!f) return `<div class="wc-tie wc-tbd"><span class="wc-tt">—</span><span class="wc-tt">—</span></div>`;
  const w = tieWinner(f);
  const played = f.played && f.homeGoals !== null && f.awayGoals !== null;
  const side = (key: string, goals: number | null): string => {
    const isUser = key === run.userNation;
    const isWin = w === key;
    const cls = ['wc-tt', isWin ? 'wc-win' : '', isUser ? 'wc-you' : ''].join(' ').trim();
    const score = played ? `<b>${goals}</b>` : '';
    return `<span class="${cls}">${code(key)} ${score}</span>`;
  };
  const pens = f.pens ? '<span class="wc-pens">pens</span>' : '';
  return `<div class="wc-tie">${side(f.home, f.homeGoals)}${side(f.away, f.awayGoals)}${pens}</div>`;
}

function renderBracket(run: WorldCupRun): string {
  if (!run.knockout.length) {
    return `<div class="wc-empty">The bracket is set after the group stage (Matchday 3).</div>`;
  }
  const round = (r: RoundKey, count: number): string => {
    const ties = run.knockout.filter((f) => f.round === r);
    const cells: string[] = [];
    for (let i = 0; i < count; i++) cells.push(tieHtml(run, ties[i] ?? null));
    return `<div class="wc-round"><div class="wc-round-h">${roundName(r)}s</div>${cells.join('')}</div>`;
  };
  const champ = run.champion
    ? `<div class="wc-champ">🏆 ${name(run.champion)}${run.champion === run.userNation ? ' — YOU!' : ''}</div>`
    : '';
  return `<div class="wc-bracket">${round('QF', 4)}${round('SF', 2)}${round('FINAL', 1)}</div>${champ}`;
}

// ---- your road --------------------------------------------------------------

function renderYourRoad(run: WorldCupRun): string {
  const fixtures: Fixture[] = [];
  for (const g of run.groups) for (const f of g.fixtures) if (f.home === run.userNation || f.away === run.userNation) fixtures.push(f);
  for (const f of run.knockout) if (f.home === run.userNation || f.away === run.userNation) fixtures.push(f);
  fixtures.sort((a, b) => a.matchday - b.matchday);

  const nextMd = run.active && !run.userOut ? userFixture(run, run.matchday)?.matchday ?? -1 : -1;
  const rows = fixtures
    .map((f) => {
      const opp = opponentOf(f, run.userNation);
      const meta = matchdayMeta(f.matchday);
      const ctx = f.round === 'GROUP' ? `${meta?.label ?? `MD${f.matchday}`}` : roundName(f.round);
      let result = '<span class="wc-up">upcoming</span>';
      if (f.played && f.homeGoals !== null && f.awayGoals !== null) {
        const userHome = f.home === run.userNation;
        const us = userHome ? f.homeGoals : f.awayGoals;
        const them = userHome ? f.awayGoals : f.homeGoals;
        const w = tieWinner(f);
        const verdict = us > them ? 'W' : us < them ? 'L' : f.pens ? (w === run.userNation ? 'W' : 'L') : 'D';
        const penTag = f.pens ? ' (pens)' : '';
        result = `<span class="wc-res wc-res-${verdict.toLowerCase()}">${verdict} ${us}–${them}${penTag}</span>`;
      }
      const here = f.matchday === nextMd ? ' wc-next' : '';
      return `<div class="wc-fix${here}"><span class="wc-fix-ctx">${ctx}</span><span class="wc-fix-opp">vs ${code(opp)}</span>${result}</div>`;
    })
    .join('');

  let banner = '';
  if (run.champion === run.userNation) banner = `<div class="wc-road-banner wc-good">🏆 WORLD CHAMPIONS</div>`;
  else if (run.userOut) banner = `<div class="wc-road-banner wc-bad">Knocked out — your run has ended.</div>`;
  return `${banner}<div class="wc-road">${rows}</div>`;
}

// ---- screen orchestration ---------------------------------------------------

function renderBody(): void {
  const body = byId('wcBody');
  const title = byId('wcTitle');
  const kicker = byId('wcKicker');
  if (!body) return;
  const run = loadRun();
  if (!run) {
    body.innerHTML = `<div class="wc-empty">No active World Cup yet. Select <b>World Cup</b> and kick off to begin your run.</div>`;
    if (title) title.textContent = 'WORLD CUP 2026';
    if (kicker) kicker.textContent = 'World Cup 2026';
    return;
  }
  if (title) title.textContent = `${name(run.userNation)} · WORLD CUP 2026`;
  if (kicker) {
    const meta = matchdayMeta(run.matchday);
    kicker.textContent = run.champion
      ? run.champion === run.userNation
        ? 'Champions of the world'
        : `Won by ${name(run.champion)}`
      : run.userOut
        ? 'Your run has ended'
        : meta
          ? `${meta.label} · ${meta.date}`
          : 'World Cup 2026';
  }
  body.innerHTML = activeTab === 'groups' ? renderGroups(run) : activeTab === 'bracket' ? renderBracket(run) : renderYourRoad(run);
}

function setTab(tab: Tab): void {
  activeTab = tab;
  for (const t of ['groups', 'bracket', 'you'] as Tab[]) {
    const btn = byId(`wcTab${t === 'groups' ? 'Groups' : t === 'bracket' ? 'Bracket' : 'You'}`);
    btn?.classList.toggle('on', t === tab);
  }
  renderBody();
}

function setTournamentVisible(v: boolean): void {
  byId('tournament')?.classList.toggle('hidden', !v);
}

/** Open the tournament overlay (defaults to the Groups tab). */
export function openTournament(): void {
  setTab('groups');
  renderBody();
  setTournamentVisible(true);
}

/** Close the tournament overlay. */
export function closeTournament(): void {
  setTournamentVisible(false);
}

/** Refresh the menu banner and, if it's open, the tournament screen. */
export function refreshWorldCupUI(): void {
  refreshBanner();
  if (!byId('tournament')?.classList.contains('hidden')) renderBody();
}

/** Wire the World Cup UI controls. Call once at boot. */
export function initWorldCupUI(): void {
  byId('btnWcTable')?.addEventListener('click', openTournament);
  byId('btnWcDone')?.addEventListener('click', closeTournament);
  byId('wcTabGroups')?.addEventListener('click', () => setTab('groups'));
  byId('wcTabBracket')?.addEventListener('click', () => setTab('bracket'));
  byId('wcTabYou')?.addEventListener('click', () => setTab('you'));
  refreshBanner();
}
