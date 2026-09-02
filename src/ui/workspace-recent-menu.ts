import {
  fetchWorkspace,
  removeRecentWorkspace,
  type WorkspaceRecentItem,
} from '../config/workspace-api';
import { getWorkspaceRecentItems, setWorkspaceFromServer } from '../state/workspace';
import {
  registerChromePopover,
  unregisterChromePopover,
} from './preview-electron-visibility';
export type WorkspaceMenuStatusState = 'ok' | 'err' | 'spin';

/** Injectable deps so tests avoid importing tools/config or status chains. */
export interface WorkspaceMenuDeps {
  isServerAvailable: () => boolean;
  reportStatus: (state: WorkspaceMenuStatusState, msg: string) => void;
}

let menuDeps: WorkspaceMenuDeps = {
  isServerAvailable: () => false,
  reportStatus: () => {},
};

/** Wire server detection and status from workspace-button at init. */
export function setWorkspaceMenuDeps(partial: Partial<WorkspaceMenuDeps>): void {
  menuDeps = { ...menuDeps, ...partial };
}

let menuEl: HTMLUListElement | null = null;
let anchorBtn: HTMLButtonElement | null = null;
let menuOpen = false;
let outsidePointerHandler: ((e: PointerEvent) => void) | null = null;
let escapeHandler: ((e: KeyboardEvent) => void) | null = null;

export type WorkspaceSelectHandler = (absPath: string) => Promise<void>;
export type OpenNewWorkspaceHandler = () => Promise<void>;

let onSelectWorkspace: WorkspaceSelectHandler | null = null;
let onOpenNew: OpenNewWorkspaceHandler | null = null;

/** Wire callbacks from workspace-button (shared post-switch refresh). */
export function configureWorkspaceRecentMenu(handlers: {
  onSelectWorkspace: WorkspaceSelectHandler;
  onOpenNew: OpenNewWorkspaceHandler;
}): void {
  onSelectWorkspace = handlers.onSelectWorkspace;
  onOpenNew = handlers.onOpenNew;
}

function ensureMenu(): HTMLUListElement {
  if (menuEl) return menuEl;

  menuEl = document.createElement('ul');
  menuEl.id = 'workspaceMenu';
  menuEl.className = 'workspace-menu hidden';
  menuEl.setAttribute('role', 'menu');
  document.body.appendChild(menuEl);
  return menuEl;
}

/** Position the menu below the anchor, right-aligned so it opens left (top-right control). */
function positionMenu(btn: HTMLButtonElement, menu: HTMLElement): void {
  const rect = btn.getBoundingClientRect();
  const margin = 8;
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.right = 'auto';

  const menuWidth = menu.offsetWidth || menu.getBoundingClientRect().width;
  let left = rect.right - menuWidth;
  left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));
  menu.style.left = `${left}px`;
}

function setAnchorExpanded(expanded: boolean): void {
  if (!anchorBtn) return;
  anchorBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

function detachGlobalListeners(): void {
  if (outsidePointerHandler) {
    document.removeEventListener('pointerdown', outsidePointerHandler, true);
    outsidePointerHandler = null;
  }
  if (escapeHandler) {
    document.removeEventListener('keydown', escapeHandler, true);
    escapeHandler = null;
  }
}

/** Close the popover and clear listeners. */
export function closeWorkspaceMenu(): void {
  if (!menuOpen) return;
  menuOpen = false;
  unregisterChromePopover();
  detachGlobalListeners();
  if (menuEl) menuEl.classList.add('hidden');
  setAnchorExpanded(false);
}

/** Whether the recent workspaces menu is open. */
export function isWorkspaceMenuOpen(): boolean {
  return menuOpen;
}

function attachGlobalListeners(): void {
  outsidePointerHandler = (e: PointerEvent) => {
    const target = e.target as Node | null;
    if (!menuEl || !anchorBtn) return;
    if (menuEl.contains(target) || anchorBtn.contains(target)) return;
    closeWorkspaceMenu();
  };
  document.addEventListener('pointerdown', outsidePointerHandler, true);

  escapeHandler = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    closeWorkspaceMenu();
  };
  document.addEventListener('keydown', escapeHandler, true);
}

