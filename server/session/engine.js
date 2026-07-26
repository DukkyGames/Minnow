/**
 * Server-owned Session Engine core (MIN-354 Phase 1 / MIN-359).
 * Loads SessionState at boot, owns it in memory, dispatches commands, and
 * publishes changes through Phase 0 SSE (notifySessionStateWritten).
 *
 * Lives under server/session/ (with Phase 0) to avoid colliding with vector
 * modules in server/engine/*.
 */

import { readResource, writeResource, writeConfigJson } from '../config/store.js';
import { writeWholeSessionState, useJsonSessionsStore } from '../config/sessions-repo.js';
import { validateSessionState } from '../config/validators.js';
import {
  getCachedSessionState,
  getSessionRev,
  seedSessionRevState,
} from './rev-store.js';
import { notifySessionStateWritten } from './publish.js';
import { isServerEngineEnabled } from './flag.js';

/** @typedef {import('./commands.js').SessionCommand} SessionCommand */

/** In-memory authoritative session blob (engine-owned when flag is on). */
/** @type {unknown | null} */
let engineState = null;

/** Per-chat AbortControllers for in-flight main-chat turns. */
/** @type {Map<string, AbortController>} */
const turnAbortByChatId = new Map();

/** Chats currently running a main-chat tool loop. */
/** @type {Set<string>} */
const activeTurnChatIds = new Set();

/** Debounced persist handle — coalesce rapid mid-turn publishes. */
/** @type {ReturnType<typeof setTimeout> | null} */
let flushTimer = null;
const FLUSH_DEBOUNCE_MS = 80;

/**
 * Bumped whenever in-memory state is replaced or a hard commit starts.
 * In-flight soft flushes bail when their captured generation is stale.
 */
let stateGeneration = 0;

/** Serialize mutate/commit so concurrent commands cannot lose updates. */
/** @type {Promise<unknown>} */
let writeChain = Promise.resolve();

/** @type {Promise<void> | null} */
let bootPromise = null;

/**
 * Run exclusive engine writes one-at-a-time (mutate + hard commit).
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function withEngineWriteLock(fn) {
  const run = writeChain.then(fn, fn);
  // Keep the chain alive after failures so later writers still queue.
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Load SessionState once (SQLite via sessions-repo) and seed Phase 0 rev cache.
 * @returns {Promise<unknown>}
 */
export async function ensureSessionEngineBooted() {
  if (engineState != null) return engineState;
  if (bootPromise) {
    await bootPromise;
    return engineState;
  }
  bootPromise = (async () => {
    let state = getCachedSessionState();
    if (state == null) {
      state = await readResource('sessions');
      seedSessionRevState(state);
    }
    engineState = state;
  })();
  try {
    await bootPromise;
  } finally {
    bootPromise = null;
  }
  return engineState;
}

/** @returns {unknown | null} */
export function getEngineSessionState() {
  return engineState;
}

/** Cancel a pending soft flush and invalidate in-flight quiet persists. */
function invalidateSoftFlush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  stateGeneration += 1;
}

/**
 * Replace engine state and bump Phase 0 rev + SSE (also persists to disk).
 * @param {unknown} nextState
 * @returns {Promise<number>} new rev
 */
export async function commitEngineState(nextState) {
  return withEngineWriteLock(async () => {
    // Drop any deferred soft write — hard commit is authoritative for disk.
    invalidateSoftFlush();
    engineState = nextState;
    // writeResource validates + persists + notifySessionStateWritten (Phase 0).
    await writeResource('sessions', nextState);
    return getSessionRev();
  });
}

/**
 * Mutate in-memory state, then persist + publish (debounced when soft=true).
 * Mid-turn generationId updates use soft flush so clients can subscribe promptly.
 * @param {(state: any) => void} mutator
 * @param {{ soft?: boolean }} [opts]
 * @returns {Promise<number>}
 */
