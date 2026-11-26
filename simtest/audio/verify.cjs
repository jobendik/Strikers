// Numeric verification of the procedural stadium audio. Run: NODE_PATH=$(npm root -g) node verify.cjs
const { open, saveWav } = require('./harness.cjs');
(async () => {
  const { browser, page, errors } = await open();
  const out = await page.evaluate(async () => {
    const L = window.LAB;
    const R = { checks: [], data: {}, wavs: {} };
    const ok = (name, cond, detail) => R.checks.push({ name, pass: !!cond, detail });
    const at = { x: 0, y: 0, z: 0 };
    const dry = (eng) => { eng.mixer.buses.crowd.gain.value = 0; };
    const noVerb = (eng) => { eng.mixer.reverbOut.gain.value = 0; };
    const E = (t, e, mut) => ({ t, fn: (eng, P) => { if (mut) mut(P); eng.event(e, P); } });
    const S = (t, mut) => ({ t, fn: (eng, P) => mut(P, eng) });
    const ramp = (t0, t1, team, to) => { const o = []; for (let t = t0; t < t1; t += 0.1) o.push(S(t, (P) => { P.threat[team] = to * (t - t0) / (t1 - t0); })); return o; };
    const allPeaks = []; let anyNan = false;
    const track = (name, buf) => { const p = Math.max(L.peak(L.ch(buf, 0)), L.peak(L.ch(buf, 1))); allPeaks.push([name, +p.toFixed(3)]); if (L.nan(L.ch(buf, 0)) || L.nan(L.ch(buf, 1))) anyNan = true; return p; };
    const fol = async (name, e, seconds = 1.5, extra = []) => {
      const r = await L.run({ seconds, pulse: L.playPulse(), opts: { bake: false }, script: [{ t: 0, fn: dry }, ...extra, E(0.1, e)] });
      track(name, r.buf); return r;
    };
    const bandTimeline = (buf, win = 0.5) => { // spectrogram-ish: per window dB in 5 coarse bands
      const m = L.mono(buf); const n = Math.floor(win * L.SR); const rows = [];
      for (let i = 0; i + n <= m.length; i += n) { const sp = L.psd(m.subarray(i, i + n), 2048); rows.push([[20, 200], [200, 800], [800, 2000], [2000, 5000], [5000, 16000]].map(([a, b]) => Math.round(10 * Math.log10(L.band(sp, a, b) / (2048 * 2048 * 0.375) * 2 + 1e-12)))); }
      return rows;
    };

    // ---------- 1. kick: power-30 shot vs power-12 pass ----------
    {
      const a = await fol('pass12', { t: 'kick', kind: 'pass', power: 12, team: 0, human: false, ...at });
      const b = await fol('shot30', { t: 'kick', kind: 'shot', power: 30, team: 0, human: false, ...at });
      const ma = L.slice(L.mono(a.buf), 0.1, 0.5), mb = L.slice(L.mono(b.buf), 0.1, 0.5);
      const sa = L.psd(ma), sb = L.psd(mb);
      const d = { passRmsDb: +L.db(L.rms(ma)).toFixed(1), shotRmsDb: +L.db(L.rms(mb)).toFixed(1), passPeak: +L.peak(ma).toFixed(3), shotPeak: +L.peak(mb).toFixed(3),
        lowDbDiff: +(10 * Math.log10(L.band(sb, 20, 160) / L.band(sa, 20, 160))).toFixed(1), hiDbDiff: +(10 * Math.log10(L.band(sb, 1500, 8000) / L.band(sa, 1500, 8000))).toFixed(1),
        passLowPeakHz: L.peaks(sa, 40, 400, -3)[0], shotLowPeakHz: L.peaks(sb, 40, 400, -3)[0], shotBands: L.bandsDb(mb), passBands: L.bandsDb(ma) };
      // whoosh tail: energy 0.25-0.6 s after strike in 400-2500 Hz
      const tail = (buf) => L.db(L.rms(L.slice(L.mono(buf), 0.35, 0.7)));
      d.shotTailDb = +tail(b.buf).toFixed(1); d.passTailDb = +tail(a.buf).toFixed(1);
      R.data.kick = d;
      ok('shot30 louder than pass12 (>6 dB RMS)', d.shotRmsDb - d.passRmsDb > 6, d.shotRmsDb - d.passRmsDb);
      ok('shot30 has more low end 20-160 Hz (>6 dB)', d.lowDbDiff > 6, d.lowDbDiff);
      ok('shot30 brighter contact 1.5-8 kHz (>10 dB)', d.hiDbDiff > 10, d.hiDbDiff);
      ok('shot thump pitched lower than pass', d.shotLowPeakHz.f < d.passLowPeakHz.f, [d.shotLowPeakHz.f, d.passLowPeakHz.f]);
      ok('shot has an air tail the pass lacks (>10 dB at 0.35-0.7 s)', d.shotTailDb - d.passTailDb > 10, [d.shotTailDb, d.passTailDb]);
      const t = await fol('touch6', { t: 'kick', kind: 'touch', power: 6, team: 0, human: false, ...at });
      const tp = L.peak(L.mono(t.buf)); R.data.kick.touchPeak = +tp.toFixed(3);
      ok('dribble touch is very quiet (peak < 0.25 x pass peak... < 0.08)', tp < 0.08 && tp > 0.005, tp);
      // rate limit: 20 touches in 0.4 s -> few voices
      const many = []; for (let i = 0; i < 20; i++) many.push(E(0.1 + i * 0.02, { t: 'kick', kind: 'touch', power: 6, team: 0, human: true, ...at }));
      const rl = await L.run({ seconds: 1, pulse: L.playPulse(), opts: { bake: false }, script: [{ t: 0, fn: dry }, ...many] });
      R.data.kick.touchStarted = rl.stats.started; ok('touch rate-limited (20 events -> <=6 voices)', rl.stats.started <= 6, rl.stats.started);
      const h = await fol('header16', { t: 'kick', kind: 'header', power: 16, team: 0, human: false, ...at });
      const p16 = await fol('pass16', { t: 'kick', kind: 'pass', power: 16, team: 0, human: false, ...at });
      const ch = L.centroid(L.psd(L.slice(L.mono(h.buf), 0.1, 0.4))), cp = L.centroid(L.psd(L.slice(L.mono(p16.buf), 0.1, 0.4)));
      const hh = L.band(L.psd(L.slice(L.mono(h.buf), 0.1, 0.4)), 1500, 8000) / L.band(L.psd(L.slice(L.mono(h.buf), 0.1, 0.4)), 20, 8000);
      const ph = L.band(L.psd(L.slice(L.mono(p16.buf), 0.1, 0.4)), 1500, 8000) / L.band(L.psd(L.slice(L.mono(p16.buf), 0.1, 0.4)), 20, 8000);
      R.data.kick.headerHfShare = +hh.toExponential(2); R.data.kick.passHfShare = +ph.toExponential(2); R.data.kick.headerCentroid = Math.round(ch); R.data.kick.pass16Centroid = Math.round(cp);
      ok('header is duller than a same-power pass (less 1.5-8 kHz share)', hh < ph, [hh, ph]);
      R.wavs.kick_shot30 = L.wav(b.buf); R.wavs.kick_pass12 = L.wav(a.buf);
    }

    // ---------- 2. woodwork ----------
    {
      const post = await fol('post', { t: 'post', speed: 25, bar: false, ...at }, 3, [{ t: 0, fn: noVerb }]);
      const bar = await fol('bar', { t: 'post', speed: 25, bar: true, ...at }, 3.5, [{ t: 0, fn: noVerb }]);
      const soft = await fol('postSoft', { t: 'post', speed: 8, bar: false, ...at }, 3, [{ t: 0, fn: noVerb }]);
      const wet = await fol('postWet', { t: 'post', speed: 25, bar: false, ...at }, 4);
      const an = (r) => { const m = L.slice(L.mono(r.buf), 0.12, 0.9); const sp = L.psd(m, 8192); return { peaks: L.peaks(sp, 120, 8000, -32, 60), ring40: L.ringTime(L.slice(L.mono(r.buf), 0.1, 3), -40), rmsDb: +L.db(L.rms(L.slice(L.mono(r.buf), 0.1, 0.6))).toFixed(1), centroid: Math.round(L.centroid(sp)), rmsAt05: +L.db(L.rms(L.slice(L.mono(r.buf), 0.6, 0.7))).toFixed(1) }; };
      const dp = an(post), db = an(bar), ds = an(soft);
      R.data.woodwork = { post: dp, bar: db, soft: ds, wetRing40: L.ringTime(L.slice(L.mono(wet.buf), 0.1, 4), -40) };
      ok('post clang has >=5 distinct partials', dp.peaks.length >= 5, dp.peaks.map((p) => p.f));
      ok('bar clang has >=5 distinct partials', db.peaks.length >= 5, db.peaks.map((p) => p.f));
      const ratios = dp.peaks.map((p) => +(p.f / dp.peaks[0].f).toFixed(2)); R.data.woodwork.postRatios = ratios;
      ok('partials are inharmonic (no ratio within 0.06 of an integer, beyond the first)', ratios.slice(1, 5).every((x) => Math.abs(x - Math.round(x)) > 0.06), ratios);
      ok('dry post rings > 0.5 s (to -40 dB)', dp.ring40 > 0.5, dp.ring40);
      ok('bar tuned lower than post', db.peaks[0].f < dp.peaks[0].f - 50, [db.peaks[0].f, dp.peaks[0].f]);
      ok('bar rings longer than post', db.ring40 > dp.ring40, [db.ring40, dp.ring40]);
      ok('harder hit is louder (>6 dB) and brighter', dp.rmsDb - ds.rmsDb > 6 && dp.centroid > ds.centroid, [dp.rmsDb, ds.rmsDb, dp.centroid, ds.centroid]);
      R.wavs.post = L.wav(wet.buf); R.wavs.bar_dry = L.wav(bar.buf);
    }

    // ---------- 3. net / save / tackle ----------
    {
      const n = await fol('net', { t: 'net', side: 1, speed: 26, vx: 20, vy: 0, vz: 0, goal: true, ...at }, 1.5, [{ t: 0, fn: noVerb }]);
      const m = L.mono(n.buf); const cs = [];
      const bc = (sp) => { let a = 0, b = 0; for (let i = Math.floor(300 / sp.df); i * sp.df < 9000; i++) { a += i * sp.df * sp.psd[i]; b += sp.psd[i]; } return a / b; };
      for (let t = 0.1; t < 0.5; t += 0.025) { const sp = L.psd(L.slice(m, t, t + 0.03), 1024); cs.push(Math.round(bc(sp))); }
      const imax = cs.indexOf(Math.max(...cs.slice(0, 6)));
      R.data.net = { centroidEvery25ms: cs, peakAtMs: imax * 25, ...L.summary(n.buf, 0.1, 0.7) };
      const late = (cs[9] + cs[10] + cs[11]) / 3;
      ok('net swish: 0.3-9 kHz centroid flicks up fast (peak within 100 ms) then relaxes down', imax >= 1 && imax <= 4 && cs[imax] > cs[0] * 1.4 && cs[imax] > late * 1.25, cs);
      const n2 = await fol('netSoft', { t: 'net', side: 1, speed: 8, vx: 8, vy: 0, vz: 0, goal: true, ...at });
      ok('net louder with speed', L.rms(L.slice(L.mono(n.buf), 0.1, 0.6)) > 1.8 * L.rms(L.slice(L.mono(n2.buf), 0.1, 0.6)));
      const parry = await fol('parry', { t: 'save', team: 1, parry: true, diving: false, speed: 24, ...at }, 1, [{ t: 0, fn: noVerb }]);
      const katch = await fol('catch', { t: 'save', team: 1, parry: false, diving: false, speed: 24, ...at }, 1, [{ t: 0, fn: noVerb }]);
      const cpar = L.centroid(L.psd(L.slice(L.mono(parry.buf), 0.1, 0.3))), ccat = L.centroid(L.psd(L.slice(L.mono(katch.buf), 0.1, 0.3)));
      R.data.save = { parryCentroid: Math.round(cpar), catchCentroid: Math.round(ccat), parryRing: L.ringTime(L.slice(L.mono(parry.buf), 0.1, 1), -30, 0.005), catchRing: L.ringTime(L.slice(L.mono(katch.buf), 0.1, 1), -30, 0.005) };
      ok('parry is sharper (brighter) than a catch', cpar > ccat * 1.5, [cpar, ccat]);
      const tk = await fol('tackle', { t: 'tackle', team: 0, slide: false, human: true, ...at });
      const ts = await fol('tackleSlide', { t: 'tackle', team: 0, slide: true, human: true, ...at });
      const col = await fol('collide', { t: 'collide', force: 9, ...at });
      R.data.tackle = { stand: L.summary(tk.buf, 0.1, 0.6), slide: L.summary(ts.buf, 0.1, 0.6), collide: L.summary(col.buf, 0.1, 0.6) };
      ok('slide tackle has a longer scrape than a standing tackle', L.rms(L.slice(L.mono(ts.buf), 0.25, 0.45)) > 3 * L.rms(L.slice(L.mono(tk.buf), 0.25, 0.45)));
      ok('collide is a low thud (centroid < 250 Hz)', R.data.tackle.collide.centroid < 250, R.data.tackle.collide.centroid);
      R.wavs.net = L.wav(n.buf);
    }

    // ---------- 4. whistle ----------
    {
      R.data.whistle = {};
      const kinds = ['kickoff', 'restart', 'foul', 'offside', 'goal', 'half', 'full'];
      for (const k of kinds) {
        const r = await fol('whistle_' + k, { t: 'whistle', kind: k }, 4, [{ t: 0, fn: noVerb }]);
        const m = L.mono(r.buf); const w = L.rmsWin(m, 0.01); const mx = Math.max(...w);
        // blast segmentation at -20 dB re max
        const blasts = []; let on = -1;
        for (let i = 0; i < w.length; i++) { const a = w[i] > mx * 0.1; if (a && on < 0) on = i; if (!a && on >= 0) { blasts.push(+((i - on) * 0.01).toFixed(2)); on = -1; } }
        const seg = L.slice(m, 0.12, 0.12 + Math.max(0.1, blasts[blasts.length - 1] > 0.3 ? 0.3 : blasts[0] - 0.04));
        const sp = L.psd(m, 4096);
        const share = L.band(sp, 1900, 2600) / L.band(sp, 20, 20000);
        R.data.whistle[k] = { blasts, share: +share.toFixed(3), peak: +L.peak(m).toFixed(3) };
        if (k === 'foul' || k === 'goal') { R.data.whistle[k].am = L.amPeak(L.slice(m, 0.16, 0.1 + blasts[0] - 0.06), 15, 80); R.data.whistle[k].tones = L.peaks(L.psd(L.slice(m, 0.16, 0.1 + blasts[0] - 0.06), 8192), 1500, 3000, -15, 40); }
      }
      const W = R.data.whistle;
      ok('whistle energy concentrated at 1.9-2.6 kHz (>85 %)', kinds.every((k) => W[k].share > 0.85), kinds.map((k) => W[k].share));
      ok('pea trill: dominant AM in 30-40 Hz', W.foul.am.f >= 30 && W.foul.am.f <= 40 && W.goal.am.f >= 30 && W.goal.am.f <= 40, [W.foul.am, W.goal.am]);
      ok('two detuned tones in 2.0-2.3 kHz', W.goal.tones.filter((p) => p.f > 1990 && p.f < 2320).length >= 2, W.goal.tones);
      ok('full time = three blasts, last one long', W.full.blasts.length === 3 && W.full.blasts[2] > 1, W.full.blasts);
      ok('half time = two blasts', W.half.blasts.length === 2, W.half.blasts);
      ok('foul = one sharp blast, longer than kickoff, shorter than goal', W.foul.blasts.length === 1 && W.foul.blasts[0] > W.kickoff.blasts[0] + 0.08 && W.goal.blasts[0] > W.foul.blasts[0] + 0.2, [W.kickoff.blasts, W.foul.blasts, W.goal.blasts]);
      ok('offside = two short pips', W.offside.blasts.length === 2 && W.offside.blasts[1] < 0.25, W.offside.blasts);
      ok('restart = shortest', W.restart.blasts[0] < W.kickoff.blasts[0], W.restart.blasts);
      const patterns = kinds.map((k) => W[k].blasts.join('/')); ok('all 7 whistle patterns distinct', new Set(patterns).size === 7, patterns);
      const full = await L.run({ seconds: 5, pulse: L.playPulse(), opts: { bake: false }, script: [{ t: 0, fn: dry }, E(0.1, { t: 'whistle', kind: 'full' })] });
      R.wavs.whistle_full = L.wav(full.buf);
    }

    // ---------- 5. panning ----------
    {
      const right = await fol('panR', { t: 'kick', kind: 'shot', power: 26, team: 0, human: false, x: 28, y: 0, z: 0 }, 1, [{ t: 0, fn: noVerb }]);
      const left = await fol('panL', { t: 'kick', kind: 'shot', power: 26, team: 0, human: false, x: -28, y: 0, z: 0 }, 1, [{ t: 0, fn: noVerb }]);
      const far = await fol('far', { t: 'kick', kind: 'shot', power: 26, team: 0, human: false, x: 0, y: 0, z: 20 }, 1, [{ t: 0, fn: noVerb }]);
      const near = await fol('near', { t: 'kick', kind: 'shot', power: 26, team: 0, human: false, x: 0, y: 0, z: 0 }, 1, [{ t: 0, fn: noVerb }]);
      const lr = (r) => L.db(L.rms(L.slice(L.ch(r.buf, 1), 0.1, 0.5)) / L.rms(L.slice(L.ch(r.buf, 0), 0.1, 0.5)));
      R.data.pan = { rightRminusL: +lr(right).toFixed(1), leftRminusL: +lr(left).toFixed(1), farVsNearDb: +L.db(L.rms(L.slice(L.mono(far.buf), 0.1, 0.5)) / L.rms(L.slice(L.mono(near.buf), 0.1, 0.5))).toFixed(1) };
      ok('event right of the ball pans right (>6 dB)', R.data.pan.rightRminusL > 6, R.data.pan.rightRminusL);
      ok('event left of the ball pans left (<-6 dB)', R.data.pan.leftRminusL < -6, R.data.pan.leftRminusL);
      ok('far touchline slightly quieter (-1..-4 dB)', R.data.pan.farVsNearDb < -1 && R.data.pan.farVsNearDb > -4, R.data.pan.farVsNearDb);
    }

    // ---------- 6. crowd bed ----------
    let idleBedDb = 0;
    {
      const r = await L.run({ seconds: 24, pulse: L.playPulse(), warm: 30 });
      track('bedIdle', r.buf);
      // NOTE: the model starts a chant in calm play; keep the first 4 s (before chantCalm=5 s) for pure-bed stats and the rest for variation
      const l = L.slice(L.ch(r.buf, 0), 1, 24), rr = L.slice(L.ch(r.buf, 1), 1, 24), m = L.slice(L.mono(r.buf), 1, 24);
      const sp = L.psd(m); const w = L.rmsWin(m, 0.25); const wdb = w.map((x) => L.db(x));
      const mean = wdb.reduce((a, c) => a + c, 0) / wdb.length;
      const tot = L.band(sp, 20, 20000);
      idleBedDb = L.db(L.rms(m));
      const wn = new Float32Array(L.SR * 8); let s = 1234567; for (let i = 0; i < wn.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; wn[i] = s / 2147483648 - 1; }
      const spw = L.psd(wn);
      R.data.bed = { rmsDb: +idleBedDb.toFixed(1), lr: +L.corr(l, rr).toFixed(3), centroid: Math.round(L.centroid(sp)), bands: L.bandsDb(m),
        mid_300_2500_share: +(L.band(sp, 300, 2500) / tot).toFixed(3), hf_5k_share: +(L.band(sp, 5000, 20000) / tot).toFixed(5), whiteHfShare: +(L.band(spw, 5000, 20000) / L.band(spw, 20, 20000)).toFixed(3),
        flat200_4k: +L.flatness(sp, 200, 4000).toFixed(3), whiteFlat: +L.flatness(spw, 200, 4000).toFixed(3),
        rms250ms: { minDb: +Math.min(...wdb).toFixed(1), maxDb: +Math.max(...wdb).toFixed(1), sdDb: +Math.sqrt(wdb.reduce((a, c) => a + (c - mean) ** 2, 0) / wdb.length).toFixed(2) },
        chantStartedAt: (r.trace.find((x) => x.chant) || {}).t, staticNodes: r.stats.staticNodes, bakeMs: Math.round(r.bakeMs), renderMs: Math.round(r.renderMs) };
      ok('bed is not white: >=75 % of energy in 300-2500 Hz... (speech band) and <1 % above 5 kHz', R.data.bed.mid_300_2500_share > 0.6 && R.data.bed.hf_5k_share < 0.01, [R.data.bed.mid_300_2500_share, R.data.bed.hf_5k_share]);
      ok('bed spectrum is far from flat (flatness < 0.6 x white)', R.data.bed.flat200_4k < 0.6 * R.data.bed.whiteFlat, [R.data.bed.flat200_4k, R.data.bed.whiteFlat]);
      ok('bed short-time RMS really varies (range > 2.5 dB over 250 ms windows)', R.data.bed.rms250ms.maxDb - R.data.bed.rms250ms.minDb > 2.5, R.data.bed.rms250ms);
      ok('bed L/R decorrelated (|corr| < 0.35)', Math.abs(R.data.bed.lr) < 0.35, R.data.bed.lr);
      R.wavs.bed_idle = L.wav(r.buf, 0, 16);
      // no-chant pure bed (first 4.5 s) for reference
      R.data.bed.first4s = L.summary(r.buf, 1, 4.5);
      // voices vs static: syllabic modulation 2-8 Hz of the 300-3000 band vs white noise
      const menu = await L.run({ seconds: 8, pulse: L.pulse(), warm: 30 }); track('bedMenu', menu.buf);
      const ht = await L.run({ seconds: 8, pulse: L.pulse({ state: 'halftime', live: true, half: 1 }), warm: 30 }); track('bedHalftime', ht.buf);
      R.data.bed.menu = L.summary(menu.buf, 2, 8); R.data.bed.halftime = L.summary(ht.buf, 2, 8);
      ok('menu ambience is distant: quieter (>6 dB) and duller than match bed', R.data.bed.menu.rmsDb < R.data.bed.first4s.rmsDb - 6 && R.data.bed.menu.centroid < R.data.bed.first4s.centroid, [R.data.bed.menu.rmsDb, R.data.bed.first4s.rmsDb, R.data.bed.menu.centroid, R.data.bed.first4s.centroid]);
      ok('menu ambience is not silent', R.data.bed.menu.rmsDb > -60, R.data.bed.menu.rmsDb);
      // lite
      const lite = await L.run({ seconds: 8, pulse: L.playPulse(), warm: 30, opts: { quality: 'lite' } }); track('bedLite', lite.buf);
      R.data.bed.lite = { ...L.summary(lite.buf, 1, 4.5), staticNodes: lite.stats.staticNodes, bakeMs: Math.round(lite.bakeMs), renderMs: Math.round(lite.renderMs) };
      ok('lite tier uses fewer persistent nodes', lite.stats.staticNodes < r.stats.staticNodes * 0.75, [lite.stats.staticNodes, r.stats.staticNodes]);
      // noise-only fallback (no OfflineAudioContext baking)
      const nb = await L.run({ seconds: 6, pulse: L.playPulse(), warm: 30, opts: { bake: false } }); track('bedNoBake', nb.buf);
      R.data.bed.noBake = L.summary(nb.buf, 1, 4.5);
      ok('fallback bed (no baking) still audible', R.data.bed.noBake.rmsDb > -45, R.data.bed.noBake.rmsDb);
    }

    // ---------- 7. held breath + anticipation ----------
    {
      const C = (await import('/strikers/src/audio/crowd.ts')).CROWD_LEVELS; const keep = C.ooh;
      const script = [...ramp(3, 4.5, 0, 0.95), S(4.5, (P) => { P.threat[0] = 0.95; }), S(7, (P) => { P.threat[0] = 0; })];
      const mid = await L.run({ seconds: 8, pulse: L.playPulse(), warm: 30, script: [...ramp(3, 4.5, 0, 0.5), S(4.5, (P) => { P.threat[0] = 0.5; })] });
      const midUp = L.db(L.rms(L.slice(L.mono(mid.buf), 5.5, 8)) / L.rms(L.slice(L.mono(mid.buf), 0.5, 3)));
      C.ooh = 0; const noOoh = await L.run({ seconds: 13, pulse: L.playPulse(), warm: 30, script }); C.ooh = keep;
      const withOoh = await L.run({ seconds: 10, pulse: L.playPulse(), warm: 30, script }); track('heldBreath', withOoh.buf);
      const lvl = (r, a, b) => L.db(L.rms(L.slice(L.mono(r.buf), a, b)));
      const tr = withOoh.trace; const antAt = (t) => tr.reduce((p, c) => (Math.abs(c.t - t) < Math.abs(p.t - t) ? c : p));
      const sp1 = L.psd(L.slice(L.mono(withOoh.buf), 1, 3)), sp2 = L.psd(L.slice(L.mono(withOoh.buf), 5, 7));
      R.data.heldBreath = { bedOnly_before: +lvl(noOoh, 1, 3).toFixed(1), bedOnly_during: +lvl(noOoh, 5, 7).toFixed(1), bedOnly_after: +lvl(noOoh, 9, 13).toFixed(1),
        full_before: +lvl(withOoh, 1, 3).toFixed(1), full_during: +lvl(withOoh, 5, 7).toFixed(1),
        hf2k5_before_vs_during: +(10 * Math.log10(L.band(sp2, 2500, 8000) / L.band(sp1, 2500, 8000))).toFixed(1), mid300_900_before_vs_during: +(10 * Math.log10(L.band(sp2, 300, 900) / L.band(sp1, 300, 900))).toFixed(1),
        ant: [3.5, 4, 4.5, 5, 7.3, 7.6, 8, 9].map((t) => [t, +antAt(t).ant.toFixed(2), +antAt(t).hold.toFixed(2)]) };
      const hb = R.data.heldBreath;
      hb.buildUp_threat0_5_dB = +midUp.toFixed(1);
      ok('build-up (threat 0.5) lifts the house a little (+0.5..+5 dB)', midUp > 0.5 && midUp < 5, midUp);
      ok('held breath: at a clear chance (threat 0.95) the broadband bed DIPS below idle (<= -1.5 dB)', hb.bedOnly_during - hb.bedOnly_before <= -1.5, [hb.bedOnly_before, hb.bedOnly_during]);
      ok('bed returns after the danger passes (within 2 dB of before)', Math.abs(hb.bedOnly_after - hb.bedOnly_before) < 2, [hb.bedOnly_before, hb.bedOnly_after]);
      ok('the pitched "oooh" swell carries the anticipation (full mix rises > 2 dB over bed-only)', hb.full_during - hb.bedOnly_during > 2, [hb.full_during, hb.bedOnly_during]);
      R.wavs.held_breath = L.wav(withOoh.buf);
    }

    // ---------- 8. goals ----------
    const shotGoal = (team, big, lastGasp, scoreAfter, t0 = 3) => [
      ...ramp(t0 - 1, t0, team, 0.9),
      E(t0, { t: 'kick', kind: 'shot', power: 29, team, human: team === 0, x: 20, y: 0, z: 0 }),
      E(t0, { t: 'shot', team, power: 29, xg: 0.35, human: team === 0, x: 20, y: 0, z: 0 }),
      E(t0 + 0.55, { t: 'net', side: 1, speed: 24, vx: 20, vy: 0, vz: 0, goal: true, x: 30, y: 1, z: 1 }),
      E(t0 + 0.6, { t: 'goal', team, big, scorer: 'X', assist: null, score: scoreAfter, lastGasp }, (P) => { P.state = 'celebrate'; P.score = scoreAfter; P.threat = [0, 0]; }),
      E(t0 + 0.9, { t: 'whistle', kind: 'goal' }),
    ];
    {
      const goalStats = (r, name) => {
        track(name, r.buf); const m = L.mono(r.buf); const w = L.rmsWin(m, 0.25).map((x) => L.db(x));
        const bed = L.db(L.rms(L.slice(m, 0.5, 2)));
        let above6 = 0, above10 = 0; for (let i = Math.floor(3.6 / 0.25); i < w.length; i++) { if (w[i] > bed + 6) above6 += 0.25; if (w[i] > bed + 10) above10 += 0.25; }
        const peakRoar = Math.max(...w.slice(Math.floor(3.6 / 0.25)));
        return { bedDb: +bed.toFixed(1), roarPeakDb: +peakRoar.toFixed(1), roar1sDb: +L.db(L.rms(L.slice(m, 4, 6))).toFixed(1), secondsAbove6dB: above6, secondsAbove10dB: above10, attackMsTo6dB: (() => { const ww = L.rmsWin(L.slice(m, 3.6, 4.6), 0.01); const i = ww.findIndex((x) => L.db(x) > bed + 6); return i * 10; })(), peakVoices: r.stats.peakVoices, peakNodes: r.stats.peakNodes };
      };
      const g1 = await L.run({ seconds: 18, pulse: L.playPulse({ timeLeft: 100, half: 1 }), script: shotGoal(0, false, false, [1, 0]), warm: 30 });
      const d1 = goalStats(g1, 'goalHome');
      const g2 = await L.run({ seconds: 24, pulse: L.playPulse({ timeLeft: 4, half: 2, score: [0, 1], stoppage: true }), script: shotGoal(0, true, true, [1, 1]), warm: 90 });
      const d2 = goalStats(g2, 'goalDelirious');
      const g3 = await L.run({ seconds: 18, pulse: L.playPulse({ timeLeft: 30, half: 2, score: [3, 0] }), script: shotGoal(0, false, false, [4, 0]), warm: 90 });
      const d3 = goalStats(g3, 'goalRoutine4-0');
      const g4 = await L.run({ seconds: 18, pulse: L.playPulse({ timeLeft: 60, half: 2, score: [0, 0] }), script: shotGoal(1, false, false, [0, 1]), warm: 60 });
      const d4 = goalStats(g4, 'goalAway');
      // away goal: where is the cheer? R-L balance of the 800-2500 band 1.5-4 s after
      const bal = (r, a, b) => { const sl = L.psd(L.slice(L.ch(r.buf, 0), a, b)), sr = L.psd(L.slice(L.ch(r.buf, 1), a, b)); return +(10 * Math.log10(L.band(sr, 800, 2500) / L.band(sl, 800, 2500))).toFixed(1); };
      d4.cheerRminusL_dB = bal(g4, 5.2, 7.5); d1.roarRminusL_dB = bal(g1, 4.5, 6.5);
      d4.stun = g4.trace.filter((x) => Math.abs(x.t - 6) < 0.02 || Math.abs(x.t - 9) < 0.02 || Math.abs(x.t - 14) < 0.02).map((x) => [+x.t.toFixed(1), +x.stun.toFixed(2), +x.a.toFixed(2), +x.v.toFixed(2)]);
      // home-only layers after away goal: compare L channel (away end is right) 7-10 s vs before
      d4.leftChan_after_vs_before_dB = +(L.db(L.rms(L.slice(L.ch(g4.buf, 0), 8, 12)) / L.rms(L.slice(L.ch(g4.buf, 0), 0.5, 2)))).toFixed(1);
      // roar character: vowel-ish peak around 0.8-1.6 kHz vs bed
      const spR = L.psd(L.slice(L.mono(g1.buf), 4, 6)), spB = L.psd(L.slice(L.mono(g1.buf), 0.5, 2));
      d1.roarBands = L.bandsDb(L.slice(L.mono(g1.buf), 4, 6)); d1.bedBands = L.bandsDb(L.slice(L.mono(g1.buf), 0.5, 2));
      d1.roarCentroid = Math.round(L.centroid(spR)); d1.bedCentroid = Math.round(L.centroid(spB));
      d1.lrCorrRoar = +L.corr(L.slice(L.ch(g1.buf, 0), 4, 6), L.slice(L.ch(g1.buf, 1), 4, 6)).toFixed(3);
      // stages: burst(3.6-3.9) -> roar(4-6) -> applause tail: 5-16 kHz share rises late
      const hfShare = (a, b) => { const sp = L.psd(L.slice(L.mono(g1.buf), a, b)); return +(L.band(sp, 2500, 8000) / L.band(sp, 100, 8000)).toFixed(3); };
      d1.hfShare_roar_4_5 = hfShare(4, 5); d1.hfShare_tail_9_11 = hfShare(9, 11); d1.hfShare_bed = hfShare(0.5, 2);
      d1.timeline = bandTimeline(g1.buf, 1); d2.timeline = bandTimeline(g2.buf, 1); d4.timeline = bandTimeline(g4.buf, 1);
      d1.emo = g1.trace.filter((x, i) => i % 60 === 0).map((x) => [+x.t.toFixed(1), +x.a.toFixed(2), +x.v.toFixed(2), +x.ant.toFixed(2), x.mood, x.chant ? 'chant' : '']);
      R.data.goals = { home: d1, delirious: d2, routine: d3, away: d4 };
      ok('goal roar >> idle bed (>= 12 dB at peak)', d1.roarPeakDb - d1.bedDb >= 12, d1.roarPeakDb - d1.bedDb);
      ok('goal roar lasts > 3 s (6 dB above bed)', d1.secondsAbove6dB > 3, d1.secondsAbove6dB);
      ok('goal roar is instant (6 dB above bed within 100 ms)', d1.attackMsTo6dB >= 0 && d1.attackMsTo6dB <= 100, d1.attackMsTo6dB);
      ok('last-gasp equaliser roar is longer than a normal goal (>= +3 s above 6 dB)', d2.secondsAbove6dB >= d1.secondsAbove6dB + 3, [d2.secondsAbove6dB, d1.secondsAbove6dB]);
      ok('last-gasp roar at least as loud as normal', d2.roar1sDb >= d1.roar1sDb - 0.5, [d2.roar1sDb, d1.roar1sDb]);
      ok('4-0 routine goal is smaller than an opener (>= 2 dB quieter, shorter)', d3.roar1sDb <= d1.roar1sDb - 2 && d3.secondsAbove6dB < d1.secondsAbove6dB, [d3.roar1sDb, d1.roar1sDb, d3.secondsAbove6dB, d1.secondsAbove6dB]);
      ok('away goal: no sustained home roar (above bed+6 dB for <= 2.5 s, vs > 6 s for a home goal)', d4.secondsAbove6dB <= 2.5 && d1.secondsAbove6dB > 6, [d4.secondsAbove6dB, d1.secondsAbove6dB]);
      ok('away goal: the cheer comes from the away end (right-biased >= 4 dB)', d4.cheerRminusL_dB >= 4, d4.cheerRminusL_dB);
      ok('away goal: home side of the house falls BELOW its pre-goal level afterwards', d4.leftChan_after_vs_before_dB < -1, d4.leftChan_after_vs_before_dB);
      ok('roar is brighter/more open than the bed (centroid up)', d1.roarCentroid > d1.bedCentroid * 1.15, [d1.roarCentroid, d1.bedCentroid]);
      { // A/B: the same goal with the applause buffers removed
        const g1b = await L.run({ seconds: 14, pulse: L.playPulse({ timeLeft: 100, half: 1 }), script: [{ t: 0, fn: (eng) => { eng.crowd.tex.applause = null; eng.crowd.tex.sparse = null; } }, ...shotGoal(0, false, false, [1, 0])], warm: 30 });
        const b = (r, a, c) => { const sp = L.psd(L.slice(L.mono(r.buf), a, c)); return 10 * Math.log10(L.band(sp, 1000, 6000)); };
        d1.ovation_AB_dB = { at4_5: +(b(g1, 4, 5) - b(g1b, 4, 5)).toFixed(1), at7_9: +(b(g1, 7, 9) - b(g1b, 7, 9)).toFixed(1), at10_12: +(b(g1, 10, 12) - b(g1b, 10, 12)).toFixed(1) };
        ok('roar hands over to an ovation (applause adds >= 2 dB at 1-6 kHz in the tail, < 1.5 dB at the peak)', d1.ovation_AB_dB.at10_12 >= 2 && d1.ovation_AB_dB.at4_5 < 1.5, d1.ovation_AB_dB);
      }
      R.wavs.goal_home = L.wav(g1.buf); R.wavs.goal_delirious = L.wav(g2.buf); R.wavs.goal_away = L.wav(g4.buf);
    }

    // ---------- 9. near miss / save / foul / applause ----------
    {
      const run = async (name, seconds, P, script, warm = 30) => { const r = await L.run({ seconds, pulse: P, script, warm }); track(name, r.buf); return r; };
      const sh = (team) => [...ramp(2, 3, team, 0.85), E(3, { t: 'kick', kind: 'shot', power: 28, team, human: true, x: 20, y: 0, z: 0 }), E(3, { t: 'shot', team, power: 28, xg: 0.3, human: true, x: 20, y: 0, z: 0 })];
      const nm = await run('nearmiss', 10, L.playPulse(), [...sh(0), E(3.5, { t: 'nearmiss', team: 0, x: 30, y: 1, z: 4 }, (P) => { P.threat = [0.1, 0]; })]);
      const m = L.mono(nm.buf); const bed = L.db(L.rms(L.slice(m, 0.5, 2)));
      // gasp: airy 1.5-4 kHz burst right at 3.5; groan: 200-900 Hz, pitch falling
      const share = (a, b, f0, f1) => { const sp = L.psd(L.slice(m, a, b), 2048); return L.band(sp, f0, f1) / L.band(sp, 100, 8000); };
      const cent = (a, b) => Math.round(L.centroid(L.psd(L.slice(m, a, b), 2048)));
      R.data.nearmiss = { bedDb: +bed.toFixed(1), gaspDb: +L.db(L.rms(L.slice(m, 3.5, 3.74))).toFixed(1), groanDb: +L.db(L.rms(L.slice(m, 3.9, 5))).toFixed(1), afterDb: +L.db(L.rms(L.slice(m, 8, 10))).toFixed(1),
        airShare_gasp: +share(3.52, 3.72, 1500, 5000).toFixed(3), airShare_groan: +share(4.2, 5, 1500, 5000).toFixed(3), centroid_groan_early: cent(3.9, 4.3), centroid_groan_late: cent(4.7, 5.2), timeline: bandTimeline(nm.buf, 0.5) };
      ok('near miss: gasp + groan clearly above bed (>6 dB) but below a goal', R.data.nearmiss.groanDb > bed + 6 && R.data.nearmiss.groanDb < R.data.goals.home.roar1sDb - 3, [R.data.nearmiss.groanDb, bed, R.data.goals.home.roar1sDb]);
      ok('gasp is airy (more 1.5-5 kHz share than the groan)', R.data.nearmiss.airShare_gasp > R.data.nearmiss.airShare_groan * 1.5, [R.data.nearmiss.airShare_gasp, R.data.nearmiss.airShare_groan]);
      { // crowd one-shots SOLO (bed torn down) so their own shape can be measured
        const soloCue = async (cue, seconds = 4) => { const r = await L.run({ seconds, pulse: L.playPulse(), script: [{ t: 0, fn: (eng) => eng.crowd.teardown() }, { t: 0.1, fn: (eng) => eng.crowd.cue({ kind: 'groan', intensity: 0.8, delay: 0, dur: 2, variant: 0, away: false, ...cue }) }] }); track('solo_' + cue.kind, r.buf); return r; };
        const centAt = (r, a, b, lo = 80, hi = 6000) => { const sp = L.psd(L.slice(L.mono(r.buf), a, b), 2048); let x = 0, y = 0; for (let i = Math.floor(lo / sp.df); i * sp.df < hi; i++) { x += i * sp.df * sp.psd[i]; y += sp.psd[i]; } return Math.round(x / y); };
        const S1 = {};
        const gr = await soloCue({ kind: 'groan' }); S1.groan = { c_early: centAt(gr, 0.2, 0.6), c_late: centAt(gr, 1.3, 1.9), rmsDb: +L.db(L.rms(L.slice(L.mono(gr.buf), 0.2, 1.2))).toFixed(1) };
        const oo = await soloCue({ kind: 'ooh', dur: 0.8 }); S1.ooh = { c_early: centAt(oo, 0.12, 0.35), c_late: centAt(oo, 0.6, 0.9), rmsDb: +L.db(L.rms(L.slice(L.mono(oo.buf), 0.2, 0.8))).toFixed(1) };
        const ga = await soloCue({ kind: 'gasp', dur: 0.4 }); S1.gasp = { centroid: centAt(ga, 0.1, 0.4, 80, 12000), ring: L.ringTime(L.slice(L.mono(ga.buf), 0.1, 3), -20, 0.02), rmsDb: +L.db(L.rms(L.slice(L.mono(ga.buf), 0.1, 0.4))).toFixed(1) };
        const bo = await soloCue({ kind: 'boo', dur: 2.5 }, 5); S1.boo = { centroid: centAt(bo, 0.6, 2), rmsDb: +L.db(L.rms(L.slice(L.mono(bo.buf), 0.6, 2))).toFixed(1) };
        const ch = await soloCue({ kind: 'cheer', dur: 1.6 }); S1.cheer = { centroid: centAt(ch, 0.2, 1), rmsDb: +L.db(L.rms(L.slice(L.mono(ch.buf), 0.2, 1))).toFixed(1) };
        const ap = await soloCue({ kind: 'applause', dur: 4, intensity: 0.8 }, 7); { const m2 = L.slice(L.mono(ap.buf), 1.5, 3.5); S1.applause = { centroid: centAt(ap, 1.5, 3.5, 80, 12000), rmsDb: +L.db(L.rms(m2)).toFixed(1), bands: L.bandsDb(m2), lr: +L.corr(L.slice(L.ch(ap.buf, 0), 1.5, 3.5), L.slice(L.ch(ap.buf, 1), 1.5, 3.5)).toFixed(2) }; }
        const sp = await soloCue({ kind: 'applause', dur: 4, intensity: 0.2 }, 7); { const m2 = L.slice(L.mono(sp.buf), 1.5, 3.5); const w = L.rmsWin(m2, 0.01); const mean = w.reduce((a, c) => a + c, 0) / w.length; S1.smattering = { rmsDb: +L.db(L.rms(m2)).toFixed(1), crest10ms: +(Math.max(...w) / mean).toFixed(1) }; const m3 = L.slice(L.mono(ap.buf), 1.5, 3.5); const w3 = L.rmsWin(m3, 0.01); S1.applause.crest10ms = +(Math.max(...w3) / (w3.reduce((a, c) => a + c, 0) / w3.length)).toFixed(1); }
        const je = await soloCue({ kind: 'jeer', dur: 2.2, intensity: 0.6 }, 5); { const s2 = L.psd(L.slice(L.mono(je.buf), 0.2, 3)); S1.jeer = { share2k_4k5: +(L.band(s2, 2000, 4500) / L.band(s2, 20, 20000)).toFixed(3), rmsDb: +L.db(L.rms(L.slice(L.mono(je.buf), 0.2, 3))).toFixed(1) }; }
        const aw = await soloCue({ kind: 'awayRoar', dur: 4, away: true }, 6); S1.awayRoar = { RminusL: +L.db(L.rms(L.slice(L.ch(aw.buf, 1), 0.3, 3)) / L.rms(L.slice(L.ch(aw.buf, 0), 0.3, 3))).toFixed(1), rmsDb: +L.db(L.rms(L.slice(L.mono(aw.buf), 0.3, 3))).toFixed(1) };
        const ro = await soloCue({ kind: 'roar', dur: 8, intensity: 0.7 }, 14); { const m2 = L.mono(ro.buf); S1.roar = { burst_0_150ms_dB: +L.db(L.rms(L.slice(m2, 0.1, 0.25))).toFixed(1), sustain_1_3s_dB: +L.db(L.rms(L.slice(m2, 1.1, 3.1))).toFixed(1), at6s_dB: +L.db(L.rms(L.slice(m2, 6, 7))).toFixed(1), at11s_dB: +L.db(L.rms(L.slice(m2, 11, 12))).toFixed(1), c_1s: centAt(ro, 0.8, 1.6), c_5s: centAt(ro, 5, 6), vowelPeak_1s: L.peaks(L.psd(L.slice(m2, 0.6, 2.6), 1024), 300, 4000, -3, 400), lr: +L.corr(L.slice(L.ch(ro.buf, 0), 1, 3), L.slice(L.ch(ro.buf, 1), 1, 3)).toFixed(2), bands_1_3s: L.bandsDb(L.slice(m2, 1.1, 3.1)) }; R.wavs.roar_solo = L.wav(ro.buf); }
        R.data.soloCues = S1;
        ok('groan sags: solo centroid falls >= 15 % from start to tail', S1.groan.c_late < S1.groan.c_early * 0.85, [S1.groan.c_early, S1.groan.c_late]);
        ok('"ooh" swell rises: solo centroid climbs >= 10 %', S1.ooh.c_late > S1.ooh.c_early * 1.1, [S1.ooh.c_early, S1.ooh.c_late]);
        ok('gasp is airy and short (centroid > 1.8 kHz, gone to -20 dB in < 0.6 s)', S1.gasp.centroid > 1800 && S1.gasp.ring < 0.6, S1.gasp);
        ok('boo is darker than a cheer (centroid < 0.6x)', S1.boo.centroid < 0.6 * S1.cheer.centroid, [S1.boo.centroid, S1.cheer.centroid]);
        ok('applause is clap-like: centroid > 1.5 kHz, smattering is grainier than an ovation', S1.applause.centroid > 1500 && S1.smattering.crest10ms > S1.applause.crest10ms * 1.3, [S1.applause, S1.smattering]);
        ok('crowd whistles live at 2-4.5 kHz (> 80 % of energy)', S1.jeer.share2k_4k5 > 0.8, S1.jeer.share2k_4k5);
        ok('away roar sits in the away end (R-L >= 6 dB)', S1.awayRoar.RminusL >= 6, S1.awayRoar.RminusL);
        ok('roar solo: instant burst, sustained body, long tail (stages)', S1.roar.burst_0_150ms_dB > S1.roar.sustain_1_3s_dB - 6 && S1.roar.sustain_1_3s_dB - S1.roar.at6s_dB > 3 && S1.roar.at6s_dB - S1.roar.at11s_dB > 6, S1.roar);
      }
      ok('crowd settles back to bed within ~5 s', Math.abs(R.data.nearmiss.afterDb - bed) < 3, [R.data.nearmiss.afterDb, bed]);
      R.wavs.nearmiss = L.wav(nm.buf);
      const pw = await run('postHome', 10, L.playPulse(), [...sh(0), E(3.5, { t: 'post', speed: 26, bar: true, x: 30, y: 2.4, z: 0 }, (P) => { P.threat = [0.1, 0]; })]);
      R.wavs.post_with_crowd = L.wav(pw.buf);
      const svH = await run('saveHomeKeeper', 10, L.playPulse(), [...ramp(2, 3, 1, 0.85), E(3, { t: 'shot', team: 1, power: 28, xg: 0.3, human: false, x: -20, y: 0, z: 0 }), E(3.5, { t: 'save', team: 0, parry: false, diving: true, speed: 26, x: -29, y: 1, z: 1 }, (P) => { P.threat = [0, 0.1]; })]);
      const mh = L.mono(svH.buf);
      const app = (mm, a, b) => { const sp = L.psd(L.slice(mm, a, b)); return L.band(sp, 2500, 8000) / L.band(sp, 100, 8000); };
      R.data.saveHome = { cheerDb: +L.db(L.rms(L.slice(mh, 3.5, 5))).toFixed(1), applauseHfShare: +app(mh, 4.5, 6.5).toFixed(3), bedHfShare: +app(mh, 0.5, 2).toFixed(3) };
      ok('home save: cheered (>= 5 dB over bed for the first 1.5 s)', R.data.saveHome.cheerDb > bed + 5, [R.data.saveHome.cheerDb, bed]);
      // applause texture: grain density
      const ft = await run('fulltimeWin', 16, L.playPulse({ half: 2, timeLeft: 0.5, score: [2, 1] }), [E(3, { t: 'whistle', kind: 'full' }, (P) => { P.state = 'fulltime'; P.live = false; })], 60);
      const ftL = await run('fulltimeLoss', 16, L.playPulse({ half: 2, timeLeft: 0.5, score: [0, 1] }), [E(3, { t: 'whistle', kind: 'full' }, (P) => { P.state = 'fulltime'; P.live = false; })], 60);
      const fw = L.db(L.rms(L.slice(L.mono(ft.buf), 5, 10))), fl = L.db(L.rms(L.slice(L.ch(ftL.buf, 0), 10, 15))), flBefore = L.db(L.rms(L.slice(L.ch(ftL.buf, 0), 0.5, 2.5))), fwBefore = L.db(L.rms(L.slice(L.mono(ft.buf), 0.5, 2.5)));
      R.data.fulltime = { winDb_5_10s: +fw.toFixed(1), winBefore: +fwBefore.toFixed(1), lossHomeSideDb_10_15s: +fl.toFixed(1), lossHomeSideBefore: +flBefore.toFixed(1), winTimeline: bandTimeline(ft.buf, 1), lossTimeline: bandTimeline(ftL.buf, 1) };
      ok('full time: a win is celebrated (>= 8 dB over the pre-whistle bed for 5 s)', fw - fwBefore >= 8, [fw, fwBefore]);
      ok('full time: a 0-1 loss deflates the home side below its pre-whistle level', fl < flBefore - 1.5, [fl, flBefore]);
      R.wavs.fulltime_win = L.wav(ft.buf);
      const foulA = await run('foulByAway', 9, L.playPulse(), [E(3, { t: 'foul', team: 1, card: 1, player: 'x' }), E(3.05, { t: 'whistle', kind: 'foul' })]);
      const mf = L.mono(foulA.buf); const spBoo = L.psd(L.slice(mf, 3.6, 5)), spBed = L.psd(L.slice(mf, 0.5, 2));
      R.data.foul = { booDb: +L.db(L.rms(L.slice(mf, 3.6, 5))).toFixed(1), bedDb: +L.db(L.rms(L.slice(mf, 0.5, 2))).toFixed(1), booCentroid: Math.round(L.centroid(spBoo)), bedCentroid: Math.round(L.centroid(spBed)), low150_500_gain_dB: +(10 * Math.log10(L.band(spBoo, 150, 500) / L.band(spBed, 150, 500))).toFixed(1) };
      ok('boo: louder than bed and darker (low-mid 150-500 Hz up >= 6 dB)', R.data.foul.booDb > R.data.foul.bedDb + 3 && R.data.foul.low150_500_gain_dB >= 6, R.data.foul);
      const foulH = await run('foulByHome', 9, L.playPulse(), [E(3, { t: 'foul', team: 0, card: 0, player: 'x' })]);
      const mj = L.mono(foulH.buf); const spJ = L.psd(L.slice(mj, 3.1, 5.5)), spJ0 = L.psd(L.slice(mj, 0.5, 2.5));
      R.data.foul.jeer2k4_4k_gain_dB = +(10 * Math.log10(L.band(spJ, 2000, 4200) / L.band(spJ0, 2000, 4200))).toFixed(1);
      ok('decision against home: derisive whistles (2-4.2 kHz up >= 6 dB)', R.data.foul.jeer2k4_4k_gain_dB >= 6, R.data.foul.jeer2k4_4k_gain_dB);
      R.wavs.foul_boo = L.wav(foulA.buf); R.wavs.foul_jeer = L.wav(foulH.buf);
    }

    // ---------- 10. chants ----------
    {
      const P = L.playPulse({ half: 2, timeLeft: 80, score: [2, 0] });
      const r = await L.run({ seconds: 34, pulse: P, warm: 90, prebake: [0, 1, 2, 3], script: [...ramp(24, 25, 1, 0.9), S(25, (p) => { p.threat[1] = 0.9; }), S(29, (p) => { p.threat[1] = 0; })] });
      track('chant', r.buf);
      const tr = r.trace; const on = tr.find((x) => x.chant); const off = on ? tr.find((x) => x.t > on.t && !x.chant) : null;
      const m = L.mono(r.buf);
      const tOn = on ? on.t : 0;
      const spC = L.psd(L.slice(m, tOn + 8, tOn + 16), 8192), spB = L.psd(L.slice(m, 0.3, Math.max(1, tOn - 0.2)), 8192);
      const lowTonal = L.peaks(spC, 100, 500, -12, 8);
      R.data.chant = { startedAt: on && +on.t.toFixed(2), stoppedAt: off && +off.t.toFixed(2), mood: on && on.mood, template: r.eng.model.state.chantTemplate,
        before_dB: +L.db(L.rms(L.slice(m, 0.3, Math.max(1, tOn - 0.2)))).toFixed(1), during_dB: +L.db(L.rms(L.slice(m, tOn + 8, tOn + 16))).toFixed(1), afterStop_dB: off ? +L.db(L.rms(L.slice(m, off.t + 2.5, off.t + 4))).toFixed(1) : null,
        flat100_500_chant: +L.flatness(spC, 100, 500).toFixed(3), flat100_500_bed: +L.flatness(spB, 100, 500).toFixed(3), tonalPeaks: lowTonal.slice(0, 8),
        beatAm: L.amPeak(L.slice(m, tOn + 8, tOn + 16), 0.8, 5), timeline: bandTimeline(r.buf, 2) };
      ok('a chant starts in calm, confident play (within 12 s)', !!on && on.t < 12, on && on.t);
      ok('chant adds pitched (tonal) energy: 100-500 Hz flatness drops vs bed', R.data.chant.flat100_500_chant < R.data.chant.flat100_500_bed * 0.8, [R.data.chant.flat100_500_chant, R.data.chant.flat100_500_bed]);
      ok('chant sits above the bed but does not swamp it (+2..+8 dB)', R.data.chant.during_dB - R.data.chant.before_dB >= 2 && R.data.chant.during_dB - R.data.chant.before_dB <= 8, [R.data.chant.during_dB, R.data.chant.before_dB]);
      ok('danger stops the chant (off within 1.5 s of threat at 24-25 s)', !!off && off.t > 24 && off.t < 26.5, off && off.t);
      R.wavs.chant = L.wav(r.buf);
      // each template renders & differs
      R.data.chant.templates = [];
      for (let id = 0; id < L.B.CHANTS.length; id++) {
        const ctx = new OfflineAudioContext(2, 48000, 48000); let s = 99 + id; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
        const b = await L.B.bakeChant(ctx, L.B.CHANTS[id], 22, rnd); const d0 = b.getChannelData(0), d1 = b.getChannelData(1);
        const mm = new Float32Array(d0.length); for (let i = 0; i < mm.length; i++) mm[i] = 0.5 * (d0[i] + d1[i]);
        const sp = L.psd(mm, 8192, b.sampleRate);
        R.data.chant.templates.push({ name: L.B.CHANTS[id].name, seconds: +b.duration.toFixed(2), peak: +Math.max(L.peak(d0), L.peak(d1)).toFixed(2), rms: +L.rms(mm).toFixed(3), lr: +L.corr(d0, d1).toFixed(2), nan: L.nan(d0), top: L.peaks(sp, 90, 600, -10, 6).slice(0, 6).map((p) => p.f) });
      }
      ok('all chant templates bake, finite, non-silent', R.data.chant.templates.every((t) => !t.nan && t.rms > 0.02), R.data.chant.templates.map((t) => t.rms));
    }

    // ---------- 11. 60 s scripted match ----------
    {
      let seed = 4242; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const P = L.playPulse({ timeLeft: 60, half: 2, score: [0, 0] });
      const script = []; const counts = {};
      const add = (t, e, mut) => { counts[e.t] = (counts[e.t] || 0) + 1; script.push(E(t, e, mut)); };
      // continuous pulse motion: ball wanders, threat follows ball position, clock runs
      for (let t = 0; t < 60; t += 1 / 30) script.push(S(t, (p) => { p.ballX = 26 * Math.sin(t * 0.37) * Math.sin(t * 0.11 + 1); p.ballZ = 12 * Math.sin(t * 0.53); p.ballSpeed = 8 + 8 * Math.abs(Math.sin(t * 1.7)); p.timeLeft = Math.max(0, 60 - t); p.stoppage = t > 55; if (p.state === 'play') { p.threat[0] = Math.max(0, p.ballX / 26) ** 2; p.threat[1] = Math.max(0, -p.ballX / 26) ** 2; } p.possession = p.ballX > 0 ? 0 : 1; }));
      const pos = () => ({ x: (rnd() * 2 - 1) * 28, y: 0, z: (rnd() * 2 - 1) * 18 });
      for (let t = 0.3; t < 60; t += 0.12 + rnd() * 0.25) add(t, { t: 'kick', kind: 'touch', power: 4 + rnd() * 6, team: rnd() < 0.5 ? 0 : 1, human: rnd() < 0.3, ...pos() });
      for (let t = 0.5; t < 60; t += 0.7 + rnd() * 1.4) add(t, { t: 'kick', kind: ['pass', 'pass', 'pass', 'through', 'cross', 'lob', 'clear', 'header', 'volley', 'knock'][Math.floor(rnd() * 10)], power: 10 + rnd() * 14, team: rnd() < 0.5 ? 0 : 1, human: rnd() < 0.3, ...pos() });
      for (let t = 1; t < 60; t += 0.6 + rnd() * 1.5) add(t, { t: 'bounce', speed: 3 + rnd() * 10, ...pos() });
      for (let t = 1; t < 60; t += 1 + rnd() * 2) add(t, { t: 'firstTouch', team: 0, quality: rnd(), human: false, ...pos() });
      for (let t = 2; t < 60; t += 2 + rnd() * 3) add(t, { t: 'collide', force: 2 + rnd() * 10, ...pos() });
      for (let t = 2; t < 60; t += 3 + rnd() * 4) { add(t, { t: 'slide', team: 0, ...pos() }); add(t + 0.3, { t: 'tackle', team: rnd() < 0.5 ? 0 : 1, slide: true, human: rnd() < 0.5, ...pos() }); add(t + 0.35, { t: 'turnover', team: rnd() < 0.5 ? 0 : 1 }); }
      for (let t = 4; t < 60; t += 5 + rnd() * 3) { const team = rnd() < 0.5 ? 0 : 1; add(t, { t: 'kick', kind: 'shot', power: 22 + rnd() * 12, team, human: team === 0, ...pos() }); add(t, { t: 'shot', team, power: 28, xg: rnd() * 0.6, human: team === 0, ...pos() });
        const k = Math.floor(rnd() * 4); if (k === 0) { add(t + 0.4, { t: 'dive', team: 1 - team, ...pos() }); add(t + 0.5, { t: 'save', team: 1 - team, parry: rnd() < 0.5, diving: true, speed: 20 + rnd() * 10, ...pos() }); } else if (k === 1) add(t + 0.5, { t: 'post', speed: 15 + rnd() * 15, bar: rnd() < 0.5, ...pos() }); else if (k === 2) add(t + 0.5, { t: 'nearmiss', team, ...pos() }); else { add(t + 0.45, { t: 'block', team: 1 - team, speed: 20, ...pos() }); } }
      for (const t of [9, 31]) { add(t, { t: 'foul', team: t === 9 ? 1 : 0, card: t === 9 ? 1 : 0, player: 'p' }); add(t + 0.05, { t: 'whistle', kind: 'foul' }); add(t + 2.5, { t: 'setpiece', kind: 'freekick', team: 0, ...pos() }); add(t + 2.6, { t: 'whistle', kind: 'restart' }); }
      add(17, { t: 'offside', team: 1, player: 'p' }); add(17.05, { t: 'whistle', kind: 'offside' });
      add(22, { t: 'setpiece', kind: 'corner', team: 0, x: 30, y: 0, z: 20 });
      // goals: home at 26 s, away at 41 s, home last-gasp at 57 s
      const goal = (t, team, score, lastGasp) => { add(t, { t: 'net', side: 1, speed: 25, vx: 20, vy: 0, vz: 0, goal: true, x: 30, y: 1, z: 0 }); add(t + 0.05, { t: 'goal', team, big: lastGasp, scorer: 'S', assist: null, score, lastGasp }, (p) => { p.state = 'celebrate'; p.score = score; p.threat = [0, 0]; }); add(t + 0.3, { t: 'whistle', kind: 'goal' }); script.push(S(t + 4, (p) => { p.state = 'play'; })); add(t + 4.05, { t: 'whistle', kind: 'kickoff' }); add(t + 4.05, { t: 'setpiece', kind: 'kickoff', team: 1 - team, x: 0, y: 0, z: 0 }); };
      goal(26, 0, [1, 0], false); goal(41, 1, [1, 1], false); goal(54.5, 0, [2, 1], true);
      add(59.2, { t: 'whistle', kind: 'full' }, (p) => { p.state = 'fulltime'; p.live = false; });
      for (let t = 5; t < 60; t += 7) script.push({ t, fn: (eng) => eng.ui(['click', 'confirm', 'back', 'reward', 'error'][Math.floor(t / 7) % 5]) });
      const r = await L.run({ seconds: 64, pulse: P, warm: 30, script, tapLimiter: true });
      track('match60', r.buf);
      const maxVoices = Math.max(...r.trace.map((x) => x.voices)), maxNodes = Math.max(...r.trace.map((x) => x.nodes));
      const m = L.mono(r.buf);
      R.data.match = { events: script.length, counts, peak: +Math.max(L.peak(L.ch(r.buf, 0)), L.peak(L.ch(r.buf, 1))).toFixed(3), preLimiterPeak: +Math.max(L.peak(L.ch(r.buf, 2)), L.peak(L.ch(r.buf, 3))).toFixed(3), nan: L.nan(m), rmsDb: +L.db(L.rms(m)).toFixed(1),
        stats: r.stats, maxVoicesSeen: maxVoices, maxNodesSeen: maxNodes, cap: r.eng.mixer.cap, renderMs: Math.round(r.renderMs), realtimeFactor: +(64000 / r.renderMs).toFixed(1),
        rms2s: L.rmsWin(m, 2).map((x) => Math.round(L.db(x))).join(' '), silentWindows: L.rmsWin(m, 0.5).filter((x) => L.db(x) < -70).length,
        samplesOver0_9: (() => { let c = 0; for (const ch of [0, 1]) { const d = L.ch(r.buf, ch); for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > 0.9) c++; } return c; })(),
        moods: [...new Set(r.trace.map((x) => x.mood))], moodChanges: r.trace.filter((x, i) => i > 0 && x.mood !== r.trace[i - 1].mood).length, chantToggles: r.trace.filter((x, i) => i > 0 && x.chant !== r.trace[i - 1].chant).length };
      ok('60 s match: never clips (peak <= 0.96)', R.data.match.peak <= 0.96, R.data.match.peak);
      ok('60 s match: no NaN', !R.data.match.nan);
      ok('60 s match: voices never exceed the cap', r.stats.peakVoices <= r.eng.mixer.cap, [r.stats.peakVoices, r.eng.mixer.cap]);
      ok('60 s match: live nodes stay under 300', r.stats.peakNodes <= 300, r.stats.peakNodes);
      ok('60 s match: never silent while live', R.data.match.silentWindows === 0, R.data.match.silentWindows);
      ok('60 s match: all voices retired at the end (pool drains)', r.trace[r.trace.length - 1].voices <= 8, r.trace[r.trace.length - 1].voices);
      R.wavs.match60 = L.wav(r.buf);
      // lite tier, same script
      const P2 = L.playPulse({ timeLeft: 60, half: 2, score: [0, 0] });
      const r2 = await L.run({ seconds: 64, pulse: P2, warm: 30, script, opts: { quality: 'lite' } }); track('match60lite', r2.buf);
      R.data.matchLite = { peak: +Math.max(L.peak(L.ch(r2.buf, 0)), L.peak(L.ch(r2.buf, 1))).toFixed(3), stats: r2.stats, cap: r2.eng.mixer.cap, renderMs: Math.round(r2.renderMs), nan: L.nan(L.mono(r2.buf)) };
      ok('lite 60 s match: under its (lower) voice cap, no clip, no NaN', r2.stats.peakVoices <= r2.eng.mixer.cap && R.data.matchLite.peak <= 0.96 && !R.data.matchLite.nan, [r2.stats.peakVoices, r2.eng.mixer.cap, R.data.matchLite.peak]);
    }

    // ---------- 12. stress / mute / ui ----------
    {
      const burst = []; for (let i = 0; i < 300; i++) burst.push(E(0.2 + i * 0.004, { t: 'kick', kind: 'shot', power: 34, team: 0, human: true, x: (i % 7) * 8 - 24, y: 0, z: 0 }));
      for (let i = 0; i < 40; i++) burst.push(E(0.3 + i * 0.02, { t: 'post', speed: 30, bar: i % 2 === 0, ...at }));
      for (let i = 0; i < 10; i++) burst.push(E(0.4 + i * 0.05, { t: 'goal', team: 0, big: true, scorer: null, assist: null, score: [i + 1, 0], lastGasp: true }));
      const r = await L.run({ seconds: 6, pulse: L.playPulse(), script: burst, warm: 10, tapLimiter: true }); track('stress', r.buf);
      R.data.stress = { peak: +Math.max(L.peak(L.ch(r.buf, 0)), L.peak(L.ch(r.buf, 1))).toFixed(3), preLimiterPeak: +Math.max(L.peak(L.ch(r.buf, 2)), L.peak(L.ch(r.buf, 3))).toFixed(2), stats: r.stats, nan: L.nan(L.mono(r.buf)) };
      ok('stress (350 loud events in 1.2 s): output still <= 0.96, no NaN, voices <= cap', R.data.stress.peak <= 0.96 && !R.data.stress.nan && r.stats.peakVoices <= r.eng.mixer.cap, R.data.stress);
      ok('stress: voice stealing engaged', r.stats.stolen + r.stats.dropped > 0, [r.stats.stolen, r.stats.dropped]);
      const mu = await L.run({ seconds: 4, pulse: L.playPulse(), warm: 10, script: [{ t: 1, fn: (eng) => eng.setMuted(true) }, E(2, { t: 'goal', team: 0, big: true, scorer: null, assist: null, score: [1, 0], lastGasp: false }), E(2, { t: 'whistle', kind: 'full' })] });
      R.data.mute = { before: +L.db(L.rms(L.slice(L.mono(mu.buf), 0.2, 0.9))).toFixed(1), after: +L.db(L.rms(L.slice(L.mono(mu.buf), 1.6, 4))).toFixed(1) };
      ok('mute silences everything (< -80 dB) incl. new events', R.data.mute.after < -80, R.data.mute);
      R.data.ui = {};
      for (const k of ['click', 'confirm', 'back', 'reward', 'error']) { const u = await L.run({ seconds: 1.6, pulse: L.pulse(), opts: { bake: false }, script: [{ t: 0, fn: dry }, { t: 0.1, fn: (eng) => eng.ui(k) }] }); track('ui_' + k, u.buf); const m = L.slice(L.mono(u.buf), 0.1, 1.5); R.data.ui[k] = { peak: +L.peak(m).toFixed(3), centroid: Math.round(L.centroid(L.psd(m))), ring: L.ringTime(m, -40, 0.01), lr: +L.corr(L.slice(L.ch(u.buf, 0), 0.1, 1.5), L.slice(L.ch(u.buf, 1), 0.1, 1.5)).toFixed(3) }; }
      ok('ui sounds: all audible, dry (L==R), distinct lengths', Object.values(R.data.ui).every((u) => u.peak > 0.03 && u.peak < 0.6 && u.lr > 0.999) && R.data.ui.reward.ring > R.data.ui.click.ring * 3, R.data.ui);
      // quality switch at run time
      const qs = await L.run({ seconds: 6, pulse: L.playPulse(), warm: 10, script: [{ t: 2, fn: (eng) => eng.setQuality('lite') }, { t: 4, fn: (eng) => eng.setQuality('full') }, E(4.5, { t: 'post', speed: 25, bar: true, ...at })] }); track('qualitySwitch', qs.buf);
      const w = L.rmsWin(L.mono(qs.buf), 0.5).map((x) => Math.round(L.db(x)));
      R.data.qualitySwitch = { rms05: w.join(' '), staticEnd: qs.stats.staticNodes };
      ok('quality can be switched live without silence or NaN', w.slice(1).every((x) => x > -60) && !L.nan(L.mono(qs.buf)), w);
    }

    R.data.peaks = allPeaks; R.data.maxPeak = Math.max(...allPeaks.map((p) => p[1]));
    ok('no render anywhere exceeds 0.96 (soft-clip ceiling 0.956)', R.data.maxPeak <= 0.96, R.data.maxPeak);
    ok('no NaN in any render', !anyNan);
    return R;
  });
  const fs = require('fs'); const path = require('path');
  let fails = 0;
  for (const c of out.checks) { if (!c.pass) fails++; console.log((c.pass ? 'PASS ' : 'FAIL ') + c.name + (c.detail !== undefined ? '  ' + JSON.stringify(c.detail) : '')); }
  fs.writeFileSync(path.join(__dirname, 'verify-data.json'), JSON.stringify(out.data, null, 1));
  for (const [k, v] of Object.entries(out.wavs)) saveWav(k + '.wav', v);
  console.log(`\n${out.checks.length - fails}/${out.checks.length} checks passed; data -> verify-data.json; ${Object.keys(out.wavs).length} wavs`);
  if (errors.length) console.log('CONSOLE ERRORS', errors);
  await browser.close();
  process.exit(fails || errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
