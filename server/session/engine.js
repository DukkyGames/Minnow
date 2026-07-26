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

/** @type {Promise<void> | null} */
let bootPromise = null;

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

/**
 * Replace engine state and bump Phase 0 rev + SSE (also persists to disk).
 * @param {unknown} nextState
 * @returns {Promise<number>} new rev
 */
export async function commitEngineState(nextState) {
  engineState = nextState;
  // writeResource validates + persists + notifySessionStateWritten (Phase 0).
  await writeResource('sessions', nextState);
  return getSessionRev();
}

/**
 * Mutate in-memory state, then persist + publish (debounced when soft=true).
 * Mid-turn generationId updates use soft flush so clients can subscribe promptly.
 * @param {(state: any) => void} mutator
 * @param {{ soft?: boolean }} [opts]
 * @returns {Promise<number>}
 */
export async function mutateEngineState(mutator, opts = {}) {
  await ensureSessionEngineBooted();
  if (engineState == null || typeof engineState !== 'object') {
    throw new Error('Session engine has no state');
  }
  // Clone so writeResource validation does not mutate mid-flight readers oddly.
  const next = structuredClone(engineState);
  mutator(next);
  engineState = next;

  if (opts.soft) {
    // Soft path: publish SSE immediately from memory, debounce disk write.
    const rev = notifySessionStateWritten(engineState);
    scheduleSoftFlush();
    return rev;
  }

  return commitEngineState(engineState);
}

/**
 * Persist without bumping rev again (soft path already published via SSE).
 * @param {unknown} state
 */
async function persistEngineStateQuiet(state) {
  const validated = validateSessionState(state);
  if (useJsonSessionsStore()) {
    await writeConfigJson('sessions/state.json', validated);
    return;
  }
  writeWholeSessionState(validated);
}

function scheduleSoftFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const state = engineState;
    if (state == null) return;
    void persistEngineStateQuiet(state).catch((err) => {
      console.error('[session-engine] soft flush failed:', err);
    });
  }, FLUSH_DEBOUNCE_MS);
}

/** Flush any pending soft write immediately (tests / shutdown). */
export async function flushEngineStateNow() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (engineState == null) return getSessionRev();
  return commitEngineState(engineState);
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