function createRecentRow(item: WorkspaceRecentItem): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'workspace-menu__item';
  li.setAttribute('role', 'menuitem');
  if (!item.exists) {
    li.classList.add('workspace-menu__item--disabled');
    li.setAttribute('aria-disabled', 'true');
  }
  if (item.isCurrent) {
    li.setAttribute('aria-current', 'true');
  }

  const check = document.createElement('span');
  check.className = 'workspace-menu__check';
  check.textContent = item.isCurrent ? '✓' : '';
  check.setAttribute('aria-hidden', 'true');

  const label = document.createElement('span');
  label.className = 'workspace-menu__label';
  label.textContent = item.label;

  const pathLine = document.createElement('span');
  pathLine.className = 'workspace-menu__path';
  pathLine.textContent = item.path;
  li.title = item.path;

  li.appendChild(check);
  li.appendChild(label);
  li.appendChild(pathLine);

  if (!item.exists) {
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'workspace-menu__remove';
    removeBtn.setAttribute('aria-label', `Remove ${item.label} from recent workspaces`);
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void (async () => {
        try {
          await removeRecentWorkspace(item.path);
          await renderMenuList();
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          menuDeps.reportStatus('err', message);
        }
      })();
    });
    li.appendChild(removeBtn);

    li.addEventListener('click', () => {
      menuDeps.reportStatus('err', 'Workspace folder no longer exists');
    });
    return li;
  }

  li.addEventListener('click', () => {
    if (item.isCurrent) {
      closeWorkspaceMenu();
      return;
    }
    void selectRecentWorkspace(item.path);
  });

  return li;
}

async function selectRecentWorkspace(absPath: string): Promise<void> {
  closeWorkspaceMenu();
  if (!onSelectWorkspace) return;
  menuDeps.reportStatus('spin', 'Switching workspace…');
  try {
    await onSelectWorkspace(absPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    menuDeps.reportStatus('err', message);
  }
}

/** Paint MRU rows plus footer actions into the menu element. */
function paintWorkspaceMenuList(menu: HTMLUListElement, recent: WorkspaceRecentItem[]): void {
  menu.innerHTML = '';

  for (const item of recent) {
    menu.appendChild(createRecentRow(item));
  }

  const divider = document.createElement('li');
  divider.className = 'workspace-menu__divider';
  divider.setAttribute('role', 'separator');
  menu.appendChild(divider);

  const openLi = document.createElement('li');
  openLi.setAttribute('role', 'none');
  const openBtn = document.createElement('button');
  openBtn.type = 'button';
  openBtn.className = 'workspace-menu__action';
  openBtn.setAttribute('role', 'menuitem');
  openBtn.textContent = 'Open new workspace…';
  openBtn.addEventListener('click', () => {
    closeWorkspaceMenu();
    void onOpenNew?.();
  });
  openLi.appendChild(openBtn);
  menu.appendChild(openLi);
}

/** Re-fetch workspace and paint MRU rows. */
export async function renderMenuList(): Promise<void> {
  const menu = ensureMenu();
  const cached = getWorkspaceRecentItems();
  if (cached.length > 0) {
    paintWorkspaceMenuList(menu, [...cached]);
  }

  const info = await fetchWorkspace();
  if (info) {
    setWorkspaceFromServer(info);
  }
  const recent = info?.recent ?? [...cached];
  paintWorkspaceMenuList(menu, [...recent]);
}

/** Open or close the menu for tests and the top bar button. */
export async function toggleWorkspaceMenu(btn: HTMLButtonElement): Promise<void> {
  if (!menuDeps.isServerAvailable()) {
    menuDeps.reportStatus('err', 'Workspace requires Minnow running locally');
    return;
  }

  if (menuOpen) {
    closeWorkspaceMenu();
    return;
  }

  anchorBtn = btn;
  const menu = ensureMenu();
  const cached = getWorkspaceRecentItems();
  if (cached.length > 0) {
    paintWorkspaceMenuList(menu, [...cached]);
    menu.classList.remove('hidden');
    positionMenu(btn, menu);
    menuOpen = true;
    registerChromePopover();
    setAnchorExpanded(true);
    attachGlobalListeners();
    void renderMenuList();
    return;
  }

  await renderMenuList();
  menu.classList.remove('hidden');
  positionMenu(btn, menu);
  menuOpen = true;
  registerChromePopover();
  setAnchorExpanded(true);
  attachGlobalListeners();
}

/** Test helper — render list into menu without opening. */
export async function renderWorkspaceMenuForTest(container?: HTMLElement): Promise<void> {
  if (container) {
    menuEl = container as HTMLUListElement;
    menuEl.className = 'workspace-menu';
    menuEl.setAttribute('role', 'menu');
  }
  await renderMenuList();
}

/** Reset module singletons between workspace menu tests. */
export function resetWorkspaceMenuForTests(): void {
  closeWorkspaceMenu();
  detachGlobalListeners();
  menuEl = null;
  anchorBtn = null;
  menuOpen = false;
  outsidePointerHandler = null;
  escapeHandler = null;
}
