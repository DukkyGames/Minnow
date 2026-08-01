/**
 * Unified tab strip for file viewer and browser preview tabs (MIN-224).
 */

import { getFilePanelState } from '../state/file-panel';
import {
  focusPaneSlot,
  getFocusedPaneSlot,
  isRightPaneSplitLayoutEnabled,
  openTabToRightPane,
} from './right-pane-split';
import {
  activePreviewIdForSlot,
  activeViewerPathForSlot,
  getSlotPaneTabs,
  previewIdsForSlot,
  viewerPathsForSlot,
} from './right-pane-slot-tabs';
import {
  getActiveViewerTabPath,
  listViewerTabs,
  onViewerTabStoreChange,
  reorderViewerTab,
} from './file-viewer-tab-store';
import {
  getActivePreviewTabId,
  listPreviewTabs,
  onPreviewTabStoreChange,
  reorderPreviewTab,
} from './preview-tab-store';
import type { PaneSlotId } from '../state/file-panel';
import { createFileTypeIconElement } from './file-type-icons';
import { iconHtml } from './icon';

const PREVIEW_TAB_ICON = iconHtml('globe', { size: 14 });

let bound = false;

type FileTabPathHandler = (path: string) => void | Promise<void>;
type FileTabCycleHandler = (direction: 'next' | 'prev') => void | Promise<void>;
type FileTabCloseAllHandler = () => void | Promise<void>;
type PreviewTabIdHandler = (id: string) => void | Promise<void>;

let onFileTabActivate: FileTabPathHandler = () => {};
let onFileTabClose: FileTabPathHandler = () => {};
let onFileTabCloseOthers: FileTabPathHandler = () => {};
let onFileTabCloseToRight: FileTabPathHandler = () => {};
let onFileTabCloseAll: FileTabCloseAllHandler = () => {};
let onFileTabCycle: FileTabCycleHandler = () => {};

let onPreviewTabActivate: PreviewTabIdHandler = () => {};
let onPreviewTabClose: PreviewTabIdHandler = () => {};
let onPreviewTabNew: () => void | Promise<void> = () => {};

/** Register file tab handlers from file-viewer. */
export function registerUnifiedFileTabHandlers(handlers: {
  onActivate: FileTabPathHandler;
  onClose: FileTabPathHandler;
  onCloseOthers?: FileTabPathHandler;
  onCloseToRight?: FileTabPathHandler;
  onCloseAll?: FileTabCloseAllHandler;
  onCycle?: FileTabCycleHandler;
}): void {
  onFileTabActivate = handlers.onActivate;
  onFileTabClose = handlers.onClose;
  onFileTabCloseOthers = handlers.onCloseOthers ?? (() => {});
  onFileTabCloseToRight = handlers.onCloseToRight ?? (() => {});
  onFileTabCloseAll = handlers.onCloseAll ?? (() => {});
  onFileTabCycle = handlers.onCycle ?? (() => {});
}

/** Register preview tab handlers from preview-panel. */
export function registerUnifiedPreviewTabHandlers(handlers: {
  onActivate: PreviewTabIdHandler;
  onClose: PreviewTabIdHandler;
  onNew: () => void | Promise<void>;
}): void {
  onPreviewTabActivate = handlers.onActivate;
  onPreviewTabClose = handlers.onClose;
  onPreviewTabNew = handlers.onNew;
}

function getTabsContainer(slot: PaneSlotId): HTMLElement | null {
  if (slot === 'secondary') {
    return document.getElementById('unifiedTabsSecondary');
  }
  return document.getElementById('unifiedTabs');
}

function getTabBarElement(slot: PaneSlotId): HTMLElement | null {
  if (slot === 'secondary') {
    return document.getElementById('unifiedTabBarSecondary');
  }
  return document.getElementById('unifiedTabBar');
}

