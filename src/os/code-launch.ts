/**
 * Apply concierge / router launch options when foregrounding the Code app.
 */

import { DEFAULT_MODE_ID, normalizeModeId } from '../chat/modes/types';
import { setWorkspacePath } from '../config/workspace-api';
import { sendMessageWithTools } from '../tools/loop';
import { getWorkspacePath } from '../state/workspace';
import { clearForegroundSeed } from './instances';
import type { LaunchOptions } from './types';
import { applyWorkspaceSwitch } from '../ui/workspace-button';
import { createChatWithMode } from '../ui/sidebar';
import { syncComposerFromStreamingState } from '../ui/composer-send';

/** Re-render the Code transcript and sync chrome for the active workspace chat. */
async function refreshCodeChatSurface(): Promise<void> {
  const { getActiveChat } = await import('../state/sessions');
  const { renderChatFromHistory, renderStatsForChat } = await import('../ui/messages');
  const { renderSidebar } = await import('../ui/sidebar');
  const { syncModeSelectorFromActiveChat } = await import('../ui/mode-selector');
  const { syncComposerReasoningEffortFromActiveChat } = await import('../ui/composer-reasoning-effort');
  const { syncViewModeToggleFromActiveChat } = await import('../ui/view-mode-toggle');
  const { refreshChatJumpChipVisibility } = await import('../ui/chat-scroll');

  const chat = getActiveChat();
  renderChatFromHistory(chat);
  renderStatsForChat(chat);
  syncModeSelectorFromActiveChat();
  syncComposerReasoningEffortFromActiveChat();
  syncViewModeToggleFromActiveChat();
  syncComposerFromStreamingState();
  renderSidebar();
  refreshChatJumpChipVisibility();
  void import('../tools/stream-chat-dom').then((m) => m.remountStreamDomForChat(chat.id));
}

/**
 * Foreground Code with the project workspace chat — not the desktop assistant thread.
 * Desktop chat renders into `#desktopChatCol`; this restores `#chatArea` on Code open.
 */
export async function restoreCodeSessionOnForeground(): Promise<void> {
  const { getChatsWorkspacePath, isChatsWorkspacePath } = await import('../lib/chats-workspace');
  const {
    getActiveChat,
    resolveActiveChatIdForWorkspace,
    sessionState,
  } = await import('../state/sessions');

  if (!sessionState) return;

  await getChatsWorkspacePath();

  const workspacePath = getWorkspacePath();
  const active = getActiveChat();
  const activeIsAssistant = isChatsWorkspacePath(active.workspacePath ?? '');
  const targetId = resolveActiveChatIdForWorkspace(
    workspacePath,
    sessionState,
    active.modelId ?? '',
  );

  const { switchChat } = await import('../ui/sidebar');

  if (targetId !== sessionState.activeId) {
    switchChat(targetId);
    return;
  }

  if (activeIsAssistant) {
    switchChat(targetId);
    return;
  }

  await refreshCodeChatSurface();
}

/** Switch workspace, create a mode-scoped chat, and auto-send the seed message. */
export async function applyCodeLaunchOptions(options: LaunchOptions): Promise<void> {
  const seed = options.seed?.trim();
  const shouldSend = options.autoRun === true && Boolean(seed);

  if (!shouldSend && !options.modeId && !options.workspacePath?.trim()) return;

  const welcome = await import('../ui/welcome-page');
  if (welcome.isWelcomePageOpen()) {
    welcome.closeWelcome({ skipHash: true });
  }

  const targetPath = options.workspacePath?.trim();
  if (targetPath && targetPath !== getWorkspacePath()) {
    try {
      const info = await setWorkspacePath(targetPath);
      await applyWorkspaceSwitch(info);
    } catch {
      /* continue with current workspace when switch fails */
    }
  }

  if (!shouldSend) return;

  const modeId = normalizeModeId(options.modeId ?? DEFAULT_MODE_ID);
  const created = createChatWithMode({ modeId });
  if (!created.ok || !seed) return;

  const input = document.getElementById('msgInput') as HTMLTextAreaElement | null;
  if (!input) return;

  input.value = seed;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  syncComposerFromStreamingState();

  try {
    await sendMessageWithTools();
    clearForegroundSeed();
  } catch {
    /* leave seed in composer for manual send when provider/tools are unavailable */
  } finally {
    syncComposerFromStreamingState();
  }
}
