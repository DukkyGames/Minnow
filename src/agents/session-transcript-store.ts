import { findChatById } from '../state/sessions';
import { isUiOnlyTranscriptMessage } from '../chat/context/injection-notice';
import type { TranscriptStore } from '../../server/runner/transcript-store';

export function createSessionTranscriptStore(): TranscriptStore {
  return {
    load(chatId) {
      const chat = findChatById(chatId);
      if (!chat) return null;
      return {
        messages: (chat.history ?? []).filter((m) => !isUiOnlyTranscriptMessage(m)),
        meta: {
          thinkingMode: chat.thinkingMode,
          reasoningEffort: chat.reasoningEffort,
        },
      };
    },
    append(chatId, message) {
      const chat = findChatById(chatId);
      if (!chat) return;
      chat.history.push(message as (typeof chat.history)[number]);
    },
    setMeta(chatId, meta) {
      const chat = findChatById(chatId);
      if (!chat) return;
      if (meta.thinkingMode !== undefined) {
        chat.thinkingMode = meta.thinkingMode as typeof chat.thinkingMode;
      }
      if (meta.reasoningEffort !== undefined) {
        chat.reasoningEffort = meta.reasoningEffort as typeof chat.reasoningEffort;
      }
    },
  };
}
