/**
 * Tracks chats running the post-turn /goal evaluator (headless, between turns).
 */

const goalEvaluatingChatIds = new Set<string>();

/** True while the goal evaluator agent loop is running for this chat. */
export function isGoalEvaluating(chatId: string): boolean {
  return goalEvaluatingChatIds.has(chatId);
}

/** Mark goal evaluation start/end for UI affordances. */
export function setGoalEvaluating(chatId: string, evaluating: boolean): void {
  const id = chatId.trim();
  if (!id) return;
  if (evaluating) {
    goalEvaluatingChatIds.add(id);
    return;
  }
  goalEvaluatingChatIds.delete(id);
}
