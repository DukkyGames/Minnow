/**
 * Vertical two-slot split inside the Code workspace right column.
 */

import {
  EMPTY_SLOT_PANE_TABS,
  getFilePanelState,
  patchFilePanelState,
  type PaneSlotId,
  type RightPaneSplitState,
  type SlotContent,
  type SlotPaneTabs,
} from '../state/file-panel';
import { isDesktopChatActive } from '../os/desktop-state';
import { getForegroundAppId, getOsView } from '../os/instances';
import { isMobileLayout } from './file-layout';
import { bootstrapSlotTabsOnSplitEnable } from './right-pane-slot-tabs';
import { getActiveViewerTabPath } from './file-viewer-tab-store';
import { getActivePreviewTabId } from './preview-tab-store';

/** Same surface rule as desktop-workspace-mounts (no import — avoids module cycle). */
function isDesktopWorkspaceHostingSurface(): boolean {
  const codeForeground = getOsView() === 'app' && getForegroundAppId() === 'code';
  if (codeForeground) return false;
  return isDesktopChatActive() || getOsView() === 'desktop';
}

export const WORKSPACE_PREVIEW_SECONDARY_INSTANCE = 'workspace-preview-secondary';

export function isRightPaneSplitActive(): boolean {
  const state = getFilePanelState();
  return (
    state.rightPaneSplit.enabled &&
    !isMobileLayout() &&
    !isDesktopWorkspaceHostingSurface()
  );
}

/** True when persisted state is split layout (ignores desktop hosting surface DOM guard). */
export function isRightPaneSplitLayoutEnabled(): boolean {
  const state = getFilePanelState();
  return state.rightPaneSplit.enabled && state.rightPaneMode === 'split' && !isMobileLayout();
}

export function getFocusedPaneSlot(): PaneSlotId {
  return getFilePanelState().rightPaneSplit.focusedSlot;
}

export function getSlotContent(slot: PaneSlotId): SlotContent {
  const split = getFilePanelState().rightPaneSplit;
  return slot === 'primary' ? split.primary : split.secondary;
}

export function getFocusedPreviewInstanceId(): string {
  if (!isRightPaneSplitActive()) return 'workspace-preview';
  const slot = getFocusedPaneSlot();
  const content = getSlotContent(slot);
  if (content.kind === 'preview') {
    return previewInstanceIdForSlot(slot);
  }
  const secondary = getSlotContent('secondary');
  if (secondary.kind === 'preview') return WORKSPACE_PREVIEW_SECONDARY_INSTANCE;
  const primary = getSlotContent('primary');
  if (primary.kind === 'preview') return 'workspace-preview';
  return 'workspace-preview';
}

/** Instance id for a slot that is showing preview content. */
export function previewInstanceIdForSlot(slot: PaneSlotId): string {
  return slot === 'primary' ? 'workspace-preview' : WORKSPACE_PREVIEW_SECONDARY_INSTANCE;
}

function slotElements(slot: PaneSlotId): {
  slotEl: HTMLElement | null;
  viewerPane: HTMLElement | null;
  previewPane: HTMLElement | null;
} {
  const slotEl = document.getElementById(
    slot === 'primary' ? 'rightPaneSlotPrimary' : 'rightPaneSlotSecondary',
  );
  if (slot === 'primary') {
    return {
      slotEl,
      viewerPane: document.getElementById('fileViewerPane'),
      previewPane: document.getElementById('previewPane'),
    };
  }
  return {
    slotEl,
    viewerPane: document.getElementById('fileViewerPaneSecondary'),
    previewPane: document.getElementById('previewPaneSecondary'),
  };
}

function defaultPrimarySlotContent(): SlotContent {
  const state = getFilePanelState();
  if (state.rightPaneMode === 'preview' || state.activePreviewTab) {
    return { kind: 'preview', tabId: state.activePreviewTab };
  }
  const path = state.activeViewerTab ?? getActiveViewerTabPath();
  if (path) return { kind: 'viewer', tabPath: path };
  return { kind: 'none' };
}

