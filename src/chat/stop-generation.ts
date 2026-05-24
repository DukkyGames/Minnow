import { chatFetchAbort } from '../app-state';
import { clearPendingSteer } from './steer-message';
import { cancelGeneration } from '../api/generations';
import { getActiveChat } from '../state/sessions';
import { forceCloseAskQuestionModal } from '../ui/question-cards-modal';

/**
 * Stop the active chat turn: cancel the backend generation (if any) and abort the local SSE reader.
 */
export function stopGeneration(): void {
  forceCloseAskQuestionModal();

  const chat = getActiveChat();
  const generationId = chat.currentGenerationId?.trim();
  if (generationId) {
    void cancelGeneration(generationId).catch(() => {
      /* best-effort; local abort still tears down the reader */
    });
  }

  clearPendingSteer(chat);

  if (chatFetchAbort) chatFetchAbort.abort();
}
