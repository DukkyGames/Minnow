import { appConfirm } from './app-dialog';
/**
 * Block workspace switches while orchestrator boards are running (MIN-344, MIN-752).
 */

import { setWorkspacePath } from '../config/workspace-api';
import { normalizeWorkspacePath } from '../lib/normalize-workspace-path';
import {
  listBoards,
  stopBoard,
  type BoardSummary,
} from '../orchestrator/client';
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

/** Injected in tests so V2 list/stop do not need a live `/api/boards` server. */
let listV2Boards: () => Promise<BoardSummary[]> = listBoards;
let stopV2Board: (boardId: string) => Promise<void> = stopBoard;

/** Test seam for V2 switch-guard list/stop. Pass null to restore defaults. */
export function setV2WorkspaceSwitchDepsForTests(
  deps: {
    listBoards?: () => Promise<BoardSummary[]>;
    stopBoard?: (boardId: string) => Promise<void>;
  } | null,
): void {
  listV2Boards = deps?.listBoards ?? listBoards;
  stopV2Board = deps?.stopBoard ?? stopBoard;
}

/** True when a board still has active orchestration work that must not be orphaned. */
export function isBoardBlockingWorkspaceSwitch(group: ChatGroup): boolean {
  const board = group.orchestrateBoard;
  if (!board) return false;
  if (isBoardRunning(group)) return true;
  return countRunningTaskChats(board) > 0;
}

/** V1 boards in the given workspace that would be orphaned by a switch away. */
export function getBlockingBoardsForWorkspace(workspacePath?: string): ChatGroup[] {
  if (!sessionState) return [];
  const ws = normalizeWorkspacePath(workspacePath ?? getWorkspacePath());
  return getGroupsForWorkspace(ws).filter(isBoardBlockingWorkspaceSwitch);
}

/** Running V2 boards for the live workspace (the list API is already scoped). */
export async function getBlockingV2BoardsForWorkspace(): Promise<BoardSummary[]> {
  try {
    const boards = await listV2Boards();
    return boards.filter((board) => board.status === 'running');
  } catch {
    return [];
  }
}

/** Whether switching from the current workspace to targetPath needs a V1 board stop confirm. */
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

  // V2 lives in `#orchestratorBoardsRoot`, not a ChatGroup. Close the live pane
  // of the workspace we are leaving; the list refreshes after the switch.
  const { isBoardsViewOpen, deselectBoardForWorkspaceSwitch } = await import(
    '../orchestrator/boards-view'
  );
  if (isBoardsViewOpen()) {
    deselectBoardForWorkspaceSwitch();
  }
}

type NamedBoard = { name?: string };

/** User-facing confirm copy for one or more blocking boards. */
export function formatWorkspaceSwitchBoardConfirmMessage(groups: readonly NamedBoard[]): string {
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
  const current = normalizeWorkspacePath(getWorkspacePath());
  const target = normalizeWorkspacePath(targetPath);
  if (!current || current === target) {
    return true;
  }

  const v1 = getBlockingBoardsForWorkspace(current);
  const v2 = await getBlockingV2BoardsForWorkspace();
  if (v1.length === 0 && v2.length === 0) {
    return true;
  }

  const named: NamedBoard[] = [
    ...v1,
    ...v2.map((board) => ({ name: board.name?.trim() || 'Orchestrate board' })),
  ];
  const proceed = await appConfirm(formatWorkspaceSwitchBoardConfirmMessage(named));
  if (!proceed) {
    return false;
  }

  for (const group of v1) {
    const planner = getPlannerChatForGroup(group);
    if (!planner) continue;
    stopBoardAutoRun(group, planner);
  }
  for (const board of v2) {
    try {
      await stopV2Board(board.boardId);
    } catch (err) {
      console.warn('[workspace] failed to stop V2 board', board.boardId, err);
    }
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