export async function mutateEngineState(mutator, opts = {}) {
  return withEngineWriteLock(async () => {
    await ensureSessionEngineBooted();
    if (engineState == null || typeof engineState !== 'object') {
      throw new Error('Session engine has no state');
    }
    // Clone so writeResource validation does not mutate mid-flight readers oddly.
    const next = structuredClone(engineState);
    mutator(next);
    engineState = next;
    stateGeneration += 1;
    // Board host keeps a sessionState alias — rebind after replace.
    void import('./board-loader.js')
      .then((m) => m.rebindEngineBoardHostSession?.())
      .catch(() => undefined);

    if (opts.soft) {
      // Soft path: publish SSE immediately from memory, debounce disk write.
      const rev = notifySessionStateWritten(engineState);
      scheduleSoftFlush();
      return rev;
    }

    // Inline hard persist under the same lock (avoid re-entering writeChain).
    invalidateSoftFlush();
    await writeResource('sessions', engineState);
    return getSessionRev();
  });
}

/**
 * Persist without bumping rev again (soft path already published via SSE).
 * Skips the write when a newer mutate/commit superseded this snapshot.
 * @param {unknown} state
 * @param {number} generation
 */
async function persistEngineStateQuiet(state, generation) {
  if (generation !== stateGeneration || state !== engineState) return;
  const validated = validateSessionState(state);
  if (generation !== stateGeneration || state !== engineState) return;
  if (useJsonSessionsStore()) {
    await writeConfigJson('sessions/state.json', validated);
    return;
  }
  writeWholeSessionState(validated);
}

function scheduleSoftFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  const generation = stateGeneration;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const state = engineState;
    if (state == null) return;
    void persistEngineStateQuiet(state, generation).catch((err) => {
      console.error('[session-engine] soft flush failed:', err);
    });
  }, FLUSH_DEBOUNCE_MS);
}

/** Flush any pending soft write immediately (tests / shutdown). */
export async function flushEngineStateNow() {
  return withEngineWriteLock(async () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (engineState == null) return getSessionRev();
    invalidateSoftFlush();
    await writeResource('sessions', engineState);
    return getSessionRev();
  });
}

/**
 * Adopt a sessions write that bypassed the engine (client PUT/PATCH) so the
 * in-memory engine blob stays aligned with rev-store + disk while idle.
 * No-op when the engine is disabled or already holding the same reference.
 * @param {unknown} state
 */
export function adoptExternalSessionWrite(state) {
  if (!isServerEngineEnabled()) return;
  if (state == null) return;
  if (engineState === state) return;
  // Only adopt when no engine turn is mid-flight — otherwise the turn's next
  // mutate/commit remains authoritative and will republish.
  if (activeTurnChatIds.size > 0) return;
  // Preserve ephemeral live sub-agent slice — clients omit it on PUT/PATCH.
  const liveRuns =
    engineState &&
    typeof engineState === 'object' &&
    Array.isArray(/** @type {any} */ (engineState).liveSubAgentRuns)
      ? /** @type {any} */ (engineState).liveSubAgentRuns
      : null;
  invalidateSoftFlush();
  engineState = state;
  if (liveRuns && engineState && typeof engineState === 'object') {
    /** @type {any} */ (engineState).liveSubAgentRuns = liveRuns;
  }
  // Keep board host sessionState alias aligned after external writes.
  void import('./board-loader.js')
    .then((m) => m.rebindEngineBoardHostSession?.())
    .catch(() => undefined);
}

/**
 * Publish the live in-memory engine blob after in-place board mutations
 * (board host aliases sessionState === engineState). Does not structuredClone
 * before validate — writeResource validates and we adopt the returned blob so
 * the board-host alias can be rebound to the same post-validate object.
 * @param {{ soft?: boolean }} [opts]
 * @returns {Promise<number>}
 */
