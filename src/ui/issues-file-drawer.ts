/**
 * File-tree drawer while the fullscreen Issues app is foreground.
 *
 * Code owns `#fileSidebar` inside `#appBody`, which is hidden when another app
 * is active. Reparent the sidebar to `document.body` as a fixed right dock so
 * workspace files stay reachable for capture drags and attachment drops.
 */

import '../styles/issues-file-drawer.css';

import { getForegroundAppId, subscribeInstances } from '../os/instances';
import { patchFilePanelState, getFilePanelState } from '../state/file-panel';
import { initFileTreeIfNeeded } from './file-tree';
import { applyFileSidebarVisuals } from './file-layout';

type Listener = () => void;

let sidebarHome: { parent: HTMLElement; nextSibling: ChildNode | null } | null = null;
let drawerOpen = false;
let bound = false;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      /* ignore */
    }
  }
}

/** Subscribe to drawer open/close (for chrome toggle state). */
export function subscribeIssuesFileDrawer(listener: Listener): () => void {
  listeners.add(listener);
  listener();
  return () => {
    listeners.delete(listener);
  };
}

/** True when the Issues file drawer is mounted over the Issues app. */
export function isIssuesFileDrawerOpen(): boolean {
  return drawerOpen;
}

function rememberSidebarHome(sidebar: HTMLElement): void {
  if (sidebarHome) return;
  const parent = sidebar.parentElement;
  if (!parent) return;
  sidebarHome = { parent, nextSibling: sidebar.nextSibling };
}

function restoreSidebarHome(): void {
  const sidebar = document.getElementById('fileSidebar');
  if (!sidebar || !sidebarHome) return;
  const { parent, nextSibling } = sidebarHome;
  if (nextSibling && nextSibling.parentElement === parent) {
    parent.insertBefore(sidebar, nextSibling);
  } else {
    parent.appendChild(sidebar);
  }
  sidebar.classList.remove('file-sidebar--issues-drawer');
  sidebarHome = null;
}

/** Close the drawer and restore the sidebar to the Code workspace. */
export function closeIssuesFileDrawer(): void {
  if (!drawerOpen) return;
  drawerOpen = false;
  document.documentElement.classList.remove('issues-file-drawer-open');
  restoreSidebarHome();
  applyFileSidebarVisuals();
  emit();
}

/** Open the drawer when Issues is foreground; no-op otherwise. */
export async function openIssuesFileDrawer(): Promise<void> {
  if (drawerOpen) return;
  if (getForegroundAppId() !== 'issues') return;

  const sidebar = document.getElementById('fileSidebar');
  if (!sidebar) return;

  rememberSidebarHome(sidebar);
  document.body.appendChild(sidebar);
  sidebar.classList.add('file-sidebar--issues-drawer');

  if (getFilePanelState().fileSidebarCollapsed) {
    patchFilePanelState({ fileSidebarCollapsed: false });
  }

  await initFileTreeIfNeeded();
  applyFileSidebarVisuals();

  drawerOpen = true;
  document.documentElement.classList.add('issues-file-drawer-open');
  emit();
}

/** Toggle the Issues file drawer. */
export function toggleIssuesFileDrawer(): void {
  if (drawerOpen) {
    closeIssuesFileDrawer();
    return;
  }
  void openIssuesFileDrawer();
}

/** Wire auto-close when leaving Issues (once). */
export function initIssuesFileDrawer(): void {
  if (bound) return;
  bound = true;

  subscribeInstances(() => {
    if (drawerOpen && getForegroundAppId() !== 'issues') {
      closeIssuesFileDrawer();
    }
  });
}

/** Reset module state (tests). */
export function resetIssuesFileDrawerForTests(): void {
  closeIssuesFileDrawer();
  bound = false;
  listeners.clear();
}
