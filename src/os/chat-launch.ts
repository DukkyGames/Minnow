/**
 * Code app launch helper — switch workspace chat from OS deep-links.
 */

import { launchApp } from './router';

/** Foreground Code and activate the given chat session. */
export async function launchCodeWithChat(chatId: string): Promise<void> {
  const trimmed = chatId.trim();
  if (!trimmed) {
    launchApp('code');
    return;
  }

  launchApp('code', { chatId: trimmed, codeSection: 'chat' });
  await switchToCodeChat(trimmed);
}

/** Foreground desktop chat and activate the given assistant thread. */
export async function launchChatWithThread(chatId: string): Promise<void> {
  const trimmed = chatId.trim();
  if (!trimmed) {
    launchApp('chat');
    return;
  }

  launchApp('chat', { chatId: trimmed });
  await switchToDesktopChatThread(trimmed);
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
  const trimmed = chatId.trim();
  if (!trimmed) return;

  const { activateDesktopChatSession } = await import('./desktop-chat');
  const trySwitch = (attempt = 0): void => {
    const col = document.getElementById('desktopChatCol');
    if (col || attempt >= 20) {
      activateDesktopChatSession(trimmed);
      return;
    }
    window.setTimeout(() => trySwitch(attempt + 1), 50);
  };
  trySwitch();
}

/** @deprecated Legacy Chat app thread switch — routes to desktop chat. */
export async function switchToChatAppThread(chatId: string): Promise<void> {
  await switchToDesktopChatThread(chatId);
}
