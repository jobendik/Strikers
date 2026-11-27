// Page-side lab: offline rendering + numeric analysis helpers. Injected into a blank page on the Vite dev server.
(() => {
  const SR = 48000;
  const L = (window.LAB = { SR });
  L.load = async () => {
    L.M = await import('/strikers/src/audio/engine.ts');
    L.E = await import('/strikers/src/audio/emotion.ts');
    L.B = await import('/strikers/src/audio/bake.ts');
    L.X = await import('/strikers/src/audio/mixer.ts');
  };
  L.pulse = (o = {}) => ({ live: false, state: 'menu', ballX: 0, ballY: 0, ballZ: 0, ballSpeed: 0, possession: -1, threat: [0, 0], score: [0, 0], timeLeft: 0, half: 1, stoppage: false, halfL: 30, halfW: 20, ...o });
  L.playPulse = (o = {}) => L.pulse({ live: true, state: 'play', timeLeft: 120, ...o });

  // run a scripted scenario through an OfflineAudioContext. script: [{t, fn(eng,P)}]
  L.run = async ({ seconds, step = 1 / 30, pulse, script = [], opts = {}, warm = null, tapLimiter = false, prebake = [] }) => {
    const ctx = new OfflineAudioContext(tapLimiter ? 4 : 2, Math.ceil(SR * seconds), SR);
    let output;
    if (tapLimiter) {
      const merger = ctx.createChannelMerger(4);
      merger.connect(ctx.destination);
      output = ctx.createGain();
      const sp = ctx.createChannelSplitter(2);
      output.connect(sp);
      sp.connect(merger, 0, 0);
      sp.connect(merger, 1, 1);
      L._merger = merger;
    }
    const t0 = performance.now();
    const eng = L.M.createEngine(ctx, { seed: 7, output, ...opts });
    await eng.ready;
    for (const id of prebake) await eng.crowd.prebakeChant(id);
    const bakeMs = performance.now() - t0;
    if (tapLimiter) {
      // channels 2/3 = pre-limiter master
      const sp2 = ctx.createChannelSplitter(2);
      eng.mixer.master.connect(sp2);
      sp2.connect(L._merger, 0, 2);
      sp2.connect(L._merger, 1, 3);
    }
    const P = pulse || L.pulse();
    // warm the emotion model (no audio time passes) so scenarios start from a settled state
    if (warm) for (let i = 0; i < warm * 30; i++) eng.model.update(1 / 30, P);
    eng.crowd.apply(eng.model.mix(), 0.001);
    const events = script.slice().sort((a, b) => a.t - b.t);
    let ei = 0;
    const trace = [];
    const tick = (t) => {
      while (ei < events.length && events[ei].t <= t + 1e-6) {
        events[ei].fn(eng, P);
        ei++;
      }
      eng.update(step, P);
      const s = eng.model.state;
      const st = eng.stats();
      trace.push({ t, a: s.arousal, v: s.valence, ant: s.anticipation, ten: s.tension, hold: s.hold, stun: s.stun, mood: s.mood, chant: s.chanting, voices: st.voices, nodes: st.nodes });
    };
    tick(0);
    let k = 1;
    const sched = () => {
      const t = k * step;
      if (t >= seconds - step) return;
      ctx.suspend(t).then(() => {
        tick(ctx.currentTime);
        k++;
        sched();
        ctx.resume();
      });
    };
    sched();
    const r0 = performance.now();
    const buf = await ctx.startRendering();
    const renderMs = performance.now() - r0;
    return { buf, eng, trace, bakeMs, renderMs, stats: { ...eng.stats() } };
  };

  // ---- analysis ----
  L.ch = (buf, c) => buf.getChannelData(c);
  L.mono = (buf) => {
    const a = buf.getChannelData(0), b = buf.getChannelData(1), o = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) o[i] = 0.5 * (a[i] + b[i]);
    return o;
  };
  L.slice = (d, t0, t1) => d.subarray(Math.max(0, Math.floor(t0 * SR)), Math.min(d.length, Math.floor(t1 * SR)));
  L.peak = (d) => { let p = 0; for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > p) p = a; } return p; };
  L.rms = (d) => { let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / Math.max(1, d.length)); };
  L.nan = (d) => { for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) return true; return false; };
  L.db = (x) => 20 * Math.log10(Math.max(1e-12, x));
  L.rmsWin = (d, win = 0.05) => { const n = Math.floor(win * SR), out = []; for (let i = 0; i + n <= d.length; i += n) out.push(L.rms(d.subarray(i, i + n))); return out; };
  L.corr = (a, b) => { let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < a.length; i++) { sab += a[i] * b[i]; saa += a[i] * a[i]; sbb += b[i] * b[i]; } return sab / Math.sqrt(saa * sbb + 1e-20); };
  // radix-2 FFT (in place)
  L.fft = (re, im) => {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr; re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr; } }
    }
  };
  // Welch power spectrum: returns {psd: Float64Array(N/2), df}
  L.psd = (d, N = 4096, sr = SR) => {
    const psd = new Float64Array(N / 2); let frames = 0;
    const re = new Float64Array(N), im = new Float64Array(N);
    const hop = N / 2;
    if (d.length < N) { const dd = new Float32Array(N); dd.set(d); d = dd; }
    for (let s = 0; s + N <= d.length; s += hop) {
      for (let i = 0; i < N; i++) { re[i] = d[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))); im[i] = 0; }
      L.fft(re, im);
      for (let i = 0; i < N / 2; i++) psd[i] += re[i] * re[i] + im[i] * im[i];
      frames++;
    }
    for (let i = 0; i < N / 2; i++) psd[i] /= Math.max(1, frames);
    return { psd, df: sr / N };
  };
  L.band = (sp, f0, f1) => { let s = 0; const i0 = Math.max(1, Math.floor(f0 / sp.df)), i1 = Math.min(sp.psd.length - 1, Math.ceil(f1 / sp.df)); for (let i = i0; i <= i1; i++) s += sp.psd[i]; return s; };
  L.centroid = (sp) => { let a = 0, b = 0; for (let i = 1; i < sp.psd.length; i++) { a += i * sp.df * sp.psd[i]; b += sp.psd[i]; } return a / Math.max(1e-30, b); };
  L.BANDS = [[20, 80], [80, 160], [160, 315], [315, 630], [630, 1250], [1250, 2500], [2500, 5000], [5000, 10000], [10000, 20000]];
  L.bandsDb = (d) => { const sp = L.psd(d); const tot = L.band(sp, 20, 20000) + 1e-30; return L.BANDS.map(([a, b]) => +(10 * Math.log10(L.band(sp, a, b) / tot + 1e-12)).toFixed(1)); };
  // spectral flatness (geometric/arithmetic mean) within a band
  L.flatness = (sp, f0, f1) => { let g = 0, a = 0, n = 0; for (let i = Math.floor(f0 / sp.df); i <= Math.ceil(f1 / sp.df); i++) { g += Math.log(sp.psd[i] + 1e-30); a += sp.psd[i]; n++; } return Math.exp(g / n) / (a / n + 1e-30); };
  // spectral peaks: local maxima above rel threshold (dB below max), min spacing Hz
  L.peaks = (sp, f0, f1, relDb = -30, minSpace = 30) => {
    let mx = 0; const i0 = Math.floor(f0 / sp.df), i1 = Math.ceil(f1 / sp.df);
    for (let i = i0; i <= i1; i++) mx = Math.max(mx, sp.psd[i]);
    const out = [];
    for (let i = i0 + 1; i < i1; i++) { const p = sp.psd[i]; if (p > sp.psd[i - 1] && p >= sp.psd[i + 1] && 10 * Math.log10(p / mx) > relDb) { if (out.length && i * sp.df - out[out.length - 1].f < minSpace) { if (p > out[out.length - 1].p) out[out.length - 1] = { f: i * sp.df, p }; } else out.push({ f: i * sp.df, p }); } }
    return out.map((o) => ({ f: Math.round(o.f), db: +(10 * Math.log10(o.p / mx)).toFixed(1) }));
  };
  // amplitude-envelope modulation spectrum: dominant AM frequency in [f0,f1]
  L.amPeak = (d, f0, f1) => {
    const dec = 48; const n = Math.floor(d.length / dec); const env = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < dec; k++) s += Math.abs(d[i * dec + k]); env[i] = s / dec; }
    let mean = 0; for (let i = 0; i < n; i++) mean += env[i]; mean /= n; for (let i = 0; i < n; i++) env[i] -= mean;
    let N = 1; while (N * 2 <= n) N *= 2; N = Math.min(N, 4096);
    const sp = L.psd(env, N, SR / dec);
    let best = 0, bf = 0; for (let i = Math.floor(f0 / sp.df); i <= Math.ceil(f1 / sp.df); i++) if (sp.psd[i] > best) { best = sp.psd[i]; bf = i * sp.df; }
    const tot = L.band(sp, 2, 200);
    return { f: +bf.toFixed(1), share: +(L.band(sp, bf - 3, bf + 3) / (tot + 1e-30)).toFixed(3), depth: +(Math.sqrt(2 * best) / (N / 4) / (mean + 1e-12)).toFixed(3) };
  };
  L.summary = (buf, t0 = 0, t1 = 1e9) => {
    const l = L.slice(L.ch(buf, 0), t0, t1), r = L.slice(L.ch(buf, 1), t0, t1), m = L.slice(L.mono(buf), t0, t1);
    const sp = L.psd(m);
    return { peak: +Math.max(L.peak(l), L.peak(r)).toFixed(4), rmsDb: +L.db(L.rms(m)).toFixed(1), centroid: Math.round(L.centroid(sp)), bands: L.bandsDb(m), nan: L.nan(l) || L.nan(r), lr: +L.corr(l, r).toFixed(3) };
  };
  // time above -60 dB re peak window (ring time)
  L.ringTime = (d, relDb = -40, win = 0.02) => { const w = L.rmsWin(d, win); const mx = Math.max(...w); let last = 0; for (let i = 0; i < w.length; i++) if (L.db(w[i] / mx) > relDb) last = i; return +((last + 1) * win).toFixed(2); };
  L.wav = (buf, t0 = 0, t1 = 1e9) => {
    const l = L.slice(L.ch(buf, 0), t0, t1), r = L.slice(L.ch(buf, 1), t0, t1); const n = l.length;
    const out = new Uint8Array(44 + n * 4); const dv = new DataView(out.buffer);
    const W = (o, s) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
    W(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); W(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, SR, true); dv.setUint32(28, SR * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); W(36, 'data'); dv.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) { dv.setInt16(44 + i * 4, Math.max(-1, Math.min(1, l[i])) * 32767, true); dv.setInt16(46 + i * 4, Math.max(-1, Math.min(1, r[i])) * 32767, true); }
    let s = ''; const CH = 0x8000; for (let i = 0; i < out.length; i += CH) s += String.fromCharCode.apply(null, out.subarray(i, i + CH)); return btoa(s);
  };
})();
