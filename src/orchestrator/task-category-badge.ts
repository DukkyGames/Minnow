/**
 * Category chip label + CSS variant for a board task card.
 *
 * Presentation only (leftover session cards / V2 kanban). Not a board engine —
 * moved out of `src/chat/orchestrate/` in MIN-714.
 */

import type { BoardCategory, LeftoverBoardTask } from '../types';

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
export function deriveTaskCategoryBadge(task: LeftoverBoardTask): TaskCategoryBadge {
  return { label: task.category, cssVariant: task.category };
}
