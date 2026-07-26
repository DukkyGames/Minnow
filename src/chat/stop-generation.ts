import { getChatAbort, setChatStopReason } from '../app-state';
import type { ChatStopReason } from '../types';
import { clearPendingSteer } from './steer-message';
import { cancelGeneration } from '../api/generations';
import { findChatById, getActiveChat } from '../state/sessions';
import { forceCloseAskQuestionModal } from '../ui/question-cards-modal';
import { isServerEngineEnabled } from '../state/server-engine-flag';

/**
 * Stop a chat turn: cancel the backend generation (if any) and abort the local SSE reader.
 * When the Session Engine owns the turn, also dispatch stop_generation.
 * @param reason Recorded on the turn run when the stream ends with status `stopped`.
 */
export function stopGeneration(chatId?: string, reason: ChatStopReason = 'user'): void {
  forceCloseAskQuestionModal();

  const id = chatId?.trim() || getActiveChat().id;
  setChatStopReason(id, reason);
  const chat = findChatById(id) ?? getActiveChat();
  const generationId = chat.currentGenerationId?.trim();
  if (generationId) {
    void cancelGeneration(generationId).catch(() => {
      /* best-effort; local abort still tears down the reader */
    });
  }

  clearPendingSteer(chat);

  getChatAbort(chat.id)?.abort();

  if (isServerEngineEnabled()) {
    void import('../state/session-commands').then((m) =>
      m.dispatchStopGeneration(chat.id).catch(() => undefined),
    );
  }
}
