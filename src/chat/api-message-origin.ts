/**
 * Which `chat.history` row each outbound API message came from.
 *
 * Archive collapse used to assume history index `i` landed at API index
 * `systemEnd + i`. It does not: `buildApiMessages` skips UI-only transcript rows,
 * emits extra follow-ups for tool screenshots, and the provider normalizers fold
 * and synthesize rows afterwards. Every drift shifted the collapse window onto
 * live turns, so the transcript stayed complete on screen while the model was
 * handed a placeholder in its place.
 *
 * The mapping is kept in a WeakMap keyed on message identity rather than on the
 * message itself, so nothing extra is serialized into the provider request.
 */

import type { ApiMessage } from '../types';

const historyIndexByMessage = new WeakMap<object, number>();

/** Record the history row an outbound message was built from. */
export function tagApiMessageHistoryIndex(message: ApiMessage, historyIndex: number): void {
  if (historyIndex < 0) return;
  historyIndexByMessage.set(message as object, historyIndex);
}

/**
 * History row for an outbound message, or undefined for rows with no history of
 * their own — synthesized tool results, folded preambles, ephemeral instructions.
 */
export function historyIndexOfApiMessage(message: ApiMessage): number | undefined {
  return historyIndexByMessage.get(message as object);
}
