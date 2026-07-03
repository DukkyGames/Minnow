/**
 * Right-edge workspace rail — Files, Browser, and File preview on the desktop.
 */

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

const MOBILE_DESKTOP_MQ = '(max-width: 640px)';

let mobileMq: MediaQueryList | null = null;
let mobileMqListener: ((event: MediaQueryListEvent) => void) | null = null;
let chromeSubscribed = false;

function isMobileDesktopLayout(): boolean {
  return window.matchMedia(MOBILE_DESKTOP_MQ).matches;
}

function getRailRoot(): HTMLElement | null {
  return document.querySelector('.mn-os-workspace-rail');
}

function getRailBackdrop(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('.mn-os-workspace-rail-backdrop');
}

function syncRailBackdrop(): void {
  const backdrop = getRailBackdrop();
  if (!backdrop) return;
  const show = isMobileDesktopLayout() && isDesktopWorkspacePanelOpen();
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
    rail.hidden = shouldSuppressDesktopChrome() || getOsView() !== 'desktop';
  }

  for (const { id, tab, label } of TAB_DEFS) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    const active = state.open && state.tab === tab;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-expanded', active ? 'true' : 'false');
    btn.setAttribute('aria-label', active ? `Hide ${label}` : `Show ${label}`);
  }

  const drawerTitle = document.getElementById('desktopWorkspaceDrawerTitle');
  if (drawerTitle) {
    drawerTitle.textContent = TAB_DEFS.find((t) => t.tab === state.tab)?.drawerTitle ?? 'Workspace';
  }

  syncRailBackdrop();
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
  if (tab === 'browser') {
    const { showPreviewSplit } = await import('../ui/file-layout');
    showPreviewSplit();
  } else if (tab === 'viewer') {
    const { showViewerSplit } = await import('../ui/file-layout');
    showViewerSplit();
  } else if (tab === 'files') {
    const { initFileTreeIfNeeded, refreshFileTree } = await import('../ui/file-tree');
    initFileTreeIfNeeded();
    await refreshFileTree();
  }
  await syncDesktopWorkspaceMounts();
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
    tab.appendChild(createOsIcon(def.icon, { size: 28 }));
    tabStrip.appendChild(tab);
  }

  const drawer = document.createElement('div');
  drawer.className = 'mn-os-workspace-rail-drawer';

  const drawerHeader = document.createElement('header');
  drawerHeader.className = 'mn-os-workspace-rail-drawer-hdr';

  const drawerTitle = document.createElement('span');
  drawerTitle.id = 'desktopWorkspaceDrawerTitle';
  drawerTitle.className = 'mn-os-workspace-rail-drawer-title';
  drawerTitle.textContent = 'Desktop workspace';

  const drawerPath = document.createElement('span');
  drawerPath.id = 'desktopWorkspaceDrawerPath';
  drawerPath.className = 'mn-os-workspace-rail-drawer-path';
  drawerPath.textContent = '~/.minnow/workspace';

  const collapseBtn = document.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.id = 'btnDesktopWorkspaceCollapse';
  collapseBtn.className = 'icon-btn';
  collapseBtn.setAttribute('aria-label', 'Collapse workspace panel');
  collapseBtn.innerHTML = ICON_CHEVRON_LEFT;

  drawerHeader.append(drawerTitle, drawerPath, collapseBtn);

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

  for (const def of TAB_DEFS) {
    const tab = document.getElementById(def.id);
    if (!tab || tab.dataset.bound === '1') continue;
    tab.dataset.bound = '1';
    tab.addEventListener('click', () => handleTabClick(def.tab));
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
    mobileMq = window.matchMedia(MOBILE_DESKTOP_MQ);
    mobileMqListener = () => syncRailBackdrop();
    mobileMq.addEventListener('change', mobileMqListener);
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
  void refreshDesktopWorkspaceDrawerPath();
  void syncDesktopWorkspaceMounts();
}

/** Load desktop workspace path label into the drawer header. */
export async function refreshDesktopWorkspaceDrawerPath(): Promise<void> {
  const el = document.getElementById('desktopWorkspaceDrawerPath');
  if (!el) return;
  const { getDesktopWorkspacePath } = await import('../lib/desktop-workspace');
  const path = await getDesktopWorkspacePath();
  if (path) el.textContent = path;
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
