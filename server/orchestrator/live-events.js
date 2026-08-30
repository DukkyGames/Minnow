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
 */

/**
 * @typedef {object} LiveAttemptEvent
 * @property {string} boardId
 * @property {string} attemptId
 * @property {string | null} taskId
 * @property {string} role
 * @property {import('../runner/run-turn').TurnEvent} event
 */

/** @type {Map<string, Set<(payload: LiveAttemptEvent) => void>>} */
const listeners = new Map();

/**
 * @param {string} boardId
 * @param {(payload: LiveAttemptEvent) => void} handler
 * @returns {() => void} unsubscribe
 */
export function subscribeLive(boardId, handler) {
  let set = listeners.get(boardId);
  if (!set) {
    set = new Set();
    listeners.set(boardId, set);
  }
  set.add(handler);
  return () => {
    set.delete(handler);
    if (set.size === 0) listeners.delete(boardId);
  };
}

/**
 * @param {LiveAttemptEvent} payload
 * @returns {void}
 */
export function emitLive(payload) {
  const set = listeners.get(payload.boardId);
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
 * treat one as a journal id.
 *
 * @typedef {object} BoardErrorEvent
 * @property {string} boardId
 * @property {string | null} taskId
 * @property {string} role
 * @property {string} message
 * @property {number} consecutive  how many times this has failed in a row
 */

/** @type {Map<string, Set<(payload: BoardErrorEvent) => void>>} */
const errorListeners = new Map();

/**
 * @param {string} boardId
 * @param {(payload: BoardErrorEvent) => void} handler
 * @returns {() => void} unsubscribe
 */
export function subscribeErrors(boardId, handler) {
  let set = errorListeners.get(boardId);
  if (!set) {
    set = new Set();
    errorListeners.set(boardId, set);
  }
  set.add(handler);
  return () => {
    set.delete(handler);
    if (set.size === 0) errorListeners.delete(boardId);
  };
}

/**
 * @param {BoardErrorEvent} payload
 * @returns {void}
 */
export function emitError(payload) {
  const set = errorListeners.get(payload.boardId);
  if (!set) return;
  for (const handler of set) {
    try {
      handler(payload);
    } catch {
      // A broken UI subscriber must not take the engine down.
    }
  }
}
