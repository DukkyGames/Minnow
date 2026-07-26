/**
 * Apply concierge / router launch options when foregrounding the Code app.
 */

import { DEFAULT_MODE_ID, normalizeModeId } from '../chat/modes/types';
import { setWorkspacePath } from '../config/workspace-api';
import { sendMessageWithTools } from '../tools/loop';
import { normalizeWorkspacePath } from '../lib/normalize-workspace-path';
import { getWorkspacePath } from '../state/workspace';
import { clearForegroundSeed } from './instances';
import type { LaunchOptions } from './types';
import { executeWorkspaceSwitch } from '../ui/workspace-switch-guard';
import { createChatWithMode } from '../ui/sidebar';
import { syncComposerFromStreamingState } from '../ui/composer-send';

/** Repoint file tree / git panel to the Code project workspace (not desktop sandbox). */
async function syncCodeFileTreeChrome(): Promise<void> {
  const { syncDesktopWorkspaceMounts } = await import('./desktop-workspace-mounts');
  const { clearPanelCwdUserOverride, syncPanelFromActiveChat } = await import('../ui/git-panel');
  clearPanelCwdUserOverride();
  await syncDesktopWorkspaceMounts();
  syncPanelFromActiveChat({ forceFileTree: true });
}

/** Re-render the Code transcript and sync chrome for the active workspace chat. */
async function refreshCodeChatSurface(): Promise<void> {
  const { ensureSessionsReady, getActiveChat } = await import('../state/sessions');
  await ensureSessionsReady();
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
  await syncCodeFileTreeChrome();
  void import('../tools/stream-chat-dom').then((m) => m.remountStreamDomForChat(chat.id));
}

/**
 * Foreground Code with the project workspace chat — not the desktop assistant thread.
 * Desktop chat renders into `#desktopChatCol`; this restores `#chatArea` on Code open.
 */
export async function restoreCodeSessionOnForeground(): Promise<void> {
  const { getChatsWorkspacePath } = await import('../lib/chats-workspace');
  const {
    ensureSessionsReady,
    getActiveChat,
    resolveActiveChatIdForWorkspace,
    sessionState,
  } = await import('../state/sessions');

  await ensureSessionsReady();
  if (!sessionState) return;

  await getChatsWorkspacePath();

  const workspacePath = getWorkspacePath();
  const active = getActiveChat();
  // Any app-scoped thread (Chat, Desktop, Email) — Code must not adopt one as its
  // workspace chat just because the folders happen to line up.
  const activeIsAssistant = active.appScope != null;
  const workspaceKey = normalizeWorkspacePath(workspacePath);
  const activeInCurrentWorkspace =
    !activeIsAssistant &&
    normalizeWorkspacePath(active.workspacePath ?? '') === workspaceKey;

  // Honor an explicit workspace chat selection (e.g. overview session row) instead of
  // reverting to lastActiveChatIdByWorkspace.
  if (activeInCurrentWorkspace) {
    await refreshCodeChatSurface();
    return;
  }

  const targetId = resolveActiveChatIdForWorkspace(
    workspacePath,
    sessionState,
    active.modelId ?? '',
  );

  const { switchChat } = await import('../ui/sidebar');

  if (targetId !== sessionState.activeId) {
    switchChat(targetId);
    await syncCodeFileTreeChrome();
    return;
  }

  if (activeIsAssistant) {
    switchChat(targetId);
    await syncCodeFileTreeChrome();
    return;
  }

  await refreshCodeChatSurface();
}

/**
 * Switch workspace, create a mode-scoped chat, and auto-send the seed message.
 * Returns the created chat id when a seeded send was attempted.
 */
export async function applyCodeLaunchOptions(
  options: LaunchOptions,
): Promise<{ chatId?: string }> {
  const seed = options.seed?.trim();
  const shouldSend = options.autoRun === true && Boolean(seed);

  if (!shouldSend && !options.modeId && !options.workspacePath?.trim()) return {};

  const welcome = await import('../ui/welcome-page');
  if (welcome.isWelcomePageOpen()) {
    welcome.closeWelcome({ skipHash: true });
  }

  const targetPath = options.workspacePath?.trim();
  if (targetPath && targetPath !== getWorkspacePath()) {
    try {
      await executeWorkspaceSwitch(targetPath);
    } catch {
      /* continue with current workspace when switch fails */
    }
  }

  if (!shouldSend) return {};

  const modeId = normalizeModeId(options.modeId ?? DEFAULT_MODE_ID);
  const created = createChatWithMode({ modeId });
  if (!created.ok || !seed) return {};

  // Attach issue code refs synchronously when possible so they ride with the send.
  const { addCodeReferenceToComposer } = await import('../attachments/code-ref');
  for (const ref of options.codeRefs ?? []) {
    const path = ref.path?.trim().replace(/\\/g, '/');
    if (!path) continue;
    const startLine = Math.max(1, ref.startLine ?? 1);
    const endLine = Math.max(startLine, ref.endLine ?? startLine);
    const text = ref.text?.trim() || `(code reference: ${path})`;
    addCodeReferenceToComposer({
      workspacePath: path,
      startLine,
      endLine,
      text,
    });
  }

  const input = document.getElementById('msgInput') as HTMLTextAreaElement | null;
  if (!input) return { chatId: created.chatId };

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

  return { chatId: created.chatId };
}
