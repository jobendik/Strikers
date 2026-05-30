import { CFG } from '../config/constants';
import { Audio } from '../core/audio';
import { Haptics } from '../core/haptics';
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

export function showFullTime(h: number, a: number, result: string, stats: string, motm = ''): void {
  el('ftH').textContent = String(h);
  el('ftA').textContent = String(a);
  el('ftResult').textContent = result;
  el('ftStats').textContent = stats;
  el('ftMotm').textContent = motm;
  setFullTimeVisible(true);
}

/** Show the half-time interval card with the running score + stats. */
export function showHalfTime(h: number, a: number, stats: string): void {
  el('htH').textContent = String(h);
  el('htA').textContent = String(a);
  el('htStats').textContent = stats;
  setHalfTimeVisible(true);
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

/** Wire menu segmented controls and primary buttons. */
export function initUI(callbacks: { onPlay: () => void; onAgain: () => void; onSecondHalf: () => void }): void {
  const seg = (id: string, cb: (v: number) => void): void => {
    const group = el(id);
    group.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        group.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        cb(Number(b.getAttribute('data-v')));
      }),
    );
  };
  seg('segDiff', (v) => (CFG.diff = v));
  seg('segLen', (v) => (CFG.matchSeconds = v));

  el('btnPlay').addEventListener('click', callbacks.onPlay);
  el('btnAgain').addEventListener('click', callbacks.onAgain);
  el('btnSecond').addEventListener('click', callbacks.onSecondHalf);

  let muted = false;
  const muteBtn = el('muteBtn');
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    Audio.setMute(muted);
    Haptics.setEnabled(!muted);
    muteBtn.textContent = muted ? '🔇' : '🔊';
  });
}
