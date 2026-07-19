/**
 * Source Control Center lightbox: repo topology tree + full git operations.
 */

import {
  registerChromePopover,
  unregisterChromePopover,
} from './preview-electron-visibility';
import {
  buildTopologyTree,
  defaultExpandedIds,
  renderTopologyTree,
  type TopologyNode,
  type TopologyTreeModel,
} from './git-repo-topology';
import {
  createGitOperationsPanel,
  type GitOperationsPanelHandle,
} from './git-operations-panel';
import { confirmDirtyCheckout } from './git-checkout-confirm';
import {
  gitBranches,
  gitCheckout,
  gitFetch,
  gitPull,
  gitPush,
  type GitOpResult,
} from '../state/git-api';
import { getWorkspacePath } from '../state/workspace';
import { resolvePanelWorktreeCwd, panelPathsEqual } from './panel-worktree-cwd';
import {
  getGitPanelCwd,
  refreshGitPanel,
  setGitPanelCwd,
} from './git-panel';
import { showToast } from './toast';
import {
  openCherryPickDialog,
  openMergeDialog,
  openRebaseDialog,
  openStashMenuDialog,
  openStashPushDialog,
} from './git-advanced-actions';
import { filterUserFacingBranches } from '../lib/worktree-list-parse';
import { decorateGitSourceControlButton } from './git-source-control-icons';

const OVERLAY_ID = 'gitCenterLightboxOverlay';
const DIALOG_ID = 'gitCenterLightbox';
const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

let overlayEl: HTMLDivElement | null = null;
let dialogEl: HTMLDivElement | null = null;
let topologyMount: HTMLElement | null = null;
let opsMount: HTMLElement | null = null;
let conflictHost: HTMLElement | null = null;
let repoTitleEl: HTMLElement | null = null;
let opsPanel: GitOperationsPanelHandle | null = null;

let panelCwd: string | undefined;
let selectedNodeId: string | null = null;
let expandedIds = new Set<string>();
let topologyModel: TopologyTreeModel | null = null;
let isOpen = false;
let previousFocus: HTMLElement | null = null;
let escapeHandler: ((e: KeyboardEvent) => void) | null = null;
let chromePopoverRegistered = false;
let toolbarBusy = false;
let pollTimer: number | undefined;

/** Whether the Git Center lightbox is open. */
export function isGitCenterLightboxOpen(): boolean {
  return isOpen;
}

function getEffectiveCwd(): string | undefined {
  return resolvePanelWorktreeCwd(panelCwd);
}

function createIconBtn(label: string, title: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'git-center-toolbar-btn';
  btn.title = title;
  btn.setAttribute('aria-label', title);
  decorateGitSourceControlButton(btn, label);
  return btn;
}

function setToolbarBusy(busy: boolean): void {
  toolbarBusy = busy;
  const toolbar = dialogEl?.querySelector('.git-center-toolbar');
  if (!toolbar) return;
  for (const btn of toolbar.querySelectorAll('button')) {
  (btn as HTMLButtonElement).disabled = busy;
  }
}

async function runToolbarOp(
  fn: () => Promise<GitOpResult>,
  successMessage: string,
  activeBtn?: HTMLButtonElement,
): Promise<void> {
  if (toolbarBusy) return;
  setToolbarBusy(true);
  if (activeBtn) activeBtn.classList.add('is-busy');
  try {
    const result = await fn();
    if (!result.ok) {
      showToast(result.error ?? 'Operation failed', 'error');
      return;
    }
    showToast(successMessage, 'success');
    await refreshAll();
  } finally {
    if (activeBtn) activeBtn.classList.remove('is-busy');
    setToolbarBusy(false);
  }
}

async function syncSidebarAndFileTree(): Promise<void> {
  setGitPanelCwd(panelCwd);
  await refreshGitPanel();
  const { syncFileTreeToPanelWorktree } = await import('./file-tree');
  await syncFileTreeToPanelWorktree(panelCwd);
}

