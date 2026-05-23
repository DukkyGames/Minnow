/**
 * Pure mutators for chat.bugBoard (bug tracker Kanban).
 */

import type {
  BugBoardState,
  BugCard,
  BugColumn,
  BugSeverity,
  Chat,
} from '../types.ts';
import { emitBugBoardChange } from './bug-board-events.ts';
import { scheduleSaveSessions, touchChat } from './sessions.ts';

/** Injectable clock for deterministic tests. */
let bugBoardNowMs = (): number => Date.now();

/** Override timestamp source in tests. */
export function setBugBoardNowForTests(fn: (() => number) | null): void {
  bugBoardNowMs = fn ?? (() => Date.now());
}

const BUG_COLUMNS: readonly BugColumn[] = [
  'reported',
  'investigating',
  'planned',
  'fixing',
  'complete',
] as const;

const BUG_SEVERITIES = new Set<BugSeverity>(['low', 'medium', 'high', 'critical']);

export function isBugColumn(value: string): value is BugColumn {
  return (BUG_COLUMNS as readonly string[]).includes(value);
}

export function isBugSeverity(value: string): value is BugSeverity {
  return BUG_SEVERITIES.has(value as BugSeverity);
}

/** Workspace-relative default plan path for a bug id. */
export function defaultBugPlanPath(bugId: string): string {
  return `documentation/plans/bugs/${bugId}.md`;
}

function ensureBugBoard(chat: Chat, nowMs: number): BugBoardState {
  if (!chat.bugBoard) {
    chat.bugBoard = {
      bugs: [],
      startedAt: nowMs,
      lastUpdatedAt: nowMs,
    };
  }
  return chat.bugBoard;
}

function touchBugBoard(chat: Chat): void {
  const nowMs = bugBoardNowMs();
  const board = ensureBugBoard(chat, nowMs);
  board.lastUpdatedAt = nowMs;
  touchChat(chat);
  scheduleSaveSessions();
  emitBugBoardChange(chat.id);
  void import('../ui/global-bugs-page.ts').then((m) => m.refreshGlobalBugsSidebarBadge());
}

/** Create bug board if missing and return it. */
export function getOrInitBugBoard(chat: Chat): BugBoardState {
  return ensureBugBoard(chat, bugBoardNowMs());
}

/** Find one bug by id. */
export function findBug(chat: Chat, bugId: string): BugCard | undefined {
  return chat.bugBoard?.bugs.find((b) => b.id === bugId);
}

export type AddBugInput = {
  title: string;
  description: string;
  severity: BugSeverity;
};

/** Add a bug card in the Reported column. */
export function addBug(chat: Chat, input: AddBugInput, bugId: string): BugCard {
  const nowMs = bugBoardNowMs();
  const board = ensureBugBoard(chat, nowMs);
  const card: BugCard = {
    id: bugId,
    title: input.title.trim(),
    description: input.description.trim(),
    severity: input.severity,
    column: 'reported',
    createdAt: nowMs,
    updatedAt: nowMs,
  };
  board.bugs.push(card);
  touchBugBoard(chat);
  return card;
}

export type UpdateBugPatch = {
  column?: BugColumn;
  notes?: string;
  planPath?: string;
  investigateRunId?: string;
  planRunId?: string;
  fixRunId?: string;
};

/** Patch one bug card; returns updated card or null if missing. */
export function updateBug(
  chat: Chat,
  bugId: string,
  patch: UpdateBugPatch,
): BugCard | null {
  const bug = findBug(chat, bugId);
  if (!bug) return null;
  const nowMs = bugBoardNowMs();
  if (patch.column) bug.column = patch.column;
  if (patch.notes !== undefined) bug.notes = patch.notes;
  if (patch.planPath !== undefined) bug.planPath = patch.planPath;
  if (patch.investigateRunId !== undefined) bug.investigateRunId = patch.investigateRunId;
  if (patch.planRunId !== undefined) bug.planRunId = patch.planRunId;
  if (patch.fixRunId !== undefined) bug.fixRunId = patch.fixRunId;
  bug.updatedAt = nowMs;
  touchBugBoard(chat);
  return bug;
}

/** Serialize bug board for tools and UI. */
export function getBugBoardSnapshot(chat: Chat): BugBoardState | null {
  return chat.bugBoard ?? null;
}

/** Count bugs per column (for header stats). */
export function countBugsByColumn(board: BugBoardState): Record<BugColumn, number> {
  const counts: Record<BugColumn, number> = {
    reported: 0,
    investigating: 0,
    planned: 0,
    fixing: 0,
    complete: 0,
  };
  for (const bug of board.bugs) {
    counts[bug.column] += 1;
  }
  return counts;
}
