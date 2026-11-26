import { match } from './state';
import { clamp } from '../core/math';
import { Haptics } from '../core/haptics';
import { switchPlayer, userKnockOn, userPass, userShoot, userThrough, type ShotMods } from './humanActions';
import { penaltyAction } from './penalty';
import { skipReplay } from './replay';
import { quitToMenu, restartMatch, resumeGame, togglePause } from './flow';
import { cycleCameraMode } from './camera';
import { flashToast } from '../ui/hud';

/*
 * Input: touch, keyboard and gamepad merged into one intent.
 *
 *   Move      left stick · WASD / arrows · touch joystick
 *   Sprint    RT · Shift · »           (double-tap = knock-on)
 *   Pass      A · J · ➤                (hold = lofted / cross)   off the ball: standing tackle
 *   Shoot     B · K · ⚽               (hold = power + height)   off the ball: slide / header
 *   Through   Y · L                    (hold = lobbed through)
 *   Finesse   RB + shoot · I           Chip   LB + shoot · O
 *   Jockey    LT · C / Ctrl            Switch LB / right stick · Space · ⇄
 *   Camera    V                        Pause  Start · Esc / P
 *
 * Buttons are edge-detected and time-stamped here; what they *mean* is decided in
 * humanActions.ts. Actions pressed just before the ball arrives are buffered by
 * the simulation and played first-time.
 */

const keys: Record<string, boolean> = {};
let sprintBtn = false;

const DOUBLE_TAP_MS = 280; // window for a double-tap sprint → knock-on burst
let lastSprintTap = 0;

/** Register a sprint tap; a quick second tap fires the knock-on burst. */
function sprintTap(): void {
  const now = performance.now();
  if (now - lastSprintTap < DOUBLE_TAP_MS) userKnockOn();
  lastSprintTap = now;
}

const MAX_CHARGE_MS = 620; // hold time for a full-power shot
const LOB_HOLD_MS = 230; // hold PASS / THROUGH beyond this to loft the ball

let shootDownAt = 0;
let shooting = false;
let shootMods: ShotMods = {};
let passDownAt = 0;
let passing = false;
let throughDownAt = 0;
let throughing = false;

function modsNow(extra: ShotMods = {}): ShotMods {
  return {
    finesse: extra.finesse || !!keys['KeyI'] || pad.finesse,
    chip: extra.chip || !!keys['KeyO'] || pad.chip,
  };
}

