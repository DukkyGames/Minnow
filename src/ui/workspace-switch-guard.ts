/**
 * Block workspace switches while orchestrator boards are running (MIN-344).
 */

import { setWorkspacePath } from '../config/workspace-api';
import { normalizeWorkspacePath } from '../lib/normalize-workspace-path';
import {
  getGroupsForWorkspace,
  getPlannerChatForGroup,
} from '../state/chat-groups';
import {
  countRunningTaskChats,
  stopBoardAutoRun,
} from '../state/orchestrate-board-actions';
import { isBoardRunning } from '../state/orchestrate-board-store';
import { sessionState } from '../state/sessions';
import { getWorkspacePath } from '../state/workspace';
import type { ChatGroup } from '../types';

/** True when a board still has active orchestration work that must not be orphaned. */
export function isBoardBlockingWorkspaceSwitch(group: ChatGroup): boolean {
  const board = group.orchestrateBoard;
  if (!board) return false;
  if (isBoardRunning(group)) return true;
  return countRunningTaskChats(board) > 0;
}

/** Boards in the given workspace that would be orphaned by a switch away. */
export function getBlockingBoardsForWorkspace(workspacePath?: string): ChatGroup[] {
  if (!sessionState) return [];
  const ws = normalizeWorkspacePath(workspacePath ?? getWorkspacePath());
  return getGroupsForWorkspace(ws).filter(isBoardBlockingWorkspaceSwitch);
}

/** Whether switching from the current workspace to targetPath needs a board stop confirm. */
export function isWorkspaceSwitchBlockedByRunningBoard(targetPath: string): boolean {
  const current = normalizeWorkspacePath(getWorkspacePath());
  const target = normalizeWorkspacePath(targetPath);
  if (!current || current === target) return false;
  return getBlockingBoardsForWorkspace(current).length > 0;
}

/** Hide board view when the open board folder belongs to another workspace. */
export async function dismissBoardViewOutsideWorkspace(workspacePath: string): Promise<void> {
  const { getActiveBoardGroup } = await import('../state/chat-groups');
  const activeBoard = getActiveBoardGroup();
  if (
    activeBoard &&
    normalizeWorkspacePath(activeBoard.workspacePath) !== normalizeWorkspacePath(workspacePath)
  ) {
    const { exitBoardViewForNavigation } = await import('./exit-board-view');
    exitBoardViewForNavigation();
  }
}

/** User-facing confirm copy for one or more blocking boards. */
export function formatWorkspaceSwitchBoardConfirmMessage(groups: readonly ChatGroup[]): string {
  if (groups.length === 1) {
    const name = groups[0]?.name?.trim() || 'Orchestrate board';
    return (
      `${name} is still running in this workspace.\n\n` +
      'Stop the board and switch workspace? In-flight agent chats will be cancelled.'
    );
  }
  return (
    `${groups.length} orchestrator boards are still running in this workspace.\n\n` +
    'Stop all boards and switch workspace? In-flight agent chats will be cancelled.'
  );
}

/**
 * When a board is active, prompt to stop cleanly or cancel the switch.
 * Returns true when the switch may proceed (no blockers, or user confirmed stop).
 */
export async function confirmAndStopBoardsForWorkspaceSwitch(
  targetPath: string,
): Promise<boolean> {
  if (!isWorkspaceSwitchBlockedByRunningBoard(targetPath)) {
    return true;
  }

  const blockers = getBlockingBoardsForWorkspace();
  const proceed = window.confirm(formatWorkspaceSwitchBoardConfirmMessage(blockers));
  if (!proceed) {
    return false;
  }

  for (const group of blockers) {
    const planner = getPlannerChatForGroup(group);
    if (!planner) continue;
    stopBoardAutoRun(group, planner);
  }

  const { exitBoardViewForNavigation } = await import('./exit-board-view');
  exitBoardViewForNavigation();
  return true;
}

/** Guard, stop boards if confirmed, PUT workspace, and run shared client refresh. */
export async function executeWorkspaceSwitch(
  absPath: string,
): Promise<import('../config/workspace-api').WorkspaceInfo | null> {
  const allowed = await confirmAndStopBoardsForWorkspaceSwitch(absPath);
  if (!allowed) {
    return null;
  }
  const info = await setWorkspacePath(absPath);
  const { applyWorkspaceSwitch } = await import('./workspace-button');
  await applyWorkspaceSwitch(info);
  return info;
}
