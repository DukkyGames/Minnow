import {
  attachChatToWorktree,
  setChatRunTargetLocal,
} from '../state/chat-worktree.ts';
import { scheduleSaveSessions } from '../state/sessions.ts';
import type { Chat } from '../types.ts';
import { syncComposerRunTargetFromActiveChat } from './composer-run-target.ts';
import { getGitPanelNewChatRunTargetSeed } from './git-panel.ts';

/** Apply Source Control browse override to a freshly created chat's run-target. */
export async function applyNewChatRunTargetFromGitPanelBrowse(chat: Chat): Promise<void> {
  const seed = getGitPanelNewChatRunTargetSeed();
  if (!seed) return;
  if (seed.kind === 'local') {
    await setChatRunTargetLocal(chat);
    return;
  }
  if (chat.chatWorktreeManaged) {
    await setChatRunTargetLocal(chat);
  }
  attachChatToWorktree(chat, seed.worktreeRoot, seed.gitBranch);
}

/**
 * Seed composer run-target from git panel browse before chrome sync.
 * Worktree attach is synchronous; Local / managed cleanup runs async with a follow-up sync.
 */
export function seedNewChatComposerRunTarget(chat: Chat): void {
  const seed = getGitPanelNewChatRunTargetSeed();
  if (!seed) return;
  if (seed.kind === 'worktree' && !chat.chatWorktreeManaged) {
    attachChatToWorktree(chat, seed.worktreeRoot, seed.gitBranch);
    return;
  }
  void applyNewChatRunTargetFromGitPanelBrowse(chat).then(() => {
    syncComposerRunTargetFromActiveChat();
    scheduleSaveSessions();
  });
}
