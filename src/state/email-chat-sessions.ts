/**
 * Email assistant session helpers.
 *
 * Email conversations share the local chats workspace for file permissions but
 * carry an app scope so they never appear in Code, Desktop, or Chat app rails.
 */

import { getChatsWorkspacePath } from '../lib/chats-workspace';
import type { Chat } from '../types';
import {
  EMAIL_APP_ID,
  createEmailAssistantChat,
} from './session-workspace-scope';

export { EMAIL_APP_ID, createEmailAssistantChat };

/** Ensure the remembered Email assistant conversation is globally active. */
export async function ensureActiveEmailAssistantChat(): Promise<{
  chat: Chat;
  workspacePath: string;
}> {
  const workspacePath = await getChatsWorkspacePath();
  if (!workspacePath) {
    throw new Error('Email assistant workspace is unavailable. Open or restart Minnow.');
  }

  const { activateEmailAssistantChatForApp } = await import('./sessions');
  return {
    chat: activateEmailAssistantChatForApp(workspacePath),
    workspacePath,
  };
}
