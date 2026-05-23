/**
 * Aggregate bug cards across all chats in the session (MIN-16 global list).
 */

import { normalizeWorkspacePath } from '../lib/normalize-workspace-path.ts';
import type { BugCard, BugColumn, Chat } from '../types.ts';

/** One bug row in the global list with owning chat metadata. */
export interface GlobalBugEntry {
  chatId: string;
  chatName: string;
  workspacePath: string;
  bug: BugCard;
}

export type GlobalBugScope = 'all' | 'current_workspace';

export type CollectGlobalBugsOptions = {
  /** When set, only bugs from chats in this workspace (normalized). */
  workspacePath?: string;
  scope?: GlobalBugScope;
  /** Omit bugs in the complete column. */
  hideComplete?: boolean;
  /** When set, only bugs in this column. */
  column?: BugColumn | 'all';
};

function workspaceLabel(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return 'Unassigned';
  const parts = trimmed.split('/');
  return parts[parts.length - 1] || trimmed;
}

/** Short label for UI (chat name + workspace). */
export function formatGlobalBugWorkspaceLabel(entry: GlobalBugEntry): string {
  const ws = workspaceLabel(entry.workspacePath);
  if (!entry.workspacePath.trim()) return ws;
  return ws;
}

/** Collect bugs from chats, newest activity first. */
export function collectGlobalBugs(
  chats: Chat[],
  options: CollectGlobalBugsOptions = {},
): GlobalBugEntry[] {
  const scope = options.scope ?? 'current_workspace';
  const hideComplete = options.hideComplete !== false;
  const columnFilter = options.column ?? 'all';
  const workspaceKey =
    scope === 'current_workspace' && options.workspacePath != null
      ? normalizeWorkspacePath(options.workspacePath)
      : null;

  const entries: GlobalBugEntry[] = [];

  for (const chat of chats) {
    const bugs = chat.bugBoard?.bugs;
    if (!bugs?.length) continue;

    const chatWorkspace = normalizeWorkspacePath(chat.workspacePath ?? '');
    if (workspaceKey !== null && chatWorkspace !== workspaceKey) continue;

    for (const bug of bugs) {
      if (hideComplete && bug.column === 'complete') continue;
      if (columnFilter !== 'all' && bug.column !== columnFilter) continue;
      entries.push({
        chatId: chat.id,
        chatName: chat.name?.trim() || 'Chat',
        workspacePath: chat.workspacePath ?? '',
        bug,
      });
    }
  }

  entries.sort((a, b) => b.bug.updatedAt - a.bug.updatedAt);
  return entries;
}

/** Count open (non-complete) bugs for a scope. */
export function countOpenGlobalBugs(
  chats: Chat[],
  options: Omit<CollectGlobalBugsOptions, 'hideComplete' | 'column'> = {},
): number {
  return collectGlobalBugs(chats, { ...options, hideComplete: true, column: 'all' })
    .length;
}
