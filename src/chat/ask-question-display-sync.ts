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
