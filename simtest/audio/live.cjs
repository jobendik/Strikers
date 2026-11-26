// Live-page check: real AudioContext, events before/after resume, mute/quality/volume API, no console errors.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const results = {};
  const allEvents = `[
    { t: 'kick', kind: 'pass', power: 14, team: 0, human: true, x: 3, y: 0, z: 1 },
    { t: 'kick', kind: 'shot', power: 31, team: 0, human: true, x: 18, y: 0, z: 1 },
    { t: 'kick', kind: 'touch', power: 6, team: 1, human: false, x: -3, y: 0, z: 1 },
    { t: 'kick', kind: 'chip', power: 13, team: 0, human: true, x: 3, y: 0, z: 1 },
    { t: 'kick', kind: 'bogus', power: NaN, team: 0, human: true, x: NaN, y: 0, z: undefined },
    { t: 'shot', team: 0, power: 31, xg: 0.4, human: true, x: 18, y: 0, z: 1 },
    { t: 'bounce', speed: 9, x: 0, y: 0, z: 0 }, { t: 'post', speed: 24, bar: true, x: 30, y: 2.4, z: 0 },
    { t: 'net', side: 1, speed: 22, vx: 20, vy: 0, vz: 0, goal: true, x: 30, y: 1, z: 0 },
    { t: 'goal', team: 0, big: true, scorer: 'A', assist: null, score: [1, 0], lastGasp: false },
    { t: 'goal', team: 1, big: false, scorer: 'B', assist: null, score: [1, 1], lastGasp: false },
    { t: 'save', team: 1, parry: true, diving: true, speed: 25, x: 29, y: 1, z: 0 }, { t: 'nearmiss', team: 0, x: 30, y: 1, z: 5 },
    { t: 'tackle', team: 0, slide: true, human: true, x: 0, y: 0, z: 0 }, { t: 'block', team: 1, speed: 20, x: 0, y: 0, z: 0 },
    { t: 'collide', force: 8, x: 0, y: 0, z: 0 }, { t: 'firstTouch', team: 0, quality: 0.1, human: true, x: 0, y: 0, z: 0 },
    { t: 'slide', team: 0, x: 0, y: 0, z: 0 }, { t: 'dive', team: 1, x: 29, y: 0, z: 0 },
    { t: 'foul', team: 1, card: 1, player: 'x' }, { t: 'offside', team: 0, player: 'y' },
    { t: 'setpiece', kind: 'corner', team: 0, x: 30, y: 0, z: 20 }, { t: 'turnover', team: 1 }, { t: 'toast', text: 'hi' },
    ...['kickoff', 'half', 'full', 'foul', 'goal', 'offside', 'restart', 'nonsense'].map((kind) => ({ t: 'whistle', kind })),
    { t: 'unknown-event' },
  ]`;

  // ---- A: the real game page ----
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
    await page.goto('http://localhost:5183/strikers/');
    await page.waitForTimeout(7000);
    const baselineErrors = errors.slice();
    results.A = await page.evaluate(async (evSrc) => {
      const bus = await import('/strikers/src/core/bus.ts');
      const { Audio } = await import('/strikers/src/core/audio.ts');
      const events = eval(evSrc);
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = {};
      let threw = 0;
      const fire = () => { for (const e of events) { try { bus.emit(e); } catch (err) { threw++; out.lastThrow = String(err); } } };
      out.before = Audio.debug().state;
      // 1) before resume(): nothing may throw, no context may be created
      fire(); for (let i = 0; i < 30; i++) Audio.update(1 / 60);
      for (const k of ['kick', 'pass', 'tackle', 'save', 'whistle', 'goal', 'post', 'bounce', 'header', 'chip', 'slide']) Audio[k]();
      Audio.setCrowd(0.5); Audio.roar(true); Audio.roar(); Audio.ui('click'); Audio.setVolume('crowd', 0.8); Audio.setQuality('full'); Audio.setMute(false);
      out.afterEventsNoResume = Audio.debug().state;
      out.legacyAreSilent = Audio.debug().stats === null;
      // 2) resume (twice — must be idempotent)
      Audio.resume(); Audio.resume();
      await sleep(4000); // let the textures bake
      out.afterResume = Audio.debug().state;
      const s0 = { ...Audio.debug().stats };
      // legacy calls must stay silent with a live context
      for (const k of ['kick', 'pass', 'tackle', 'save', 'whistle', 'goal', 'post', 'bounce', 'header', 'chip', 'slide']) Audio[k]();
      Audio.setCrowd(1); Audio.roar(true);
      out.legacyStartedVoices = Audio.debug().stats.started - s0.started;
      // 3) a live match pulse + every event type (incl. garbage)
      Object.assign(bus.pulse, { live: true, state: 'play', timeLeft: 100, half: 2, ballX: 5, threat: [0.4, 0.1] });
      fire();
      await sleep(1500);
      const s1 = { ...Audio.debug().stats };
      out.busStartedVoices = s1.started - s0.started;
      out.statsAfterBurst = s1;
      out.emotion = { ...Audio.debug().emotion };
      for (const k of ['click', 'confirm', 'back', 'reward', 'error', 'nope']) Audio.ui(k);
      out.uiStarted = Audio.debug().stats.started - s1.started;
      // 4) mute → context suspends after a moment; events while muted create no voices; unmute → running
      Audio.setMute(true); const sm = Audio.debug().stats.started; fire(); for (let i = 0; i < 10; i++) Audio.update(0.1); await sleep(600);
      out.mutedState = Audio.debug().state; out.mutedStarted = Audio.debug().stats.started - sm;
      Audio.setMute(false); await sleep(500); out.unmutedState = Audio.debug().state;
      // 5) quality + volumes + speech hook
      Audio.setQuality('lite'); await sleep(300); out.liteStatic = Audio.debug().stats.staticNodes;
      Audio.setQuality('full'); await sleep(300); out.fullStatic = Audio.debug().stats.staticNodes;
      for (const b of ['master', 'sfx', 'crowd', 'ui', 'commentary']) { Audio.setVolume(b, 0.5); Audio.setVolume(b, NaN); Audio.setVolume(b, 1); }
      out.volume = Audio.getVolume('crowd');
      out.sayWhileOff = Audio.say('Goal!');
      out.speechSupported = Audio.debug().speech;
      fire(); await sleep(3000);
      out.final = { state: Audio.debug().state, stats: { ...Audio.debug().stats } };
      out.threw = threw;
      Object.assign(bus.pulse, { live: false, state: 'menu' });
      return out;
    }, allEvents);
    console.error('A done');
    results.A.consoleErrorsAtLoad = baselineErrors;
    results.A.consoleErrorsDuringTest = errors.slice(baselineErrors.length);
    await page.close();
  }

  // ---- B: no AudioContext at all (old browser / locked-down webview) ----
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
    await page.addInitScript(() => { delete window.AudioContext; delete window.webkitAudioContext; delete window.OfflineAudioContext; delete window.webkitOfflineAudioContext; window.AudioContext = undefined; window.OfflineAudioContext = undefined; try { delete window.speechSynthesis; } catch {} });
    await page.route('**/strikers/blank', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>x</body></html>' }));
    await page.goto('http://localhost:5183/strikers/blank');
    results.B = await page.evaluate(async (evSrc) => {
      const bus = await import('/strikers/src/core/bus.ts');
      const { Audio } = await import('/strikers/src/core/audio.ts');
      const events = eval(evSrc); let threw = 0;
      try { Audio.resume(); Audio.resume(); for (const e of events) bus.emit(e); for (let i = 0; i < 60; i++) Audio.update(1 / 60); Audio.setMute(true); Audio.setMute(false); Audio.ui('click'); Audio.setQuality('lite'); Audio.setVolume('master', 0.3); Audio.setCommentary(true); Audio.say('x'); } catch (e) { threw++; }
      return { hasAC: typeof window.AudioContext, state: Audio.debug().state, threw };
    }, allEvents);
    console.error('B done');
    results.B.consoleErrors = errors;
    await page.close();
  }

  // ---- C: autoplay blocked (context stays suspended until a gesture) ----
  {
    const b2 = await chromium.launch({ args: ['--autoplay-policy=user-gesture-required'] });
    const page = await b2.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
    await page.route('**/strikers/blank', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><button id="b" style="width:200px;height:200px">go</button></body></html>' }));
    await page.goto('http://localhost:5183/strikers/blank');
    results.C = await page.evaluate(async (evSrc) => {
      const bus = await import('/strikers/src/core/bus.ts');
      const { Audio } = await import('/strikers/src/core/audio.ts');
      window.__A = Audio; window.__bus = bus; window.__events = eval(evSrc);
      Audio.resume(); // NOT in a gesture → suspended
      await new Promise((r) => setTimeout(r, 500));
      const st = Audio.debug().state;
      const s0 = Audio.debug().stats ? Audio.debug().stats.started : -1;
      for (const e of window.__events) bus.emit(e);
      for (let i = 0; i < 60; i++) Audio.update(1 / 60);
      document.getElementById('b').addEventListener('click', () => Audio.resume());
      return { stateBlocked: st, voicesQueuedWhileSuspended: Audio.debug().stats ? Audio.debug().stats.started - s0 : null };
    }, allEvents);
    await page.click('#b');
    await page.waitForTimeout(800);
    Object.assign(results.C, await page.evaluate(async () => {
      const st = window.__A.debug().state; const s0 = window.__A.debug().stats.started;
      Object.assign(window.__bus.pulse, { live: true, state: 'play', timeLeft: 100 });
      for (const e of window.__events) window.__bus.emit(e);
      return { stateAfterGesture: st, voicesAfterGesture: window.__A.debug().stats.started - s0 };
    }));
    results.C.consoleErrors = errors;
    await b2.close();
  }
  console.log(JSON.stringify(results, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(2); });
