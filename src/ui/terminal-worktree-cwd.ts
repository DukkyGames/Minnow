/**
 * Terminal cwd resolution — mirrors git panel / file tree worktree scoping (MIN-349).
 */

import type { Chat, ChatGroup } from '../types';
import { getWorkspacePath } from '../state/workspace';
import { resolveChatWorktreeRoot } from '../state/worktree-isolation';
import { normalizePanelPath, panelPathsEqual } from './panel-worktree-cwd';

/** Absolute cwd for new PTY sessions: chat worktree or main workspace. */
export function resolveActiveChatTerminalCwd(
  chat: Pick<Chat, 'worktreeRoot' | 'boardTaskId' | 'boardGroupId'>,
  groups: ChatGroup[] | undefined,
): string {
  const worktree = resolveChatWorktreeRoot(chat, groups);
  if (worktree) return worktree;
  const ws = getWorkspacePath().trim();
  return ws || '.';
}

/** True when cwd is a worktree distinct from the main workspace. */
export function isTerminalWorktreeCwd(cwd: string): boolean {
  const ws = getWorkspacePath().trim();
  if (!ws) return false;
  return !panelPathsEqual(cwd, ws);
}

/** Muted header suffix when browsing a task worktree (e.g. " · task-abc"). */
export function getTerminalCwdLabelSuffix(cwd: string): string {
  if (!isTerminalWorktreeCwd(cwd)) return '';
  const base = normalizePanelPath(cwd).split('/').filter(Boolean).pop();
  return base ? ` · ${base}` : '';
}

/** Short label for the terminal header cwd chip. */
export function formatTerminalCwdHeader(cwd: string): string {
  const normalized = normalizePanelPath(cwd);
  const base = normalized.split('/').filter(Boolean).pop() ?? cwd;
  if (isTerminalWorktreeCwd(cwd)) {
    return `${base} (worktree)`;
  }
  return base;
}

export interface TerminalShellHintOptions {
  /** Active chat changed while a PTY tab is open in a different directory. */
  chatSwitched?: boolean;
  activeShellDiffers?: boolean;
}

/** Shell policy hint text; reflects worktree cwd and chat-switch guidance. */
export function formatTerminalShellHint(
  cwd: string,
  options?: TerminalShellHintOptions,
): string {
  const baseHint =
    'Shell has full access on your machine (not limited by workspace tool policy).';
  if (options?.chatSwitched && options?.activeShellDiffers) {
    const suffix = getTerminalCwdLabelSuffix(cwd);
    const label = suffix ? suffix.slice(3) : formatTerminalCwdHeader(cwd);
    return `Chat changed — open a new terminal tab (+) to start in ${label}. Current shell keeps its directory.`;
  }
  if (isTerminalWorktreeCwd(cwd)) {
    return `Shell cwd: ${cwd} (active chat worktree). ${baseHint}`;
  }
  return baseHint;
}

/** Compare two terminal cwd paths (undefined-safe via panel normalization). */
export function terminalCwdsEqual(a: string, b: string): boolean {
  return panelPathsEqual(a, b);
}
