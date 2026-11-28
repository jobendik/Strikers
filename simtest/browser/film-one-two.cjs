// Find a forward one-two (A passes to B, runs on >= 4 m, B returns it to A) in a live
// AI-v-AI match and film the seconds before it from the replay recording
// (window.__strikers.film) — nothing is re-simulated.
//
//   npx vite --port 5173 --strictPort &
//   NODE_PATH=$(npm root -g) node simtest/browser/film-one-two.cjs [skip] [outDir]
//
// `skip` = how many earlier one-twos to pass over. Writes film-1.png … film-6.png.
// Note: the fixture is random per page load, so two runs film different matches.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));
  await page.goto('http://localhost:5173/strikers/', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__strikers, null, { timeout: 90000 });
  await page.evaluate(() => { document.getElementById('btnIntroGo')?.click(); document.getElementById('btnPlay').click(); });
  await page.waitForTimeout(600);
  await page.evaluate(async () => { const K = window.__strikers; K.loop.manual = true; K.camera.set('broadcast'); K.match.assistIdle = true; K.match.userIdleT = 99; const q = await import('/strikers/src/rendering/quality.ts'); q.applyQualityTier('standard'); K.reseed(123); });
  const skip = Number(process.argv[2] || 0);
  const out = process.argv[3] || '.';
  const found = await page.evaluate((skip) => {
    const K = window.__strikers; const m = K.match;
    let a = null, aT = -9, aX = 0, prev = null, n = 0, want = null, wantT = 0;
    for (let i = 0; i < 120 * 170; i++) {
      K.step(1); m.userIdleT = 99; K.skipGoalReplay();
      const pp = m.pendingPass;
      if (pp && pp !== prev) {
        const r = m.receivingPlayer;
        if (r && a === r && K.sim.elapsed - aT < 3.2 && (r.position.x - aX) * r.team.side > 4) { want = { giver: r.name, via: pp.name, team: pp.team.short, t: K.sim.elapsed }; wantT = K.sim.elapsed; }
        a = pp; aT = K.sim.elapsed; aX = pp.position.x;
      }
      prev = pp;
      // the return ball has been received by the original passer: done (after 0.7 s more)
      if (want && m.controlPlayer && m.controlPlayer.name === want.giver && K.sim.elapsed - wantT > 0.2) {
        if (n++ >= skip) { K.step(84); return { ...want, end: +K.sim.elapsed.toFixed(2), rec: K.film.seconds() }; }
        want = null;
      }
      if (want && K.sim.elapsed - wantT > 3) want = null;
    }
    return null;
  }, skip);
  console.log(JSON.stringify(found));
  if (!found) { await browser.close(); return; }
  const shots = [3.3, 2.8, 2.3, 1.8, 1.3, 0.6];
  for (let i = 0; i < shots.length; i++) {
    await page.evaluate((s) => window.__strikers.film.show(s), Math.min(shots[i], found.rec - 0.05));
    await page.waitForTimeout(2600);
    await page.screenshot({ path: `${out}/film-${i + 1}.png` });
  }
  await page.evaluate(() => window.__strikers.film.live());
  console.log(JSON.stringify(errs));
  await browser.close();
})();
