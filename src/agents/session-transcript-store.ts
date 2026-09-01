/**
 * P2-A transcript seam over the renderer session store (MIN-698 / P6-A).
 *
 * Shared by the sub-agent adapter and the P6-A chat spike so both callers
 * wrap `findChatById` the same way. The runner never imports `sessions.ts`.
 */

import { findChatById } from '../state/sessions';
import { isUiOnlyTranscriptMessage } from '../chat/context/injection-notice';
import type { TranscriptStore } from '../../server/runner/transcript-store';

/**
 * Session-store wrapper — the only `sessions.ts` coupling the shared runner
 * used to have. `load` is synchronous so the turn loop does not become async
 * at read (see `TranscriptStore` in `server/runner/transcript-store.d.ts`).
 *
 * `load` is model-facing: `runTurn` uses it both for `priorMessages` (which go
 * straight to the provider) and for the `have` count that aligns the suffix
 * persist. UI-only notice rows (`injection`, `context`) are dropped here so
 * both stay consistent — a stored `role: 'injection'` row reaches the provider
 * as an unknown role and the completion fails with HTTP 400. Any other
 * model-facing view of `chat.history` must filter the same way (see
 * `overlayMultimodalHistoryForRunTurn`), or the persist offset drifts.
 */
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
