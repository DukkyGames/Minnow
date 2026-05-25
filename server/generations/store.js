/**
 * In-memory generation state for backend-owned LLM streams.
 */

import { randomUUID } from 'node:crypto';

/** @typedef {'pending' | 'streaming' | 'complete' | 'error' | 'cancelled'} GenerationStatus */

/** @typedef {import('http').ServerResponse} ServerResponse */

/**
 * @typedef {object} GenerationState
 * @property {string} id
 * @property {string} providerId
 * @property {Buffer} requestBody
 * @property {Buffer[]} chunks
 * @property {number} totalBytes
 * @property {GenerationStatus} status
 * @property {AbortController | null} upstreamController
 * @property {Set<ServerResponse>} subscribers
 * @property {ReturnType<typeof setTimeout> | null} evictTimer
 * @property {boolean} persist
 * @property {string} startedAt
 * @property {string | null} finishedAt
 * @property {string | null} errorMessage
 */

const MAX_BYTES = 16 * 1024 * 1024;
const EVICT_MS_EPHEMERAL = 30_000;
const EVICT_MS_PERSIST = 5 * 60_000;

/** @type {Map<string, GenerationState>} */
const generations = new Map();

/**
 * @param {GenerationStatus} status
 * @returns {boolean}
 */
function isTerminal(status) {
  return status === 'complete' || status === 'error' || status === 'cancelled';
}

/**
 * @param {GenerationState} state
 * @returns {object}
 */
function terminalEventPayload(state) {
  const payload = { status: state.status };
  if (state.errorMessage) {
    payload.errorMessage = state.errorMessage;
  }
  return payload;
}

/**
 * @param {ServerResponse} res
 * @returns {boolean}
 */
function canWriteToSubscriber(res) {
  return !res.writableEnded && !res.destroyed;
}

/**
 * @param {GenerationState} state
 * @param {ServerResponse} res
 * @param {Buffer} buf
 */
function detachSubscriber(state, res) {
  state.subscribers.delete(res);
  if (!res.writableEnded && !res.destroyed) {
    try {
      res.destroy();
    } catch {
      /* ignore */
    }
  }
}

function writeToSubscriber(state, res, buf) {
  if (!canWriteToSubscriber(res)) {
    detachSubscriber(state, res);
    return;
  }
  try {
    const ok = res.write(buf);
    if (!ok) {
      res.once('drain', () => {
        if (!state.subscribers.has(res)) {
          return;
        }
        writeToSubscriber(state, res, buf);
      });
    }
  } catch {
    detachSubscriber(state, res);
  }
}

/**
 * SSE sentinel so subscribers know the generation ended.
 * @param {GenerationState} state
 */
function broadcastTerminalEvent(state) {
  // Leading blank line ensures client `\n\n` framing never merges with the last upstream chunk.
  const line = `\n\nevent: end\ndata: ${JSON.stringify(terminalEventPayload(state))}\n\n`;
  const buf = Buffer.from(line, 'utf8');
  for (const res of [...state.subscribers]) {
    state.subscribers.delete(res);
    try {
      if (canWriteToSubscriber(res)) {
        res.write(buf);
        res.end();
      } else {
        res.destroy();
      }
    } catch {
      try {
        res.destroy();
      } catch {
        /* ignore */
      }
    }
  }
  state.subscribers.clear();
}

/**
 * @param {GenerationState} state
 */
function scheduleEviction(state) {
  if (state.evictTimer) {
    clearTimeout(state.evictTimer);
  }
  const delay = state.persist ? EVICT_MS_PERSIST : EVICT_MS_EPHEMERAL;
  state.evictTimer = setTimeout(() => {
    generations.delete(state.id);
  }, delay);
}

/**
 * @param {{ providerId: string, body: unknown, persist?: boolean }} params
 * @returns {GenerationState}
 */
export function createGenerationState({ providerId, body, persist = false }) {
  const id = randomUUID();
  const requestBody = Buffer.from(JSON.stringify(body ?? {}), 'utf8');
  /** @type {GenerationState} */
  const state = {
    id,
    providerId,
    requestBody,
    chunks: [],
    totalBytes: 0,
    status: 'pending',
    upstreamController: null,
    subscribers: new Set(),
    evictTimer: null,
    persist: persist === true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    errorMessage: null,
  };
  generations.set(id, state);
  return state;
}

/**
 * @param {string} id
 * @returns {GenerationState | undefined}
 */
export function getGenerationState(id) {
  return generations.get(id);
}

/**
 * @param {GenerationState} state
 */
export function markStreaming(state) {
  if (state.status === 'pending') {
    state.status = 'streaming';
  }
}

/**
 * @param {GenerationState} state
 * @param {Buffer} buf
 */
export function appendChunk(state, buf) {
  if (isTerminal(state.status)) {
    return;
  }
  markStreaming(state);

  state.chunks.push(buf);
  state.totalBytes += buf.length;

  for (const res of [...state.subscribers]) {
    writeToSubscriber(state, res, buf);
  }

  if (state.totalBytes > MAX_BYTES) {
    state.upstreamController?.abort();
    markError(state, 'Buffer overflow');
  }
}

/**
 * Replay buffered bytes, then terminal sentinel when already finished.
 * @param {GenerationState} state
 * @param {ServerResponse} res
 */
export function addSubscriber(state, res) {
  state.subscribers.add(res);

  for (const chunk of state.chunks) {
    writeToSubscriber(state, res, chunk);
  }

  if (isTerminal(state.status)) {
    const line = `\n\nevent: end\ndata: ${JSON.stringify(terminalEventPayload(state))}\n\n`;
    try {
      if (canWriteToSubscriber(res)) {
        res.write(Buffer.from(line, 'utf8'));
        res.end();
      }
    } catch {
      /* subscriber may already be closed */
    }
    state.subscribers.delete(res);
  }
}

/**
 * Drop a client stream without stopping upstream generation.
 * @param {GenerationState} state
 * @param {ServerResponse} res
 */
export function removeSubscriber(state, res) {
  detachSubscriber(state, res);
}

/**
 * @param {GenerationState} state
 */
export function markComplete(state) {
  if (isTerminal(state.status)) {
    return;
  }
  state.status = 'complete';
  state.finishedAt = new Date().toISOString();
  broadcastTerminalEvent(state);
  scheduleEviction(state);
}

/**
 * @param {GenerationState} state
 * @param {string} message
 */
export function markError(state, message) {
  if (isTerminal(state.status)) {
    return;
  }
  state.status = 'error';
  state.errorMessage = message;
  state.finishedAt = new Date().toISOString();
  broadcastTerminalEvent(state);
  scheduleEviction(state);
}

/**
 * @param {GenerationState} state
 */
export function markCancelled(state) {
  if (isTerminal(state.status)) {
    return;
  }
  state.status = 'cancelled';
  state.finishedAt = new Date().toISOString();
  broadcastTerminalEvent(state);
  scheduleEviction(state);
}

/**
 * Abort upstream and end subscribers with cancelled status.
 * @param {GenerationState} state
 */
export function cancel(state) {
  state.upstreamController?.abort();
  markCancelled(state);
}

/**
 * Process exit: cancel all in-flight generations.
 */
export function deleteGenerationsForProviderShutdown() {
  for (const state of generations.values()) {
    state.upstreamController?.abort();
    if (!isTerminal(state.status)) {
      markCancelled(state);
    }
    if (state.evictTimer) {
      clearTimeout(state.evictTimer);
    }
  }
  generations.clear();
}