function scrollActiveTabIntoView(slot: PaneSlotId): void {
  const container = getTabsContainer(slot);
  if (!container) return;
  const active = container.querySelector('.unified-tab.is-active');
  if (active instanceof HTMLElement) {
    active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function tabDropIndex(container: HTMLElement, clientX: number, selector: string): number {
  const tabs = [...container.querySelectorAll<HTMLElement>(selector)];
  for (let i = 0; i < tabs.length; i++) {
    const rect = tabs[i]!.getBoundingClientRect();
    const mid = rect.left + rect.width / 2;
    if (clientX < mid) return i;
  }
  return tabs.length;
}

function clearDropIndicator(container: HTMLElement, className: string): void {
  container.querySelectorAll(`.${className}`).forEach((el) => {
    el.classList.remove(className);
  });
}

function appendFileTab(
  container: HTMLElement,
  slot: PaneSlotId,
  tab: ReturnType<typeof listViewerTabs>[number],
  activePath: string | null,
  fileTabs: ReturnType<typeof listViewerTabs>[number][],
): void {
  const isActive = activePath === tab.path;
  const tabEl = document.createElement('div');
  tabEl.className = 'unified-tab unified-tab--file file-viewer-tab';
  tabEl.setAttribute('role', 'tab');
  tabEl.setAttribute('aria-selected', isActive ? 'true' : 'false');
  tabEl.setAttribute('tabindex', isActive ? '0' : '-1');
  tabEl.title = tab.path;
  tabEl.dataset.path = tab.path;
  tabEl.dataset.tabKind = 'file';
  tabEl.draggable = true;
  if (isActive) tabEl.classList.add('is-active');
  if (tab.isDirty) tabEl.classList.add('file-viewer-tab--dirty');

  const icon = document.createElement('span');
  icon.className = 'unified-tab__icon-wrap';
  icon.appendChild(createFileTypeIconElement(tab.path, 'tab'));
  tabEl.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'unified-tab__label file-viewer-tab__label';
  label.textContent = tab.isDirty ? `${tab.displayName} ●` : tab.displayName;
  tabEl.appendChild(label);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'unified-tab__close file-viewer-tab__close';
  closeBtn.setAttribute('aria-label', `Close ${tab.displayName}`);
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    void onFileTabClose(tab.path);
  });
  tabEl.appendChild(closeBtn);

  tabEl.addEventListener('click', () => {
    if (isActive) return;
    if (isRightPaneSplitLayoutEnabled()) focusPaneSlot(slot);
    void onFileTabActivate(tab.path);
  });

  tabEl.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    void onFileTabClose(tab.path);
  });

  tabEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    void import('./file-tree-context-menu').then(({ showFilePanelContextMenu }) => {
      showFilePanelContextMenu(
        [
          { label: 'Close', action: () => void onFileTabClose(tab.path) },
          {
            label: 'Open to the right',
            action: () => openTabToRightPane('file', tab.path),
          },
          {
            label: 'Close others',
            action: () => void onFileTabCloseOthers(tab.path),
            disabled: fileTabs.length < 2,
          },
          {
            label: 'Close to the right',
            action: () => void onFileTabCloseToRight(tab.path),
            disabled: fileTabs.findIndex((t) => t.path === tab.path) >= fileTabs.length - 1,
          },
          {
            label: 'Close all',
            action: () => void onFileTabCloseAll(),
            disabled: fileTabs.length === 0,
          },
        ],
        e.clientX,
        e.clientY,
      );
    });
  });

  tabEl.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData('text/plain', `file:${tab.path}`);
    e.dataTransfer!.effectAllowed = 'move';
    tabEl.classList.add('unified-tab--dragging');
  });

  tabEl.addEventListener('dragend', () => {
    tabEl.classList.remove('unified-tab--dragging');
    clearDropIndicator(container, 'unified-tab--drop-before');
  });

  tabEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    clearDropIndicator(container, 'unified-tab--drop-before');
    const idx = tabDropIndex(container, e.clientX, '.unified-tab--file');
    const target = container.querySelectorAll<HTMLElement>('.unified-tab--file')[idx];
    target?.classList.add('unified-tab--drop-before');
  });

  tabEl.addEventListener('dragleave', () => {
    tabEl.classList.remove('unified-tab--drop-before');
  });

  tabEl.addEventListener('drop', (e) => {
    e.preventDefault();
    clearDropIndicator(container, 'unified-tab--drop-before');
    const raw = e.dataTransfer?.getData('text/plain');
    if (!raw?.startsWith('file:')) return;
    const fromPath = raw.slice(5);
    if (!fromPath || fromPath === tab.path) return;
    const toIndex = tabDropIndex(container, e.clientX, '.unified-tab--file');
    reorderViewerTab(fromPath, toIndex);
  });

  container.appendChild(tabEl);
}