function shootDown(mods: ShotMods = {}): void {
  if (shooting) return;
  shooting = true;
  shootMods = mods;
  shootDownAt = performance.now();
  Haptics.tap();
}
function shootUp(): void {
  if (!shooting) return;
  const charge = clamp((performance.now() - shootDownAt) / MAX_CHARGE_MS, 0, 1);
  shooting = false;
  if (match.state === 'shootout') penaltyAction(charge);
  else userShoot(charge, modsNow(shootMods));
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
function throughDown(): void {
  throughing = true;
  throughDownAt = performance.now();
}
function throughUp(): void {
  if (!throughing) return;
  const lob = performance.now() - throughDownAt >= LOB_HOLD_MS;
  throughing = false;
  userThrough(lob);
  Haptics.tap();
}

/** 0–1 shot charge level (for the on-screen power bar); 0 when not charging. */
export function shootCharge(): number {
  return shooting ? clamp((performance.now() - shootDownAt) / MAX_CHARGE_MS, 0, 1) : 0;
}

/* ------------------------------------------------------------------ gamepad */

/** Stick dead zone (0–0.5). Configurable; persisted by settings when changed there. */
export const inputCfg = { deadzone: 0.18 };

const pad = { x: 0, z: 0, sprint: false, jockey: false, finesse: false, chip: false, connected: false };
const prevBtn: boolean[] = [];
let rsArmed = true;

function pollGamepad(): void {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  let gp: Gamepad | null = null;
  for (const g of pads) {
    if (g && g.connected && g.mapping === 'standard') {
      gp = g;
      break;
    }
  }
  if (!gp) for (const g of pads) if (g && g.connected) gp = gp ?? g;
  pad.connected = !!gp;
  if (!gp) {
    pad.x = pad.z = 0;
    pad.sprint = pad.jockey = pad.finesse = pad.chip = false;
    return;
  }
  // radial dead zone with rescale so the stick still reaches full deflection
  const ax = gp.axes[0] ?? 0;
  const ay = gp.axes[1] ?? 0;
  const m = Math.hypot(ax, ay);
  const dz = inputCfg.deadzone;
  if (m > dz) {
    const k = Math.min(1, (m - dz) / (1 - dz)) / m;
    pad.x = ax * k;
    pad.z = ay * k;
  } else {
    pad.x = pad.z = 0;
  }
  const b = (i: number): boolean => !!gp!.buttons[i] && (gp!.buttons[i].pressed || gp!.buttons[i].value > 0.35);
  pad.sprint = b(7);
  pad.jockey = b(6);
  pad.finesse = b(5);
  pad.chip = b(4);
  const edge = (i: number, down: () => void, up?: () => void): void => {
    const now = b(i);
    if (now && !prevBtn[i]) down();
    if (!now && prevBtn[i] && up) up();
    prevBtn[i] = now;
  };
  edge(0, passDown, passUp); // A / Cross
  edge(1, () => shootDown(), shootUp); // B / Circle
  edge(2, () => shootDown({ finesse: true }), shootUp); // X / Square — finesse shot
  edge(3, throughDown, throughUp); // Y / Triangle
  edge(7, sprintTap); // RT
  edge(4, () => {
    // LB: switch when defending (a chip modifier when held with shoot on the ball)
    switchPlayer();
  });
  edge(9, () => togglePause()); // Start
  edge(8, () => flashToast(`CAMERA: ${cycleCameraMode().toUpperCase()}`)); // Back / Select
  // right stick flick: directional player switch (defending) / knock-on (on the ball)
  const rx = gp.axes[2] ?? 0;
  const ry = gp.axes[3] ?? 0;
  const rm = Math.hypot(rx, ry);
  if (rm > 0.7 && rsArmed) {
    rsArmed = false;
    if (match.controlPlayer && match.controlPlayer === match.userPlayer) userKnockOn();
    else switchPlayer(rx, ry);
  } else if (rm < 0.3) rsArmed = true;
}

/** True when a gamepad is driving the game (for control hints). */
export function gamepadConnected(): boolean {
  return pad.connected;
}

/** Attach all touch, mouse and keyboard listeners. Call once at boot. */
export function initInput(): void {
  initJoystick();
  bindButton('bShoot', (down) => (down ? shootDown() : shootUp()));
  bindButton('bPass', (down) => (down ? passDown() : passUp()));
  bindButton('bSprint', (down) => {
    sprintBtn = down;
    if (down) sprintTap();
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

  // no touchscreen: hide the on-screen pad and show the key hints instead
  const touch = 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
  document.body.classList.toggle('no-touch', !touch);

  addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return; // typing a name
    const repeat = keys[e.code];
    keys[e.code] = true;
    if (repeat) return; // ignore auto-repeat for edge-triggered actions
    switch (e.code) {
      case 'KeyJ':
        passDown();
        break;
      case 'KeyK':
        shootDown();
        break;
      case 'KeyI':
        shootDown({ finesse: true });
        break;
      case 'KeyO':
        shootDown({ chip: true });
        break;
      case 'KeyL':
        throughDown();
        break;
      case 'Space':
        e.preventDefault();
        switchPlayer(match.input.x, match.input.z);
        break;
      case 'Escape':
      case 'KeyP':
        e.preventDefault();
        togglePause();
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        sprintTap();
        break;
      case 'KeyV':
        flashToast(`CAMERA: ${cycleCameraMode().toUpperCase()}`);
        break;
      case 'Enter':
        skipReplay();
        break;
    }
  });
  addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === 'KeyJ') passUp();
    if (e.code === 'KeyK' || e.code === 'KeyI' || e.code === 'KeyO') shootUp();
    if (e.code === 'KeyL') throughUp();
  });
  // a lost focus must not leave keys stuck down
  addEventListener('blur', () => {
    for (const k of Object.keys(keys)) keys[k] = false;
    sprintBtn = false;
    shooting = passing = throughing = false;
  });
}

/** Merge keyboard + joystick + gamepad into the resolved per-frame input. Call each frame. */
export function pollInput(): void {
  pollGamepad();
  let kx = 0;
  let kz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) kz -= 1;
  if (keys['KeyS'] || keys['ArrowDown']) kz += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) kx -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) kx += 1;
  if (kx || kz) {
    const l = Math.hypot(kx, kz);
    match.input.x = kx / l;
    match.input.z = kz / l;
  } else if (pad.x || pad.z) {
    match.input.x = pad.x;
    match.input.z = pad.z;
  } else {
    match.input.x = match.joy.x;
    match.input.z = match.joy.z;
  }
  match.input.sprint = sprintBtn || !!keys['ShiftLeft'] || !!keys['ShiftRight'] || pad.sprint;
  match.input.jockey = !!keys['KeyC'] || !!keys['ControlLeft'] || !!keys['ControlRight'] || pad.jockey;
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
  const live = c > 0 && match.userPlayer != null && (match.state === 'play' || match.state === 'shootout');
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
