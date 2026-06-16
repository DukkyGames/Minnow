/**
 * Desktop research library — floating OS window for saved reports.
 */

import '../styles/research-library-window.css';

import {
  RESEARCH_LIBRARY_INSTANCE_ID,
  RESEARCH_LIBRARY_WINDOW_MIN_HEIGHT,
  RESEARCH_LIBRARY_WINDOW_MIN_WIDTH,
  centeredResearchLibraryBounds,
} from '../os/research-constants';
import { windowManager } from '../os/window-manager';
import { renderResearchLibrary, type ResearchLibraryMountOptions } from './library';

export type ResearchLibraryWindowOptions = Omit<ResearchLibraryMountOptions, 'mount'>;

let openWindowId: string | null = null;

/** Whether the research library window is open. */
export function isResearchLibraryWindowOpen(): boolean {
  return openWindowId !== null && Boolean(windowManager.getFrame(openWindowId));
}

/** Close the research library window if open. */
export function closeResearchLibraryWindow(): void {
  if (!openWindowId) {
    return;
  }
  windowManager.close(openWindowId);
  openWindowId = null;
}

/** Open (or foreground) the research library in a floating OS window. */
export async function openResearchLibraryWindow(
  options: ResearchLibraryWindowOptions,
): Promise<void> {
  windowManager.ensureLayer();
  const windowId = windowManager.open('research', {
    instanceId: RESEARCH_LIBRARY_INSTANCE_ID,
    title: 'Research library',
    bounds: centeredResearchLibraryBounds(),
    minWidth: RESEARCH_LIBRARY_WINDOW_MIN_WIDTH,
    minHeight: RESEARCH_LIBRARY_WINDOW_MIN_HEIGHT,
    persistBounds: false,
    manageInstance: false,
  });
  openWindowId = windowId;

  const clearIfClosed = (): void => {
    if (!windowManager.getWindows().some((w) => w.id === windowId)) {
      openWindowId = null;
      unsub();
    }
  };
  const unsub = windowManager.subscribe(() => {
    clearIfClosed();
  });

  const body = windowManager.getFrame(windowId)?.body;
  if (!body) {
    return;
  }

  body.classList.add('research-library-window-body');
  body.replaceChildren();

  const shell = document.createElement('div');
  shell.className = 'dr-lib';
  shell.setAttribute('aria-label', 'Research library');
  body.appendChild(shell);

  await renderResearchLibrary({
    mount: shell,
    onOpenDetail: (id) => {
      closeResearchLibraryWindow();
      options.onOpenDetail(id);
    },
    onOpenReport: options.onOpenReport,
    onDiscuss: options.onDiscuss,
    onRefine: (id, query) => {
      closeResearchLibraryWindow();
      options.onRefine(id, query);
    },
    onNewResearch: options.onNewResearch
      ? () => {
          closeResearchLibraryWindow();
          options.onNewResearch!();
        }
      : undefined,
  });
}

/** Reset module state (tests). */
export function resetResearchLibraryWindowForTests(): void {
  openWindowId = null;
}