function appendPreviewTab(
  container: HTMLElement,
  slot: PaneSlotId,
  tab: ReturnType<typeof listPreviewTabs>[number],
  activeId: string | null,
): void {
  const isActive = activeId === tab.id;
  const tabEl = document.createElement('div');
  tabEl.className = 'unified-tab unified-tab--preview preview-tab';
  tabEl.setAttribute('role', 'tab');
  tabEl.setAttribute('aria-selected', isActive ? 'true' : 'false');
  tabEl.setAttribute('tabindex', isActive ? '0' : '-1');
  tabEl.dataset.tabId = tab.id;
  tabEl.dataset.tabKind = 'preview';
  tabEl.draggable = true;
  if (isActive) tabEl.classList.add('is-active');
  if (tab.loading) tabEl.classList.add('preview-tab--loading');
  if (tab.guestCrashed) tabEl.classList.add('preview-tab--crashed');

  const icon = document.createElement('span');
  icon.className = 'unified-tab__icon-wrap';
  icon.innerHTML = PREVIEW_TAB_ICON;
  tabEl.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'unified-tab__label preview-tab__label';
  label.textContent = tab.title;
  tabEl.appendChild(label);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'unified-tab__close preview-tab__close';
  closeBtn.setAttribute('aria-label', `Close ${tab.title}`);
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    void onPreviewTabClose(tab.id);
  });
  tabEl.appendChild(closeBtn);

  tabEl.addEventListener('click', () => {
    if (isActive) return;
    if (isRightPaneSplitLayoutEnabled()) focusPaneSlot(slot);
    void onPreviewTabActivate(tab.id);
  });

  tabEl.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    void onPreviewTabClose(tab.id);
  });

  tabEl.addEventListener('dragstart', (e) => {
    e.dataTransfer?.setData('text/plain', `preview:${tab.id}`);
    e.dataTransfer!.effectAllowed = 'move';
    tabEl.classList.add('unified-tab--dragging');
  });

  tabEl.addEventListener('dragend', () => {
    tabEl.classList.remove('unified-tab--dragging');
    clearDropIndicator(container, 'unified-tab--drop-before');
  });

  tabEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    clearDropIndicator(container, 'unified-tab--drop-before');
    const idx = tabDropIndex(container, e.clientX, '.unified-tab--preview');
    const target = container.querySelectorAll<HTMLElement>('.unified-tab--preview')[idx];
    target?.classList.add('unified-tab--drop-before');
  });

  tabEl.addEventListener('drop', (e) => {
    e.preventDefault();
    clearDropIndicator(container, 'unified-tab--drop-before');
    const raw = e.dataTransfer?.getData('text/plain');
    if (!raw?.startsWith('preview:')) return;
    const fromId = raw.slice(8);
    if (!fromId || fromId === tab.id) return;
    const toIndex = tabDropIndex(container, e.clientX, '.unified-tab--preview');
    reorderPreviewTab(fromId, toIndex);
  });

  container.appendChild(tabEl);
}

