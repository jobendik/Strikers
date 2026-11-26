/*
 * Crowd-emotion model — PURE (no Web Audio, no DOM, no wall clock, no Math.random).
 *
 * It turns the match pulse + sim events into (a) a small continuous state
 * (arousal / valence / anticipation / tension / held breath / stun), (b) a
 * `CrowdMix` of layer gains and filter cutoffs for the always-on stadium bed and
 * (c) discrete `CrowdCue`s (roar, groan, gasp, applause, boo, chant start/stop…)
 * that the audio engine renders as one-shots.
 *
 * Perspective: the stadium is "home = team 0" with a small away end. Valence is
 * therefore home-biased: +1 = the home support is delirious, −1 = it is sunk.
 *
 * Design rules (asserted in simtest/units.ts):
 *  - It is not "volume follows the ball". Silence is part of it: the bed DUCKS
 *    while a clear chance develops / a shot is in the air (held breath), and the
 *    house is STUNNED for a few seconds after the away side scores.
 *  - Context matters: score and clock set tension and "flatness"; the same goal
 *    is worth a different roar at 4–0 than as a late equaliser.
 *  - Everything that makes a decision (attacking side, mood, chants, repeated
 *    cues) has hysteresis, dwell times or rate limits so it never flutters.
 */
import type { SimEvent } from '../core/bus';
import { clamp, smoothstep } from './rng';

/** The subset of `pulse` (core/bus.ts) the model reads. */
export interface PulseLike {
  live: boolean;
  state: string;
  ballX: number;
  ballY: number;
  ballZ: number;
  ballSpeed: number;
  possession: number;
  threat: ArrayLike<number>;
  score: ArrayLike<number>;
  timeLeft: number;
  half: number;
  stoppage: boolean;
  halfL: number;
  halfW: number;
}

export type CueKind =
  | 'roar' // home goal: multi-stage explosion (variant 1 = delirious)
  | 'awayRoar' // the away end celebrating
  | 'groan' // falling "ooohhh"
  | 'gasp' // sharp collective intake of breath
  | 'ooh' // rising "ooooOOH" as a shot is struck
  | 'cheer' // short positive burst (tackle, home save, kick-off)
  | 'applause'
  | 'boo'
  | 'jeer' // derisive crowd whistles
  | 'sigh' // quiet deflation
  | 'ole'
  | 'chantStart'
  | 'chantStop';

export interface CrowdCue {
  kind: CueKind;
  /** 0..1 (roar may reach 1). */
  intensity: number;
  /** Seconds from now. */
  delay: number;
  /** Nominal length in seconds (for chantStop: the fade time). */
  dur: number;
  /** roar: 1 = delirious; chantStart: template index. */
  variant: number;
  /** Comes from the away end. */
  away: boolean;
}

export type Mood = 'flat' | 'nervous' | 'neutral' | 'confident' | 'delirious';

/** Continuous targets for the stadium bed. Gains are relative multipliers (1 = reference). */
export interface CrowdMix {
  /** Overall bed level (includes the held-breath duck and the stun dip). */
  level: number;
  /** "Many people talking" layer. */
  murmur: number;
  /** "Many people shouting" layer (replaces murmur as arousal rises). */
  shout: number;
  /** Continuous anticipation "oooh" layer + its playback-rate (pitch) factor. */
  ooh: number;
  oohRate: number;
  /** Sub/low rumble. */
  rumble: number;
  /** Low-pass cutoff (Hz) of the voice layers — brightness follows arousal. */
  cutoff: number;
  /** 0..1 held breath (already folded into `level`; exposed for tests/UI). */
  duck: number;
  /** Away-end bed level. */
  away: number;
}

export interface EmotionState {
  arousal: number;
  valence: number;
  anticipation: number;
  tension: number;
  /** 0..1 — bed duck while a chance develops / a shot is in the air. */
  hold: number;
  /** 0..1 — the house falls quiet after conceding. */
  stun: number;
  /** Which team is creating the danger: 0 home, 1 away, −1 nobody. */
  side: number;
  /** 0..1 — how lifeless the home support is (well behind, little to play for). */
  flat: number;
  /** 0..1 match progress and "lateness". */
  progress: number;
  late: number;
  mood: Mood;
  chanting: boolean;
  chantAway: boolean;
  chantTemplate: number;
}

