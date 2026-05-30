/*
 * CrazyGames SDK wrapper (B1–B4) — the single, defensive seam between the game
 * and the CrazyGames HTML5 SDK v3.
 *
 * Design rules (work_ahead.md §B):
 *  - **No-op in local dev.** Everything is gated behind `available()`, so the
 *    game runs identically with or without the SDK present. Nothing here is
 *    required for progress.
 *  - **Resilient to API drift.** The SDK is loaded at runtime from the platform
 *    (it injects `window.CrazyGames.SDK` on their domain; the npm package exposes
 *    the same object). We *feature-detect every call* and wrap it in try/catch, so
 *    a renamed/missing method degrades to a no-op instead of breaking the match.
 *    Verify exact names against the current official docs when enabling on QA.
 *  - **Honest.** Ads are light + opt-in (rewarded) or at natural breaks
 *    (interstitial between matches, never mid-match); audio mutes during ads.
 *
 * Init handshake (B1): call {@link initCrazyGames} once at boot. It detects the
 * environment, runs the SDK loading handshake around first asset load, and swaps
 * the storage backend (B5) to the CrazyGames data module when present.
 *
 * The SDK is NOT bundled. We read it off `window` at runtime, so this file has no
 * import of `@crazygames/sdk` and adds nothing to the bundle in dev.
 */
import { setStorageBackend, type KVBackend } from './storage';
import { Audio } from '../core/audio';

// ---- minimal structural typing of the bits of the SDK we touch ---------------
// (kept loose on purpose — we feature-detect rather than rely on these shapes)

type AdType = 'midgame' | 'rewarded';
interface AdCallbacks {
  adStarted?: () => void;
  adFinished?: () => void;
  adError?: (e: unknown) => void;
}
interface CrazySDK {
  init?: () => Promise<void> | void;
  environment?: string;
  game?: {
    // v3 loading handshake; sdkGameLoading* kept as a v2 fallback (we call whichever exists)
    loadingStart?: () => void;
    loadingStop?: () => void;
    sdkGameLoadingStart?: () => void;
    sdkGameLoadingStop?: () => void;
    gameplayStart?: () => void;
    gameplayStop?: () => void;
    happytime?: () => void;
    inviteLink?: (params?: Record<string, unknown>) => Promise<string> | string;
  };
  ad?: {
    requestAd?: (type: AdType, callbacks?: AdCallbacks) => void;
  };
  data?: {
    getItem?: (key: string) => string | null;
    setItem?: (key: string, value: string) => void;
    removeItem?: (key: string) => void;
  };
}

// ---- state ------------------------------------------------------------------

let sdk: CrazySDK | null = null;
let ready = false;
/** True once an SDK was found and init resolved. */
let active = false;
/** Guards against re-entrant gameplay events (start/start or stop/stop). */
let gameplayLive = false;

/** Locate the SDK object the platform injects (or the npm global), if any. */
function findSdk(): CrazySDK | null {
  const w = globalThis as unknown as { CrazyGames?: { SDK?: CrazySDK } };
  return w.CrazyGames?.SDK ?? null;
}

/** True when a usable SDK is present and initialised (false in local dev). */
export function available(): boolean {
  return active && sdk !== null;
}

/** Best-effort: run `fn`, swallow any error so the SDK can never break the game. */
function safe(fn: () => void): void {
  if (!available()) return;
  try {
    fn();
  } catch {
    /* SDK call failed / method renamed — ignore, the game continues */
  }
}

// ---- init + loading handshake (B1) ------------------------------------------

/**
 * Detect + initialise the SDK once at boot. No-ops cleanly when the SDK is
 * absent (local dev) or init fails. Resolves either way so boot never blocks.
 */
