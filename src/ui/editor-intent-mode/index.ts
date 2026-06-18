/**
 * Editor Intent mode — public exports (MIN-131).
 */

export type { IntentModeOptions, IntentRegion } from './types';
export {
  editorIntentModeExtensions,
  mountIntentModeEditor,
  toggleIntentMode,
  setIntentMode,
  revertIntentRegion,
  getIntentStaleCount,
  isIntentModeEnabled,
  findIntentRegionOnLine,
} from './extensions';
export {
  resolvedContext,
  contextHash,
  simpleHash,
  withStale,
  contextHashForRegion,
  resolvedLineIndices,
  changeIntersectsRegion,
} from './context';
export { systemPromptForIntent, resolveIntentLine } from './resolver';
