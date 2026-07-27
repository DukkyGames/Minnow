import type { BoardCategory } from '../types';
import { createIcon, type IconName } from './icon';

const CATEGORY_TO_ICON: Partial<Record<BoardCategory, IconName>> = {
  build: 'boardBuild',
  fix: 'boardFix',
  test: 'boardTest',
};

/** Create a Uicons icon for a board category. Returns null for `research`. */
export function createBoardCategoryIcon(
  category: BoardCategory,
  className: string,
): HTMLElement | null {
  const name = CATEGORY_TO_ICON[category];
  if (!name) return null;
  return createIcon(name, { className });
}