export async function initCrazyGames(): Promise<void> {
  if (ready) return;
  ready = true;
  sdk = findSdk();
  if (!sdk) return; // local dev / SDK not injected — stay fully no-op

  try {
    await sdk.init?.();
    // 'disabled' means the SDK is present but inert (e.g. embedded off-platform)
    if (sdk.environment === 'disabled') {
      sdk = null;
      return;
    }
    active = true;
    // swap the save backend to the platform data module if it exposes the KV shape
    adoptDataBackend();
    loadingStart(); // bracket the (already-fast) boot so the platform loader shows
  } catch {
    sdk = null;
    active = false;
  }
}

/** The reported environment ('local' | 'crazygames' | 'disabled' | unknown). */
export function environment(): string {
  return sdk?.environment ?? 'local';
}

/** Use the CrazyGames data module as the storage backend when it's usable (B5). */
function adoptDataBackend(): void {
  const data = sdk?.data;
  if (!data || typeof data.getItem !== 'function' || typeof data.setItem !== 'function') return;
  const backend: KVBackend = {
    getItem: (k) => data.getItem!(k),
    setItem: (k, v) => data.setItem!(k, v),
    removeItem: (k) => (data.removeItem ? data.removeItem(k) : data.setItem!(k, '')),
  };
  setStorageBackend(backend);
}

/** Bracket the initial asset/scene load so the platform shows its branded loader.
 *  Uses the v3 `loadingStart/Stop`, falling back to the v2 `sdkGameLoading*` name. */
export function loadingStart(): void {
  safe(() => (sdk!.game?.loadingStart ?? sdk!.game?.sdkGameLoadingStart)?.());
}
export function loadingStop(): void {
  safe(() => (sdk!.game?.loadingStop ?? sdk!.game?.sdkGameLoadingStop)?.());
}

// ---- gameplay events (B2) ---------------------------------------------------

/** A match has begun / resumed — drives ad timing + analytics. Idempotent. */
export function gameplayStart(): void {
  if (gameplayLive) return;
  gameplayLive = true;
  safe(() => sdk!.game?.gameplayStart?.());
}

/** A match has paused / ended / returned to menu. Idempotent. */
export function gameplayStop(): void {
  if (!gameplayLive) return;
  gameplayLive = false;
  safe(() => sdk!.game?.gameplayStop?.());
}

/** Celebrate a big moment (trophy, big win) — confetti on the platform shell. */
export function happytime(): void {
  safe(() => sdk!.game?.happytime?.());
}

// ---- ads (B3 interstitial / B4 rewarded) ------------------------------------

/**
 * Request an ad. Mutes audio + reports gameplay-stop for the ad's duration, then
 * restores. `onResult(true)` means a rewarded ad finished and the reward should
 * be granted; for an interstitial, `done` is always called. When no SDK is
 * present (dev), resolves immediately as "no ad shown" (`false`) so callers can
 * proceed without branching on the environment.
 */
export function requestAd(type: AdType, onResult: (rewardedComplete: boolean) => void): void {
  if (!available() || typeof sdk!.ad?.requestAd !== 'function') {
    onResult(false); // no SDK / no ad support — proceed unrewarded, no penalty
    return;
  }
  let settled = false;
  const finish = (rewarded: boolean): void => {
    if (settled) return;
    settled = true;
    try {
      Audio.setMute(false);
    } catch {
      /* ignore */
    }
    gameplayStart(); // matches were stopped for the ad; resume reporting
    onResult(rewarded);
  };

  // a match is interrupted for the ad — stop gameplay reporting + mute
  gameplayStop();
  try {
    Audio.setMute(true);
  } catch {
    /* ignore */
  }

  try {
    sdk!.ad!.requestAd!(type, {
      adFinished: () => finish(type === 'rewarded'),
      adError: () => finish(false),
      adStarted: () => {
        /* already muted above */
      },
    });
  } catch {
    finish(false); // request threw — never leave the game muted/stuck
  }
}

/** Convenience: an interstitial at a natural break (between World Cup matches). */
export function interstitial(done: () => void): void {
  requestAd('midgame', () => done());
}

/** Convenience: an opt-in rewarded ad; `onComplete(true)` only if fully watched. */
export function rewarded(onComplete: (granted: boolean) => void): void {
  requestAd('rewarded', onComplete);
}
