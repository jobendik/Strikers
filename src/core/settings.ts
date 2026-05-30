import { CFG } from '../config/constants';
import { Audio } from './audio';
import { Haptics } from './haptics';
import { renderer } from '../rendering/scene';
import { setReplayEnabled } from '../game/replay';
import { match } from '../game/state';

/*
 * Persistent player settings (localStorage). Covers both presentation prefs
 * (sound, haptics, graphics tier, left-handed layout) and the menu game options
 * (difficulty, half length, match type, rules) so a returning player keeps their
 * setup. Everything degrades gracefully if storage is unavailable.
 */

export interface Settings {
  sound: boolean;
  haptics: boolean;
  quality: 'high' | 'lite';
  lefty: boolean;
  diff: number;
  half: number;
  knockout: boolean;
  sim: boolean;
  mentality: number;
}

const KEY = 'yuka-strikers/settings';

const DEFAULTS: Settings = {
  sound: true,
  haptics: true,
  quality: 'high',
  lefty: false,
  diff: 1,
  half: 180,
  knockout: false,
  sim: false,
  mentality: 1,
};

const S: Settings = load();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore — storage may be blocked (private mode) */
  }
  return { ...DEFAULTS };
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch {
    /* ignore */
  }
}

export function getSettings(): Settings {
  return S;
}

const el = (id: string): HTMLElement | null => document.getElementById(id);

/** Light up the option in a segmented control whose data-v matches `value`. */
function setSeg(id: string, value: number): void {
  const group = el(id);
  if (!group) return;
  group.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', Number(b.getAttribute('data-v')) === value);
  });
}

/** Apply the graphics tier (replays + pixel ratio + soft shadows) to the engine. */
function applyQuality(): void {
  const high = S.quality === 'high';
  setReplayEnabled(high);
  renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio, 2) : 1);
  renderer.shadowMap.enabled = high;
}

/** Push every setting into the running game + the DOM. */
export function applySettings(): void {
  Audio.setMute(!S.sound);
  Haptics.setEnabled(S.haptics);
  applyQuality();
  document.body.classList.toggle('lefty', S.lefty);
  CFG.diff = S.diff;
  CFG.matchSeconds = S.half;
  match.settleDraws = S.knockout;
  match.simRules = S.sim;
  match.teams[0].mentality = S.mentality; // the user team's chosen approach

  const mute = el('muteBtn');
  if (mute) mute.textContent = S.sound ? '🔊' : '🔇';
  setSeg('segDiff', S.diff);
  setSeg('segLen', S.half);
  setSeg('segMode', S.knockout ? 1 : 0);
  setSeg('segRules', S.sim ? 1 : 0);
  setSeg('segMentality', S.mentality);
  setSeg('segHaptics', S.haptics ? 1 : 0);
  setSeg('segQuality', S.quality === 'high' ? 1 : 0);
  setSeg('segLayout', S.lefty ? 1 : 0);
}

/** Wire every menu/settings control to mutate, persist and re-apply. Call once. */
export function initSettings(): void {
  const seg = (id: string, cb: (v: number) => void): void => {
    const group = el(id);
    if (!group) return;
    group.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        cb(Number(b.getAttribute('data-v')));
        persist();
        applySettings();
      }),
    );
  };

  seg('segDiff', (v) => (S.diff = v));
  seg('segLen', (v) => (S.half = v));
  seg('segMode', (v) => (S.knockout = v === 1));
  seg('segRules', (v) => (S.sim = v === 1));
  seg('segMentality', (v) => (S.mentality = v));
  seg('segHaptics', (v) => (S.haptics = v === 1));
  seg('segQuality', (v) => (S.quality = v === 1 ? 'high' : 'lite'));
  seg('segLayout', (v) => (S.lefty = v === 1));

  el('muteBtn')?.addEventListener('click', () => {
    Audio.resume();
    S.sound = !S.sound;
    persist();
    applySettings();
  });

  // overlay open/close
  const show = (id: string, v: boolean): void => {
    el(id)?.classList.toggle('hidden', !v);
  };
  el('btnSettings')?.addEventListener('click', () => show('settings', true));
  el('btnHowto')?.addEventListener('click', () => show('howto', true));
  el('btnSettingsDone')?.addEventListener('click', () => show('settings', false));
  el('btnHowtoDone')?.addEventListener('click', () => show('howto', false));

  applySettings();
}
