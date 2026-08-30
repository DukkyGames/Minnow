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
