import type { BoardCategory, LeftoverBoardTask } from '../types';

export interface TaskCategoryBadge {
  label: BoardCategory;
  cssVariant: BoardCategory;
}

export function deriveTaskCategoryBadge(task: LeftoverBoardTask): TaskCategoryBadge {
  return { label: task.category, cssVariant: task.category };
}
