/**
 * Apply desktop session restore when foregrounding the desktop chat surface.
 * Mirrors {@link restoreCodeSessionOnForeground} in code-launch.ts.
 */

import { getDesktopWorkspacePath, isDesktopWorkspacePath } from '../lib/desktop-workspace';
import { getWorkspacePath } from '../state/workspace';
import { isDesktopChatActive } from './desktop-state';

/** Re-render desktop rail, transcript, file drawer, and stream shell for the active desktop chat. */
async function refreshDesktopChatSurface(): Promise<void> {
  const { ensureSessionsReady, getActiveChat } = await import('../state/sessions');
  await ensureSessionsReady();

  const desktopPath = await getDesktopWorkspacePath();
  const { renderDesktopChatRail } = await import('../ui/desktop-chat-rail');
  const { renderDesktopChatMessages } = await import('./desktop-chat');
  const { syncDesktopWorkspaceMounts } = await import('./desktop-workspace-mounts');
  const { clearPanelCwdUserOverride, syncPanelFromActiveChat } = await import('../ui/git-panel');
  const { syncComposerFromStreamingState } = await import('../ui/composer-send');
  const { syncChatItemDotsInDom } = await import('../ui/chat-item-dot');
  const { refreshContextUsageRing } = await import('../ui/context-usage-ring');

  renderDesktopChatRail(desktopPath);
  renderDesktopChatMessages();
  clearPanelCwdUserOverride();
  syncPanelFromActiveChat({ forceFileTree: true });
  await syncDesktopWorkspaceMounts();
  syncComposerFromStreamingState();
  syncChatItemDotsInDom();
  refreshContextUsageRing();
  void import('../tools/stream-chat-dom').then((m) =>
    m.remountStreamDomForChat(getActiveChat().id),
  );
}

/**
 * Foreground desktop with the assistant thread bound to ~/.minnow/workspace —
 * not the Code project chat left active by orchestrator/board work.
 */
export async function restoreDesktopSessionOnForeground(): Promise<void> {
  const { getForegroundAppId, getOsView } = await import('./instances');
  // Stale desktop restore must not repoint the file tree while Code is foreground.
  if (getOsView() === 'app' && getForegroundAppId() === 'code') return;

  const {
    activateDesktopAssistantChatForApp,
    ensureSessionsReady,
    getActiveChat,
    rememberWorkspaceActiveChat,
    sessionState,
  } = await import('../state/sessions');

  await ensureSessionsReady();
  if (!sessionState) return;

  const desktopPath = await getDesktopWorkspacePath();
  if (!desktopPath) return;

  if (!isDesktopChatActive()) {
    const active = getActiveChat();
    const activeIsDesktop = isDesktopWorkspacePath(active.workspacePath ?? '', desktopPath);
    if (!activeIsDesktop && active.kind !== 'expert') {
      rememberWorkspaceActiveChat(getWorkspacePath());
      activateDesktopAssistantChatForApp(desktopPath);
    }
    const { refreshContextUsageRing } = await import('../ui/context-usage-ring');
    refreshContextUsageRing();
    return;
  }

  const active = getActiveChat();
  const activeIsDesktop = isDesktopWorkspacePath(active.workspacePath ?? '', desktopPath);

  if (active.kind === 'expert' || activeIsDesktop) {
    await refreshDesktopChatSurface();
    return;
  }

  rememberWorkspaceActiveChat(getWorkspacePath());
  activateDesktopAssistantChatForApp(desktopPath);
  await refreshDesktopChatSurface();
}
