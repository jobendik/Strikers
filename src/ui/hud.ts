import { CFG } from '../config/constants';
import { match } from '../game/state';

const el = (id: string): HTMLElement => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing DOM element #${id}`);
  return node;
};

/** Refresh the scoreboard and match clock. */
export function updateHUD(): void {
  el('scoreH').textContent = String(match.score[0]);
  el('scoreA').textContent = String(match.score[1]);
  const tl = Math.max(0, match.timeLeft);
  const mm = Math.floor(tl / 60);
  const ss = Math.floor(tl % 60);
  el('clock').textContent = `${mm}:${String(ss).padStart(2, '0')}`;
  // the half label doubles as the added-time indicator while stoppage is playing
  el('half').textContent =
    match.stoppageLeft > 0 ? `+${Math.ceil(match.stoppageLeft)}s` : match.half >= 2 ? '2ND HALF' : '1ST HALF';
  updatePlayerBadge();
}

/** Sync the scoreboard tags + kit dots to the two teams' current identities. */
export function refreshTeamTags(): void {
  const [h, a] = match.teams;
  el('tagH').textContent = h.short;
  el('tagA').textContent = a.short;
  el('dotH').style.background = h.color;
  el('dotH').style.color = h.color;
  el('dotA').style.background = a.color;
  el('dotA').style.color = a.color;
}

/** Show which named player the user is currently controlling. */
function updatePlayerBadge(): void {
  const badge = el('pname');
  const p = match.userPlayer;
  if (p && match.state === 'play') {
    el('pnum').textContent = String(p.num);
    el('pnm').textContent = p.name;
    badge.classList.add('show');
  } else {
    badge.classList.remove('show');
  }
}

let toastT = 0;
export function flashToast(msg: string): void {
  if (!msg) return;
  const node = el('toast');
  node.textContent = msg;
  node.classList.add('show');
  toastT = 1.1;
}
export function updateToast(dt: number): void {
  if (toastT > 0) {
    toastT -= dt;
    if (toastT <= 0) el('toast').classList.remove('show');
  }
}

/** Play the big GOAL! flourish for team `i` (0 = home). */
export function showGoalFx(i: number): void {
  const fx = el('goalFx');
  const g = fx.querySelector('.g') as HTMLElement;
  g.style.setProperty('--c', i === 0 ? '#ff2d55' : '#1e90ff');
  fx.classList.remove('show');
  void fx.offsetWidth; // reflow to restart the animation
  fx.classList.add('show');
}

export function showFullTime(
  h: number,
  a: number,
  result: string,
  stats: string,
  motm = '',
  kicker = 'Full Time',
  buttonLabel = 'PLAY AGAIN ▸',
): void {
  el('ftH').textContent = String(h);
  el('ftA').textContent = String(a);
  el('ftResult').textContent = result;
  el('ftStats').textContent = stats;
  el('ftMotm').textContent = motm;
  el('ftKicker').textContent = kicker;
  el('btnAgain').textContent = buttonLabel;
  setFullTimeVisible(true);
}

/** Show the half-time interval card with the running score + stats. */
export function showHalfTime(h: number, a: number, stats: string): void {
  el('htH').textContent = String(h);
  el('htA').textContent = String(a);
  el('htStats').textContent = stats;
  setHalfTimeVisible(true);
}

/** Show/hide the shootout scoreboard banner. */
export function showShootout(v: boolean): void {
  el('shootout').classList.toggle('hidden', !v);
}

/** Show/hide the instant-replay label + skip control. */
export function showReplayUI(v: boolean): void {
  el('replay').classList.toggle('show', v);
}

/** Render the kick-by-kick shootout board (two rows of goal/miss marks + scores). */
export function updateShootoutBoard(
  goals: [number, number],
  taken: [number, number],
  marks: Array<Array<'goal' | 'miss'>>,
  _starter: number,
  current: number,
  suddenDeath: boolean,
): void {
  el('soHead').textContent = suddenDeath ? 'SUDDEN DEATH' : 'PENALTIES';
  const slots = Math.max(CFG.pen.bestOf, taken[0], taken[1]);
  for (let i = 0; i < 2; i++) {
    const row = el(`soRow${i}`);
    let dots = '';
    for (let j = 0; j < slots; j++) {
      const m = marks[i][j];
      dots += `<span class="so-dot ${m ?? 'empty'}"></span>`;
    }
    row.className = `so-row${i === current ? ' current' : ''}`;
    row.innerHTML = `<span class="so-tag">${match.teams[i].short}</span>${dots}<span class="so-score">${goals[i]}</span>`;
  }
}

export function setMenuVisible(v: boolean): void {
  el('menu').classList.toggle('hidden', !v);
}
export function setFullTimeVisible(v: boolean): void {
  el('ft').classList.toggle('hidden', !v);
}
export function setHalfTimeVisible(v: boolean): void {
  el('ht').classList.toggle('hidden', !v);
}
export function setPauseVisible(v: boolean): void {
  el('pause').classList.toggle('hidden', !v);
}

/**
 * Wire the primary flow buttons. The menu's option controls (difficulty, length,
 * match type, rules) and all settings live in {@link initSettings}, which owns
 * persistence.
 */
export function initUI(callbacks: { onPlay: () => void; onAgain: () => void; onSecondHalf: () => void }): void {
  el('btnPlay').addEventListener('click', callbacks.onPlay);
  el('btnAgain').addEventListener('click', callbacks.onAgain);
  el('btnSecond').addEventListener('click', callbacks.onSecondHalf);
}
