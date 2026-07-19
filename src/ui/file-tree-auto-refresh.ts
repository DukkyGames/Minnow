/**
 * After successful workspace filesystem tool calls, debounce-refresh the Files tree
 * so agent writes appear without manual Refresh (see executeTool wiring in tools/client).
 */

import type { ToolExecutionResult } from '../types';
import { getWorkspacePath } from '../state/workspace';
import { panelPathsEqual } from './panel-worktree-cwd';
import { getFileTreeListingWorkspaceRoot } from './file-tree-listing-root';
import { isFileTreeServerAvailable } from './file-tree-server';

/** Built-in tools that mutate workspace files or directories (aligned with path-args writes). */
export const FILE_TREE_MUTATING_TOOLS = new Set<string>([
  'save_file',
  'append_file',
  'insert_at_line',
  'replace_text_in_file',
  'make_directory',
  'move_file',
  'copy_file',
  'delete_path',
  'create_pdf',
  'create_spreadsheet',
  'create_word_document',
]);

/**
 * Debounce window — resets on every tool call; coalesces a burst of rapid agent
 * writes into one tree reload when the burst pauses for this long.
 */
export const FILE_TREE_AUTO_REFRESH_DEBOUNCE_MS = 1500;

/**
 * Hard ceiling on how long we wait before forcing a refresh even under continuous
 * agent load (pure debounce would never fire if agents write faster than the window).
 */
export const FILE_TREE_AUTO_REFRESH_MAX_DELAY_MS = 10_000;

import { scheduleChatAppOutputsRefreshAfterTool } from './chat-app-outputs';
import { refreshFileTreeViaBridge } from './file-tree-refresh-bridge';

const defaultRefreshRunner = async (): Promise<void> => {
  await refreshFileTreeViaBridge();
};

/** Swappable runner for unit tests (counts invocations without loading file-tree). */
let refreshRunner: () => Promise<void> = defaultRefreshRunner;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let maxDelayTimer: ReturnType<typeof setTimeout> | null = null;

/** True when a mutating tool's workspaceRoot matches the file tree listing root. */
function toolWorkspaceMatchesFileTreeListing(workspaceRoot?: string): boolean {
  const treeRoot = getFileTreeListingWorkspaceRoot();
  const main = getWorkspacePath().trim();
  const toolRoot = workspaceRoot?.trim() || undefined;

  if (!treeRoot) {
    if (!toolRoot) return true;
    return Boolean(main && panelPathsEqual(toolRoot, main));
  }

  if (!toolRoot) return false;
  return panelPathsEqual(treeRoot, toolRoot);
}

/**
 * True when a successful mutating tool result should trigger a debounced file tree refresh.
 * Skipped when the tool ran in a different root than the visible file tree (e.g. isolated
 * worktree writes while the tree shows the main workspace).
 */
export function shouldScheduleFileTreeRefresh(
  toolName: string,
  result: ToolExecutionResult,
  workspaceRoot?: string,
): boolean {
  if (!isFileTreeServerAvailable()) {
    return false;
  }
  if (!toolWorkspaceMatchesFileTreeListing(workspaceRoot)) {
    return false;
  }
  if (!FILE_TREE_MUTATING_TOOLS.has(toolName)) {
    return false;
  }
  const text = typeof result.content === 'string' ? result.content : '';
  if (text.startsWith('Error:')) {
    return false;
  }
  return true;
}

function flushDebouncedRefresh(): void {
  if (debounceTimer != null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (maxDelayTimer != null) {
    clearTimeout(maxDelayTimer);
    maxDelayTimer = null;
  }
  void refreshRunner().catch(() => {
    /* refreshFileTree already surfaces errors via UI; avoid unhandled rejection */
  });
}

/**
 * Schedules a debounced full file tree refresh after a successful mutating tool call.
 * Uses a debounce+throttle pattern: the debounce resets on every call, but the
 * max-delay timer ensures a refresh fires within FILE_TREE_AUTO_REFRESH_MAX_DELAY_MS
 * even when agents write continuously (which would otherwise prevent the debounce
 * from ever firing).
 */
export function scheduleFileTreeRefreshAfterTool(
  toolName: string,
  result: ToolExecutionResult,
  workspaceRoot?: string,
): void {
  if (!shouldScheduleFileTreeRefresh(toolName, result, workspaceRoot)) {
    return;
  }
  // Debounce: reset the short timer on every write.
  if (debounceTimer != null) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(flushDebouncedRefresh, FILE_TREE_AUTO_REFRESH_DEBOUNCE_MS);

  // Throttle ceiling: start the hard-limit timer only on the first write of a burst.
  if (maxDelayTimer == null) {
    maxDelayTimer = setTimeout(flushDebouncedRefresh, FILE_TREE_AUTO_REFRESH_MAX_DELAY_MS);
  }
}

/**
 * Runs a tool executor, then applies file-tree auto-refresh rules to the result.
 * Pass the tool context so worktree-scoped calls skip the main workspace file tree refresh.
 */
export async function runWithFileTreeAutoRefresh<T extends ToolExecutionResult>(
  toolName: string,
  fn: () => Promise<T>,
  context?: { workspaceRoot?: string },
): Promise<T> {
  const result = await fn();
  scheduleFileTreeRefreshAfterTool(toolName, result, context?.workspaceRoot);
  scheduleChatAppOutputsRefreshAfterTool(toolName, result);
  return result;
}

/** Test helper: restore default refresh runner and cancel any pending timers. */
export function resetFileTreeAutoRefreshForTests(): void {
  refreshRunner = defaultRefreshRunner;
  if (debounceTimer != null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (maxDelayTimer != null) {
    clearTimeout(maxDelayTimer);
    maxDelayTimer = null;
  }
}

/** Test helper: replace the refresh implementation (e.g. counter stub). */
export function setFileTreeAutoRefreshRunnerForTests(fn: () => Promise<void>): void {
  refreshRunner = fn;
}