/** Time constants (seconds) and thresholds. Tuned by reasoning, see docs/AUDIO_DESIGN.md. */
export const EMO = {
  antAttack: 0.22,
  antRelease: 0.7,
  arousalAttack: 0.6,
  arousalDecay: 3.5,
  /** Decay of event impulses on arousal / valence. */
  kickDecay: 2.8,
  valenceKickDecay: 14,
  valenceTau: 5,
  tensionTau: 3,
  duckAttack: 0.12,
  duckRelease: 0.3,
  /** A shot nobody resolves (no goal/save/miss event) lets go after this long. */
  holdMin: 0.5,
  holdMax: 1.4,
  /** The attacking side only flips when the other threat leads by this margin. */
  sideMargin: 0.1,
  /** Mood changes need this long on the other side of the threshold. */
  moodDwell: 2,
  /** Chants: calm + willing for this long before starting… */
  chantCalm: 5,
  /** …anticipation above this kills a chant, below `chantCalmAnt` counts as calm. */
  chantDanger: 0.55,
  chantCalmAnt: 0.3,
  chantMax: 26,
  chantCooldown: 10,
  /** Number of chant templates the engine provides (0..N−1). */
  chantTemplates: 4,
  /** Arousal baselines per state. */
  baseMenu: 0.1,
  baseHalftime: 0.2,
  basePlay: 0.34,
  baseShootout: 0.3,
} as const;

/** Minimum seconds between two cues of the same kind (anti machine-gun). */
const CUE_GAP: Record<CueKind, number> = {
  roar: 0,
  awayRoar: 0,
  groan: 1.2,
  gasp: 0.8,
  ooh: 1.0,
  cheer: 1.5,
  applause: 3,
  boo: 3,
  jeer: 5,
  sigh: 2.5,
  ole: 0.35,
  chantStart: 0,
  chantStop: 0,
};

const follow = (x: number, target: number, dt: number, tau: number): number => x + (target - x) * (1 - Math.exp(-dt / tau));

export interface CrowdModel {
  readonly state: EmotionState;
  /** Advance by `dt` seconds. Returns cues decided this step (state changes, chants, timeouts). */
  update(dt: number, p: PulseLike): CrowdCue[];
  /** Feed one sim event. Returns the crowd's immediate reactions. */
  event(e: SimEvent, p: PulseLike): CrowdCue[];
  /** Current bed mix targets. */
  mix(): CrowdMix;
  reset(): void;
}

