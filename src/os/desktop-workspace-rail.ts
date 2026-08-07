/**
 * Right-edge workspace rail — Files, Browser, and File preview on the desktop.
 */

import { DESKTOP_RAIL_TAB_ICON_SIZE } from './desktop-rail-constants';
import { createOsIcon } from './icons';
import { shouldSuppressDesktopChrome } from './shell-chrome';
import { getOsView } from './instances';
import { ICON_CHEVRON_LEFT } from '../constants';
import {
  collapseDesktopWorkspacePanel,
  getDesktopWorkspacePanelState,
  isDesktopWorkspacePanelOpen,
  openDesktopWorkspaceTab,
  subscribeDesktopWorkspacePanel,
  toggleDesktopWorkspaceTab,
  type DesktopWorkspaceTab,
} from './desktop-workspace-state';
import {
  initDesktopWorkspaceMountBridge,
  syncDesktopWorkspaceMounts,
} from './desktop-workspace-mounts';
import {
  initDesktopWorkspaceRailResize,
  restoreDesktopWorkspaceDrawerWidth,
  syncDesktopWorkspaceRailResize,
} from './desktop-workspace-rail-resize';
import { isPhoneLayout, onPhoneLayoutChange, PHONE_MQ } from '../ui/mobile-layout';

/** Collapsed tab glyphs — 75% of the left chat rail icon (28px). */

let mobileMq: MediaQueryList | null = null;
let mobileMqListener: ((event: MediaQueryListEvent) => void) | null = null;
let chromeSubscribed = false;

function getRailRoot(): HTMLElement | null {
  return document.querySelector('.mn-os-workspace-rail');
}

function getRailBackdrop(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('.mn-os-workspace-rail-backdrop');
}

function syncRailBackdrop(): void {
  const backdrop = getRailBackdrop();
  if (!backdrop) return;
  const show = isPhoneLayout() && isDesktopWorkspacePanelOpen();
  backdrop.classList.toggle('is-open', show);
  backdrop.setAttribute('aria-hidden', show ? 'false' : 'true');
  backdrop.tabIndex = show ? 0 : -1;
}

function syncRailChrome(): void {
  const state = getDesktopWorkspacePanelState();
  const rail = getRailRoot();
  if (rail) {
    rail.classList.toggle('is-expanded', state.open);
    rail.classList.toggle('is-collapsed', !state.open);
    rail.hidden = shouldSuppressDesktopChrome() || getOsView() !== 'workspaces';
  }

  for (const { id, tab, label } of TAB_DEFS) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    const active = state.open && state.tab === tab;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-expanded', active ? 'true' : 'false');
    btn.setAttribute('aria-label', active ? `Hide ${label}` : `Show ${label}`);
  }

  for (const { tab, label } of TAB_DEFS) {
    const segment = document.querySelector<HTMLButtonElement>(
      `.mn-os-workspace-rail-drawer-segment[data-workspace-tab="${tab}"]`,
    );
    if (!segment) continue;
    const selected = state.open && state.tab === tab;
    segment.classList.toggle('is-active', selected);
    segment.setAttribute('aria-selected', selected ? 'true' : 'false');
    segment.tabIndex = selected ? 0 : -1;
    segment.setAttribute('aria-label', label);
  }

  const metaRow = document.getElementById('desktopWorkspaceDrawerMeta');
  if (metaRow) {
    metaRow.hidden = !state.open || state.tab !== 'files';
  }

  syncRailBackdrop();
  syncDesktopWorkspaceRailResize();
}

const TAB_DEFS: Array<{
  id: string;
  tab: DesktopWorkspaceTab;
  icon: 'folder' | 'globe' | 'fileText';
  label: string;
  drawerTitle: string;
}> = [
  {
    id: 'btnDesktopWorkspaceFiles',
    tab: 'files',
    icon: 'folder',
    label: 'Files',
    drawerTitle: 'Desktop workspace',
  },
  {
    id: 'btnDesktopWorkspaceBrowser',
    tab: 'browser',
    icon: 'globe',
    label: 'Browser',
    drawerTitle: 'Browser',
  },
  {
    id: 'btnDesktopWorkspaceViewer',
    tab: 'viewer',
    icon: 'fileText',
    label: 'File preview',
    drawerTitle: 'File preview',
  },
];

