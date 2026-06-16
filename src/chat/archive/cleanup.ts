/**
 * Fire-and-forget Brain archive cleanup when a chat is deleted (MIN-139).
 */

import { brainWorkspaceKeyFromPath } from '../../lib/brain-workspace-key';
import { deleteChatArchive } from './store-client';

/** Remove ~/.minnow/brain/.../archive/<chatId>/ when policy was archive. */
export function cleanupChatArchiveOnDelete(
  chatId: string,
  workspacePath: string,
  policy?: string,
): void {
  if (policy !== 'archive') return;
  const workspaceKey = brainWorkspaceKeyFromPath(workspacePath) || 'workspace';
  void deleteChatArchive(chatId, workspaceKey);
}
