/**
 * Cycle-safe slot for ask_question modal park/unpark.
 *
 * `question-cards-modal` and `ask-question-display` import each other through
 * the UI graph. The registry lives here so a load-time `queueMicrotask` cannot
 * hit a TDZ on `let displayContextSync`.
 */

export type AskQuestionDisplayContextSync = () => void;

const state: { sync: AskQuestionDisplayContextSync | null } = { sync: null };

/** Wire modal park/unpark from question-cards-modal without a circular import. */
export function registerAskQuestionDisplayContextSync(
  sync: AskQuestionDisplayContextSync,
): void {
  state.sync = sync;
}

/** Run the registered modal sync, if any. */
export function runAskQuestionDisplayContextSync(): void {
  state.sync?.();
}
