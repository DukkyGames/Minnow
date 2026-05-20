/**
 * In-flight title job registry (avoids sessions ↔ schedule import cycle).
 */

const inflight = new Map<string, AbortController>();

/** Abort a title job when the chat is deleted. */
export function abortChatTitleGeneration(chatId: string): void {
  const controller = inflight.get(chatId);
  if (controller) {
    controller.abort();
    inflight.delete(chatId);
  }
}

/** True when a title job is already running for this chat. */
export function hasTitleJobInflight(chatId: string): boolean {
  return inflight.has(chatId);
}

/** Register a new in-flight controller; returns false if already present. */
export function registerTitleJobInflight(chatId: string, controller: AbortController): boolean {
  if (inflight.has(chatId)) return false;
  inflight.set(chatId, controller);
  return true;
}

/** Remove controller when the job finishes. */
export function releaseTitleJobInflight(chatId: string, controller: AbortController): void {
  if (inflight.get(chatId) === controller) {
    inflight.delete(chatId);
  }
}

/** Reset all in-flight jobs (tests). */
export function resetTitleGenerationInflight(): void {
  for (const controller of inflight.values()) {
    controller.abort();
  }
  inflight.clear();
}
