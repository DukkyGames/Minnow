/**
 * Tab strip UI for the multi-tab file viewer.
 * Rendering is handled by unified-right-tabs.ts (MIN-224).
 */

import {
  bindUnifiedRightTabs,
  refreshUnifiedRightTabs,
  registerUnifiedFileTabHandlers,
} from './unified-right-tabs';

type TabPathHandler = (path: string) => void | Promise<void>;
type TabCycleHandler = (direction: 'next' | 'prev') => void | Promise<void>;
type TabCloseAllHandler = () => void | Promise<void>;

/** Register activate/close handlers from file-viewer (avoids circular imports). */
export function registerFileViewerTabHandlers(handlers: {
  onActivate: TabPathHandler;
  onClose: TabPathHandler;
  onCloseOthers?: TabPathHandler;
  onCloseToRight?: TabPathHandler;
  onCloseAll?: TabCloseAllHandler;
  onCycle?: TabCycleHandler;
}): void {
  registerUnifiedFileTabHandlers(handlers);
}

/** Wire tab strip listeners (call once from init-file-panel). */
export function bindFileViewerTabs(): void {
  bindUnifiedRightTabs();
}

export function refreshFileViewerTabs(): void {
  refreshUnifiedRightTabs();
}