async function onTabActivated(tab: DesktopWorkspaceTab): Promise<void> {
  // Apply desktop listing root and reparent mounts before loading tree data.
  await syncDesktopWorkspaceMounts();
  if (tab === 'browser') {
    const { showPreviewSplit } = await import('../ui/file-layout');
    showPreviewSplit();
  } else if (tab === 'viewer') {
    const { showViewerSplit } = await import('../ui/file-layout');
    showViewerSplit();
    // Desktop Viewer tab stays visible with zero tabs — paint recent files empty state.
    const { ensureCodeWorkspaceModules } = await import('../boot/code-workspace-modules');
    await ensureCodeWorkspaceModules();
    const { renderActiveViewerTab } = await import('../ui/file-viewer');
    renderActiveViewerTab();
  } else if (tab === 'files') {
    const { ensureCodeWorkspaceModules } = await import('../boot/code-workspace-modules');
    await ensureCodeWorkspaceModules();
    const { initFileTreeIfNeeded, refreshFileTree } = await import('../ui/file-tree');
    await initFileTreeIfNeeded();
    await refreshFileTree();
  }
}

function handleTabClick(tab: DesktopWorkspaceTab): void {
  const wasOpen = isDesktopWorkspacePanelOpen();
  const prevTab = getDesktopWorkspacePanelState().tab;
  toggleDesktopWorkspaceTab(tab);
  const nowOpen = isDesktopWorkspacePanelOpen();
  if (nowOpen && (!wasOpen || prevTab !== tab)) {
    void onTabActivated(tab);
  } else if (!nowOpen) {
    void syncDesktopWorkspaceMounts();
  }
}

/** Switch panel from the drawer header (never collapses on the active segment). */
function handleHeaderSegmentClick(tab: DesktopWorkspaceTab): void {
  const state = getDesktopWorkspacePanelState();
  if (!state.open) {
    openDesktopWorkspaceTab(tab);
    void onTabActivated(tab);
    return;
  }
  if (state.tab === tab) return;
  openDesktopWorkspaceTab(tab);
  void onTabActivated(tab);
}

function onHeaderSegmentKeydown(
  event: KeyboardEvent,
  tab: DesktopWorkspaceTab,
  group: HTMLElement,
): void {
  const tabs = TAB_DEFS.map((def) => def.tab);
  const currentIndex = tabs.indexOf(tab);
  if (currentIndex < 0) return;

  let nextIndex = currentIndex;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    nextIndex = Math.min(currentIndex + 1, tabs.length - 1);
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    nextIndex = Math.max(currentIndex - 1, 0);
  } else if (event.key === 'Home') {
    event.preventDefault();
    nextIndex = 0;
  } else if (event.key === 'End') {
    event.preventDefault();
    nextIndex = tabs.length - 1;
  } else {
    return;
  }

  const nextTab = tabs[nextIndex] ?? tab;
  const nextBtn = group.querySelector<HTMLButtonElement>(
    `.mn-os-workspace-rail-drawer-segment[data-workspace-tab="${nextTab}"]`,
  );
  nextBtn?.focus();
  handleHeaderSegmentClick(nextTab);
}

