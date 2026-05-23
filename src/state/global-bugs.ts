/**
 * Aggregate bugs from ~/.minnow/bugs/state.json (MIN-16 global list).
 */

import { normalizeWorkspacePath } from '../lib/normalize-workspace-path.ts';
import { findBugById, listBugs } from './bug-board-store.ts';
import { findChatById } from './sessions.ts';
import type { BugCard, BugColumn } from '../types.ts';

/** One bug row in the global list. */
export interface GlobalBugEntry {
  bug: BugCard;
  /** Linked investigation/fix chat when set. */
  chatName: string;
}

export type GlobalBugScope = 'all' | 'current_workspace';

export type CollectGlobalBugsOptions = {
  workspacePath?: string;
  scope?: GlobalBugScope;
  hideComplete?: boolean;
  column?: BugColumn | 'all';
};

function workspaceLabel(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return 'Unassigned';
  const parts = trimmed.split('/');
  return parts[parts.length - 1] || trimmed;
}

/** Short label for UI (workspace folder name). */
export function formatGlobalBugWorkspaceLabel(bug: BugCard): string {
  return workspaceLabel(bug.workspacePath);
}

function chatLabelForBug(bug: BugCard): string {
  if (bug.chatId) {
    const chat = findChatById(bug.chatId);
    if (chat?.name?.trim()) return chat.name.trim();
    return 'Investigation chat';
  }
  return '—';
}

/** Collect bugs, newest activity first. */
export function collectGlobalBugs(
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

  for (const bug of listBugs()) {
    const bugWorkspace = normalizeWorkspacePath(bug.workspacePath ?? '');
    if (workspaceKey !== null && bugWorkspace !== workspaceKey) continue;
    if (hideComplete && bug.column === 'complete') continue;
    if (columnFilter !== 'all' && bug.column !== columnFilter) continue;
    entries.push({
      bug,
      chatName: chatLabelForBug(bug),
    });
  }

  entries.sort((a, b) => b.bug.updatedAt - a.bug.updatedAt);
  return entries;
}

/** Count open (non-complete) bugs for a scope. */
export function countOpenGlobalBugs(
  options: Omit<CollectGlobalBugsOptions, 'hideComplete' | 'column'> = {},
): number {
  return collectGlobalBugs({ ...options, hideComplete: true, column: 'all' }).length;
}

/** Resolve entry by bug id (for pipeline / navigation). */
export function findGlobalBugEntry(bugId: string): GlobalBugEntry | undefined {
  const bug = findBugById(bugId);
  if (!bug) return undefined;
  return { bug, chatName: chatLabelForBug(bug) };
}