export async function publishLiveEngineState(opts = {}) {
  return withEngineWriteLock(async () => {
    await ensureSessionEngineBooted();
    if (engineState == null) {
      throw new Error('Session engine has no state');
    }
    stateGeneration += 1;
    if (opts.soft) {
      const rev = notifySessionStateWritten(engineState);
      scheduleSoftFlush();
      return rev;
    }
    invalidateSoftFlush();
    // Ephemeral live runs are not in the validator allowlist — keep them across write.
    const liveRuns = Array.isArray(/** @type {any} */ (engineState).liveSubAgentRuns)
      ? /** @type {any} */ (engineState).liveSubAgentRuns
      : null;
    // writeResource validates + notify + adoptExternal — keep engineState on the
    // validated blob so in-place board mutations are not stranded on a stale alias.
    const written = await writeResource('sessions', engineState);
    engineState = written;
    if (liveRuns && engineState && typeof engineState === 'object') {
      /** @type {any} */ (engineState).liveSubAgentRuns = liveRuns;
    }
    try {
      const { setSessionStateForEngineHost } = await import(
        '../../src/state/sessions.ts'
      ).catch(() => ({}));
      // Dynamic TS import may fail without tsx hooks — board-loader rebind covers that.
      if (typeof setSessionStateForEngineHost === 'function') {
        setSessionStateForEngineHost(engineState);
      }
    } catch {
      /* board host rebind is best-effort here */
    }
    void import('./board-loader.js')
      .then((m) => m.rebindEngineBoardHostSession?.())
      .catch(() => undefined);
    return getSessionRev();
  });
}

/**
 * @param {string} chatId
 * @returns {AbortController}
 */
export function beginEngineTurn(chatId) {
  const existing = turnAbortByChatId.get(chatId);
  if (existing) {
    existing.abort();
  }
  const controller = new AbortController();
  turnAbortByChatId.set(chatId, controller);
  activeTurnChatIds.add(chatId);
  return controller;
}

/**
 * Claim a turn only when none is active (no abort of an existing turn).
 * @param {string} chatId
 * @returns {AbortController | null}
 */
export function tryBeginEngineTurn(chatId) {
  if (activeTurnChatIds.has(chatId)) return null;
  const controller = new AbortController();
  turnAbortByChatId.set(chatId, controller);
  activeTurnChatIds.add(chatId);
  return controller;
}

/**
 * @param {string} chatId
 * @param {AbortController} [controller]
 */
export function endEngineTurn(chatId, controller) {
  const current = turnAbortByChatId.get(chatId);
  if (!controller || current === controller) {
    turnAbortByChatId.delete(chatId);
    activeTurnChatIds.delete(chatId);
  }
}

/**
 * @param {string} chatId
 * @returns {boolean}
 */
export function isEngineTurnActive(chatId) {
  return activeTurnChatIds.has(chatId);
}

/**
 * Abort an in-flight engine turn (stop_generation).
 * @param {string} chatId
 * @returns {boolean} true when a controller was aborted
 */
export function abortEngineTurn(chatId) {
  const controller = turnAbortByChatId.get(chatId);
  if (!controller) return false;
  controller.abort();
  return true;
}

/**
 * Dispatch a typed session command. Returns immediately with the new rev;
 * long-running work (send_message tool loop) continues in the background.
 * @param {SessionCommand} cmd
 * @returns {Promise<{ rev: number, accepted: boolean, detail?: string }>}
 */
export async function applyCommand(cmd) {
  if (!isServerEngineEnabled()) {
    throw Object.assign(new Error('Server session engine is disabled'), {
      statusCode: 503,
      code: 'ENGINE_DISABLED',
    });
  }
  await ensureSessionEngineBooted();
  // Dynamic import avoids engine ↔ commands cycle at module eval time.
  const { applySessionCommand } = await import('./commands.js');
  return applySessionCommand(cmd);
}

/** Reset engine memory (tests). */
export function resetSessionEngineForTests() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  stateGeneration = 0;
  writeChain = Promise.resolve();
  for (const controller of turnAbortByChatId.values()) {
    try {
      controller.abort();
    } catch {
      /* ignore */
    }
  }
  turnAbortByChatId.clear();
  activeTurnChatIds.clear();
  engineState = null;
  bootPromise = null;
}