function renderSlotTabStrip(slot: PaneSlotId): void {
  const container = getTabsContainer(slot);
  if (!container) return;

  const slotViewerPaths = new Set(viewerPathsForSlot(slot));
  const slotPreviewIds = new Set(previewIdsForSlot(slot));
  const fileTabs = listViewerTabs().filter((t) => slotViewerPaths.has(t.path));
  const previewTabs = listPreviewTabs().filter((t) => slotPreviewIds.has(t.id));
  const activePath = activeViewerPathForSlot(slot);
  const activePreviewId = activePreviewIdForSlot(slot);

  container.replaceChildren();

  for (const tab of fileTabs) {
    appendFileTab(container, slot, tab, activePath, fileTabs);
  }
  for (const tab of previewTabs) {
    appendPreviewTab(container, slot, tab, activePreviewId);
  }

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'unified-tab-add preview-tab-add';
  addBtn.setAttribute('aria-label', 'New browser tab');
  addBtn.textContent = '+';
  addBtn.addEventListener('click', () => {
    if (isRightPaneSplitLayoutEnabled()) focusPaneSlot(slot);
    void onPreviewTabNew();
  });
  container.appendChild(addBtn);

  const tabBar = getTabBarElement(slot);
  const hasTabs = fileTabs.length > 0 || previewTabs.length > 0;
  tabBar?.classList.toggle('hidden', !hasTabs);

  scrollActiveTabIntoView(slot);
}

function renderTabStrip(): void {
  renderSlotTabStrip('primary');
  if (isRightPaneSplitLayoutEnabled()) {
    renderSlotTabStrip('secondary');
    getTabBarElement('secondary')?.classList.remove('hidden');
  } else {
    getTabBarElement('secondary')?.classList.add('hidden');
  }
}

/** Wire unified tab strip (call once from init-file-panel). */
export function bindUnifiedRightTabs(): void {
  if (bound) return;
  bound = true;
  onViewerTabStoreChange(renderTabStrip);
  onPreviewTabStoreChange(renderTabStrip);
  renderTabStrip();

  const container = getTabsContainer('primary');
  if (!container) return;

  container.addEventListener('keydown', (e) => {
    const slot = isRightPaneSplitLayoutEnabled() ? getFocusedPaneSlot() : 'primary';
    const pathSet = new Set(viewerPathsForSlot(slot));
    const idSet = new Set(previewIdsForSlot(slot));
    const fileTabs = listViewerTabs().filter((t) => pathSet.has(t.path));
    const previewTabs = listPreviewTabs().filter((t) => idSet.has(t.id));
    const total = fileTabs.length + previewTabs.length;
    if (total < 2) return;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const activePath = activeViewerPathForSlot(slot);
      const activePreviewId = activePreviewIdForSlot(slot);
      let currentIdx = -1;
      if (activePath && pathSet.has(activePath)) {
        currentIdx = fileTabs.findIndex((t) => t.path === activePath);
      } else if (activePreviewId && idSet.has(activePreviewId)) {
        currentIdx = fileTabs.length + previewTabs.findIndex((t) => t.id === activePreviewId);
      }
      if (currentIdx < 0) return;
      const nextIdx =
        e.key === 'ArrowLeft' ? (currentIdx - 1 + total) % total : (currentIdx + 1) % total;
      if (nextIdx < fileTabs.length) {
        void onFileTabActivate(fileTabs[nextIdx]!.path);
      } else {
        void onPreviewTabActivate(previewTabs[nextIdx - fileTabs.length]!.id);
      }
      return;
    }

    if (e.key === 'w' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const activePath = activeViewerPathForSlot(slot);
      const activePreviewId = activePreviewIdForSlot(slot);
      const tabs = getSlotPaneTabs(slot);
      if (tabs.surface === 'viewer' && activePath) {
        void onFileTabClose(activePath);
      } else if (activePreviewId) {
        void onPreviewTabClose(activePreviewId);
      }
      return;
    }

    if (e.key === 'Tab' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void onFileTabCycle(e.shiftKey ? 'prev' : 'next');
    }
  });
}

export function refreshUnifiedRightTabs(): void {
  renderTabStrip();
}
