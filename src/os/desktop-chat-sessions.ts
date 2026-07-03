/**
 * Desktop chat session helpers — scoped to ~/.minnow/workspace.
 */

import { getDesktopWorkspacePath } from '../lib/desktop-workspace';
import type { Chat } from '../types';
import { createAssistantChat, CHAT_APP_ID } from '../state/session-workspace-scope';

export { CHAT_APP_ID, createAssistantChat };

/**
 * Ensure an active assistant chat exists for desktop chat and make it the session active chat.
 */
export async function ensureActiveDesktopAssistantChat(): Promise<Chat> {
  const desktopWorkspacePath = await getDesktopWorkspacePath();
  if (!desktopWorkspacePath) {
    throw new Error('Desktop workspace is unavailable (start the tool server with npm start)');
  }
  const { activateAssistantChatForApp } = await import('../state/sessions');
  return activateAssistantChatForApp(desktopWorkspacePath);
}
