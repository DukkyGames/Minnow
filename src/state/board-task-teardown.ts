/**
 * Best-effort cleanup when a board task chat ends: stop dev-servers and background
 * commands scoped to the task worktree so ports do not leak between tasks.
 */

import type { Chat, ChatGroup } from '../types.ts';
import { resolveChatWorktreeRoot } from './worktree-isolation.ts';

/** Stop dev-server hub state and agent background runs for a board task chat. */
export function teardownBoardTaskChatResources(
  chat: Pick<Chat, 'id' | 'worktreeRoot' | 'boardGroupId' | 'boardTaskId'>,
  groups?: ChatGroup[],
): void {
  const worktree = resolveChatWorktreeRoot(chat, groups);
  if (!worktree) return;

  void fetch('/api/workspace/dev-server/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceRoot: worktree }),
  }).catch(() => {});

  void fetch('/api/terminal/stop-chat-runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chatId: chat.id }),
  }).catch(() => {});
}