/** Build right-edge workspace rail DOM and append to the desktop layer. */
export function renderDesktopWorkspaceRail(root: HTMLElement): void {
  const rail = document.createElement('aside');
  rail.className = 'mn-os-workspace-rail is-collapsed';
  rail.setAttribute('aria-label', 'Desktop workspace');

  const tabStrip = document.createElement('div');
  tabStrip.className = 'mn-os-workspace-rail-tabs';

  for (const def of TAB_DEFS) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.id = def.id;
    tab.className = 'mn-os-workspace-rail-tab';
    tab.dataset.workspaceTab = def.tab;
    tab.setAttribute('aria-expanded', 'false');
    tab.setAttribute('aria-label', `Show ${def.label}`);
    tab.appendChild(createOsIcon(def.icon, { size: DESKTOP_RAIL_TAB_ICON_SIZE }));
    tabStrip.appendChild(tab);
  }

  const drawer = document.createElement('div');
  drawer.className = 'mn-os-workspace-rail-drawer';

  const resizeHandle = document.createElement('button');
  resizeHandle.type = 'button';
  resizeHandle.id = 'desktopWorkspaceDrawerResize';
  resizeHandle.className = 'mn-os-workspace-rail-drawer-resize';
  resizeHandle.setAttribute('aria-label', 'Resize workspace panel');
  resizeHandle.setAttribute('aria-orientation', 'vertical');
  resizeHandle.hidden = true;
  resizeHandle.setAttribute('aria-hidden', 'true');
  resizeHandle.tabIndex = -1;
  drawer.appendChild(resizeHandle);

  const drawerHeader = document.createElement('header');
  drawerHeader.className = 'mn-os-workspace-rail-drawer-hdr';

  const headerTop = document.createElement('div');
  headerTop.className = 'mn-os-workspace-rail-drawer-hdr-top';

  const segmentGroup = document.createElement('div');
  segmentGroup.className = 'mn-os-workspace-rail-drawer-segments';
  segmentGroup.setAttribute('role', 'tablist');
  segmentGroup.setAttribute('aria-label', 'Workspace panels');

  for (const def of TAB_DEFS) {
    const segment = document.createElement('button');
    segment.type = 'button';
    segment.className = 'mn-os-workspace-rail-drawer-segment';
    segment.dataset.workspaceTab = def.tab;
    segment.setAttribute('role', 'tab');
    segment.setAttribute('aria-selected', 'false');
    segment.tabIndex = -1;
    segment.appendChild(createOsIcon(def.icon, { size: 14 }));
    const segmentLabel = document.createElement('span');
    segmentLabel.className = 'mn-os-workspace-rail-drawer-segment-label';
    segmentLabel.textContent = def.label;
    segment.appendChild(segmentLabel);
    segmentGroup.appendChild(segment);
  }

  const collapseBtn = document.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.id = 'btnDesktopWorkspaceCollapse';
  collapseBtn.className = 'icon-btn mn-os-workspace-rail-drawer-collapse';
  collapseBtn.setAttribute('aria-label', 'Collapse workspace panel');
  collapseBtn.innerHTML = ICON_CHEVRON_LEFT;

  headerTop.append(segmentGroup, collapseBtn);

  const metaRow = document.createElement('div');
  metaRow.id = 'desktopWorkspaceDrawerMeta';
  metaRow.className = 'mn-os-workspace-rail-drawer-hdr-meta';
  metaRow.hidden = true;

  const metaTop = document.createElement('div');
  metaTop.className = 'mn-os-workspace-rail-drawer-meta-top';

  const workspaceSelect = document.createElement('select');
  workspaceSelect.id = 'desktopWorkspaceSelect';
  workspaceSelect.className = 'mn-os-workspace-rail-drawer-select';
  workspaceSelect.setAttribute('aria-label', 'Desktop workspace folder');

  const folderBtn = document.createElement('button');
  folderBtn.type = 'button';
  folderBtn.id = 'btnDesktopWorkspaceFolder';
  folderBtn.className = 'mn-os-workspace-rail-drawer-folder-btn';
  folderBtn.setAttribute('aria-label', 'Change workspace folder');
  folderBtn.title = 'Change workspace folder';
  folderBtn.appendChild(createOsIcon('folder', { size: 14 }));

  metaTop.append(workspaceSelect, folderBtn);

  const drawerPath = document.createElement('span');
  drawerPath.id = 'desktopWorkspaceDrawerPath';
  drawerPath.className = 'mn-os-workspace-rail-drawer-path';
  drawerPath.textContent = '~/.minnow/workspace';

  metaRow.append(metaTop, drawerPath);
  drawerHeader.append(headerTop, metaRow);

  const drawerBody = document.createElement('div');
  drawerBody.className = 'mn-os-workspace-rail-drawer-body';

  const filesMount = document.createElement('div');
  filesMount.id = 'desktopFileTreeMount';
  filesMount.className = 'mn-os-workspace-mount mn-os-workspace-mount--files';

  const previewMount = document.createElement('div');
  previewMount.id = 'desktopPreviewMount';
  previewMount.className = 'mn-os-workspace-mount mn-os-workspace-mount--browser';

  const viewerMount = document.createElement('div');
  viewerMount.id = 'desktopFileViewerMount';
  viewerMount.className = 'mn-os-workspace-mount mn-os-workspace-mount--viewer';

  drawerBody.append(filesMount, previewMount, viewerMount);
  drawer.append(drawerHeader, drawerBody);
  rail.append(drawer, tabStrip);
  root.appendChild(rail);

  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.className = 'mn-os-workspace-rail-backdrop';
  backdrop.setAttribute('aria-label', 'Close workspace panel');
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.tabIndex = -1;
  root.appendChild(backdrop);
}

