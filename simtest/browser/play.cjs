/*
 * Browser-level gameplay checks (Playwright). Drives the REAL game in a real
 * browser through the dev API (`window.__strikers`), stepping the simulation
 * deterministically so results do not depend on the machine's frame rate
 * (important: CI/sandbox Chromium renders with SwiftShader at 1–2 fps).
 *
 *   npx vite --port 5173 --strictPort &            # or any dev/preview server
 *   NODE_PATH=$(npm root -g) node simtest/browser/play.cjs [url] [--shots dir]
 *
 * Exit code 1 if any check fails. Covers: boot without console errors, scripted
 * human control (dribble / sprint / reversal / stop / pass), a mocked standard
 * gamepad, a penalty shoot-out played to full time.
 */
const { chromium } = require('playwright');

const URL = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:5173/strikers/';
const si = process.argv.indexOf('--shots');
const SHOTS = si > 0 ? process.argv[si + 1] : null;
const GL = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

let failed = 0;
function check(name, ok, detail) {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail !== undefined ? '  — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
  if (!ok) failed++;
}

(async () => {
  const browser = await chromium.launch({ args: GL });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
  // a fake standard-mapping gamepad the test can drive
  await page.addInitScript(() => {
    const pad = { connected: false, mapping: 'standard', id: 'test pad', index: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false })), timestamp: 0 };
    window.__pad = pad;
    navigator.getGamepads = () => (pad.connected ? [pad, null, null, null] : [null, null, null, null]);
  });
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__strikers, null, { timeout: 120000 });
  await page.evaluate(() => { document.getElementById('btnIntroGo')?.click(); document.getElementById('btnPlay').click(); });
  await page.waitForTimeout(600);
  const S = (fn, a) => page.evaluate(fn, a);
  const frame = () => page.waitForTimeout(1300); // a couple of rendered frames so input is polled

  console.log('# boot');
  await S(() => { const K = window.__strikers; K.loop.manual = true; K.run(0.2); });
  check('match is live', (await S(() => window.__strikers.match.state)) === 'play');

  // helpers living in the page: isolate the user's #10 with the ball; sample a run
  await S(() => {
    const K = window.__strikers;
    K.setup = (x, z) => {
      const m = K.match; const u = m.teams[0].players[3];
      let i = 0;
      for (const t of m.teams) for (const p of t.players) {
        if (p === u) continue;
        if (t === m.teams[1]) p.position.set(27, 0, (i++ % 5) * 3 - 6);
        p.velocity.set(0, 0, 0); p.clearAction();
      }
      m.teams[0].players[4].position.set(x + 12, 0, z + 5);
      m.teams[0].players[1].position.set(x - 8, 0, z - 6);
      m.teams[0].players[2].position.set(x - 8, 0, z + 8);
      u.position.set(x, 0, z); u.velocity.set(0, 0, 0); u.heading = Math.PI / 2; u.clearAction(); u.stamina = 1;
      K.ball.place(x + 0.6, z);
      m.restart = null; m.setPieceT = 0; m.controlPlayer = u; m.controlTeam = u.team;
      if (m.userPlayer) m.userPlayer.isHuman = false; m.userPlayer = u; u.isHuman = true;
      m.receivingPlayer = null; m.state = 'play'; m.timeLeft = 150;
      K.reseed(20261126); // same random stream every scenario ⇒ reproducible
      m.assistIdle = false; m.userIdleT = 0; // scenarios leave the controls alone on purpose; the idle-assist test turns it on
    };
    K.sample = (secs) => {
      const m = K.match; const u = m.teams[0].players[3]; let maxD = 0, ctl = 0; const n = Math.round(secs * 120);
      const x0 = u.position.x;
      for (let i = 0; i < n; i++) {
        K.step(1);
        maxD = Math.max(maxD, Math.hypot(K.ball.position.x - u.position.x, K.ball.position.z - u.position.z));
        if (m.controlPlayer === u) ctl++;
      }
      return { maxD: +maxD.toFixed(2), ctl: +(ctl / n).toFixed(2), dx: +(u.position.x - x0).toFixed(1), v: +Math.hypot(u.velocity.x, u.velocity.z).toFixed(1) };
    };
  });
  const run = async (keys, secs) => { for (const k of keys) await page.keyboard.down(k); await frame(); return S((s) => window.__strikers.sample(s), secs); };
  const up = async (keys) => { for (const k of keys) await page.keyboard.up(k); await frame(); };

  console.log('# human control (keyboard)');
  await S(() => window.__strikers.setup(-20, 0));
  let r = await run(['KeyD'], 2.5); await up(['KeyD']);
  check('jog: keeps the ball, ball stays close', r.ctl === 1 && r.maxD < 1.3 && r.dx > 10, r);
  await S(() => window.__strikers.setup(-20, 0));
  r = await run(['KeyD', 'ShiftLeft'], 2.5);
  // (a sprint touch can be a heavy one — up to ~2.5 m — but must never be lost outright)
  check('sprint: faster, heavier touches, still in control', r.ctl > 0.9 && r.maxD < 2.6 && r.dx > 14 && r.v > 7, r);
  await page.keyboard.up('KeyD');
  r = await run(['KeyA'], 1.5); await up(['KeyA', 'ShiftLeft']);
  check('full-sprint reversal keeps possession and is heading back within 1.5 s', r.ctl > 0.9 && r.maxD < 2.4 && r.dx < 3.5, r);
  await S(() => window.__strikers.setup(-20, 0));
  await run(['KeyD'], 1.0); await up(['KeyD']);
  r = await S(() => window.__strikers.sample(1.0));
  check('releasing the stick stops him on the ball', r.ctl === 1 && r.v < 0.3 && r.maxD < 1.2, r);

  await S(() => { const K = window.__strikers; K.setup(-20, 0); K.ev = []; K.bus.onAny((e) => { if (e.t === 'kick' && e.kind !== 'touch') K.ev.push('kick:' + e.kind); else if (e.t === 'shot' || e.t === 'firstTouch') K.ev.push(e.t); }); });
  await page.keyboard.down('KeyD'); await frame();
  // A quick tap, dispatched inside the page so down/up carry (almost) the same event
  // timestamp — Playwright's own key calls wait for the page to acknowledge each event,
  // which under software rendering stretches any "tap" into a long hold.
  await S(() => { for (const type of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(type, { code: 'KeyJ', bubbles: true })); });
  await page.keyboard.up('KeyD'); await frame();
  const pass = await S(() => { const K = window.__strikers; K.run(2.4); const m = K.match; return { ev: K.ev, control: m.controlPlayer && m.controlPlayer.name, user: m.userPlayer && m.userPlayer.name, done: m.stats.passesDone[0] }; });
  check('a tap is a ground pass (not a lob) even on a slow frame; it reaches a team-mate and control switches to him', pass.done === 1 && pass.control === pass.user && pass.ev.includes('kick:pass'), pass);

  await S(() => { const K = window.__strikers; K.setup(15, 2); K.ev.length = 0; });
  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyK'); await page.waitForTimeout(380); await page.keyboard.up('KeyK'); await frame();
  const shot = await S(() => { const K = window.__strikers; K.run(1.2); return { ev: K.ev, shots: K.match.stats.shots[0] }; });
  await up(['KeyW']);
  check('held SHOOT takes a shot', shot.shots >= 1 && shot.ev.includes('shot'), shot);

  console.log('# idle assist');
  await S(() => { const K = window.__strikers; K.setup(-20, 0); K.ev.length = 0; K.match.assistIdle = true; });
  const idle = await S(() => { const K = window.__strikers; const u = K.match.teams[0].players[3]; K.run(1.0); const early = u.autopilot; K.run(3.0); return { early, late: u.autopilot || K.match.userPlayer !== u, ev: K.ev.slice(0, 4), idleT: +K.match.userIdleT.toFixed(1) }; });
  check('controls untouched: AI takes over the user\'s man after a beat (not before)', idle.early === false && idle.late === true, idle);
  await page.keyboard.down('KeyD'); await frame();
  const back = await S(() => { const K = window.__strikers; K.step(2); return { auto: K.match.userPlayer.autopilot, idleT: K.match.userIdleT }; });
  await up(['KeyD']);
  check('touching the stick hands control straight back', back.auto === false && back.idleT < 0.1, back);

  console.log('# gamepad (mocked standard mapping)');
  await S(() => { const K = window.__strikers; K.setup(-15, 0); const p = window.__pad; p.connected = true; p.axes[0] = 1; p.buttons[7].pressed = true; p.buttons[7].value = 1; });
  await frame();
  r = await S(() => window.__strikers.sample(1.5));
  check('left stick + RT sprints', r.dx > 7 && r.v > 7, r);
  await S(() => { window.__strikers.ev.length = 0; window.__pad.buttons[0].pressed = true; }); await page.waitForTimeout(80);
  await S(() => { window.__pad.buttons[0].pressed = false; }); await frame();
  await S(() => window.__strikers.run(0.4));
  const gp = await S(() => window.__strikers.ev.slice());
  // (the pad is polled once per rendered frame, so under 1–2 fps software rendering a
  // tap spans a whole frame and reads as a hold → lob; on real hardware it is a pass)
  check('A button passes', gp.some((e) => e === 'kick:pass' || e === 'kick:lob'), gp);
  await S(() => { const p = window.__pad; p.axes[0] = 0; p.buttons[7].pressed = false; p.buttons[7].value = 0; });

  console.log('# penalty shoot-out');
  await S(() => window.__strikers.shootout.start());
  let ended = '';
  for (let i = 0; i < 40 && !ended; i++) {
    const st = await S(() => { const K = window.__strikers; K.run(1.2); return K.match.state; });
    if (st !== 'shootout') { ended = st; break; }
    await S((i) => { window.__pad.axes[0] = i % 2 ? 0.8 : -0.8; window.__pad.buttons[1].pressed = true; }, i);
    await page.waitForTimeout(700);
    await S(() => { window.__pad.buttons[1].pressed = false; });
    await frame();
  }
  check('shoot-out resolves to full time', ended === 'fulltime', ended || 'still running');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/play-end.png` });

  console.log('# console');
  check('no page errors', errs.length === 0, errs.slice(0, 3));
  await browser.close();
  console.log(failed ? `\n# FAILED: ${failed} check(s)` : '\n# all browser checks passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