function syncSlotPaneVisibility(slot: PaneSlotId, content: SlotContent): void {
  const { slotEl, viewerPane, previewPane } = slotElements(slot);
  if (!slotEl) return;

  const showViewer = content.kind === 'viewer';
  const showPreview = content.kind === 'preview';

  if (viewerPane) {
    viewerPane.classList.toggle('hidden', !showViewer);
  }
  if (previewPane) {
    previewPane.classList.toggle('hidden', !showPreview);
  }

  if (content.kind === 'none') {
    if (viewerPane) viewerPane.classList.add('hidden');
    if (previewPane) previewPane.classList.add('hidden');
  }
}

/** Apply split chrome, slot visibility, and focus ring from persisted state. */
export function applyRightPaneSplitDom(): void {
  const state = getFilePanelState();
  const split = state.rightPaneSplit;
  const active = isRightPaneSplitActive();

  const wrapper = document.getElementById('rightPaneSplit');
  const resizer = document.getElementById('rightPaneSplitResizer');
  const secondarySlot = document.getElementById('rightPaneSlotSecondary');

  if (wrapper) {
    wrapper.classList.toggle('is-active', active);
    if (active) {
      wrapper.style.setProperty('--right-pane-split-ratio', String(split.ratio));
    }
  }
  if (resizer) resizer.classList.toggle('hidden', !active);
  if (secondarySlot) secondarySlot.classList.toggle('hidden', !active);

  const primarySlot = document.getElementById('rightPaneSlotPrimary');
  if (primarySlot) {
    primarySlot.classList.toggle('is-focused', active && split.focusedSlot === 'primary');
  }
  if (secondarySlot) {
    secondarySlot.classList.toggle('is-focused', active && split.focusedSlot === 'secondary');
  }

  if (!active) {
    syncSlotPaneVisibility('primary', defaultPrimarySlotContent());
    void import('./unified-right-tabs').then((m) => m.refreshUnifiedRightTabs());
    return;
  }

  syncSlotPaneVisibility('primary', split.primary);
  syncSlotPaneVisibility('secondary', split.secondary);

  void import('./file-viewer-secondary-slot').then((m) => {
    const sec = split.secondary;
    if (sec.kind === 'viewer') {
      m.renderSecondaryViewerSlot(sec.tabPath);
    } else {
      m.destroySecondaryViewerSlot();
    }
  });

  void import('./preview-secondary-slot').then((m) => {
    const sec = split.secondary;
    if (sec.kind === 'preview') {
      void m.renderSecondaryPreviewSlot(sec.tabId);
    } else {
      m.hideSecondaryPreviewSlot();
    }
  });

  void import('./preview-electron-visibility').then((m) => {
    m.scheduleElectronPreviewHostLayoutSync();
    m.scheduleSecondaryPreviewHostLayoutSync?.();
  });

  void import('./unified-right-tabs').then((m) => m.refreshUnifiedRightTabs());
}

export function focusPaneSlot(slot: PaneSlotId): void {
  if (!isRightPaneSplitActive()) return;
  patchFilePanelState({
    rightPaneSplit: { ...getFilePanelState().rightPaneSplit, focusedSlot: slot },
  });
  applyRightPaneSplitDom();
}

export function setSlotContent(slot: PaneSlotId, content: SlotContent): void {
  const split = getFilePanelState().rightPaneSplit;
  const next: RightPaneSplitState = {
    ...split,
    enabled: true,
    primary: slot === 'primary' ? content : split.primary,
    secondary: slot === 'secondary' ? content : split.secondary,
  };
  patchFilePanelState({
    rightPaneSplit: next,
    rightPaneMode: 'split',
    viewerOpen: true,
  });
  applyRightPaneSplitDom();
  void import('./file-layout').then((m) => m.applyFileSidebarVisuals());
}

