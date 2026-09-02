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
}

export function refreshPreviewTabs(): void {
  void import('./unified-right-tabs').then((m) => m.refreshUnifiedRightTabs());
}
