/**
 * Tab strip UI for the multi-tab file viewer.
 */

import { showFilePanelContextMenu } from './file-tree-context-menu';
import {
  getActiveViewerTabPath,
  listViewerTabs,
  onViewerTabStoreChange,
  reorderViewerTab,
} from './file-viewer-tab-store';

let bound = false;

type TabPathHandler = (path: string) => void | Promise<void>;
type TabCycleHandler = (direction: 'next' | 'prev') => void | Promise<void>;

type TabCloseAllHandler = () => void | Promise<void>;

let onTabActivate: TabPathHandler = () => {};
let onTabClose: TabPathHandler = () => {};
let onTabCloseOthers: TabPathHandler = () => {};
let onTabCloseToRight: TabPathHandler = () => {};
let onTabCloseAll: TabCloseAllHandler = () => {};
let onTabCycle: TabCycleHandler = () => {};

/** Register activate/close handlers from file-viewer (avoids circular imports). */
export function registerFileViewerTabHandlers(handlers: {
  onActivate: TabPathHandler;
  onClose: TabPathHandler;
  onCloseOthers?: TabPathHandler;
  onCloseToRight?: TabPathHandler;
  onCloseAll?: TabCloseAllHandler;
  onCycle?: TabCycleHandler;
}): void {
  onTabActivate = handlers.onActivate;
  onTabClose = handlers.onClose;
  onTabCloseOthers = handlers.onCloseOthers ?? (() => {});
  onTabCloseToRight = handlers.onCloseToRight ?? (() => {});
  onTabCloseAll = handlers.onCloseAll ?? (() => {});
  onTabCycle = handlers.onCycle ?? (() => {});
}

function getTabsContainer(): HTMLElement | null {
  return document.getElementById('fileViewerTabs');
}

/** Scroll the active tab chip into view when many tabs overflow. */
function scrollActiveTabIntoView(): void {
  const container = getTabsContainer();
  if (!container) return;
  const active = container.querySelector('.file-viewer-tab.is-active');
  if (active instanceof HTMLElement) {
    active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function tabDropIndex(container: HTMLElement, clientX: number): number {
  const tabs = [...container.querySelectorAll<HTMLElement>('.file-viewer-tab')];
  for (let i = 0; i < tabs.length; i++) {
    const rect = tabs[i]!.getBoundingClientRect();
    const mid = rect.left + rect.width / 2;
    if (clientX < mid) return i;
  }
  return tabs.length;
}

function clearDropIndicator(container: HTMLElement): void {
  container.querySelectorAll('.file-viewer-tab--drop-before').forEach((el) => {
    el.classList.remove('file-viewer-tab--drop-before');
  });
}

function renderTabStrip(): void {
  const container = getTabsContainer();
  if (!container) return;

  const tabs = listViewerTabs();
  const activePath = getActiveViewerTabPath();
  container.replaceChildren();

  for (const tab of tabs) {
    const isActive = tab.path === activePath;
    const tabEl = document.createElement('div');
    tabEl.className = 'file-viewer-tab';
    tabEl.setAttribute('role', 'tab');
    tabEl.setAttribute('aria-selected', isActive ? 'true' : 'false');
    tabEl.setAttribute('tabindex', isActive ? '0' : '-1');
    tabEl.title = tab.path;
    tabEl.dataset.path = tab.path;
    tabEl.draggable = true;
    if (isActive) {
      tabEl.classList.add('is-active');
    }
    if (tab.isDirty) {
      tabEl.classList.add('file-viewer-tab--dirty');
    }

    const label = document.createElement('span');
    label.className = 'file-viewer-tab__label';
    label.textContent = tab.isDirty ? `${tab.displayName} ●` : tab.displayName;
    tabEl.appendChild(label);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'file-viewer-tab__close';
    closeBtn.setAttribute('aria-label', `Close ${tab.displayName}`);
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void onTabClose(tab.path);
    });
    tabEl.appendChild(closeBtn);

    tabEl.addEventListener('click', () => {
      if (tab.path === activePath) return;
      void onTabActivate(tab.path);
    });

    tabEl.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      void onTabClose(tab.path);
    });

    tabEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showFilePanelContextMenu(
        [
          { label: 'Close', action: () => void onTabClose(tab.path) },
          {
            label: 'Close others',
            action: () => void onTabCloseOthers(tab.path),
            disabled: tabs.length < 2,
          },
          {
            label: 'Close to the right',
            action: () => void onTabCloseToRight(tab.path),
            disabled: tabs.findIndex((t) => t.path === tab.path) >= tabs.length - 1,
          },
          {
            label: 'Close all',
            action: () => void onTabCloseAll(),
            disabled: tabs.length === 0,
          },
        ],
        e.clientX,
        e.clientY,
      );
    });

    tabEl.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', tab.path);
      e.dataTransfer!.effectAllowed = 'move';
      tabEl.classList.add('file-viewer-tab--dragging');
    });

    tabEl.addEventListener('dragend', () => {
      tabEl.classList.remove('file-viewer-tab--dragging');
      clearDropIndicator(container);
    });

    tabEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      clearDropIndicator(container);
      const idx = tabDropIndex(container, e.clientX);
      const target = container.querySelectorAll<HTMLElement>('.file-viewer-tab')[idx];
      target?.classList.add('file-viewer-tab--drop-before');
    });

    tabEl.addEventListener('dragleave', () => {
      tabEl.classList.remove('file-viewer-tab--drop-before');
    });

    tabEl.addEventListener('drop', (e) => {
      e.preventDefault();
      clearDropIndicator(container);
      const fromPath = e.dataTransfer?.getData('text/plain');
      if (!fromPath || fromPath === tab.path) return;
      const toIndex = tabDropIndex(container, e.clientX);
      reorderViewerTab(fromPath, toIndex);
    });

    container.appendChild(tabEl);
  }

  scrollActiveTabIntoView();
}

/** Wire tab strip listeners (call once from init-file-panel). */
export function bindFileViewerTabs(): void {
  if (bound) return;
  bound = true;
  onViewerTabStoreChange(renderTabStrip);
  renderTabStrip();

  const container = getTabsContainer();
  if (!container) return;

  container.addEventListener('keydown', (e) => {
    const tabs = listViewerTabs();
    if (tabs.length < 2) return;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const activePath = getActiveViewerTabPath();
      const idx = tabs.findIndex((t) => t.path === activePath);
      if (idx < 0) return;
      e.preventDefault();
      const nextIdx =
        e.key === 'ArrowLeft'
          ? (idx - 1 + tabs.length) % tabs.length
          : (idx + 1) % tabs.length;
      const next = tabs[nextIdx]!;
      void onTabActivate(next.path);
      return;
    }

    if (e.key === 'w' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const activePath = getActiveViewerTabPath();
      if (activePath) void onTabClose(activePath);
      return;
    }

    if (e.key === 'Tab' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void onTabCycle(e.shiftKey ? 'prev' : 'next');
    }
  });
}

export function refreshFileViewerTabs(): void {
  renderTabStrip();
}
