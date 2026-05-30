import { match } from './state';
import { Haptics } from '../core/haptics';
import { switchPlayer, userPass, userShoot } from './humanActions';

const keys: Record<string, boolean> = {};
let sprintBtn = false;

/** Attach all touch, mouse and keyboard listeners. Call once at boot. */
export function initInput(): void {
  initJoystick();
  bindButton('bShoot', (down) => {
    if (down) {
      userShoot();
      Haptics.tap();
    }
  });
  bindButton('bPass', (down) => {
    if (down) {
      userPass();
      Haptics.tap();
    }
  });
  bindButton('bSprint', (down) => {
    sprintBtn = down;
  });
  bindButton('bSwitch', (down) => {
    if (down) {
      switchPlayer();
      Haptics.tap();
    }
  });

  addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'KeyJ') userPass();
    if (e.code === 'KeyK') userShoot();
    if (e.code === 'Space') {
      e.preventDefault();
      switchPlayer();
    }
  });
  addEventListener('keyup', (e) => {
    keys[e.code] = false;
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
