import { chatFetchAbort } from '../app-state';
import { forceCloseAskQuestionModal } from '../ui/question-cards-modal';

/** Abort the active chat completion fetch / SSE reader (no-op if idle). */
export function stopGeneration(): void {
  forceCloseAskQuestionModal();
  if (chatFetchAbort) chatFetchAbort.abort();
}
