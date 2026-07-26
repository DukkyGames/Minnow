/**
 * Per-chat model UI — composer triggers and active chat binding updates.
 * Kept separate from sidebar.ts to avoid circular imports with composer-model-trigger.
 */

import { applyModelSelectValueToChat, decodeModelSelectKey } from '../lib/model-select-key';
import { isChatStreaming } from '../chat/streaming-state';
import { stopGeneration } from '../chat/stop-generation';
import {
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import { boardUiSetModel } from '../state/board-command-bridge';
import { syncComposerModelTriggers } from './composer-model-trigger';
import { syncComposerReasoningEffortFromActiveChat } from './composer-reasoning-effort';
import { setStatus } from './status';

/** Refresh composer model UI from the active chat (default #modelSelect stays put). */
export function syncActiveChatModelUi(): void {
  syncComposerModelTriggers();
  syncComposerReasoningEffortFromActiveChat();
  void import('./context-usage-ring').then((m) => m.refreshContextUsageRing());
}

/** Per-chat model changed via composer picker — does not alter the global default. */
export function onActiveChatModelChange(selectValue: string): void {
  const chat = getActiveChat();
  const raw = selectValue.trim();
  if (!raw) return;

  if (isChatStreaming(chat.id)) {
    stopGeneration(chat.id, 'user');
    setStatus('ok', 'Stopped — model changed');
  }

  applyModelSelectValueToChat(chat, raw);
  touchChat(chat);
  scheduleSaveSessions();
  // Engine board host: also stamp preferred model on the board (MIN-360).
  const decoded = decodeModelSelectKey(raw);
  const modelId = decoded?.modelId ?? raw;
  const providerId = decoded?.providerId ?? chat.providerId;
  void boardUiSetModel({
    chatId: chat.id,
    groupId: chat.boardGroupId ?? chat.groupId,
    providerId,
    modelId,
  });
  syncComposerModelTriggers();
  syncComposerReasoningEffortFromActiveChat();
  void import('./context-usage-ring').then((m) => m.refreshContextUsageRing());
}
