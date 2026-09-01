/**
 * Live attempt stream (P2-F).
 *
 * Token / tool events from `runTurn({ onEvent })` must reach the board SSE so
 * the UI can show output, and must **never** be journaled. The journal records
 * completed side effects (`task.attempt.started` / `ended`); a 6-hour run of
 * tokens would make replay and storage unbounded.
 *
 * This bus is parallel to `engine.subscribe`, which only fires on append.
 * Frames have no `seq` — a reconnect must not treat a token as a journal id.
 *
 * ## P8-B: the key is opaque
 *
 * Subscribe/emit are keyed on a string, not on "a board". Board callers keep
 * passing `boardId` — it is just that string. P8-F passes a parent chat id on
 * the same bus for `/api/agents/*` (`event: live` / `error` / `deliver`).
 *
 * Payload fields stay named `boardId` so the board SSE contract does not churn
 * (`event: live` / `event: error` frames the UI already parses). Routing uses
 * `payload.key ?? payload.boardId`. That is the smallest change that makes the
 * bus namespace-agnostic without renaming every board frame.
 */

/**
 * @typedef {object} LiveAttemptEvent
 * @property {string} [key]  opaque routing key; omitted on board events
 * @property {string} boardId  board SSE field; also the routing key when `key` is omitted
 * @property {string} attemptId
 * @property {string | null} taskId
 * @property {string} role
 * @property {import('../runner/run-turn').TurnEvent} event
 */

/** @type {Map<string, Set<(payload: LiveAttemptEvent) => void>>} */
const listeners = new Map();

/**
 * @param {{ key?: string, boardId: string }} payload
 * @returns {string}
 */
function routingKey(payload) {
  return payload.key ?? payload.boardId;
}

/**
 * @param {string} key  opaque. Boards pass boardId; P8-F will pass an agents id.
 * @param {(payload: LiveAttemptEvent) => void} handler
 * @returns {() => void} unsubscribe
 */
export function subscribeLive(key, handler) {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(handler);
  return () => {
    set.delete(handler);
    if (set.size === 0) listeners.delete(key);
  };
}

/**
 * @param {LiveAttemptEvent} payload
 * @returns {void}
 */
export function emitLive(payload) {
  const set = listeners.get(routingKey(payload));
  if (!set) return;
  for (const handler of set) {
    try {
      handler(payload);
    } catch {
      // A broken UI subscriber must not take the attempt down.
    }
  }
}

// ---------------------------------------------------------------------------
// Engine errors — P9-A
// ---------------------------------------------------------------------------

/**
 * Failures that stop work from *starting*, on the way to the screen.
 *
 * A rejected `effector.start()` journals nothing, and correctly so: no process
 * existed, so there is no completed side effect to record, and putting it on the
 * journal would make replay disagree with reality. But "nothing happened" is not
 * the same as "nothing to say" — before this, a missing model binding presented
 * as *Start does nothing*, with the board reading `running`, every tick retrying,
 * and the only evidence a server log the user never sees.
 *
 * So this is a parallel, non-journaled channel, exactly like the live token bus
 * above and for the same reason. Frames carry no `seq`; a reconnect must not
 * treat one as a journal id. The subscribe key is opaque (see file header).
 *
 * @typedef {object} BoardErrorEvent
 * @property {string} [key]  opaque routing key; omitted on board events
 * @property {string} boardId
 * @property {string | null} taskId
 * @property {string} role
 * @property {string} message
 * @property {number} consecutive  how many times this has failed in a row
 */

/** @type {Map<string, Set<(payload: BoardErrorEvent) => void>>} */
const errorListeners = new Map();

/**
 * @param {string} key  opaque. Boards pass boardId.
 * @param {(payload: BoardErrorEvent) => void} handler
 * @returns {() => void} unsubscribe
 */
export function subscribeErrors(key, handler) {
  let set = errorListeners.get(key);
  if (!set) {
    set = new Set();
    errorListeners.set(key, set);
  }
  set.add(handler);
  return () => {
    set.delete(handler);
    if (set.size === 0) errorListeners.delete(key);
  };
}

/**
 * @param {BoardErrorEvent} payload
 * @returns {void}
 */
export function emitError(payload) {
  const set = errorListeners.get(routingKey(payload));
  if (!set) return;
  for (const handler of set) {
    try {
      handler(payload);
    } catch {
      // A broken UI subscriber must not take the engine down.
    }
  }
}

// ---------------------------------------------------------------------------
// Parent delivery — P8-F
// ---------------------------------------------------------------------------

/**
 * A pending parent-chat inject, on the way to the renderer.
 *
 * `result.delivered` is journaled *after* this notify returns, same ordering
 * as `attempt.started`. The frame itself is not journaled: the inject is the
 * completed side effect, and the journal line records that it landed. No `seq`
 * — a reconnect must not treat one as a journal id.
 *
 * @typedef {object} DeliverEvent
 * @property {string} [key]
 * @property {string} parentChatId
 * @property {'completion' | 'check_in_nudge'} kind
 * @property {string[]} runIds
 * @property {string} message
 */

/** @type {Map<string, Set<(payload: DeliverEvent) => void>>} */
const deliverListeners = new Map();

/**
 * @param {string} key  opaque. Agents pass parentChatId.
 * @param {(payload: DeliverEvent) => void} handler
 * @returns {() => void}
 */
export function subscribeDeliver(key, handler) {
  let set = deliverListeners.get(key);
  if (!set) {
    set = new Set();
    deliverListeners.set(key, set);
  }
  set.add(handler);
  return () => {
    set.delete(handler);
    if (set.size === 0) deliverListeners.delete(key);
  };
}

/**
 * @param {DeliverEvent} payload
 * @returns {number} how many listeners received the frame
 */
export function emitDeliver(payload) {
  const key = payload.key ?? payload.parentChatId;
  const set = deliverListeners.get(key);
  if (!set || set.size === 0) return 0;
  for (const handler of set) {
    try {
      handler(payload);
    } catch {
      // A broken UI subscriber must not take delivery down.
    }
  }
  return set.size;
}
