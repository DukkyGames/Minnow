/**
 * Per-slot tab lists when the right pane split is active (editor group parity).
 */

import {
  EMPTY_SLOT_PANE_TABS,
  getFilePanelState,
  patchFilePanelState,
  type PaneSlotId,
  type SlotContent,
  type SlotPaneTabs,
} from '../state/file-panel';
import {
  getActiveViewerTabPath,
  listViewerTabs,
} from './file-viewer-tab-store';
import {
  getActivePreviewTabId,
  listPreviewTabs,
} from './preview-tab-store';
import { getFocusedPaneSlot, isRightPaneSplitLayoutEnabled } from './right-pane-split';

function cloneSlotTabs(tabs: SlotPaneTabs): SlotPaneTabs {
  return {
    viewerPaths: [...tabs.viewerPaths],
    activeViewerPath: tabs.activeViewerPath,
    previewIds: [...tabs.previewIds],
    activePreviewId: tabs.activePreviewId,
    surface: tabs.surface,
  };
}

function slotTabsKey(slot: PaneSlotId): 'primaryTabs' | 'secondaryTabs' {
  return slot === 'primary' ? 'primaryTabs' : 'secondaryTabs';
}

export function getSlotPaneTabs(slot: PaneSlotId): SlotPaneTabs {
  const split = getFilePanelState().rightPaneSplit;
  const tabs = slot === 'primary' ? split.primaryTabs : split.secondaryTabs;
  return cloneSlotTabs(tabs);
}

export function patchSlotPaneTabs(slot: PaneSlotId, partial: Partial<SlotPaneTabs>): void {
  const split = getFilePanelState().rightPaneSplit;
  const key = slotTabsKey(slot);
  const current = slot === 'primary' ? split.primaryTabs : split.secondaryTabs;
  const next: SlotPaneTabs = {
    ...current,
    ...partial,
    viewerPaths: partial.viewerPaths ? [...partial.viewerPaths] : [...current.viewerPaths],
    previewIds: partial.previewIds ? [...partial.previewIds] : [...current.previewIds],
  };
  patchFilePanelState({
    rightPaneSplit: {
      ...split,
      [key]: next,
    },
  });
}

export function slotContentFromTabs(tabs: SlotPaneTabs): SlotContent {
  if (tabs.surface === 'viewer' && tabs.activeViewerPath) {
    return { kind: 'viewer', tabPath: tabs.activeViewerPath };
  }
  if (tabs.surface === 'preview' && tabs.activePreviewId) {
    return { kind: 'preview', tabId: tabs.activePreviewId };
  }
  if (tabs.activeViewerPath) {
    return { kind: 'viewer', tabPath: tabs.activeViewerPath };
  }
  if (tabs.activePreviewId) {
    return { kind: 'preview', tabId: tabs.activePreviewId };
  }
  return { kind: 'none' };
}

export function syncSlotContentFromTabs(slot: PaneSlotId): void {
  const split = getFilePanelState().rightPaneSplit;
  const tabs = slot === 'primary' ? split.primaryTabs : split.secondaryTabs;
  const content = slotContentFromTabs(tabs);
  patchFilePanelState({
    rightPaneSplit: {
      ...split,
      [slot === 'primary' ? 'primary' : 'secondary']: content,
    },
  });
}

/** Viewer tab paths shown in a slot's tab strip. */
export function viewerPathsForSlot(slot: PaneSlotId): string[] {
  if (!isRightPaneSplitLayoutEnabled()) {
    return listViewerTabs().map((t) => t.path);
  }
  return getSlotPaneTabs(slot).viewerPaths;
}

/** Preview tab ids shown in a slot's tab strip. */
export function previewIdsForSlot(slot: PaneSlotId): string[] {
  if (!isRightPaneSplitLayoutEnabled()) {
    return listPreviewTabs().map((t) => t.id);
  }
  return getSlotPaneTabs(slot).previewIds;
}

export function activeViewerPathForSlot(slot: PaneSlotId): string | null {
  if (!isRightPaneSplitLayoutEnabled()) {
    return getActiveViewerTabPath();
  }
  return getSlotPaneTabs(slot).activeViewerPath;
}

export function activePreviewIdForSlot(slot: PaneSlotId): string | null {
  if (!isRightPaneSplitLayoutEnabled()) {
    return getActivePreviewTabId();
  }
  return getSlotPaneTabs(slot).activePreviewId;
}

export function registerViewerTabOpened(path: string, slot?: PaneSlotId): void {
  if (!isRightPaneSplitLayoutEnabled()) return;
  const target = slot ?? getFocusedPaneSlot();
  const tabs = getSlotPaneTabs(target);
  const paths = tabs.viewerPaths.includes(path) ? tabs.viewerPaths : [...tabs.viewerPaths, path];
  patchSlotPaneTabs(target, {
    viewerPaths: paths,
    activeViewerPath: path,
    surface: 'viewer',
  });
  syncSlotContentFromTabs(target);
}

