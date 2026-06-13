/**
 * After successful workspace filesystem tool calls, debounce-refresh the Files tree
 * so agent writes appear without manual Refresh (see executeTool wiring in tools/client).
 */

import type { ToolExecutionResult } from '../types';
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
]);

/** Debounce window so rapid multi-file agent edits coalesce into one tree reload. */
export const FILE_TREE_AUTO_REFRESH_DEBOUNCE_MS = 300;

import { scheduleChatAppOutputsRefreshAfterTool } from './chat-app-outputs';
import { refreshFileTreeViaBridge } from './file-tree-refresh-bridge';

const defaultRefreshRunner = async (): Promise<void> => {
  await refreshFileTreeViaBridge();
};

/** Swappable runner for unit tests (counts invocations without loading file-tree). */
let refreshRunner: () => Promise<void> = defaultRefreshRunner;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * True when a successful mutating tool result should trigger a debounced file tree refresh.
 */
export function shouldScheduleFileTreeRefresh(
  toolName: string,
  result: ToolExecutionResult,
): boolean {
  if (!isFileTreeServerAvailable()) {
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
  debounceTimer = null;
  void refreshRunner().catch(() => {
    /* refreshFileTree already surfaces errors via UI; avoid unhandled rejection */
  });
}

/**
 * Schedules a debounced full file tree refresh after a successful mutating tool call.
 */
export function scheduleFileTreeRefreshAfterTool(
  toolName: string,
  result: ToolExecutionResult,
): void {
  if (!shouldScheduleFileTreeRefresh(toolName, result)) {
    return;
  }
  if (debounceTimer != null) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(flushDebouncedRefresh, FILE_TREE_AUTO_REFRESH_DEBOUNCE_MS);
}

/**
 * Runs a tool executor, then applies file-tree auto-refresh rules to the result.
 */
export async function runWithFileTreeAutoRefresh<T extends ToolExecutionResult>(
  toolName: string,
  fn: () => Promise<T>,
): Promise<T> {
  const result = await fn();
  scheduleFileTreeRefreshAfterTool(toolName, result);
  scheduleChatAppOutputsRefreshAfterTool(toolName, result);
  return result;
}

/** Test helper: restore default refresh runner and cancel any pending debounce. */
export function resetFileTreeAutoRefreshForTests(): void {
  refreshRunner = defaultRefreshRunner;
  if (debounceTimer != null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/** Test helper: replace the refresh implementation (e.g. counter stub). */
export function setFileTreeAutoRefreshRunnerForTests(fn: () => Promise<void>): void {
  refreshRunner = fn;
}
