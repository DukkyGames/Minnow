/**
 * Resolve cwd for interactive PTY sessions (MIN-349).
 */

import { validateAllowedWorkspaceRoot } from '../chats-workspace/paths.js';
import { resolveChatCwd } from '../workspace/chat-cwd.js';

/**
 * @param {string} projectRoot Global Code workspace root.
 * @param {{ cwd?: string; chatId?: string | null }} body Session POST body.
 * @param {(chatId: string) => Promise<string | undefined>} [resolveChatCwdFn]
 * @returns {Promise<string>}
 */
export async function resolvePtySessionCwd(
  projectRoot,
  body,
  resolveChatCwdFn = resolveChatCwd,
) {
  const explicit =
    typeof body?.cwd === 'string' && body.cwd.trim() ? body.cwd.trim() : '';
  if (explicit) {
    return validateAllowedWorkspaceRoot(explicit);
  }

  const chatId = typeof body?.chatId === 'string' ? body.chatId : null;
  if (chatId) {
    const chatRoot = await resolveChatCwdFn(chatId);
    if (chatRoot) {
      try {
        return await validateAllowedWorkspaceRoot(chatRoot);
      } catch {
        return chatRoot;
      }
    }
  }

  return projectRoot;
}
