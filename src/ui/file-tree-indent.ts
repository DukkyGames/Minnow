/**
 * File tree row indent constants (shared by tree UI and layout tests).
 */

/** Horizontal indent per tree depth level (px). */
export const FILE_TREE_DEPTH_INDENT_PX = 12;

/** Base paddingLeft for directory rows (expand chevron column). */
export const FILE_TREE_DIR_BASE_PADDING_PX = 6;

/** Base paddingLeft for file rows (aligns with dir row + 18px expand). */
export const FILE_TREE_FILE_BASE_PADDING_PX = FILE_TREE_DIR_BASE_PADDING_PX + 18;

/** paddingLeft for a directory row at the given depth. */
export function dirRowPaddingLeftPx(depth: number): number {
  return FILE_TREE_DIR_BASE_PADDING_PX + depth * FILE_TREE_DEPTH_INDENT_PX;
}

/** paddingLeft for a file row at the given depth. */
export function fileRowPaddingLeftPx(depth: number): number {
  return FILE_TREE_FILE_BASE_PADDING_PX + depth * FILE_TREE_DEPTH_INDENT_PX;
}