async function refreshTopology(): Promise<void> {
  if (!topologyMount) return;
  topologyModel = await buildTopologyTree();
  if (repoTitleEl) {
    repoTitleEl.textContent = topologyModel.repoName || 'Repository';
  }
  if (expandedIds.size === 0) {
    expandedIds = defaultExpandedIds(topologyModel);
  }
  renderTopologyTree(topologyMount, topologyModel, {
    selectedId: selectedNodeId,
    expandedIds,
    onSelect: (node) => void handleNodeSelect(node),
    onToggleExpand: (id) => {
      if (expandedIds.has(id)) expandedIds.delete(id);
      else expandedIds.add(id);
      renderTopologyTree(topologyMount!, topologyModel!, {
        selectedId: selectedNodeId,
        expandedIds,
        onSelect: (node) => void handleNodeSelect(node),
        onToggleExpand: (id2) => {
          if (expandedIds.has(id2)) expandedIds.delete(id2);
          else expandedIds.add(id2);
          void refreshTopology();
        },
        onContextMenu: (node, e) => showNodeContextMenu(node, e),
        onDoubleClick: (node) => void handleNodeDoubleClick(node),
      });
    },
    onContextMenu: (node, e) => showNodeContextMenu(node, e),
    onDoubleClick: (node) => void handleNodeDoubleClick(node),
  });
}

async function refreshAll(): Promise<void> {
  await refreshTopology();
  await opsPanel?.refresh();
  await syncSidebarAndFileTree();
}

async function handleNodeSelect(node: TopologyNode): Promise<void> {
  selectedNodeId = node.id;
  if (node.cwd) {
    panelCwd = node.cwd;
  } else if (node.branch) {
    // Branch-only node: keep cwd on main workspace for checkout target context.
    const ws = getWorkspacePath().trim();
    panelCwd = ws || undefined;
  }
  await refreshTopology();
  await opsPanel?.refresh();
  await syncSidebarAndFileTree();
  if (node.dirty) {
    opsPanel?.setTab('changes');
  }
}

async function handleNodeDoubleClick(node: TopologyNode): Promise<void> {
  if (node.kind === 'branch' && node.branch) {
    const cwd = getEffectiveCwd();
    if (!(await confirmDirtyCheckout(cwd))) return;
    await runToolbarOp(
      () => gitCheckout({ branch: node.branch!, cwd }),
      `Switched to ${node.branch}`,
    );
  }
}

function showNodeContextMenu(node: TopologyNode, event: MouseEvent): void {
  const items: { label: string; action: () => void }[] = [];
  if (node.kind === 'branch' && node.branch) {
    items.push({
      label: 'Checkout',
      action: () => void handleNodeDoubleClick(node),
    });
    items.push({
      label: 'Delete branch',
      action: () => {
        opsPanel?.setTab('branches');
        void opsPanel?.refresh();
      },
    });
  }
  if (node.cwd && !panelPathsEqual(node.cwd, getWorkspacePath().trim())) {
    items.push({
      label: 'Select worktree',
      action: () => void handleNodeSelect(node),
    });
  }
  if (node.branch && node.cwd) {
    items.push({
      label: 'Merge into current',
      action: () => void openMergeForBranch(node.branch!),
    });
  }
  if (items.length === 0) return;
  const menu = document.createElement('div');
  menu.className = 'git-topology-context-menu';
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'git-topology-context-menu__item';
    btn.textContent = item.label;
    btn.addEventListener('click', () => {
      menu.remove();
      item.action();
    });
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);
  const close = (): void => {
    menu.remove();
    document.removeEventListener('click', close, true);
  };
  setTimeout(() => document.addEventListener('click', close, true), 0);
}

async function openMergeForBranch(branch: string): Promise<void> {
  const ctx = {
    cwd: getEffectiveCwd(),
    onSuccess: () => void refreshAll(),
    onConflict: () => {},
  };
  const result = await import('../state/git-api').then((m) =>
    m.gitMerge({ branch, cwd: ctx.cwd }),
  );
  if (!result.ok) {
    if (result.conflict && conflictHost) {
      const { renderConflictAlert } = await import('./git-advanced-actions');
      renderConflictAlert(conflictHost, 'merge', result.error ?? 'Conflict', ctx);
    } else if (conflictHost) {
      const { renderMergeErrorAlert } = await import('./git-advanced-actions');
      renderMergeErrorAlert(conflictHost, result.error ?? 'Merge failed', ctx);
      showToast(result.error ?? 'Merge failed', 'error');
    } else {
      showToast(result.error ?? 'Merge failed', 'error');
    }
    return;
  }
  showToast(`Merged ${branch}`, 'success');
  await refreshAll();
}

