/**
 * Editor Quick Edit — Mod-K inline AI edit with diff preview (Phase 4).
 */

export type { QuickEditSelectionRange, QuickEditSession } from './types';
export {
  formatSelectionFence,
  insertSelectionInComposer,
  lineNumbersForRange,
} from './selection-fence';
export {
  applyReplacementInRange,
  sanitizeQuickEditText,
  buildQuickEditDiffLines,
  countQuickEditStats,
} from './diff-apply';
export { fetchQuickEditReplacement } from './client';
export {
  openQuickEditPanel,
  closeQuickEditPanel,
  isQuickEditPanelOpen,
  readQuickEditSelection,
} from './panel';
export { buildFileViewerContextMenuItems } from './context-menu';
export type { FileViewerContextMenuInput } from './context-menu';
export { editorQuickEditExtensions, quickEditKeymapBindings } from './extensions';
