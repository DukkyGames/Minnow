/**
 * Tab strip UI for the multi-tab preview browser panel.
 */

import {
  getActivePreviewTabId,
  listPreviewTabs,
  onPreviewTabStoreChange,
  reorderPreviewTab,
} from './preview-tab-store';

let bound = false;

type TabIdHandler = (id: string) => void | Promise<void>;

let onTabActivate: TabIdHandler = () => {};
let onTabClose: TabIdHandler = () => {};
let onTabNew: () => void | Promise<void> = () => {};

/** Register handlers from preview-panel (avoids circular imports). */
export function registerPreviewTabHandlers(handlers: {
  onActivate: TabIdHandler;
  onClose: TabIdHandler;
  onNew: () => void | Promise<void>;
}): void {
  onTabActivate = handlers.onActivate;
  onTabClose = handlers.onClose;
  onTabNew = handlers.onNew;
}

function getTabsContainer(): HTMLElement | null {
  return document.getElementById('previewTabs');
}

function scrollActiveTabIntoView(): void {
  const container = getTabsContainer();
  if (!container) return;
  const active = container.querySelector('.preview-tab.is-active');
  if (active instanceof HTMLElement) {
    active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function tabDropIndex(container: HTMLElement, clientX: number): number {
  const tabs = [...container.querySelectorAll<HTMLElement>('.preview-tab')];
  for (let i = 0; i < tabs.length; i++) {
    const rect = tabs[i]!.getBoundingClientRect();
    const mid = rect.left + rect.width / 2;
    if (clientX < mid) return i;
  }
  return tabs.length;
}

function clearDropIndicator(container: HTMLElement): void {
  container.querySelectorAll('.preview-tab--drop-before').forEach((el) => {
    el.classList.remove('preview-tab--drop-before');
  });
}

function renderTabStrip(): void {
  const container = getTabsContainer();
  if (!container) return;

  const tabs = listPreviewTabs();
  const activeId = getActivePreviewTabId();
  container.replaceChildren();

  for (const tab of tabs) {
    const isActive = tab.id === activeId;
    const tabEl = document.createElement('div');
    tabEl.className = 'preview-tab';
    tabEl.setAttribute('role', 'tab');
    tabEl.setAttribute('aria-selected', isActive ? 'true' : 'false');
    tabEl.setAttribute('tabindex', isActive ? '0' : '-1');
    tabEl.dataset.tabId = tab.id;
    tabEl.draggable = true;
    if (isActive) tabEl.classList.add('is-active');
    if (tab.loading) tabEl.classList.add('preview-tab--loading');

    const label = document.createElement('span');
    label.className = 'preview-tab__label';
    label.textContent = tab.title;
    tabEl.appendChild(label);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'preview-tab__close';
    closeBtn.setAttribute('aria-label', `Close ${tab.title}`);
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void onTabClose(tab.id);
    });
    tabEl.appendChild(closeBtn);

    tabEl.addEventListener('click', () => {
      if (tab.id === activeId) return;
      void onTabActivate(tab.id);
    });

    tabEl.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      void onTabClose(tab.id);
    });

    tabEl.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', tab.id);
      e.dataTransfer!.effectAllowed = 'move';
      tabEl.classList.add('preview-tab--dragging');
    });

    tabEl.addEventListener('dragend', () => {
      tabEl.classList.remove('preview-tab--dragging');
      clearDropIndicator(container);
    });

    tabEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      clearDropIndicator(container);
      const idx = tabDropIndex(container, e.clientX);
      const target = container.querySelectorAll<HTMLElement>('.preview-tab')[idx];
      target?.classList.add('preview-tab--drop-before');
    });

    tabEl.addEventListener('drop', (e) => {
      e.preventDefault();
      clearDropIndicator(container);
      const fromId = e.dataTransfer?.getData('text/plain');
      if (!fromId || fromId === tab.id) return;
      const toIndex = tabDropIndex(container, e.clientX);
      reorderPreviewTab(fromId, toIndex);
    });

    container.appendChild(tabEl);
  }

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'preview-tab-add';
  addBtn.setAttribute('aria-label', 'New preview tab');
  addBtn.textContent = '+';
  addBtn.addEventListener('click', () => {
    void onTabNew();
  });
  container.appendChild(addBtn);

  scrollActiveTabIntoView();
}

/** Wire preview tab strip listeners (call once from initPreviewPanel). */
export function bindPreviewTabs(): void {
  if (bound) return;
  bound = true;
  onPreviewTabStoreChange(renderTabStrip);
  renderTabStrip();
}

export function refreshPreviewTabs(): void {
  renderTabStrip();
}