function buildToolbar(): HTMLElement {
  const toolbar = document.createElement('div');
  toolbar.className = 'git-center-toolbar';

  const pullBtn = createIconBtn('Pull', 'Pull');
  pullBtn.addEventListener('click', () =>
    void runToolbarOp(() => gitPull(getEffectiveCwd()), 'Pulled changes', pullBtn),
  );

  const pushBtn = createIconBtn('Push', 'Push');
  pushBtn.addEventListener('click', () =>
    void runToolbarOp(() => gitPush({ cwd: getEffectiveCwd() }), 'Pushed changes', pushBtn),
  );

  const fetchBtn = createIconBtn('Fetch', 'Fetch all remotes');
  fetchBtn.addEventListener('click', () =>
    void runToolbarOp(() => gitFetch(getEffectiveCwd()), 'Fetched remotes', fetchBtn),
  );

  const mergeBtn = createIconBtn('Merge', 'Merge branch');
  mergeBtn.addEventListener('click', () => void openMergeFromToolbar());

  const rebaseBtn = createIconBtn('Rebase', 'Rebase onto');
  rebaseBtn.addEventListener('click', () => void openRebaseFromToolbar());

  const stashBtn = createIconBtn('Stash', 'Stash menu');
  stashBtn.addEventListener('click', () => void openStashFromToolbar());

  const cherryBtn = createIconBtn('Cherry-pick', 'Cherry-pick commit');
  cherryBtn.addEventListener('click', () => void openCherryFromToolbar());

  toolbar.append(pullBtn, pushBtn, fetchBtn, mergeBtn, rebaseBtn, stashBtn, cherryBtn);
  return toolbar;
}

async function getLocalBranches(): Promise<string[]> {
  const result = await gitBranches(getEffectiveCwd());
  if (!result.ok) return [];
  return filterUserFacingBranches(result.local ?? []);
}

async function openMergeFromToolbar(): Promise<void> {
  const branches = await getLocalBranches();
  const ctx = {
    cwd: getEffectiveCwd(),
    onSuccess: () => void refreshAll(),
  };
  await openMergeDialog(branches, ctx, conflictHost!);
}

async function openRebaseFromToolbar(): Promise<void> {
  const branches = await getLocalBranches();
  const ctx = {
    cwd: getEffectiveCwd(),
    onSuccess: () => void refreshAll(),
  };
  await openRebaseDialog(branches, ctx, conflictHost!);
}

async function openStashFromToolbar(): Promise<void> {
  const ctx = { cwd: getEffectiveCwd(), onSuccess: () => void refreshAll() };
  const action = window.confirm('OK = Stash changes, Cancel = Stash list (pop/apply/drop)');
  if (action) await openStashPushDialog(ctx);
  else await openStashMenuDialog(ctx, conflictHost!);
}

async function openCherryFromToolbar(): Promise<void> {
  const ctx = { cwd: getEffectiveCwd(), onSuccess: () => void refreshAll() };
  await openCherryPickDialog(ctx, conflictHost!);
}

function trapFocus(e: KeyboardEvent): void {
  if (!dialogEl || e.key !== 'Tab') return;
  const nodes = [...dialogEl.querySelectorAll(FOCUSABLE)].filter(
    (el) => !(el as HTMLButtonElement).disabled && (el as HTMLElement).offsetParent !== null,
  ) as HTMLElement[];
  if (nodes.length < 2) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function handleTreeKeyboard(e: KeyboardEvent): void {
  if (!topologyMount || !isOpen) return;
  const rows = [...topologyMount.querySelectorAll('.git-topology-row')];
  const idx = rows.findIndex((r) => r.classList.contains('is-selected'));
  if (e.key === 'ArrowDown' && idx < rows.length - 1) {
    e.preventDefault();
    (rows[idx + 1] as HTMLElement).click();
  } else if (e.key === 'ArrowUp' && idx > 0) {
    e.preventDefault();
    (rows[idx - 1] as HTMLElement).click();
  }
}

function ensureShell(): void {
  if (overlayEl && dialogEl) return;

  overlayEl = document.createElement('div');
  overlayEl.id = OVERLAY_ID;
  overlayEl.className = 'git-center-overlay hidden';
  overlayEl.hidden = true;

  dialogEl = document.createElement('div');
  dialogEl.id = DIALOG_ID;
  dialogEl.className = 'git-center-lightbox';
  dialogEl.setAttribute('role', 'dialog');
  dialogEl.setAttribute('aria-modal', 'true');
  dialogEl.setAttribute('aria-labelledby', 'gitCenterTitle');
  dialogEl.tabIndex = -1;

  const header = document.createElement('header');
  header.className = 'git-center-header';
  const titleWrap = document.createElement('div');
  titleWrap.className = 'git-center-header__titles';
  const title = document.createElement('h2');
  title.id = 'gitCenterTitle';
  title.className = 'git-center-header__title';
  title.textContent = 'Source Control Center';
  repoTitleEl = document.createElement('span');
  repoTitleEl.className = 'git-center-header__repo';
  titleWrap.append(title, repoTitleEl);

  const headerActions = document.createElement('div');
  headerActions.className = 'git-center-header__actions';
  const fetchAllBtn = createIconBtn('Fetch all', 'Fetch all remotes');
  fetchAllBtn.addEventListener('click', () =>
    void runToolbarOp(() => gitFetch(getEffectiveCwd()), 'Fetched all remotes', fetchAllBtn),
  );
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'icon-btn git-center-close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.innerHTML =
    '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  closeBtn.addEventListener('click', () => closeGitCenterLightbox());
  headerActions.append(fetchAllBtn, closeBtn);
  header.append(titleWrap, headerActions);

  const body = document.createElement('div');
  body.className = 'git-center-body';

  const leftRail = document.createElement('aside');
  leftRail.className = 'git-center-rail';
  leftRail.setAttribute('aria-label', 'Repository topology');
  topologyMount = document.createElement('div');
  topologyMount.className = 'git-center-topology';
  leftRail.appendChild(topologyMount);

  const rightPane = document.createElement('div');
  rightPane.className = 'git-center-main';
  const toolbar = buildToolbar();
  conflictHost = document.createElement('div');
  conflictHost.className = 'git-center-conflict-host';
  opsMount = document.createElement('div');
  opsMount.className = 'git-center-ops';
  rightPane.append(toolbar, conflictHost, opsMount);

  body.append(leftRail, rightPane);
  dialogEl.append(header, body);
  overlayEl.appendChild(dialogEl);
  document.body.appendChild(overlayEl);

  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeGitCenterLightbox();
  });
}

