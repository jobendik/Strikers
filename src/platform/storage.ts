/*
 * Persistent key/value storage abstraction (B5).
 *
 * One tiny synchronous interface that the player save (and anything else that
 * persists) reads/writes through, so the *backend* can change without touching
 * callers. Today it is `localStorage`; once the CrazyGames SDK is wired (B1/B5)
 * its data module — which exposes the same `getItem`/`setItem`/`removeItem`
 * shape — can be swapped in via {@link setStorageBackend}, with `localStorage`
 * as the fallback when no platform account is present.
 *
 * Always degrades gracefully: if the active backend throws (private mode, quota,
 * SSR/Node with no DOM), we fall back to an in-memory map so the game keeps
 * running for the session instead of crashing. That also makes the player save
 * usable under the headless harness/Node.
 */

/** The minimal contract a storage backend must satisfy (matches both
 *  `localStorage` and the CrazyGames `data` module). */
export interface KVBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Session-only fallback used when no real backend is available/working. */
function makeMemoryBackend(): KVBackend {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

const memory = makeMemoryBackend();

/** The DOM `localStorage`, or null when it is absent/blocked. */
function detectLocalStorage(): KVBackend | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (!ls) return null;
    // probe — Safari private mode exposes localStorage but throws on setItem
    const probe = '__strikers_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

let backend: KVBackend = detectLocalStorage() ?? memory;

/**
 * Swap the active storage backend (e.g. the CrazyGames data module once the SDK
 * is ready). Pass null to revert to the best available default.
 */
export function setStorageBackend(b: KVBackend | null): void {
  backend = b ?? detectLocalStorage() ?? memory;
}

/** Read a raw string for `key`, or null if absent. Never throws. */
export function readKey(key: string): string | null {
  try {
    return backend.getItem(key);
  } catch {
    try {
      return memory.getItem(key);
    } catch {
      return null;
    }
  }
}

/** Write a raw string for `key`. Never throws; mirrors into memory as a backstop. */
export function writeKey(key: string, value: string): void {
  try {
    backend.setItem(key, value);
  } catch {
    /* primary backend failed (quota/blocked) — keep it for this session */
    try {
      memory.setItem(key, value);
    } catch {
      /* nothing we can do */
    }
  }
}

/** Remove `key`. Never throws. */
export function removeKey(key: string): void {
  try {
    backend.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Read + JSON.parse a key. Returns null on absent or malformed data. */
export function readJSON<T>(key: string): T | null {
  const raw = readKey(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** JSON.stringify + write a value. Never throws. */
export function writeJSON(key: string, value: unknown): void {
  try {
    writeKey(key, JSON.stringify(value));
  } catch {
    /* ignore — value not serialisable; should never happen for save data */
  }
}