export function registerPreviewTabOpened(id: string, slot?: PaneSlotId): void {
  if (!isRightPaneSplitLayoutEnabled()) return;
  const target = slot ?? getFocusedPaneSlot();
  const tabs = getSlotPaneTabs(target);
  const ids = tabs.previewIds.includes(id) ? tabs.previewIds : [...tabs.previewIds, id];
  patchSlotPaneTabs(target, {
    previewIds: ids,
    activePreviewId: id,
    surface: 'preview',
  });
  syncSlotContentFromTabs(target);
}

export function unregisterViewerTab(path: string): void {
  if (!isRightPaneSplitLayoutEnabled()) return;
  for (const slot of ['primary', 'secondary'] as PaneSlotId[]) {
    const tabs = getSlotPaneTabs(slot);
    if (!tabs.viewerPaths.includes(path)) continue;
    const viewerPaths = tabs.viewerPaths.filter((p) => p !== path);
    const activeViewerPath =
      tabs.activeViewerPath === path
        ? viewerPaths.length > 0
          ? viewerPaths[viewerPaths.length - 1]!
          : null
        : tabs.activeViewerPath;
    let surface = tabs.surface;
    if (surface === 'viewer' && viewerPaths.length === 0 && tabs.previewIds.length > 0) {
      surface = 'preview';
    }
    if (viewerPaths.length === 0 && tabs.previewIds.length === 0) {
      surface = 'none';
    }
    patchSlotPaneTabs(slot, { viewerPaths, activeViewerPath, surface });
    syncSlotContentFromTabs(slot);
  }
}

export function unregisterPreviewTab(id: string): void {
  if (!isRightPaneSplitLayoutEnabled()) return;
  for (const slot of ['primary', 'secondary'] as PaneSlotId[]) {
    const tabs = getSlotPaneTabs(slot);
    if (!tabs.previewIds.includes(id)) continue;
    const previewIds = tabs.previewIds.filter((t) => t !== id);
    const activePreviewId =
      tabs.activePreviewId === id
        ? previewIds.length > 0
          ? previewIds[previewIds.length - 1]!
          : null
        : tabs.activePreviewId;
    let surface = tabs.surface;
    if (surface === 'preview' && previewIds.length === 0 && tabs.viewerPaths.length > 0) {
      surface = 'viewer';
    }
    if (previewIds.length === 0 && tabs.viewerPaths.length === 0) {
      surface = 'none';
    }
    patchSlotPaneTabs(slot, { previewIds, activePreviewId, surface });
    syncSlotContentFromTabs(slot);
  }
}

/** Initialize slot tab lists when split is first enabled. */
export function bootstrapSlotTabsOnSplitEnable(secondarySeed?: SlotPaneTabs): void {
  const state = getFilePanelState();
  const viewerPaths = listViewerTabs().map((t) => t.path);
  const previewIds = listPreviewTabs().map((t) => t.id);
  const activeViewer = getActiveViewerTabPath();
  const activePreview = getActivePreviewTabId();
  let primarySurface: SlotPaneTabs['surface'] = 'none';
  if (state.rightPaneMode === 'preview' || activePreview) primarySurface = 'preview';
  else if (activeViewer || viewerPaths.length > 0) primarySurface = 'viewer';

  const primaryTabs: SlotPaneTabs = {
    viewerPaths,
    activeViewerPath: activeViewer,
    previewIds,
    activePreviewId: activePreview,
    surface: primarySurface,
  };

  const secondaryTabs = secondarySeed ?? { ...EMPTY_SLOT_PANE_TABS };

  patchFilePanelState({
    rightPaneSplit: {
      ...state.rightPaneSplit,
      enabled: true,
      primaryTabs,
      secondaryTabs,
      primary: slotContentFromTabs(primaryTabs),
      secondary: slotContentFromTabs(secondaryTabs),
    },
  });
}

export function moveViewerTabToSlot(path: string, slot: PaneSlotId): void {
  if (!isRightPaneSplitLayoutEnabled()) return;
  for (const s of ['primary', 'secondary'] as PaneSlotId[]) {
    const tabs = getSlotPaneTabs(s);
    if (!tabs.viewerPaths.includes(path)) continue;
    const viewerPaths = tabs.viewerPaths.filter((p) => p !== path);
    patchSlotPaneTabs(s, {
      viewerPaths,
      activeViewerPath: tabs.activeViewerPath === path ? viewerPaths.at(-1) ?? null : tabs.activeViewerPath,
    });
    syncSlotContentFromTabs(s);
  }
  registerViewerTabOpened(path, slot);
}

export function movePreviewTabToSlot(id: string, slot: PaneSlotId): void {
  if (!isRightPaneSplitLayoutEnabled()) return;
  for (const s of ['primary', 'secondary'] as PaneSlotId[]) {
    const tabs = getSlotPaneTabs(s);
    if (!tabs.previewIds.includes(id)) continue;
    const previewIds = tabs.previewIds.filter((t) => t !== id);
    patchSlotPaneTabs(s, {
      previewIds,
      activePreviewId: tabs.activePreviewId === id ? previewIds.at(-1) ?? null : tabs.activePreviewId,
    });
    syncSlotContentFromTabs(s);
  }
  registerPreviewTabOpened(id, slot);
}
