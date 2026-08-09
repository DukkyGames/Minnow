import { getChatAbort, setChatStopReason } from '../app-state';
import type { ChatStopReason } from '../types';
import { clearPendingSteer } from './steer-message';
import { cancelGeneration } from '../api/generations';
import { flushStoppedChatPresentation } from './flush-stopped-chat-presentation';
import { findChatById, getActiveChat } from '../state/sessions';
import { forceCloseAskQuestionModal } from '../ui/question-cards-modal';

/**
 * Stop a chat turn: cancel the backend generation (if any) and abort the local SSE reader.
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

  const abort = getChatAbort(chat.id);
  if (abort) {
    // A live turn owns teardown: its `finally` clears activity and the generation id.
    abort.abort();
    return;
  }

  /*
   * No local turn to abort — the chat is only "running" because it still holds a
   * persisted `currentGenerationId`. Nothing else will ever clear it, so the
   * agent activity row would keep ticking after the user pressed Stop.
   */
  flushStoppedChatPresentation([chat.id]);
}