/** Wire workspace rail controls (call once from desktop render). */
export function wireDesktopWorkspaceRail(): void {
  initDesktopWorkspaceMountBridge();
  initDesktopWorkspaceRailResize();
  restoreDesktopWorkspaceDrawerWidth();

  for (const def of TAB_DEFS) {
    const tab = document.getElementById(def.id);
    if (!tab || tab.dataset.bound === '1') continue;
    tab.dataset.bound = '1';
    tab.addEventListener('click', () => handleTabClick(def.tab));
  }

  const segmentGroup = document.querySelector<HTMLElement>('.mn-os-workspace-rail-drawer-segments');
  if (segmentGroup && segmentGroup.dataset.bound !== '1') {
    segmentGroup.dataset.bound = '1';
    for (const def of TAB_DEFS) {
      const segment = segmentGroup.querySelector<HTMLButtonElement>(
        `[data-workspace-tab="${def.tab}"]`,
      );
      if (!segment) continue;
      segment.addEventListener('click', () => handleHeaderSegmentClick(def.tab));
      segment.addEventListener('keydown', (event) => {
        onHeaderSegmentKeydown(event, def.tab, segmentGroup as HTMLElement);
      });
    }
  }

  const collapse = document.getElementById('btnDesktopWorkspaceCollapse');
  if (collapse && collapse.dataset.bound !== '1') {
    collapse.dataset.bound = '1';
    collapse.addEventListener('click', () => {
      collapseDesktopWorkspacePanel();
      void syncDesktopWorkspaceMounts();
    });
  }

  const backdrop = getRailBackdrop();
  if (backdrop && backdrop.dataset.bound !== '1') {
    backdrop.dataset.bound = '1';
    backdrop.addEventListener('click', () => {
      collapseDesktopWorkspacePanel();
      void syncDesktopWorkspaceMounts();
    });
  }

  if (!mobileMq && typeof window.matchMedia === 'function') {
    mobileMq = window.matchMedia(PHONE_MQ);
    mobileMqListener = () => syncRailBackdrop();
    mobileMq.addEventListener('change', mobileMqListener);
    onPhoneLayoutChange(() => syncRailBackdrop());
  }

  if (!chromeSubscribed) {
    chromeSubscribed = true;
    subscribeDesktopWorkspacePanel(() => syncRailChrome());
    void import('./instances').then(({ subscribeInstances }) => {
      subscribeInstances(() => syncRailChrome());
    });
    void import('./desktop-state').then(({ subscribeDesktopState }) => {
      subscribeDesktopState(() => {
        syncRailChrome();
        void syncDesktopWorkspaceMounts();
      });
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !isDesktopWorkspacePanelOpen()) return;
    collapseDesktopWorkspacePanel();
    void syncDesktopWorkspaceMounts();
  });

  syncRailChrome();
  void import('../ui/desktop-workspace-folder').then((m) => m.initDesktopWorkspaceFolderControls());
  void syncDesktopWorkspaceMounts();
}

/** Load desktop workspace path label into the drawer header. */
export async function refreshDesktopWorkspaceDrawerPath(): Promise<void> {
  const el = document.getElementById('desktopWorkspaceDrawerPath');
  if (!el) return;
  const { getDesktopWorkspacePath } = await import('../lib/desktop-workspace');
  const path = await getDesktopWorkspacePath();
  if (path) {
    el.textContent = path;
    el.title = path;
  }
  const { refreshDesktopWorkspaceFolderUi, refreshDesktopWorkspaceSelect } = await import(
    '../ui/desktop-workspace-folder'
  );
  refreshDesktopWorkspaceFolderUi();
  const select = document.getElementById('desktopWorkspaceSelect') as HTMLSelectElement | null;
  await refreshDesktopWorkspaceSelect(select);
}

/** Reset rail bindings (tests). */
export function resetDesktopWorkspaceRailForTests(): void {
  chromeSubscribed = false;
  if (mobileMq && mobileMqListener) {
    mobileMq.removeEventListener('change', mobileMqListener);
    mobileMq = null;
    mobileMqListener = null;
  }
}

export { openDesktopWorkspaceTab, collapseDesktopWorkspacePanel };