/** Enable split with current primary content and optional secondary content. */
export function enableRightPaneSplit(secondary?: SlotContent): void {
  if (isMobileLayout() || isDesktopWorkspaceHostingSurface()) return;
  const state = getFilePanelState();
  const primary = defaultPrimarySlotContent();
  let sec: SlotContent = secondary ?? { kind: 'none' };

  if (sec.kind === 'none' && primary.kind === 'viewer' && primary.tabPath) {
    sec = { kind: 'viewer', tabPath: primary.tabPath };
  }
  if (sec.kind === 'none' && primary.kind === 'preview' && primary.tabId) {
    sec = { kind: 'preview', tabId: primary.tabId };
  }

  let secondaryTabs: SlotPaneTabs = { ...EMPTY_SLOT_PANE_TABS };
  if (sec.kind === 'viewer' && sec.tabPath) {
    secondaryTabs = {
      viewerPaths: [sec.tabPath],
      activeViewerPath: sec.tabPath,
      previewIds: [],
      activePreviewId: null,
      surface: 'viewer',
    };
  } else if (sec.kind === 'preview' && sec.tabId) {
    secondaryTabs = {
      viewerPaths: [],
      activeViewerPath: null,
      previewIds: [sec.tabId],
      activePreviewId: sec.tabId,
      surface: 'preview',
    };
  }

  bootstrapSlotTabsOnSplitEnable(secondaryTabs);
  patchFilePanelState({
    rightPaneMode: 'split',
    viewerOpen: true,
    rightPaneSplit: {
      ...getFilePanelState().rightPaneSplit,
      enabled: true,
      focusedSlot: 'secondary',
      secondary: sec,
    },
  });
  applyRightPaneSplitDom();
  void import('./file-layout').then((layout) => layout.applyFileSidebarVisuals());
  void import('./unified-right-tabs').then((tabs) => tabs.refreshUnifiedRightTabs());
}

/** Split right: duplicate active file in secondary slot (VS Code parity). */
export function splitRightViewer(): void {
  const path = getActiveViewerTabPath();
  if (!path) return;
  const state = getFilePanelState();
  if (!state.rightPaneSplit.enabled) {
    enableRightPaneSplit({ kind: 'viewer', tabPath: path });
    return;
  }
  void import('./right-pane-slot-tabs').then((m) => {
    m.moveViewerTabToSlot(path, 'secondary');
    focusPaneSlot('secondary');
    void import('./unified-right-tabs').then((tabs) => tabs.refreshUnifiedRightTabs());
  });
}

/** Split right from whichever surface is active (file viewer or browser preview). */
export function splitRightPane(): void {
  const path = getActiveViewerTabPath();
  if (path) {
    splitRightViewer();
    return;
  }
  const previewId = getActivePreviewTabId();
  if (!previewId) return;
  const state = getFilePanelState();
  if (!state.rightPaneSplit.enabled) {
    enableRightPaneSplit({ kind: 'preview', tabId: previewId });
    return;
  }
  setSlotContent('secondary', { kind: 'preview', tabId: previewId });
  focusPaneSlot('secondary');
}

/** Open unified tab in secondary slot (creates split when needed). */
export function openTabToRightPane(kind: 'file' | 'preview', id: string): void {
  if (isMobileLayout() || isDesktopWorkspaceHostingSurface()) return;
  const content: SlotContent =
    kind === 'file' ? { kind: 'viewer', tabPath: id } : { kind: 'preview', tabId: id };
  if (!isRightPaneSplitActive()) {
    enableRightPaneSplit(content);
    return;
  }
  void import('./right-pane-slot-tabs').then((m) => {
    if (kind === 'file') m.moveViewerTabToSlot(id, 'secondary');
    else m.movePreviewTabToSlot(id, 'secondary');
    focusPaneSlot('secondary');
    void import('./unified-right-tabs').then((tabs) => tabs.refreshUnifiedRightTabs());
  });
}

export function closeRightPaneSplit(): void {
  const split = getFilePanelState().rightPaneSplit;
  if (!split.enabled) return;

  const primary = split.primary.kind !== 'none' ? split.primary : split.secondary;
  let rightPaneMode: 'viewer' | 'preview' | null = null;
  if (primary.kind === 'viewer') rightPaneMode = 'viewer';
  if (primary.kind === 'preview') rightPaneMode = 'preview';

  patchFilePanelState({
    rightPaneSplit: {
      ...split,
      enabled: false,
      secondary: { kind: 'none' },
      primary: primary.kind !== 'none' ? primary : defaultPrimarySlotContent(),
      secondaryTabs: { ...EMPTY_SLOT_PANE_TABS },
    },
    rightPaneMode,
    viewerOpen: rightPaneMode !== null,
  });

  void import('./file-viewer-secondary-slot').then((m) => m.destroySecondaryViewerSlot());
  void import('./preview-secondary-slot').then((m) => m.hideSecondaryPreviewSlot());

  applyRightPaneSplitDom();
  void import('./file-layout').then((m) => {
    m.reconcileRightSplitDomWithState();
    m.applyFileSidebarVisuals();
  });
}
