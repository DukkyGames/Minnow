/**
 * Tab strip UI for the multi-tab preview browser panel.
 * Rendering is handled by unified-right-tabs.ts (MIN-224).
 */

import {
  registerUnifiedPreviewTabHandlers,
} from './unified-right-tabs';

type TabIdHandler = (id: string) => void | Promise<void>;

/** Register handlers from preview-panel (avoids circular imports). */
export function registerPreviewTabHandlers(handlers: {
  onActivate: TabIdHandler;
  onClose: TabIdHandler;
  onNew: () => void | Promise<void>;
}): void {
  registerUnifiedPreviewTabHandlers(handlers);
}

/** Wire preview tab strip listeners (call once from initPreviewPanel). */
export function bindPreviewTabs(): void {
  // Unified tab strip is bound from init-file-panel via bindFileViewerTabs.
}

export function refreshPreviewTabs(): void {
  void import('./unified-right-tabs').then((m) => m.refreshUnifiedRightTabs());
}
