/**
 * Tab strip UI for the multi-tab file viewer.
 */

import {
  getActiveViewerTabPath,
  listViewerTabs,
  onViewerTabStoreChange,
} from './file-viewer-tab-store';

let bound = false;

type TabPathHandler = (path: string) => void | Promise<void>;

let onTabActivate: TabPathHandler = () => {};
let onTabClose: TabPathHandler = () => {};

/** Register activate/close handlers from file-viewer (avoids circular imports). */
export function registerFileViewerTabHandlers(handlers: {
  onActivate: TabPathHandler;
  onClose: TabPathHandler;
}): void {
  onTabActivate = handlers.onActivate;
  onTabClose = handlers.onClose;
}

function getTabsContainer(): HTMLElement | null {
  return document.getElementById('fileViewerTabs');
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

    container.appendChild(tabEl);
  }
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
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const tabs = listViewerTabs();
    if (tabs.length < 2) return;
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
  });
}

export function refreshFileViewerTabs(): void {
  renderTabStrip();
}