export function createCrowdModel(): CrowdModel {
  const s: EmotionState = {
    arousal: EMO.baseMenu,
    valence: 0,
    anticipation: 0,
    tension: 0,
    hold: 0,
    stun: 0,
    side: -1,
    flat: 0,
    progress: 0,
    late: 0,
    mood: 'neutral',
    chanting: false,
    chantAway: false,
    chantTemplate: 0,
  };

  let clock = 0;
  let prevState: string | null = null;
  let curState = 'menu';
  let halfLen = 0;
  let diff = 0;
  // impulses
  let arousalKick = 0;
  let valenceKick = 0;
  let arousalBase = EMO.baseMenu as number;
  // held breath
  let holdT = 0;
  let holdLevel = 0;
  let holdTeam = -1;
  // stun
  let stunT = 0;
  let stunLen = 1;
  let stunPeak = 0;
  // anticipation floor (set pieces)
  let floorT = 0;
  let floorLevel = 0;
  // slow momentum
  let momentum = 0;
  // attribution
  let lastShotTeam = -1;
  let lastShotT = -99;
  let lastKickTeam = -1;
  let passChain = 0;
  // mood hysteresis
  let moodCand: Mood = 'neutral';
  let moodCandT = 0;
  // chants
  let calmT = 0;
  let chantT = 0;
  let chantCool = 4;
  let chantCount = 0;
  let awayPressT = 0;
  let fullTimeResult = 0;
  const lastCue: Partial<Record<CueKind, number>> = {};
  let out: CrowdCue[] = [];

  function cue(kind: CueKind, intensity: number, delay = 0, dur = 1, variant = 0, away = false): void {
    const gap = CUE_GAP[kind];
    const last = lastCue[kind];
    const at = clock + delay;
    if (gap > 0 && last !== undefined && at - last < gap) return;
    lastCue[kind] = at;
    out.push({ kind, intensity: clamp(intensity, 0, 1), delay, dur, variant, away });
  }

  function flush(): CrowdCue[] {
    const r = out;
    out = [];
    return r;
  }

  function stopChant(fade: number): void {
    if (!s.chanting) return;
    cue('chantStop', 0, 0, fade, s.chantTemplate, s.chantAway);
    s.chanting = false;
    chantT = 0;
    calmT = 0;
    chantCool = EMO.chantCooldown + ((chantCount * 7) % 9);
  }

  function resolveHold(): void {
    holdT = 0;
    holdLevel = 0;
    holdTeam = -1;
  }

  function kickArousal(v: number): void {
    arousalKick = Math.min(0.6, arousalKick + v);
  }

  function kickValence(v: number): void {
    valenceKick = clamp(valenceKick + v, -1, 1);
    s.valence = clamp(s.valence + v * 0.8, -1, 1);
  }

  function shooterTeam(): number {
    if (clock - lastShotT < 4 && lastShotTeam >= 0) return lastShotTeam;
    if (holdTeam >= 0) return holdTeam;
    if (lastKickTeam >= 0) return lastKickTeam;
    return s.side >= 0 ? s.side : 0;
  }

  /** How much a goal matters to the side that scored, from the goal difference after it. */
  function importance(d: number): number {
    if (d === 0 || d === 1) return 1;
    if (d === 2) return 0.7;
    if (d >= 3) return 0.45;
    if (d === -1) return 0.75;
    return 0.4;
  }

  function onState(from: string | null, to: string, p: PulseLike): void {
    curState = to;
    if (from === null) return; // first observation: adopt silently
    const d = (p.score[0] || 0) - (p.score[1] || 0);
    if (to === 'play') {
      if (from !== 'celebrate') {
        // teams are out / the restart: a kick-off cheer
        cue('cheer', 0.5, 0, 2.2);
        kickArousal(0.25);
      }
    } else if (to === 'halftime') {
      stopChant(1.2);
      resolveHold();
      cue('applause', 0.32 + 0.25 * clamp(s.valence + 0.5, 0, 1), 0.3, 5.5);
      if (d <= -2) cue('boo', 0.3, 0.6, 2.4);
    } else if (to === 'fulltime') {
      stopChant(0.8);
      resolveHold();
      fullTimeResult = Math.sign(d);
      if (d > 0) {
        cue('roar', 0.55, 0.15, 5, 0);
        cue('applause', 0.85, 1.2, 11);
        kickValence(0.5);
      } else if (d === 0) {
        cue('applause', 0.45, 0.4, 6.5);
      } else {
        cue('groan', 0.4, 0.2, 1.8);
        cue('applause', 0.2, 1.6, 4.5);
        if (d <= -3) cue('boo', 0.5, 0.9, 3);
        cue('awayRoar', 0.5, 0.2, 4, 0, true);
      }
    } else if (to === 'shootout') {
      stopChant(0.6);
      resolveHold();
    } else if (to === 'menu') {
      stopChant(0.5);
      resetMatch();
    }
  }

  function resetMatch(): void {
    halfLen = 0;
    arousalKick = 0;
    valenceKick = 0;
    resolveHold();
    stunT = 0;
    s.stun = 0;
    floorT = 0;
    momentum = 0;
    lastShotTeam = -1;
    lastShotT = -99;
    lastKickTeam = -1;
    passChain = 0;
    calmT = 0;
    chantCool = 4;
    awayPressT = 0;
    fullTimeResult = 0;
  }

  function moodCandidate(cur: Mood): Mood {
    if (s.arousal > (cur === 'delirious' ? 0.6 : 0.82) && s.valence > (cur === 'delirious' ? 0.3 : 0.5)) return 'delirious';
    if (s.valence < (cur === 'flat' ? -0.3 : -0.45) && s.tension < (cur === 'flat' ? 0.45 : 0.3)) return 'flat';
    if (s.tension > (cur === 'nervous' ? 0.45 : 0.6) && s.valence < 0.35) return 'nervous';
    if (s.valence > (cur === 'confident' ? 0.1 : 0.25)) return 'confident';
    return 'neutral';
  }

  function update(dtIn: number, p: PulseLike): CrowdCue[] {
    const dt = clamp(Number.isFinite(dtIn) ? dtIn : 0, 0, 0.25);
    clock += dt;
    if (p.state !== prevState) {
      onState(prevState, p.state, p);
      prevState = p.state;
    }
    const st = curState;
    const inPlay = st === 'play';
    const matchOn = inPlay || st === 'celebrate';

    // ---- clock / score context -------------------------------------------------
    if (p.live && p.timeLeft > halfLen) halfLen = p.timeLeft;
    const frac = halfLen > 0 ? clamp(1 - p.timeLeft / halfLen, 0, 1) : 0;
    if (matchOn || st === 'halftime') {
      s.progress = clamp((Math.max(1, p.half) - 1 + frac) / 2, 0, 1);
      if (st === 'halftime') s.progress = 0.5;
      if (p.stoppage) s.progress = Math.max(s.progress, p.half >= 2 ? 1 : 0.5);
    } else if (st === 'fulltime' || st === 'shootout') s.progress = 1;
    else s.progress = 0;
    s.late = smoothstep(0.62, 0.92, s.progress);
    diff = (p.score[0] || 0) - (p.score[1] || 0);
    const ad = Math.abs(diff);
    const close = ad === 0 ? 1 : ad === 1 ? 0.85 : ad === 2 ? 0.25 : 0;

    // ---- tension ------------------------------------------------------------------
    let tensionTarget = 0;
    if (matchOn) tensionTarget = close * (0.12 + 0.88 * s.late);
    else if (st === 'shootout') tensionTarget = 0.95;
    s.tension = clamp(follow(s.tension, tensionTarget, dt, EMO.tensionTau), 0, 1);

    // ---- anticipation (fast attack, quick release) + attacking side with hysteresis
    const tH = clamp(p.threat[0] || 0, 0, 1);
    const tA = clamp(p.threat[1] || 0, 0, 1);
    momentum = follow(momentum, inPlay ? tH - tA : 0, dt, 8);
    let antTarget = 0;
    if (inPlay) {
      if (s.side === 0) {
        if (tA > tH + EMO.sideMargin) s.side = 1;
      } else if (s.side === 1) {
        if (tH > tA + EMO.sideMargin) s.side = 0;
      } else if (Math.max(tH, tA) > 0.15) s.side = tH >= tA ? 0 : 1;
      const raw = s.side === 1 ? tA * 0.9 : tH;
      antTarget = smoothstep(0.2, 0.85, raw);
    } else if (st === 'shootout') {
      antTarget = 0.4;
    }
    if (floorT > 0) {
      floorT -= dt;
      if (inPlay) antTarget = Math.max(antTarget, floorLevel);
    }
    if (holdT > 0) {
      holdT -= dt;
      antTarget = Math.max(antTarget, 0.55 + 0.45 * holdLevel);
      if (holdT <= 0) {
        // nobody resolved the shot (dragged well wide / blocked silently): let go
        if (holdTeam === 0) cue('sigh', 0.3 + 0.2 * holdLevel, 0, 1.0);
        resolveHold();
      }
    }
    s.anticipation = clamp(follow(s.anticipation, antTarget, dt, antTarget > s.anticipation ? EMO.antAttack : EMO.antRelease), 0, 1);
    if (!inPlay && st !== 'shootout' && s.anticipation < 0.02) s.side = -1;

    // ---- held breath ----------------------------------------------------------------
    const develop = inPlay || st === 'shootout' ? 0.7 * smoothstep(0.6, 0.92, s.anticipation) : 0;
    const holdTarget = Math.max(develop, holdT > 0 ? 0.55 + 0.45 * holdLevel : 0);
    s.hold = clamp(follow(s.hold, holdTarget, dt, holdTarget > s.hold ? EMO.duckAttack : EMO.duckRelease), 0, 1);

    // ---- stun (after conceding) -----------------------------------------------------
    if (stunT > 0) {
      stunT -= dt;
      // full for the first half of the spell, then the murmur creeps back
      s.stun = clamp(stunPeak * smoothstep(0, 0.5, Math.max(0, stunT) / stunLen), 0, 1);
    } else s.stun = follow(s.stun, 0, dt, 0.4);

    // ---- valence -----------------------------------------------------------------------
    valenceKick = follow(valenceKick, 0, dt, EMO.valenceKickDecay);
    let valTarget = 0;
    if (matchOn || st === 'halftime' || st === 'shootout') {
      const scoreTerm = clamp(diff * 0.35, -0.8, 0.8) * (0.6 + 0.4 * s.progress);
      valTarget = scoreTerm + 0.2 * momentum + valenceKick;
    } else if (st === 'fulltime') {
      valTarget = fullTimeResult > 0 ? 0.7 : fullTimeResult < 0 ? -0.6 : 0.05;
    }
    s.valence = clamp(follow(s.valence, clamp(valTarget, -1, 1), dt, EMO.valenceTau), -1, 1);

    // ---- flatness: well behind with little tension left ------------------------------------
    const flatTarget = matchOn ? smoothstep(0.25, 0.7, -s.valence) * (1 - s.tension) * (0.4 + 0.6 * s.late) : 0;
    s.flat = clamp(follow(s.flat, flatTarget, dt, 4), 0, 1);

    // ---- arousal ---------------------------------------------------------------------------
    arousalKick = follow(arousalKick, 0, dt, EMO.kickDecay);
    let aTarget: number;
    if (matchOn) {
      aTarget =
        EMO.basePlay +
        0.1 * Math.max(0, s.valence) -
        0.16 * s.flat +
        0.2 * s.tension +
        // the build-up lifts the house; a held breath takes that lift away again
        0.22 * s.anticipation * (s.side === 1 ? 0.6 : 1) * (1 - s.hold) +
        0.05 * Math.min(1, (p.ballSpeed || 0) / 25);
    } else if (st === 'shootout') aTarget = EMO.baseShootout + 0.25 * s.anticipation;
    else if (st === 'halftime') aTarget = EMO.baseHalftime;
    else if (st === 'fulltime') aTarget = fullTimeResult > 0 ? 0.42 : fullTimeResult < 0 ? 0.14 : 0.28;
    else aTarget = EMO.baseMenu;
    arousalBase = follow(arousalBase, aTarget, dt, aTarget > arousalBase ? EMO.arousalAttack : EMO.arousalDecay);
    s.arousal = clamp(arousalBase + arousalKick, 0, 1);

    // ---- mood (Schmitt thresholds + dwell) --------------------------------------------------
    const cand = moodCandidate(s.mood);
    if (cand === s.mood) {
      moodCandT = 0;
      moodCand = cand;
    } else {
      if (cand !== moodCand) {
        moodCand = cand;
        moodCandT = 0;
      }
      moodCandT += dt;
      if (moodCandT >= EMO.moodDwell) {
        s.mood = cand;
        moodCandT = 0;
      }
    }

    // ---- derisive whistles while the away side camps near the home goal ----------------------
    if (inPlay && s.side === 1 && s.anticipation > 0.45 && holdT <= 0) {
      awayPressT += dt;
      if (awayPressT > 1.5) {
        cue('jeer', 0.25 + 0.3 * s.anticipation, 0, 2.2);
        awayPressT = -5;
      }
    } else if (awayPressT > 0) awayPressT = Math.max(0, awayPressT - dt);
    else awayPressT = Math.min(0, awayPressT + dt);

    // ---- chants ------------------------------------------------------------------------------
    chantCool -= dt;
    if (s.chanting) {
      chantT += dt;
      if (!inPlay) stopChant(0.6);
      else if (s.anticipation > EMO.chantDanger || s.hold > 0.5) stopChant(0.5);
      else if (!s.chantAway && s.mood === 'flat') stopChant(1.5);
      else if (s.chantAway && s.valence > -0.1) stopChant(1.5);
      else if (chantT > EMO.chantMax) stopChant(2.5);
    } else {
      const calm = inPlay && p.live && s.anticipation < EMO.chantCalmAnt && s.stun < 0.1 && holdT <= 0;
      const homeWilling =
        s.mood === 'confident' || s.mood === 'delirious' || s.mood === 'nervous' || (s.mood === 'neutral' && s.arousal > 0.36 && s.valence > -0.08);
      const awayWilling = s.mood === 'flat' && diff < 0;
      if (calm && (homeWilling || awayWilling)) calmT += dt;
      else calmT = Math.max(0, calmT - 2 * dt);
      if (calmT > EMO.chantCalm && chantCool <= 0) {
        s.chanting = true;
        s.chantAway = awayWilling && !homeWilling;
        chantT = 0;
        chantCount++;
        // template choice: 0 = rhythmic clap-and-shout (urgent), 1/2 = melodic, 3 = slow anthem
        let tpl: number;
        if (s.chantAway) tpl = 1 + (chantCount % 2);
        else if (s.mood === 'nervous') tpl = 0;
        else if (s.mood === 'delirious') tpl = 3;
        else if (s.mood === 'confident') tpl = 1 + (chantCount % 3);
        else tpl = chantCount % 2 === 0 ? 0 : 2;
        s.chantTemplate = tpl % EMO.chantTemplates;
        cue('chantStart', s.chantAway ? 0.45 : 0.55 + 0.45 * clamp(s.valence + 0.3, 0, 1), 0, EMO.chantMax, s.chantTemplate, s.chantAway);
      }
    }

    return flush();
  }

  function event(e: SimEvent, p: PulseLike): CrowdCue[] {
    const tH = clamp(p.threat[0] || 0, 0, 1);
    const tA = clamp(p.threat[1] || 0, 0, 1);
    switch (e.t) {
      case 'kick': {
        lastKickTeam = e.team;
        if (e.team === 1) passChain = 0;
        else if (e.kind === 'pass' || e.kind === 'through') {
          passChain++;
          // showboating: the house "olé"s every pass when cruising late on
          if (passChain >= 5 && diff >= 2 && s.late > 0.2 && s.valence > 0.4 && s.anticipation < 0.35) {
            cue('ole', 0.3 + 0.05 * Math.min(6, passChain - 5), 0.05, 0.5);
          }
        }
        if (e.kind === 'clear' && e.team === 0 && tA > 0.5) cue('cheer', 0.22, 0, 1.2);
        break;
      }
      case 'shot': {
        lastShotTeam = e.team;
        lastShotT = clock;
        const q = clamp(0.4 + 1.2 * (e.xg || 0), 0.4, 1);
        holdT = EMO.holdMin + (EMO.holdMax - EMO.holdMin) * q;
        holdLevel = q;
        holdTeam = e.team;
        s.side = e.team;
        s.anticipation = Math.max(s.anticipation, 0.55 + 0.45 * q);
        kickArousal(0.12 * q);
        if (s.chanting) stopChant(0.3);
        if (e.team === 0) cue('ooh', q, 0, 0.8);
        else cue('gasp', 0.15 + 0.35 * q, 0, 0.4);
        break;
      }
      case 'goal': {
        resolveHold();
        s.anticipation = 0;
        floorT = 0;
        passChain = 0;
        const d = (e.score[0] || 0) - (e.score[1] || 0);
        diff = d;
        if (s.chanting) stopChant(0.3);
        const lateNow = curState === 'shootout' ? 0.8 : s.late;
        if (e.team === 0) {
          const imp = curState === 'shootout' ? 0.8 : importance(d);
          const I = clamp(0.3 + 0.4 * imp + 0.2 * lateNow * imp + (e.big ? 0.08 : 0) + (e.lastGasp ? 0.2 : 0), 0.3, 1);
          const delirious = e.lastGasp || (lateNow > 0.5 && imp === 1);
          cue('roar', I, 0, 4.5 + 5 * I + (delirious ? 3 : 0), delirious ? 1 : 0);
          arousalBase = Math.max(arousalBase, 0.6 + 0.3 * I);
          arousalKick = Math.max(arousalKick, 0.25 + 0.2 * I);
          kickValence(0.45 + 0.5 * I);
          stunT = 0;
          s.stun = 0;
          // the celebration rolls into a song
          chantCool = Math.min(chantCool, 3 + 3 * I);
          calmT = Math.max(calmT, EMO.chantCalm * 0.5);
        } else {
          const imp = curState === 'shootout' ? 0.8 : importance(-d);
          const I = clamp(0.3 + 0.4 * imp + 0.2 * lateNow * imp + (e.lastGasp ? 0.2 : 0), 0.3, 1);
          cue('gasp', 0.5, 0, 0.4);
          cue('groan', 0.5 + 0.5 * I, 0.25, 1.6 + 1.2 * I);
          cue('awayRoar', 0.4 + 0.6 * I, 0, 3 + 2.5 * I, 0, true);
          stunPeak = 0.6 + 0.4 * I;
          stunLen = 6 + 8 * I;
          stunT = stunLen;
          arousalKick = 0;
          arousalBase = Math.min(arousalBase, 0.3);
          kickValence(-(0.4 + 0.45 * I));
          calmT = 0;
          chantCool = Math.max(chantCool, 8);
        }
        break;
      }
      case 'save': {
        const wasHold = holdT > 0;
        resolveHold();
        const q = clamp((e.speed || 0) / 30, 0.25, 1) * (e.diving ? 1 : 0.7);
        if (e.team === 1) {
          // the away keeper denies the home side
          cue('gasp', 0.4 + 0.5 * q, 0, 0.4);
          cue('groan', 0.35 + 0.5 * q, 0.25, 1.2 + 0.6 * q);
          cue('applause', 0.18 + 0.2 * q, 1.6, 2.6);
          kickArousal(0.2 * q + (wasHold ? 0.05 : 0));
          kickValence(-0.04);
        } else {
          cue('cheer', 0.4 + 0.5 * q, 0, 1.6 + q);
          cue('applause', 0.32 + 0.4 * q, 0.5, 3 + 2 * q);
          kickArousal(0.25 * q);
          kickValence(0.1);
        }
        break;
      }
      case 'nearmiss': {
        resolveHold();
        if (e.team === 0) {
          cue('gasp', 0.8, 0, 0.4);
          cue('groan', 0.7, 0.25, 1.9);
          cue('applause', 0.25, 1.9, 2.6);
          kickArousal(0.25);
        } else {
          cue('sigh', 0.5, 0.1, 1.1);
          cue('jeer', 0.3, 0.6, 1.8);
          kickArousal(0.1);
        }
        break;
      }
      case 'post': {
        const team = shooterTeam();
        resolveHold();
        const q = clamp((e.speed || 0) / 28, 0.4, 1);
        if (team === 0) {
          cue('gasp', 0.6 + 0.4 * q, 0, 0.45);
          cue('groan', 0.6 + 0.4 * q, 0.25, 2.2);
          kickArousal(0.3);
        } else {
          cue('gasp', 0.45 + 0.3 * q, 0, 0.4);
          cue('sigh', 0.6, 0.45, 1.2);
          kickArousal(0.2);
        }
        break;
      }
      case 'tackle': {
        if (e.team === 0) {
          if (e.slide || tA > 0.45) {
            cue('cheer', 0.2 + 0.3 * tA + (e.slide ? 0.12 : 0), 0, 1.3);
            if (e.slide) cue('applause', 0.2, 0.4, 2);
          }
          kickArousal(0.06);
        } else if (s.side === 0 && s.anticipation > 0.45) cue('sigh', 0.35, 0.05, 0.9);
        break;
      }
      case 'block': {
        const shotInAir = holdT > 0;
        if (e.team === 0) {
          if ((shotInAir && holdTeam === 1) || tA > 0.4) cue('cheer', 0.3, 0, 1.2);
        } else if (shotInAir && holdTeam === 0) cue('groan', 0.35, 0.05, 1.0);
        if (shotInAir) resolveHold();
        break;
      }
      case 'collide': {
        if ((e.force || 0) > 9) cue('gasp', 0.2, 0, 0.3);
        break;
      }
      case 'foul': {
        // `team` = the side the free kick is given AGAINST
        if (s.chanting) stopChant(0.6);
        resolveHold();
        if (e.team === 1) {
          cue('boo', 0.35 + 0.2 * e.card, 0.1, 2 + 0.6 * e.card);
          if (e.card > 0) cue('cheer', 0.3 + 0.15 * e.card, 1.5, 1.5);
          kickArousal(0.1);
        } else {
          cue('jeer', 0.45 + 0.2 * e.card, 0.1, 2.2 + 0.5 * e.card);
          if (e.card > 0) cue('boo', 0.4 + 0.2 * e.card, 0.35, 2.6);
          kickValence(-0.04 * e.card);
          kickArousal(0.08);
        }
        break;
      }
      case 'offside': {
        resolveHold();
        if (e.team === 0) cue('sigh', 0.4, 0.1, 1.0);
        else cue('cheer', 0.2, 0.1, 1.0);
        break;
      }
      case 'setpiece': {
        if (e.kind === 'corner') {
          floorT = 4.5;
          floorLevel = e.team === 0 ? 0.32 : 0.26;
          if (e.team === 0) {
            cue('cheer', 0.22, 0, 1.4);
            kickArousal(0.12);
          }
        } else if (e.kind === 'freekick') {
          floorT = 3;
          floorLevel = 0.15;
        }
        break;
      }
      case 'turnover': {
        if (e.team === 1) {
          passChain = 0;
          if (s.side === 0 && s.anticipation > 0.5) cue('sigh', 0.3, 0.05, 0.9);
        } else if (tH < 0.3 && tA > 0.5) kickArousal(0.05);
        break;
      }
      default:
        break;
    }
    return flush();
  }

  function mix(): CrowdMix {
    const a = s.arousal;
    const st = curState;
    const playLike = st === 'play' || st === 'celebrate' || st === 'shootout';
    // the menu is heard from outside the ground: quieter as well as duller
    const level = (0.5 + 1.1 * Math.pow(a, 1.3)) * (1 - 0.6 * s.hold) * (1 - 0.5 * s.stun) * (st === 'menu' ? 0.5 : 1);
    const shoutMix = smoothstep(0.42, 0.9, a);
    let cutoff = 1300 + 4200 * Math.pow(a, 1.2) - 500 * s.flat;
    if (st === 'menu') cutoff = 520;
    else if (st === 'halftime') cutoff = Math.min(cutoff, 1300);
    return {
      level,
      murmur: 1 - 0.7 * shoutMix,
      shout: shoutMix * (0.55 + 0.45 * clamp(s.valence + 0.4, 0, 1)),
      ooh: playLike ? Math.pow(s.anticipation, 1.6) * (s.side === 1 ? 0.35 : 1) : 0,
      oohRate: 0.9 + 0.28 * s.anticipation,
      rumble: 0.3 + 0.7 * a,
      cutoff: Math.max(450, cutoff),
      duck: s.hold,
      away: playLike ? 0.1 + 0.3 * Math.max(0, -s.valence) : 0.03,
    };
  }

  function reset(): void {
    s.arousal = EMO.baseMenu;
    arousalBase = EMO.baseMenu;
    s.valence = 0;
    s.anticipation = 0;
    s.tension = 0;
    s.hold = 0;
    s.stun = 0;
    s.side = -1;
    s.flat = 0;
    s.progress = 0;
    s.late = 0;
    s.mood = 'neutral';
    moodCand = 'neutral';
    moodCandT = 0;
    s.chanting = false;
    s.chantAway = false;
    chantT = 0;
    chantCount = 0;
    clock = 0;
    prevState = null;
    curState = 'menu';
    stunPeak = 0;
    diff = 0;
    for (const k of Object.keys(lastCue) as CueKind[]) delete lastCue[k];
    out = [];
    resetMatch();
  }

  return { state: s, update, event, mix, reset };
}
