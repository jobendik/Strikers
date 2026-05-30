import { match } from './state';
import { clamp } from '../core/math';
import { Haptics } from '../core/haptics';
import { switchPlayer, userPass, userShoot } from './humanActions';
import { penaltyAction } from './penalty';
import { skipReplay } from './replay';
import { quitToMenu, restartMatch, resumeGame, togglePause } from './flow';

const keys: Record<string, boolean> = {};
let sprintBtn = false;

const MAX_CHARGE_MS = 620; // hold time for a full-power shot
const LOB_HOLD_MS = 230; // hold PASS beyond this to loft the ball

let shootDownAt = 0;
let shooting = false;
let passDownAt = 0;
let passing = false;

function shootDown(): void {
  shooting = true;
  shootDownAt = performance.now();
  Haptics.tap();
}
function shootUp(): void {
  if (!shooting) return;
  const charge = clamp((performance.now() - shootDownAt) / MAX_CHARGE_MS, 0, 1);
  shooting = false;
  if (match.state === 'shootout') penaltyAction(charge);
  else userShoot(charge);
}
function passDown(): void {
  passing = true;
  passDownAt = performance.now();
}
function passUp(): void {
  if (!passing) return;
  const lob = performance.now() - passDownAt >= LOB_HOLD_MS;
  passing = false;
  userPass(lob);
  Haptics.tap();
}

/** 0–1 shot charge level (for the on-screen power bar); 0 when not charging. */
export function shootCharge(): number {
  return shooting ? clamp((performance.now() - shootDownAt) / MAX_CHARGE_MS, 0, 1) : 0;
}

/** Attach all touch, mouse and keyboard listeners. Call once at boot. */
export function initInput(): void {
  initJoystick();
  bindButton('bShoot', (down) => (down ? shootDown() : shootUp()));
  bindButton('bPass', (down) => (down ? passDown() : passUp()));
  bindButton('bSprint', (down) => {
    sprintBtn = down;
  });
  bindButton('bSwitch', (down) => {
    if (down) {
      switchPlayer();
      Haptics.tap();
    }
  });
  bindButton('skipReplay', (down) => {
    if (down) skipReplay();
  });
  bindButton('pauseBtn', (down) => down && togglePause());
  bindButton('btnResume', (down) => down && resumeGame());
  bindButton('btnRestart', (down) => down && restartMatch());
  bindButton('btnQuit', (down) => down && quitToMenu());

  addEventListener('keydown', (e) => {
    const repeat = keys[e.code];
    keys[e.code] = true;
    if (repeat) return; // ignore auto-repeat for edge-triggered actions
    if (e.code === 'KeyJ') passDown();
    if (e.code === 'KeyK') shootDown();
    if (e.code === 'Space') {
      e.preventDefault();
      switchPlayer();
    }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      e.preventDefault();
      togglePause();
    }
  });
  addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === 'KeyJ') passUp();
    if (e.code === 'KeyK') shootUp();
  });
}

/** Merge keyboard + joystick into the resolved per-frame input. Call each frame. */
export function pollInput(): void {
  let kx = 0;
  let kz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) kz -= 1;
  if (keys['KeyS'] || keys['ArrowDown']) kz += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) kx -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) kx += 1;
  if (kx || kz) {
    match.input.x = kx;
    match.input.z = kz;
  } else {
    match.input.x = match.joy.x;
    match.input.z = match.joy.z;
  }
  match.input.sprint = sprintBtn || keys['ShiftLeft'] || keys['ShiftRight'];
  updatePowerBar();
}

let powerEl: HTMLElement | null = null;
let powerFillEl: HTMLElement | null = null;
function updatePowerBar(): void {
  if (!powerEl) {
    powerEl = document.getElementById('power');
    powerFillEl = document.getElementById('powerFill');
  }
  if (!powerEl || !powerFillEl) return;
  const c = shootCharge();
  const live = c > 0 && match.controlPlayer != null && match.controlPlayer === match.userPlayer;
  powerEl.classList.toggle('show', live);
  if (live) powerFillEl.style.width = `${Math.round(c * 100)}%`;
}

function initJoystick(): void {
  const joy = document.getElementById('joy')!;
  const nub = document.getElementById('nub')!;
  let id: number | 'm' | null = null;
  let cx = 0;
  let cy = 0;
  const R = 58;

  const find = (e: TouchEvent | MouseEvent): Touch | MouseEvent | null => {
    if ('changedTouches' in e) {
      for (const t of Array.from(e.changedTouches)) if (t.identifier === id) return t;
      return null;
    }
    return e;
  };
  const start = (e: TouchEvent | MouseEvent): void => {
    const t = 'changedTouches' in e ? e.changedTouches[0] : e;
    id = 'changedTouches' in e ? (t as Touch).identifier : 'm';
    const r = joy.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    doMove(t);
  };
  const move = (e: TouchEvent | MouseEvent): void => {
    const t = find(e);
    if (t) doMove(t);
  };
  const doMove = (t: Touch | MouseEvent): void => {
    let dx = t.clientX - cx;
    let dy = t.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      dx = (dx / d) * R;
      dy = (dy / d) * R;
    }
    nub.style.transform = `translate(${dx}px,${dy}px)`;
    match.joy.x = dx / R;
    match.joy.z = dy / R;
  };
  const end = (): void => {
    id = null;
    nub.style.transform = 'translate(0,0)';
    match.joy.x = 0;
    match.joy.z = 0;
  };

  joy.addEventListener('touchstart', (e) => {
    e.preventDefault();
    start(e);
  }, { passive: false });
  joy.addEventListener('touchmove', (e) => {
    e.preventDefault();
    move(e);
  }, { passive: false });
  joy.addEventListener('touchend', (e) => {
    e.preventDefault();
    end();
  }, { passive: false });
  joy.addEventListener('mousedown', (e) => {
    e.preventDefault();
    start(e);
  });
  window.addEventListener('mousemove', (e) => {
    if (id !== null) move(e);
  });
  window.addEventListener('mouseup', () => {
    if (id !== null) end();
  });
}

function bindButton(id: string, fn: (down: boolean) => void): void {
  const elBtn = document.getElementById(id)!;
  elBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    fn(true);
  }, { passive: false });
  elBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    fn(false);
  }, { passive: false });
  elBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    fn(true);
  });
  elBtn.addEventListener('mouseup', (e) => {
    e.preventDefault();
    fn(false);
  });
}
