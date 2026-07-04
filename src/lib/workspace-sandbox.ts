/**
 * Minnow-owned sandbox workspace paths (~/.minnow/chats, ~/.minnow/workspace).
 * Used to scope tools and prompts to the chat's bound sandbox instead of the Code workspace.
 */

import { normalizeWorkspacePath } from './normalize-workspace-path';

/** True when the path is a Minnow chat/desktop sandbox under ~/.minnow. */
export function isMinnowSandboxWorkspacePath(workspacePath: string): boolean {
  const normalized = normalizeWorkspacePath(workspacePath);
  if (!normalized) return false;
  return (
    normalized.endsWith('/.minnow/chats') || normalized.endsWith('/.minnow/workspace')
  );
}
