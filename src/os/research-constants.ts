import type { WindowBounds } from './window-manager';

/** Window-manager instance id for the desktop research library surface. */
export const RESEARCH_LIBRARY_INSTANCE_ID = 'research-library';

/** Default research library window size (first open). */
export const RESEARCH_LIBRARY_WINDOW_WIDTH = 880;
export const RESEARCH_LIBRARY_WINDOW_HEIGHT = 620;

/** Minimum resize size for the research library window frame. */
export const RESEARCH_LIBRARY_WINDOW_MIN_WIDTH = 480;
export const RESEARCH_LIBRARY_WINDOW_MIN_HEIGHT = 400;

/** Center the default research library window within the OS stage. */
export function centeredResearchLibraryBounds(): WindowBounds {
  const stage = document.getElementById('osStage') ?? document.body;
  const rect = stage.getBoundingClientRect();
  const stageWidth = rect.width || stage.clientWidth || RESEARCH_LIBRARY_WINDOW_WIDTH;
  const stageHeight = rect.height || stage.clientHeight || RESEARCH_LIBRARY_WINDOW_HEIGHT;
  const width = Math.min(RESEARCH_LIBRARY_WINDOW_WIDTH, stageWidth);
  const height = Math.min(RESEARCH_LIBRARY_WINDOW_HEIGHT, stageHeight);
  return {
    x: Math.max(0, Math.round((stageWidth - width) / 2)),
    y: Math.max(0, Math.round((stageHeight - height) / 2)),
    width,
    height,
  };
}
