/**
 * Resolve which preview tab/source a Design Mode instance is attached to (primary vs split secondary).
 */

import type { PreviewSource } from '../state/file-panel';
import { getFilePanelState } from '../state/file-panel';
import { getActivePreviewTabId, getPreviewTab } from './preview-tab-store';
import { WORKSPACE_PREVIEW_DESIGN_INSTANCE_ID } from './preview-design-mode-mount';
import { WORKSPACE_PREVIEW_SECONDARY_INSTANCE } from './right-pane-split';
import { getSecondaryPreviewTabId } from './preview-secondary-slot';

/** Active preview source for a design-meta / design-mode instance id. */
export function previewSourceForDesignInstance(instanceId: string): PreviewSource | null {
  if (instanceId === WORKSPACE_PREVIEW_SECONDARY_INSTANCE) {
    const tabId = getSecondaryPreviewTabId();
    if (!tabId) return null;
    return getPreviewTab(tabId)?.source ?? null;
  }
  if (instanceId !== WORKSPACE_PREVIEW_DESIGN_INSTANCE_ID) {
    return getFilePanelState().previewSource;
  }
  const tabId = getActivePreviewTabId();
  if (tabId) {
    return getPreviewTab(tabId)?.source ?? getFilePanelState().previewSource;
  }
  return getFilePanelState().previewSource;
}
