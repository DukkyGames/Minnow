/**
 * Code app launch helper — switch workspace chat from OS deep-links.
 */

import { isChatsWorkspacePath } from '../lib/chats-workspace';
import { isDesktopWorkspacePath } from '../lib/desktop-workspace';
import { normalizeWorkspacePath } from '../lib/normalize-workspace-path';
import { sessionState } from '../state/sessions';
import { getWorkspacePath } from '../state/workspace';
import { launchApp } from './router';

/** True when the chat belongs to a user project folder (not a Minnow sandbox). */
function isProjectWorkspacePath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed) return false;
  return !isChatsWorkspacePath(trimmed) && !isDesktopWorkspacePath(trimmed);
}

/** Switch the Code workspace when a deep-linked chat lives in another project folder. */
async function ensureWorkspaceForCodeChat(chatId: string): Promise<boolean> {
  const chat = sessionState?.chats.find((row) => row.id === chatId);
  const chatWorkspace = chat?.workspacePath?.trim();
  if (!chat || !chatWorkspace || !isProjectWorkspacePath(chatWorkspace)) {
    return true;
  }

  if (normalizeWorkspacePath(chatWorkspace) === normalizeWorkspacePath(getWorkspacePath())) {
    return true;
  }

  const { executeWorkspaceSwitch } = await import('../ui/workspace-switch-guard');
  const info = await executeWorkspaceSwitch(chatWorkspace);
  return info !== null;
}

/** Foreground Code and activate the given chat session. */
export async function launchCodeWithChat(chatId: string): Promise<void> {
  const trimmed = chatId.trim();
  if (!trimmed) {
    launchApp('code');
    return;
  }

  const allowed = await ensureWorkspaceForCodeChat(trimmed);
  if (!allowed) return;

  launchApp('code', { chatId: trimmed, codeSection: 'chat' });
  await switchToCodeChat(trimmed);
}

/** Foreground Code chat and activate the given assistant thread (legacy desktop/chat deep-links). */
export async function launchChatWithThread(chatId: string): Promise<void> {
  const trimmed = chatId.trim();
  if (!trimmed) {
    launchApp('code', { codeSection: 'chat' });
    return;
  }

  await launchCodeWithChat(trimmed);
}

/** Switch sidebar to a chat after Code app is foreground (app-host / deep-link). */
export async function switchToCodeChat(chatId: string): Promise<void> {
  const trimmed = chatId.trim();
  if (!trimmed) return;

  const { switchChat } = await import('../ui/sidebar');
  const trySwitch = (attempt = 0): void => {
    const chatList = document.getElementById('chatList');
    if (chatList || attempt >= 20) {
      switchChat(trimmed);
      return;
    }
    window.setTimeout(() => trySwitch(attempt + 1), 50);
  };
  trySwitch();
}

/** Activate an assistant thread after desktop chat is active (notification deep-link). */
export async function switchToDesktopChatThread(chatId: string): Promise<void> {
  await switchToCodeChat(chatId);
}

/** @deprecated Legacy Chat app thread switch — routes to desktop chat. */
export async function switchToChatAppThread(chatId: string): Promise<void> {
  await switchToDesktopChatThread(chatId);
}
