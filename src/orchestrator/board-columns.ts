/**
 * P9-B — the kanban column mapping.
 *
 * Ported from V1's `src/chat/orchestrate/board-kanban-columns.ts`, re-keyed from
 * `BoardTaskStatus` to `TaskPhase`. The columns are the same four the board has
 * always had; what changed underneath them is where a card's column comes from.
 *
 * ## A column is derived, never written
 *
 * V1's drop handler wrote a status (`orchestrate-board-dnd.ts`). Here there is
 * no such thing to write: `phase` is recomputed by the fold from the journal on
 * every derive, so "which column is this card in" is a question with exactly one
 * answer and no way for a view to disagree with it.
 *
 * That is why **drag-and-drop does not port**, and why this module is a pure
 * function of state rather than a controller. Ctrl/Cmd+Arrow lane moves go with
 * the drag for the same reason; the keyboard grid ports as navigation only.
 *
 * `Blocked` is the one column that is not a bare phase test: an idle task whose
 * dependencies have not all merged is not waiting for a slot, it is waiting for
 * something else, and a board where those two look identical is a board nobody
 * can read at a glance.
 */

import type { BoardState, TaskState } from '../../server/orchestrator/core/types';

export type ColumnId = 'planned' | 'in_progress' | 'testing' | 'complete';

export interface ColumnDef {
  id: ColumnId;
  label: string;
  /** Compact label for the wave strip. */
  short: string;
}

/**
 * The columns, in order.
 *
 * Fixed at four rather than V1's conditional three: `testing` is a real phase in
 * every V2 run — the policy table's forward edge is builder → tester → merge —
 * so there is no `boardSkipsPerTaskTesting` equivalent to hide the lane behind.
 */
export const COLUMNS: readonly ColumnDef[] = Object.freeze([
  Object.freeze({ id: 'planned', label: 'Planned', short: 'Plan' }),
  Object.freeze({ id: 'in_progress', label: 'In Progress', short: 'Run' }),
  Object.freeze({ id: 'testing', label: 'Testing', short: 'Test' }),
  Object.freeze({ id: 'complete', label: 'Complete', short: 'Done' }),
]) as readonly ColumnDef[];

/**
 * Which column a task sits in.
 *
 * The whole mapping, in one place, so a card cannot be in two columns and the
 * DOM test has one function to assert against.
 */
export function columnOf(state: BoardState, task: TaskState): ColumnId {
  switch (task.phase) {
    case 'building':
    case 'merging':
      return 'in_progress';
    case 'testing':
      return 'testing';
    case 'merged':
    case 'abandoned':
    case 'skipped':
      return 'complete';
    case 'idle':
    default:
      return 'planned';
  }
}

/**
 * Is this task waiting on something rather than waiting for a slot?
 *
 * Only meaningful in `planned`. Read from `dependsOn` against the fold, which is
 * the same test `readyTasks()` makes on the server — a card that says Blocked
 * and a scheduler that would happily start it would be a view disagreeing with
 * the engine.
 */
export function isBlocked(state: BoardState, task: TaskState): boolean {
  if (task.phase !== 'idle') return false;
  return task.dependsOn.some((dep) => state.tasks.get(dep)?.phase !== 'merged');
}

/**
 * The tasks of one wave, bucketed by column, in declared order.
 *
 * Every column is present even when empty: a lane that disappears when it
 * empties makes the board jump under the pointer, and an empty Testing column is
 * information.
 */
export function bucketWave(
  state: BoardState,
  taskIds: readonly string[],
): Map<ColumnId, TaskState[]> {
  const buckets = new Map<ColumnId, TaskState[]>();
  for (const column of COLUMNS) buckets.set(column.id, []);
  for (const id of taskIds) {
    const task = state.tasks.get(id);
    if (!task) continue;
    buckets.get(columnOf(state, task))?.push(task);
  }
  return buckets;
}

/** Tasks grouped by declared wave, in the order the plan declared them. */
export function groupByWave(state: BoardState): Array<[number, string[]]> {
  const waves = new Map<number, string[]>();
  for (const id of state.taskOrder) {
    const task = state.tasks.get(id);
    if (!task) continue;
    const bucket = waves.get(task.wave) ?? [];
    bucket.push(id);
    waves.set(task.wave, bucket);
  }
  return [...waves.entries()].sort((a, b) => a[0] - b[0]);
}