function startPolling(): void {
  stopPolling();
  pollTimer = window.setInterval(() => {
    void refreshAll();
  }, 5000);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

function detachListeners(): void {
  if (escapeHandler) {
    document.removeEventListener('keydown', escapeHandler, true);
    escapeHandler = null;
  }
  document.removeEventListener('keydown', handleTreeKeyboard, true);
  document.removeEventListener('keydown', trapFocus, true);
}

/** Open the Git Center lightbox. */
export async function openGitCenterLightbox(): Promise<void> {
  ensureShell();
  if (isOpen) return;

  previousFocus =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;

  panelCwd = getGitPanelCwd() ?? (getWorkspacePath().trim() || undefined);
  selectedNodeId = panelCwd ? `wt:${panelCwd}` : null;
  expandedIds = new Set();

  if (!opsPanel && opsMount) {
    opsPanel = createGitOperationsPanel(opsMount, {
      layout: 'tabbed',
      getPanelCwd: () => panelCwd,
      onAfterGitOp: () => void refreshAll(),
      initialTab: 'changes',
      conflictHost,
    });
  }

  isOpen = true;
  overlayEl!.hidden = false;
  overlayEl!.classList.remove('hidden');
  document.getElementById('btnGitCenter')?.classList.add('is-active');
  registerChromePopover();
  chromePopoverRegistered = true;
  dialogEl!.focus();

  escapeHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeGitCenterLightbox();
    }
  };
  document.addEventListener('keydown', escapeHandler, true);
  document.addEventListener('keydown', trapFocus, true);
  document.addEventListener('keydown', handleTreeKeyboard, true);

  await refreshAll();
  startPolling();
}

/** Close the Git Center lightbox and restore focus. */
export function closeGitCenterLightbox(): void {
  if (!isOpen) return;
  isOpen = false;
  stopPolling();
  detachListeners();
  document.getElementById('btnGitCenter')?.classList.remove('is-active');
  overlayEl!.hidden = true;
  overlayEl!.classList.add('hidden');
  if (chromePopoverRegistered) {
    unregisterChromePopover();
    chromePopoverRegistered = false;
  }
  previousFocus?.focus();
  previousFocus = null;
  void refreshGitPanel();
}

/** Wire the header button entry point. */
export function initGitCenterLightbox(): void {
  ensureShell();
  const btn = document.getElementById('btnGitCenter');
  btn?.addEventListener('click', () => void openGitCenterLightbox());
}

/** Sync cwd from sidebar git panel when lightbox is open. */
export function syncGitCenterFromPanel(): void {
  if (!isOpen) return;
  panelCwd = getGitPanelCwd();
  void refreshAll();
}

/** Reset module state (tests). */
export function resetGitCenterLightboxForTests(): void {
  closeGitCenterLightbox();
  opsPanel?.destroy();
  opsPanel = null;
  overlayEl?.remove();
  overlayEl = null;
  dialogEl = null;
  topologyMount = null;
  opsMount = null;
  conflictHost = null;
  panelCwd = undefined;
  selectedNodeId = null;
  expandedIds = new Set();
  topologyModel = null;
}
