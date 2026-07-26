/**
 * Monotonic revision counter for SessionState writes (Phase 0 multi-device sync).
 */

/** @type {number} */
let sessionRev = 0;

/** Latest validated session blob mirrored from disk (for SSE snapshots). */
/** @type {unknown | null} */
let cachedSessionState = null;

/** @returns {number} */
export function getSessionRev() {
  return sessionRev;
}

/** @returns {unknown | null} */
export function getCachedSessionState() {
  return cachedSessionState;
}

/**
 * Seed rev from boot load (does not broadcast).
 * @param {unknown} state
 */
export function seedSessionRevState(state) {
  cachedSessionState = state;
  if (sessionRev === 0) {
    sessionRev = 1;
  }
}

/**
 * Bump rev after a successful sessions write and return the new value.
 * @param {unknown} state
 * @returns {number}
 */
export function bumpSessionRev(state) {
  sessionRev += 1;
  cachedSessionState = state;
  return sessionRev;
}

/** Reset in-memory rev (tests). */
export function resetSessionRevStoreForTests() {
  sessionRev = 0;
  cachedSessionState = null;
}
