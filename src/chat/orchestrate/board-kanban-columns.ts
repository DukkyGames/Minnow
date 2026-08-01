/**
 * Kanban column layout for Orchestrate boards (shared by board UI + tests).
 */

import { boardSkipsPerTaskTesting } from '../../state/orchestrate-board-actions.ts';
import type { BoardTaskStatus, OrchestrateBoardState } from '../../types.ts';

/** True when the Testing kanban lane should appear (legacy in-flight testers). */
export function boardShowsTestingKanbanColumn(board: OrchestrateBoardState): boolean {
  if (!boardSkipsPerTaskTesting(board)) return true;
  return board.tasks.some((t) => t.status === 'testing');
}

/** Kanban columns for the board (3 lanes when skip is on and no legacy testing). */
export function getKanbanColumnDefs(
  board: OrchestrateBoardState,
): Array<{ id: string; label: string; statuses: BoardTaskStatus[] }> {
  const columns: Array<{ id: string; label: string; statuses: BoardTaskStatus[] }> = [
    { id: 'planned', label: 'Planned', statuses: ['planned', 'blocked'] },
    { id: 'in_progress', label: 'In Progress', statuses: ['in_progress', 'merging'] },
  ];
  if (boardShowsTestingKanbanColumn(board)) {
    columns.push({ id: 'testing', label: 'Testing', statuses: ['testing'] });
  }
  columns.push({
    id: 'complete',
    label: 'Complete',
    statuses: ['complete', 'failed', 'quarantined'],
  });
  return columns;
}

/** Compact wave strip lane labels (drops Test when skip is on). */
export function getWaveCompactLaneDefs(
  board: OrchestrateBoardState,
): Array<{ label: string; statuses: BoardTaskStatus[] }> {
  const lanes: Array<{ label: string; statuses: BoardTaskStatus[] }> = [
    { label: 'Plan', statuses: ['planned', 'blocked'] },
    { label: 'Run', statuses: ['in_progress', 'merging'] },
  ];
  if (boardShowsTestingKanbanColumn(board)) {
    lanes.push({ label: 'Test', statuses: ['testing'] });
  }
  lanes.push({ label: 'Done', statuses: ['complete', 'failed', 'quarantined'] });
  return lanes;
}
