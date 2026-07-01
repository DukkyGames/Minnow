/**
 * Per-chat worktree helpers (MIN-276) — attach/detach, labels, managed-slot detection.
 */

import { normalizeWorkspacePath } from '../lib/normalize-workspace-path.ts';
import { sanitizeRefFragment } from './worktree-isolation.ts';
import { getWorkspacePath } from './workspace.ts';
import {
  createChatWorktree,
  removeChatWorktree,
} from './worktree-service.ts';
import type { Chat } from '../types.ts';

/** True when the chat runs tools inside an isolated git worktree. */
export function isChatWorktreeMode(chat: Pick<Chat, 'worktreeRoot'>): boolean {
  return Boolean(chat.worktreeRoot?.trim());
}

/** Short label for the composer run-target button. */
export function formatComposerRunTargetLabel(chat: Pick<Chat, 'worktreeRoot'>): string {
  return isChatWorktreeMode(chat) ? 'Worktree' : 'Local';
}

/** Short label for the composer branch button. */
export function formatComposerBranchLabel(branch?: string): string {
  const name = branch?.trim();
  return name || 'Branch';
}

/**
 * Expected managed slot path pattern: ~/.minnow/worktrees/<repo>/chat/<chatId>.
 * Used to decide whether delete should remove the worktree.
 */
export function isManagedChatWorktreePath(
  chatId: string,
  worktreePath: string,
): boolean {
  const slot = sanitizeRefFragment(chatId);
  const wt = worktreePath.trim().replace(/\\/g, '/');
  if (!slot || !wt) return false;
  return wt.includes('/worktrees/') && wt.endsWith(`/chat/${slot}`);
}

/** Detach a chat from its worktree; remove the managed slot when Minnow created it. */
export async function detachChatWorktree(chat: Chat): Promise<void> {
  const managed = chat.chatWorktreeManaged === true;
  const wt = chat.worktreeRoot?.trim();
  if (managed) {
    await removeChatWorktree({ chatId: chat.id });
  }
  delete chat.worktreeRoot;
  delete chat.chatWorktreeManaged;
  if (!managed && wt) {
    // Attached to a foreign worktree — leave filesystem intact.
  }
}

/** Point the chat at a worktree path + branch (existing attachment). */
export function attachChatToWorktree(
  chat: Chat,
  worktreePath: string,
  branch?: string,
): void {
  const path = normalizeWorkspacePath(worktreePath);
  chat.worktreeRoot = path;
  if (branch?.trim()) chat.gitBranch = branch.trim();
  chat.chatWorktreeManaged = isManagedChatWorktreePath(chat.id, path);
}

/** Create a fresh managed worktree for this chat on `branch`. */
export async function createManagedChatWorktree(
  chat: Chat,
  branch: string,
  baseRef?: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await createChatWorktree({
    chatId: chat.id,
    branch: branch.trim(),
    baseRef,
  });
  if (!res.ok || !res.path) {
    return { ok: false, error: res.error ?? res.output ?? 'Could not create worktree' };
  }
  chat.worktreeRoot = res.path;
  chat.gitBranch = (res.branch ?? branch).trim();
  chat.chatWorktreeManaged = true;
  return { ok: true };
}

/** Switch chat back to the main Code workspace (Local target). */
export async function setChatRunTargetLocal(chat: Chat): Promise<void> {
  await detachChatWorktree(chat);
}

/** Best-effort cleanup when a chat is deleted. */
export async function cleanupChatWorktreeOnDelete(chat: Chat): Promise<void> {
  if (!chat.chatWorktreeManaged) return;
  await removeChatWorktree({ chatId: chat.id });
}

/** Workspace root used for branch listing (always the Code workspace). */
export function composerGitRepoRoot(): string {
  return getWorkspacePath().trim();
}
