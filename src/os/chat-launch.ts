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

  launchApp('code', { chatId: trimmed });
  await switchToCodeChat(trimmed);
}

/** Foreground Chat app and activate the given assistant thread. */
export async function launchChatWithThread(chatId: string): Promise<void> {
  const trimmed = chatId.trim();
  if (!trimmed) {
    launchApp('chat');
    return;
  }

  launchApp('chat', { chatId: trimmed });
  await switchToChatAppThread(trimmed);
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

/** Activate an assistant thread after the Chat app is foreground (notification deep-link). */
export async function switchToChatAppThread(chatId: string): Promise<void> {
  const trimmed = chatId.trim();
  if (!trimmed) return;

  const { activateChatAppThread } = await import('../ui/chat-app');
  const trySwitch = (attempt = 0): void => {
    const root = document.getElementById('chatView');
    if (root?.classList.contains('is-open') || attempt >= 20) {
      activateChatAppThread(trimmed);
      return;
    }
    window.setTimeout(() => trySwitch(attempt + 1), 50);
  };
  trySwitch();
}
