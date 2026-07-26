/**
 * Helpers for per-chat streaming: which chats are in-flight vs which chat is active in the UI.
 *
 * Stream-end / activity bus lives in session-engine/stream-bus (MIN-360) so the
 * Session Engine board scheduler can share the same in-process events.
 */

import { expertsPageOpen, streamingChatIds } from '../app-state';
import { getActiveChat } from '../state/sessions';
import { getForegroundAppId } from '../os/instances';
import { isOrchestratePlanScreenSuppressingChatDom } from '../ui/orchestrate-plan-screen';
import {
  isChatAppForeground,
  isEmailAssistantForeground,
  shouldPaintDesktopChatSurface,
} from '../ui/chat-mount';
import { isMainColumnOverlaySuppressingChatDom } from '../ui/main-column-overlay';
import { isBoardViewActive } from '../ui/view-mode-toggle';

export {
  subscribeChatStreamEnd,
  notifyChatStreamEnded,
  subscribeChatStreamActivity,
  notifyChatStreamActivity,
} from '../session-engine/stream-bus';

/**
 * Active chat id when it is streaming; otherwise any single streaming id; else null.
 * Sidebar "foreground" stream hint uses this.
 */
export function getStreamingChatId(): string | null {
  const active = getActiveChat();
  if (streamingChatIds.has(active.id)) return active.id;
  if (streamingChatIds.size === 1) return [...streamingChatIds][0]!;
  return null;
}

/** True when the given chat has an in-flight assistant turn. */
export function isChatStreaming(chatId: string): boolean {
  return streamingChatIds.has(chatId);
}

/** True when the active sidebar chat is the one currently streaming. */
export function isActiveChatStreaming(): boolean {
  return streamingChatIds.has(getActiveChat().id);
}

/** Concurrent streams are allowed — board cap handles orchestrate task limits. */
export function isBackgroundStreamBlockingSend(): boolean {
  return false;
}

/** Whether stream/tool DOM for this chat should mount in the active transcript (Code or Chat app). */
export function isStreamDomVisible(chatId: string): boolean {
  const active = getActiveChat();
  if (active.id !== chatId) return false;
  // Email owns chat DOM only while its assistant dock is visible. Closing the
  // dock leaves the generation running as a background stream.
  if (getForegroundAppId() === 'email') {
    return active.appScope === 'email' && isEmailAssistantForeground();
  }
  // Desktop chat owns its transcript — do not let Code board/plan overlays suppress it.
  if (shouldPaintDesktopChatSurface()) return true;
  if (isOrchestratePlanScreenSuppressingChatDom(chatId)) return false;
  if (isMainColumnOverlaySuppressingChatDom()) return false;
  if (active.kind === 'expert-lab' && expertsPageOpen) return false;
  if (isChatAppForeground()) return true;
  if (isBoardViewActive()) return false;
  return true;
}
