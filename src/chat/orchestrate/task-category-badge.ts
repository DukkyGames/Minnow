import type { BoardCategory, BoardTask } from '../../types';

/** Resolved category chip label + CSS variant for a board task card. */
export interface TaskCategoryBadge {
  label: BoardCategory;
  cssVariant: BoardCategory;
}

/**
 * Derive the category badge shown on kanban cards.
 * Tasks back in the Run column after failed testing show `fix` (red styling)
 * without mutating the plan-authored `task.category`.
 */
export function deriveTaskCategoryBadge(task: BoardTask): TaskCategoryBadge {
  if ((task.testAttempts ?? 0) > 0 && task.status === 'in_progress') {
    return { label: 'fix', cssVariant: 'fix' };
  }
  return { label: task.category, cssVariant: task.category };
}
