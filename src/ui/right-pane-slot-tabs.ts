import {
  EMPTY_SLOT_PANE_TABS,
  getFilePanelState,
  patchFilePanelState,
  type PaneSlotId,
  type RightPaneSplitState,
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
import { isAncestorPath, normalizeTreePath } from './file-tree-path';

const SLOTS: PaneSlotId[] = ['primary', 'secondary'];

function cloneSlotTabs(tabs: SlotPaneTabs): SlotPaneTabs {
  return {
    viewerPaths: [...tabs.viewerPaths],
    activeViewerPath: tabs.activeViewerPath,
    previewIds: [...tabs.previewIds],
    activePreviewId: tabs.activePreviewId,
    surface: tabs.surface,
  };
}

/** Bookkeeping predicate: persisted split flag only. */
function splitStateEnabled(): boolean {
  return getFilePanelState().rightPaneSplit.enabled;
}

export function getSlotPaneTabs(slot: PaneSlotId): SlotPaneTabs {
  const split = getFilePanelState().rightPaneSplit;
  return cloneSlotTabs(slot === 'primary' ? split.primaryTabs : split.secondaryTabs);
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

/** Recompute `surface` after a list change so an emptied surface falls back to the other. */
function resolveSurface(tabs: SlotPaneTabs): SlotPaneTabs['surface'] {
  const hasViewer = tabs.viewerPaths.length > 0;
  const hasPreview = tabs.previewIds.length > 0;
  if (!hasViewer && !hasPreview) return 'none';
  if (tabs.surface === 'viewer' && hasViewer) return 'viewer';
  if (tabs.surface === 'preview' && hasPreview) return 'preview';
  return hasViewer ? 'viewer' : 'preview';
}

/** Write both slot tab lists plus their derived content in one patch. */
function commitSlotTabs(next: { primary: SlotPaneTabs; secondary: SlotPaneTabs }): void {
  const split = getFilePanelState().rightPaneSplit;
  const primaryTabs: SlotPaneTabs = { ...next.primary, surface: resolveSurface(next.primary) };
  const secondaryTabs: SlotPaneTabs = {
    ...next.secondary,
    surface: resolveSurface(next.secondary),
  };
  const patch: RightPaneSplitState = {
    ...split,
    primaryTabs,
    secondaryTabs,
    primary: slotContentFromTabs(primaryTabs),
    secondary: slotContentFromTabs(secondaryTabs),
  };
  patchFilePanelState({ rightPaneSplit: patch });
}

function readSlots(): { primary: SlotPaneTabs; secondary: SlotPaneTabs } {
  return { primary: getSlotPaneTabs('primary'), secondary: getSlotPaneTabs('secondary') };
}

export function patchSlotPaneTabs(slot: PaneSlotId, partial: Partial<SlotPaneTabs>): void {
  const slots = readSlots();
  slots[slot] = { ...slots[slot], ...partial };
  commitSlotTabs(slots);
}

/** Re-derive `primary`/`secondary` slot content from the current lists. */
export function syncSlotContentFromTabs(_slot?: PaneSlotId): void {
  commitSlotTabs(readSlots());
}

/** Which slot owns this viewer path, or null when it belongs to neither. */
export function slotOwningViewerPath(path: string): PaneSlotId | null {
  for (const slot of SLOTS) {
    if (getSlotPaneTabs(slot).viewerPaths.includes(path)) return slot;
  }
  return null;
}

/** Which slot owns this preview tab, or null when it belongs to neither. */
export function slotOwningPreviewId(id: string): PaneSlotId | null {
  for (const slot of SLOTS) {
    if (getSlotPaneTabs(slot).previewIds.includes(id)) return slot;
  }
  return null;
}

/** Slot a viewer path should act in: the slot that already owns it, else the focused one. */
export function targetSlotForViewerPath(path: string): PaneSlotId {
  if (!isRightPaneSplitLayoutEnabled()) return 'primary';
  return slotOwningViewerPath(path) ?? getFocusedPaneSlot();
}

/** Slot a preview tab should act in (owner, else focused). */
export function targetSlotForPreviewId(id: string): PaneSlotId {
  if (!isRightPaneSplitLayoutEnabled()) return 'primary';
  return slotOwningPreviewId(id) ?? getFocusedPaneSlot();
}

/** Viewer tab paths shown in a slot's tab strip. */
export function viewerPathsForSlot(slot: PaneSlotId): string[] {
  if (!isRightPaneSplitLayoutEnabled()) {
    return slot === 'primary' ? listViewerTabs().map((t) => t.path) : [];
  }
  return getSlotPaneTabs(slot).viewerPaths;
}

/** Preview tab ids shown in a slot's tab strip. */
export function previewIdsForSlot(slot: PaneSlotId): string[] {
  if (!isRightPaneSplitLayoutEnabled()) {
    return slot === 'primary' ? listPreviewTabs().map((t) => t.id) : [];
  }
  return getSlotPaneTabs(slot).previewIds;
}

export function activeViewerPathForSlot(slot: PaneSlotId): string | null {
  if (!isRightPaneSplitLayoutEnabled()) {
    return slot === 'primary' ? getActiveViewerTabPath() : null;
  }
  return getSlotPaneTabs(slot).activeViewerPath;
}

export function activePreviewIdForSlot(slot: PaneSlotId): string | null {
  if (!isRightPaneSplitLayoutEnabled()) {
    return slot === 'primary' ? getActivePreviewTabId() : null;
  }
  return getSlotPaneTabs(slot).activePreviewId;
}

/** Single active tab for the unified strip: at most one of viewer or preview is highlighted. */
export function unifiedStripActiveTabForSlot(slot: PaneSlotId): {
  viewerPath: string | null;
  previewId: string | null;
} {
  if (isRightPaneSplitLayoutEnabled()) {
    const tabs = getSlotPaneTabs(slot);
    if (tabs.surface === 'viewer') {
      return { viewerPath: tabs.activeViewerPath, previewId: null };
    }
    if (tabs.surface === 'preview') {
      return { viewerPath: null, previewId: tabs.activePreviewId };
    }
    return { viewerPath: null, previewId: null };
  }

  if (slot !== 'primary') {
    return { viewerPath: null, previewId: null };
  }

  const state = getFilePanelState();
  const mode =
    state.rightPaneMode === 'preview' ||
    state.rightPaneMode === 'viewer' ||
    state.rightPaneMode === 'split'
      ? state.rightPaneMode
      : state.viewerOpen
        ? 'viewer'
        : null;

  if (mode === 'preview') {
    return { viewerPath: null, previewId: getActivePreviewTabId() };
  }
  if (mode === 'viewer') {
    return { viewerPath: getActiveViewerTabPath(), previewId: null };
  }
  return { viewerPath: null, previewId: null };
}

/** Make `path` the active viewer tab of `slot` (no-op when the slot does not own it). */
export function setSlotActiveViewerPath(slot: PaneSlotId, path: string): void {
  if (!splitStateEnabled()) return;
  const slots = readSlots();
  if (!slots[slot].viewerPaths.includes(path)) return;
  slots[slot] = { ...slots[slot], activeViewerPath: path, surface: 'viewer' };
  commitSlotTabs(slots);
}

/** Make `id` the active preview tab of `slot` (no-op when the slot does not own it). */
export function setSlotActivePreviewId(slot: PaneSlotId, id: string): void {
  if (!splitStateEnabled()) return;
  const slots = readSlots();
  if (!slots[slot].previewIds.includes(id)) return;
  slots[slot] = { ...slots[slot], activePreviewId: id, surface: 'preview' };
  commitSlotTabs(slots);
}

/** Record an opened/activated viewer tab against a slot and return the slot used. */
export function registerViewerTabOpened(path: string, slot?: PaneSlotId): PaneSlotId {
  if (!splitStateEnabled()) return 'primary';
  const owner = slotOwningViewerPath(path);
  const target = slot ?? owner ?? getFocusedPaneSlot();
  const slots = readSlots();

  if (owner && owner !== target) {
    const from = slots[owner];
    const viewerPaths = from.viewerPaths.filter((p) => p !== path);
    slots[owner] = {
      ...from,
      viewerPaths,
      activeViewerPath:
        from.activeViewerPath === path ? (viewerPaths.at(-1) ?? null) : from.activeViewerPath,
    };
  }

  const to = slots[target];
  slots[target] = {
    ...to,
    viewerPaths: to.viewerPaths.includes(path) ? to.viewerPaths : [...to.viewerPaths, path],
    activeViewerPath: path,
    surface: 'viewer',
  };
  commitSlotTabs(slots);
  return target;
}

/** Record an opened/activated preview tab against a slot and return the slot used. */
export function registerPreviewTabOpened(id: string, slot?: PaneSlotId): PaneSlotId {
  if (!splitStateEnabled()) return 'primary';
  const owner = slotOwningPreviewId(id);
  const target = slot ?? owner ?? getFocusedPaneSlot();
  const slots = readSlots();

  if (owner && owner !== target) {
    const from = slots[owner];
    const previewIds = from.previewIds.filter((p) => p !== id);
    slots[owner] = {
      ...from,
      previewIds,
      activePreviewId:
        from.activePreviewId === id ? (previewIds.at(-1) ?? null) : from.activePreviewId,
    };
  }

  const to = slots[target];
  slots[target] = {
    ...to,
    previewIds: to.previewIds.includes(id) ? to.previewIds : [...to.previewIds, id],
    activePreviewId: id,
    surface: 'preview',
  };
  commitSlotTabs(slots);
  return target;
}

export function unregisterViewerTab(path: string): void {
  if (!splitStateEnabled()) return;
  const slots = readSlots();
  let changed = false;
  for (const slot of SLOTS) {
    const tabs = slots[slot];
    if (!tabs.viewerPaths.includes(path)) continue;
    const viewerPaths = tabs.viewerPaths.filter((p) => p !== path);
    slots[slot] = {
      ...tabs,
      viewerPaths,
      activeViewerPath:
        tabs.activeViewerPath === path ? (viewerPaths.at(-1) ?? null) : tabs.activeViewerPath,
    };
    changed = true;
  }
  if (changed) commitSlotTabs(slots);
}

export function unregisterPreviewTab(id: string): void {
  if (!splitStateEnabled()) return;
  const slots = readSlots();
  let changed = false;
  for (const slot of SLOTS) {
    const tabs = slots[slot];
    if (!tabs.previewIds.includes(id)) continue;
    const previewIds = tabs.previewIds.filter((p) => p !== id);
    slots[slot] = {
      ...tabs,
      previewIds,
      activePreviewId:
        tabs.activePreviewId === id ? (previewIds.at(-1) ?? null) : tabs.activePreviewId,
    };
    changed = true;
  }
  if (changed) commitSlotTabs(slots);
}

/** Drop slot entries for tabs that are no longer open, and adopt tabs that belong to no slot (restored prefs, tabs opened while the split was off) into the primary. */
export function reconcileSlotTabsWithStores(): void {
  if (!splitStateEnabled()) return;
  const openPaths = new Set(listViewerTabs().map((t) => t.path));
  const openPreviewIds = new Set(listPreviewTabs().map((t) => t.id));
  const slots = readSlots();

  for (const slot of SLOTS) {
    const tabs = slots[slot];
    const viewerPaths = tabs.viewerPaths.filter((p) => openPaths.has(p));
    const previewIds = tabs.previewIds.filter((id) => openPreviewIds.has(id));
    slots[slot] = {
      ...tabs,
      viewerPaths,
      previewIds,
      activeViewerPath:
        tabs.activeViewerPath && viewerPaths.includes(tabs.activeViewerPath)
          ? tabs.activeViewerPath
          : (viewerPaths.at(-1) ?? null),
      activePreviewId:
        tabs.activePreviewId && previewIds.includes(tabs.activePreviewId)
          ? tabs.activePreviewId
          : (previewIds.at(-1) ?? null),
    };
  }

  const owned = new Set([...slots.primary.viewerPaths, ...slots.secondary.viewerPaths]);
  const ownedPreviews = new Set([...slots.primary.previewIds, ...slots.secondary.previewIds]);
  const orphanPaths = [...openPaths].filter((p) => !owned.has(p));
  const orphanPreviews = [...openPreviewIds].filter((id) => !ownedPreviews.has(id));

  if (orphanPaths.length > 0 || orphanPreviews.length > 0) {
    slots.primary = {
      ...slots.primary,
      viewerPaths: [...slots.primary.viewerPaths, ...orphanPaths],
      previewIds: [...slots.primary.previewIds, ...orphanPreviews],
      activeViewerPath: slots.primary.activeViewerPath ?? (orphanPaths.at(-1) ?? null),
      activePreviewId: slots.primary.activePreviewId ?? (orphanPreviews.at(-1) ?? null),
    };
  }

  commitSlotTabs(slots);
}

/** Follow a renamed/moved file so it keeps its pane instead of vanishing from the strip. */
export function retargetSlotViewerPath(oldPath: string, newPath: string): void {
  if (!splitStateEnabled()) return;
  const slots = readSlots();
  let changed = false;
  for (const slot of SLOTS) {
    const tabs = slots[slot];
    if (!tabs.viewerPaths.includes(oldPath)) continue;
    slots[slot] = {
      ...tabs,
      viewerPaths: tabs.viewerPaths.map((p) => (p === oldPath ? newPath : p)),
      activeViewerPath: tabs.activeViewerPath === oldPath ? newPath : tabs.activeViewerPath,
    };
    changed = true;
  }
  if (changed) commitSlotTabs(slots);
}

/** Follow a renamed/moved directory for every tab beneath it. */
export function remapSlotViewerPathsUnderAncestor(
  oldAncestor: string,
  newAncestor: string,
): void {
  if (!splitStateEnabled()) return;
  const oldNorm = normalizeTreePath(oldAncestor);
  const newNorm = normalizeTreePath(newAncestor);
  const remap = (p: string): string => {
    const pn = normalizeTreePath(p);
    if (pn !== oldNorm && !isAncestorPath(oldNorm, pn)) return p;
    return normalizeTreePath(newNorm + pn.slice(oldNorm.length));
  };
  const slots = readSlots();
  for (const slot of SLOTS) {
    const tabs = slots[slot];
    slots[slot] = {
      ...tabs,
      viewerPaths: tabs.viewerPaths.map(remap),
      activeViewerPath: tabs.activeViewerPath ? remap(tabs.activeViewerPath) : null,
    };
  }
  commitSlotTabs(slots);
}

/** Seed the primary slot from the global stores when the split is first enabled. */
export function bootstrapSlotTabsOnSplitEnable(): void {
  const state = getFilePanelState();
  const viewerPaths = listViewerTabs().map((t) => t.path);
  const previewIds = listPreviewTabs().map((t) => t.id);
  const activeViewer = getActiveViewerTabPath();
  const activePreview = getActivePreviewTabId();
  const surface: SlotPaneTabs['surface'] =
    state.rightPaneMode === 'preview' || (activePreview && !activeViewer) ? 'preview' : 'viewer';

  const primaryTabs: SlotPaneTabs = {
    viewerPaths,
    activeViewerPath: activeViewer ?? (viewerPaths.at(-1) ?? null),
    previewIds,
    activePreviewId: activePreview ?? (previewIds.at(-1) ?? null),
    surface,
  };
  const secondaryTabs: SlotPaneTabs = { ...EMPTY_SLOT_PANE_TABS };

  patchFilePanelState({
    rightPaneSplit: {
      ...state.rightPaneSplit,
      enabled: true,
      primaryTabs: { ...primaryTabs, surface: resolveSurface(primaryTabs) },
      secondaryTabs,
      primary: slotContentFromTabs(primaryTabs),
      secondary: slotContentFromTabs(secondaryTabs),
    },
  });
}

/** Fold the secondary slot's tabs back into the primary when the split closes. */
export function mergeSecondarySlotTabsIntoPrimary(): SlotPaneTabs {
  const slots = readSlots();
  const { primary, secondary } = slots;

  const viewerPaths = [
    ...primary.viewerPaths,
    ...secondary.viewerPaths.filter((p) => !primary.viewerPaths.includes(p)),
  ];
  const previewIds = [
    ...primary.previewIds,
    ...secondary.previewIds.filter((id) => !primary.previewIds.includes(id)),
  ];

  const merged: SlotPaneTabs = {
    viewerPaths,
    previewIds,
    activeViewerPath: primary.activeViewerPath ?? secondary.activeViewerPath,
    activePreviewId: primary.activePreviewId ?? secondary.activePreviewId,
    surface: primary.surface !== 'none' ? primary.surface : secondary.surface,
  };
  merged.surface = resolveSurface(merged);
  return merged;
}

export function moveViewerTabToSlot(path: string, slot: PaneSlotId): void {
  if (!splitStateEnabled()) return;
  registerViewerTabOpened(path, slot);
}

export function movePreviewTabToSlot(id: string, slot: PaneSlotId): void {
  if (!splitStateEnabled()) return;
  registerPreviewTabOpened(id, slot);
}

/** True when the slot has no tabs of either kind. */
export function isSlotEmpty(slot: PaneSlotId): boolean {
  const tabs = getSlotPaneTabs(slot);
  return tabs.viewerPaths.length === 0 && tabs.previewIds.length === 0;
}
