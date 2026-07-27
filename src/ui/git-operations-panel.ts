import { appAlert, appConfirm, appPrompt } from './app-dialog';
/**
 * Shared git operations UI: changes, commit, history graph, branches tab.
 * Used by the sidebar git panel and the Git Center lightbox.
 */

import {
  filterUserFacingBranches,
} from '../lib/worktree-list-parse';
import { isProtectedBranchName } from '../lib/git-trunk-branch';
import {
  gitBranches,
  gitCheckout,
  gitCommit,
  gitDeleteBranch,
  gitDiff,
  gitDiscard,
  gitPush,
  gitStage,
  gitStatus,
  gitUnstage,
  type GitFileEntry,
  type GitOpResult,
} from '../state/git-api';
import { getWorkspacePath } from '../state/workspace';
import { resolvePanelWorktreeCwd } from './panel-worktree-cwd';
import { renderGitGraph, type GitGraphOptions } from './git-graph';
import {
  showGitGraphCommitContextMenu,
  type GitGraphContextMenuCtx,
} from './git-graph-context-menu';
import { createIcon } from './icon';
import { parseUnifiedPatchToDiffLines } from './git-patch-parse';
import { renderUnifiedPromptDiff } from './prompt-diff-unified';
import {
  closeGitCommitDiffPanel,
  getOpenGitCommitDiffSha,
  GIT_COMMIT_DIFF_CLOSED_EVENT,
  openGitCommitDiffPanel,
} from './git-commit-diff-panel';
import { fetchGitCommitMessage } from './git-commit-message-client';
import { showToast } from './toast';
import {
  isMissingGitRepositoryError,
  renderGitNoRepositoryState,
} from './git-no-repo-state';
import {
  closeGitPanelNamePopover,
  openGitPanelNamePopover,
} from './git-panel-name-popover';
import {
  renderGitStatusWithSendToChat,
  type GitErrorChatContext,
  type GitErrorChatKind,
} from './git-error-to-chat';

export type GitOpsTab = 'changes' | 'history' | 'branches';

export interface GitOperationsPanelOptions {
  /** Stacked (sidebar) or tabbed (lightbox). */
  layout: 'stacked' | 'tabbed';
  /** Resolve effective cwd for git API calls. */
  getPanelCwd: () => string | undefined;
  /** Called after successful git mutations (sync file tree, topology, etc.). */
  onAfterGitOp?: () => void;
  initialTab?: GitOpsTab;
  /** Conflict alert host (Git Center lightbox). */
  conflictHost?: HTMLElement | null;
}

export interface GitOperationsPanelHandle {
  root: HTMLElement;
  refresh: () => Promise<void>;
  setTab: (tab: GitOpsTab) => void;
  getTab: () => GitOpsTab;
  destroy: () => void;
}

type CommitActionKind = 'commit' | 'commit-push';

function statusBadgeLetter(status: string): string {
  if (status === '?') return '?';
  if (status === 'A' || status === 'M' || status === 'D' || status === 'R' || status === 'C') {
    return status;
  }
  return status.slice(0, 1).toUpperCase() || 'M';
}

/** Mount shared git operations UI into `mount`. */
export function createGitOperationsPanel(
  mount: HTMLElement,
  options: GitOperationsPanelOptions,
): GitOperationsPanelHandle {
  let activeTab: GitOpsTab = options.initialTab ?? 'changes';
  let commitBusy = false;
  let generateMessageAbort: AbortController | null = null;
  let expandedDiffPath: string | null = null;
  let expandedDiffStaged = false;
  let selectedCommitSha: string | null = null;
  let graphHandle: ReturnType<typeof renderGitGraph> | null = null;
  let currentBranchName = '';
  const graphOptions: GitGraphOptions = {};
  let refreshing = false;

  const root = document.createElement('div');
  root.className = 'git-ops-panel';

  const tabBar = document.createElement('div');
  tabBar.className = 'git-ops-panel__tabs';
  tabBar.hidden = options.layout === 'stacked';
  tabBar.setAttribute('role', 'tablist');

  const tabButtons: Partial<Record<GitOpsTab, HTMLButtonElement>> = {};
  for (const tab of ['changes', 'history', 'branches'] as const) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'git-ops-panel__tab';
    btn.setAttribute('role', 'tab');
    btn.dataset.tab = tab;
    btn.textContent =
      tab === 'changes' ? 'Changes' : tab === 'history' ? 'History' : 'Branches';
    btn.addEventListener('click', () => setTab(tab));
    tabButtons[tab] = btn;
    tabBar.appendChild(btn);
  }

  const panes = document.createElement('div');
  panes.className = 'git-ops-panel__panes';

  const changesPane = document.createElement('div');
  changesPane.className = 'git-ops-panel__pane git-ops-panel__pane--changes';
  changesPane.dataset.pane = 'changes';

  const statusWrap = document.createElement('div');
  statusWrap.className = 'git-panel-status-wrap';
  statusWrap.setAttribute('role', 'status');
  statusWrap.setAttribute('aria-live', 'polite');
  statusWrap.hidden = true;

  const statusEl = document.createElement('p');
  statusEl.className = 'git-panel-status';
  statusWrap.appendChild(statusEl);

  const noRepoMount = document.createElement('div');
  noRepoMount.className = 'git-ops-panel__no-repo-mount';
  noRepoMount.hidden = true;

  const commitBox = document.createElement('div');
  commitBox.className = 'git-panel-commit-box';
  const commitInput = document.createElement('textarea');
  commitInput.className = 'git-panel-commit-input';
  commitInput.placeholder = 'Commit message';
  commitInput.rows = 3;
  commitInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleCommit(false);
    }
  });

  const commitActions = document.createElement('div');
  commitActions.className = 'git-panel-commit-actions';
  const aiGenerateBtn = document.createElement('button');
  aiGenerateBtn.type = 'button';
  aiGenerateBtn.className = 'git-panel-action-btn git-panel-action-btn--ai git-panel-action-btn--icon';
  aiGenerateBtn.title = 'Generate commit message with AI';
  aiGenerateBtn.setAttribute('aria-label', 'Generate commit message with AI');
  aiGenerateBtn.append(createIcon('sparkles', { className: 'icon-svg git-panel-action-btn__icon', size: 12 }));
  aiGenerateBtn.addEventListener('click', () => void handleGenerateCommitMessage());

  const commitBtn = document.createElement('button');
  commitBtn.type = 'button';
  commitBtn.className = 'git-panel-action-btn git-panel-action-btn--primary';
  commitBtn.textContent = 'Commit';
  commitBtn.addEventListener('click', () => void handleCommit(false));

  const commitPushBtn = document.createElement('button');
  commitPushBtn.type = 'button';
  commitPushBtn.className = 'git-panel-action-btn';
  commitPushBtn.textContent = 'Commit & Push';
  commitPushBtn.addEventListener('click', () => void handleCommit(true));

  commitActions.append(commitBtn, commitPushBtn, aiGenerateBtn);
  commitBox.append(commitInput, commitActions);

  const bodyMount = document.createElement('div');
  bodyMount.className = 'git-panel-sections';

  const diffHost = document.createElement('div');
  diffHost.className = 'git-panel-diff-host';
  diffHost.hidden = true;

  changesPane.append(statusWrap, noRepoMount, commitBox, bodyMount, diffHost);

  const historyPane = document.createElement('div');
  historyPane.className = 'git-ops-panel__pane git-ops-panel__pane--history';
  historyPane.dataset.pane = 'history';
  historyPane.hidden = options.layout === 'tabbed';

  const graphMount = document.createElement('div');
  graphMount.className = 'git-panel-graph-mount';
  historyPane.appendChild(graphMount);

  const branchesPane = document.createElement('div');
  branchesPane.className = 'git-ops-panel__pane git-ops-panel__pane--branches';
  branchesPane.dataset.pane = 'branches';
  branchesPane.hidden = true;

  const branchList = document.createElement('div');
  branchList.className = 'git-ops-panel__branch-list';
  branchesPane.appendChild(branchList);

  panes.append(changesPane, historyPane, branchesPane);
  root.append(tabBar, panes);
  mount.appendChild(root);

  function getEffectiveCwd(): string | undefined {
    return resolvePanelWorktreeCwd(options.getPanelCwd());
  }

  function setGitOpsNoRepoState(active: boolean): void {
    root.classList.toggle('git-ops-panel--no-repo', active);
    noRepoMount.hidden = !active;
    if (active) renderGitNoRepositoryState(noRepoMount);
    else noRepoMount.replaceChildren();
  }

  function gitErrorChatContext(): GitErrorChatContext {
    return {
      cwd: (getEffectiveCwd() ?? getWorkspacePath().trim()) || undefined,
      branch: currentBranchName || undefined,
    };
  }

  function setStatus(message: string, isError = false, sendToChat?: GitErrorChatKind): void {
    renderGitStatusWithSendToChat(
      statusWrap,
      statusEl,
      message,
      isError,
      sendToChat,
      gitErrorChatContext(),
    );
  }

  function setTab(tab: GitOpsTab): void {
    activeTab = tab;
    for (const [key, btn] of Object.entries(tabButtons) as [GitOpsTab, HTMLButtonElement][]) {
      const selected = key === tab;
      btn.classList.toggle('is-active', selected);
      btn.setAttribute('aria-selected', selected ? 'true' : 'false');
    }
    if (options.layout === 'tabbed') {
      changesPane.hidden = tab !== 'changes';
      historyPane.hidden = tab !== 'history';
      branchesPane.hidden = tab !== 'branches';
      if (tab === 'history') void ensureGraphAndRefresh();
      if (tab === 'branches') void renderBranchesList();
    }
  }

  function setCommitButtonBusy(btn: HTMLButtonElement, label: string): void {
    btn.disabled = true;
    btn.classList.add('is-busy');
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML =
      '<span class="git-panel-action-spinner" aria-hidden="true"></span>' +
      `<span class="git-panel-action-label">${label}</span>`;
  }

  function setCommitActionsBusy(active: CommitActionKind, progressLabel: string): void {
    commitBusy = true;
    setStatus(progressLabel);
    commitInput.disabled = true;
    aiGenerateBtn.disabled = true;
    const activeBtn = active === 'commit-push' ? commitPushBtn : commitBtn;
    const idleBtn = active === 'commit-push' ? commitBtn : commitPushBtn;
    setCommitButtonBusy(activeBtn, progressLabel);
    idleBtn.disabled = true;
  }

  function clearCommitActionsBusy(): void {
    commitBusy = false;
    commitInput.disabled = false;
    aiGenerateBtn.disabled = false;
    aiGenerateBtn.removeAttribute('aria-busy');
    for (const btn of [commitBtn, commitPushBtn]) {
      btn.classList.remove('is-busy');
      btn.removeAttribute('aria-busy');
      btn.disabled = false;
    }
    commitBtn.textContent = 'Commit';
    commitPushBtn.textContent = 'Commit & Push';
  }

  async function runGitOp(
    fn: () => Promise<GitOpResult>,
    successMessage?: string,
    sendToChat?: GitErrorChatKind,
  ): Promise<boolean> {
    const result = await fn();
    if (!result.ok) {
      const error = result.error ?? 'Git operation failed';
      setStatus(error, true, sendToChat);
      showToast(error, 'error');
      return false;
    }
    setStatus('');
    if (successMessage) showToast(successMessage, 'success');
    await refresh();
    options.onAfterGitOp?.();
    return true;
  }

  async function handleCommit(andPush: boolean): Promise<void> {
    if (commitBusy) return;
    const message = commitInput.value.trim();
    if (!message) {
      setStatus('Enter a commit message', true);
      return;
    }
    const cwd = getEffectiveCwd();
    const action: CommitActionKind = andPush ? 'commit-push' : 'commit';
    setCommitActionsBusy(action, 'Committing…');
    try {
      const ok = await runGitOp(
        () => gitCommit({ message, cwd }),
        andPush ? undefined : 'Committed changes',
        'commit',
      );
      if (!ok) return;
      commitInput.value = '';
      if (andPush) {
        setCommitActionsBusy(action, 'Pushing…');
        await runGitOp(() => gitPush({ cwd }), 'Committed and pushed', 'commit');
      }
    } finally {
      clearCommitActionsBusy();
    }
  }

  async function handleGenerateCommitMessage(): Promise<void> {
    generateMessageAbort?.abort();
    const controller = new AbortController();
    generateMessageAbort = controller;
    aiGenerateBtn.disabled = true;
    aiGenerateBtn.setAttribute('aria-busy', 'true');
    try {
      const cwd = getEffectiveCwd();
      const status = await gitStatus(cwd);
      if (!status.ok) {
        setStatus(status.error ?? 'Could not read git status', true);
        return;
      }
      const staged = status.staged ?? [];
      const unstaged = status.unstaged ?? [];
      const untracked = status.untracked ?? [];
      const allChanges = [...staged, ...unstaged, ...untracked];
      if (allChanges.length === 0) {
        setStatus('No changes to commit', true);
        return;
      }
      const useStagedOnly = staged.length > 0;
      const diffResult = useStagedOnly
        ? await gitDiff({ cached: true, cwd })
        : await gitDiff({ workingTree: true, cwd });
      if (!diffResult.ok || !diffResult.patch?.trim()) {
        setStatus(diffResult.error ?? 'Could not read diff', true);
        return;
      }
      const changedPaths = useStagedOnly
        ? staged.map((f) => f.path)
        : allChanges.map((f) => f.path);
      const excludedPaths = useStagedOnly
        ? [...unstaged, ...untracked].map((f) => f.path)
        : [];
      setStatus('Generating commit message…');
      const result = await fetchGitCommitMessage({
        changedPaths,
        excludedPaths,
        scope: useStagedOnly ? 'staged' : 'working-tree',
        patch: diffResult.patch,
        signal: controller.signal,
        onPartial: (text) => {
          commitInput.value = text;
        },
      });
      if (controller.signal.aborted) return;
      if (result.error) {
        setStatus(result.error, true);
        return;
      }
      if (result.text) {
        commitInput.value = result.text;
        commitInput.focus();
        setStatus('');
        showToast('Commit message generated', 'success');
        return;
      }
      setStatus('No commit message generated', true);
    } finally {
      if (generateMessageAbort === controller) generateMessageAbort = null;
      aiGenerateBtn.disabled = false;
      aiGenerateBtn.removeAttribute('aria-busy');
    }
  }

  function buildFileRow(entry: GitFileEntry, staged: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = 'git-panel-file-row';
    const badge = document.createElement('span');
    badge.className = `git-panel-file-badge git-panel-file-badge--${entry.status === '?' ? 'untracked' : 'modified'}`;
    badge.textContent = statusBadgeLetter(entry.status);
    const path = document.createElement('button');
    path.type = 'button';
    path.className = 'git-panel-file-path';
    path.textContent = entry.path;
    path.title = entry.path;
    path.addEventListener('click', () => void showFileDiff(entry.path, staged));
    const actions = document.createElement('div');
    actions.className = 'git-panel-file-actions';
    const diffBtn = document.createElement('button');
    diffBtn.type = 'button';
    diffBtn.className = 'git-panel-file-btn';
    diffBtn.textContent = '↔';
    diffBtn.title = 'Open diff';
    diffBtn.addEventListener('click', () => void showFileDiff(entry.path, staged));
    const stageBtn = document.createElement('button');
    stageBtn.type = 'button';
    stageBtn.className = 'git-panel-file-btn';
    stageBtn.textContent = staged ? '−' : '+';
    stageBtn.title = staged ? 'Unstage' : 'Stage';
    stageBtn.addEventListener('click', () => {
      void runGitOp(
        () =>
          staged
            ? gitUnstage({ paths: [entry.path], cwd: getEffectiveCwd() })
            : gitStage({ paths: [entry.path], cwd: getEffectiveCwd() }),
        staged ? `Unstaged ${entry.path}` : `Staged ${entry.path}`,
      );
    });
    const discardBtn = document.createElement('button');
    discardBtn.type = 'button';
    discardBtn.className = 'git-panel-file-btn git-panel-file-btn--danger';
    discardBtn.textContent = '↩';
    discardBtn.title = 'Discard changes';
    discardBtn.addEventListener('click', () => {
      void (async () => {
        if (!await appConfirm(`Discard changes to ${entry.path}?`)) return;
        await runGitOp(
          () => gitDiscard({ paths: [entry.path], cwd: getEffectiveCwd() }),
          `Discarded changes to ${entry.path}`,
        );
      })();
    });
    actions.append(diffBtn, stageBtn, discardBtn);
    row.append(badge, path, actions);
    return row;
  }

  function buildSection(
    title: string,
    files: GitFileEntry[],
    staged: boolean,
    bulkAction?: { label: string; fn: () => Promise<GitOpResult>; successMessage?: string },
  ): HTMLElement {
    const section = document.createElement('section');
    section.className = 'git-panel-section';
    const hdr = document.createElement('button');
    hdr.type = 'button';
    hdr.className = 'git-panel-section__hdr';
    hdr.setAttribute('aria-expanded', 'true');
    const hdrTitle = document.createElement('span');
    hdrTitle.textContent = `${title} (${files.length})`;
    hdr.appendChild(hdrTitle);
    if (bulkAction && files.length > 0) {
      const bulk = document.createElement('span');
      bulk.className = 'git-panel-section__bulk';
      bulk.textContent = bulkAction.label;
      bulk.addEventListener('click', (e) => {
        e.stopPropagation();
        void runGitOp(bulkAction.fn, bulkAction.successMessage);
      });
      hdr.appendChild(bulk);
    }
    const body = document.createElement('div');
    body.className = 'git-panel-section__body';
    for (const file of files) body.appendChild(buildFileRow(file, staged));
    hdr.addEventListener('click', () => {
      const open = hdr.getAttribute('aria-expanded') === 'true';
      hdr.setAttribute('aria-expanded', open ? 'false' : 'true');
      body.hidden = open;
    });
    section.append(hdr, body);
    return section;
  }

  function renderSections(status: GitOpResult): void {
    bodyMount.replaceChildren();
    const staged = status.staged ?? [];
    const unstaged = status.unstaged ?? [];
    const untracked = status.untracked ?? [];
    if (staged.length === 0 && unstaged.length === 0 && untracked.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'git-panel-empty';
      empty.textContent = 'No changes';
      bodyMount.appendChild(empty);
      return;
    }
    if (staged.length > 0) {
      bodyMount.appendChild(
        buildSection('Staged Changes', staged, true, {
          label: 'Unstage All',
          fn: () => gitUnstage({ paths: staged.map((f) => f.path), cwd: getEffectiveCwd() }),
          successMessage: 'Unstaged all changes',
        }),
      );
    }
    if (unstaged.length > 0) bodyMount.appendChild(buildSection('Changes', unstaged, false));
    if (untracked.length > 0) bodyMount.appendChild(buildSection('Untracked', untracked, false));
  }

  function syncGraphSelectedCommit(): void {
    graphOptions.selectedSha = selectedCommitSha;
    void graphHandle?.refresh();
  }

  function ensureGitGraph(): void {
    if (graphHandle) return;
    graphOptions.onSelectCommit = (sha) => void showCommitDiff(sha);
    graphOptions.onContextMenu = (visual, event) => {
      void showGitGraphCommitContextMenu(visual, event, buildGraphContextMenuCtx());
    };
    graphHandle = renderGitGraph(graphMount, graphOptions);
  }

  function buildGraphContextMenuCtx(): GitGraphContextMenuCtx {
    return {
      cwd: getEffectiveCwd(),
      onOpenChanges: (sha) => void showCommitDiff(sha),
      onRefresh: async () => {
        await refresh();
        options.onAfterGitOp?.();
      },
      getCurrentBranch: () => currentBranchName,
      conflictHost: options.conflictHost,
      onConflict: (message) => {
        if (!options.conflictHost) {
          showToast(message, 'error');
        }
      },
    };
  }

  async function ensureGraphAndRefresh(): Promise<void> {
    ensureGitGraph();
    graphOptions.cwd = getEffectiveCwd();
    await graphHandle?.refresh();
  }

  async function showCommitDiff(sha: string): Promise<void> {
    if (selectedCommitSha === sha && getOpenGitCommitDiffSha() === sha) {
      selectedCommitSha = null;
      closeGitCommitDiffPanel();
      syncGraphSelectedCommit();
      return;
    }
    const opened = await openGitCommitDiffPanel({ sha, cwd: getEffectiveCwd() });
    if (!opened.ok) {
      if ('cancelled' in opened && opened.cancelled) return;
      const message = 'error' in opened ? opened.error : 'Could not load commit';
      setStatus(message ?? 'Could not load commit', true);
      return;
    }
    expandedDiffPath = null;
    selectedCommitSha = sha;
    diffHost.hidden = true;
    diffHost.replaceChildren();
    syncGraphSelectedCommit();
  }

  async function showFileDiff(path: string, staged: boolean): Promise<void> {
    if (expandedDiffPath === path && expandedDiffStaged === staged) {
      expandedDiffPath = null;
      diffHost.hidden = true;
      diffHost.replaceChildren();
      return;
    }
    selectedCommitSha = null;
    closeGitCommitDiffPanel();
    syncGraphSelectedCommit();
    const result = await gitDiff({ path, cached: staged, cwd: getEffectiveCwd() });
    if (!result.ok || !result.patch) {
      setStatus(result.error ?? 'Could not load diff', true);
      return;
    }
    expandedDiffPath = path;
    expandedDiffStaged = staged;
    diffHost.hidden = false;
    diffHost.replaceChildren();
    const label = document.createElement('p');
    label.className = 'git-panel-diff-label';
    label.textContent = `${staged ? 'Staged' : 'Unstaged'}: ${path}`;
    diffHost.appendChild(label);
    const diffMount = document.createElement('div');
    diffHost.appendChild(diffMount);
    renderUnifiedPromptDiff(diffMount, parseUnifiedPatchToDiffLines(result.patch));
    diffHost.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function renderBranchesList(): Promise<void> {
    branchList.replaceChildren();
    const result = await gitBranches(getEffectiveCwd());
    if (!result.ok) {
      const err = document.createElement('p');
      err.className = 'git-panel-empty';
      err.textContent = result.error ?? 'Could not load branches';
      branchList.appendChild(err);
      return;
    }
    currentBranchName = result.current ?? '';
    const branches = filterUserFacingBranches(result.local ?? []);
    if (branches.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'git-panel-empty';
      empty.textContent = 'No local branches';
      branchList.appendChild(empty);
      return;
    }
    for (const branch of branches) {
      const row = document.createElement('div');
      row.className = 'git-ops-panel__branch-row';
      const name = document.createElement('span');
      name.className = 'git-ops-panel__branch-name';
      name.textContent = branch;
      if (branch === currentBranchName) {
        name.classList.add('is-current');
      }
      const actions = document.createElement('div');
      actions.className = 'git-ops-panel__branch-actions';
      if (branch !== currentBranchName && !isProtectedBranchName(branch)) {
        const checkoutBtn = document.createElement('button');
        checkoutBtn.type = 'button';
        checkoutBtn.className = 'git-panel-action-btn';
        checkoutBtn.textContent = 'Checkout';
        checkoutBtn.addEventListener('click', () => {
          void runGitOp(
            () => gitCheckout({ branch, cwd: getEffectiveCwd() }),
            `Switched to ${branch}`,
          );
        });
        actions.appendChild(checkoutBtn);
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'git-panel-action-btn';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => void handleDeleteBranch(branch));
        actions.appendChild(deleteBtn);
      }
      row.append(name, actions);
      branchList.appendChild(row);
    }
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'git-panel-action-btn git-panel-action-btn--primary';
    addBtn.textContent = 'New branch';
    addBtn.addEventListener('click', () => {
      openGitPanelNamePopover({
        anchor: addBtn,
        title: 'New branch',
        label: 'Branch name',
        placeholder: 'feature/my-branch',
        onSubmit: async (name) => {
          await runGitOp(
            () => gitCheckout({ branch: name, create: true, cwd: getEffectiveCwd() }),
            `Created branch ${name}`,
          );
        },
      });
    });
    branchList.appendChild(addBtn);
  }

  async function handleDeleteBranch(name: string): Promise<void> {
    if (!name || name === currentBranchName || isProtectedBranchName(name)) return;
    if (!await appConfirm(`Delete branch "${name}"?`)) return;
    const cwd = getEffectiveCwd();
    const ok = await runGitOp(() => gitDeleteBranch({ branch: name, cwd }), `Deleted branch ${name}`);
    if (ok) return;
    if (!await appConfirm(`Branch "${name}" is not fully merged. Force delete?`)) return;
    await runGitOp(() => gitDeleteBranch({ branch: name, force: true, cwd }), `Deleted branch ${name}`);
  }

  const onDiffClosed = (): void => {
    selectedCommitSha = null;
    syncGraphSelectedCommit();
  };
  window.addEventListener(GIT_COMMIT_DIFF_CLOSED_EVENT, onDiffClosed);

  async function refresh(): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    try {
      const status = await gitStatus(getEffectiveCwd());
      if (!status.ok) {
        if (isMissingGitRepositoryError(status.error)) {
          setStatus('');
          setGitOpsNoRepoState(true);
          bodyMount.replaceChildren();
          return;
        }
        setGitOpsNoRepoState(false);
        setStatus(status.error ?? 'Could not read git status', true);
        bodyMount.replaceChildren();
        const err = document.createElement('p');
        err.className = 'git-panel-empty';
        err.textContent = status.error ?? 'Could not load git status';
        bodyMount.appendChild(err);
        return;
      }
      setGitOpsNoRepoState(false);
      setStatus('');
      if (status.branch) {
        currentBranchName = status.branch === 'HEAD' ? '' : status.branch;
      }
      renderSections(status);
      if (options.layout === 'stacked' || activeTab === 'history') {
        await ensureGraphAndRefresh();
      }
      if (options.layout === 'tabbed' && activeTab === 'branches') {
        await renderBranchesList();
      }
      // Pre-select changes tab when dirty in lightbox.
      if (options.layout === 'tabbed') {
        const dirty =
          (status.staged?.length ?? 0) +
            (status.unstaged?.length ?? 0) +
            (status.untracked?.length ?? 0) >
          0;
        if (dirty && activeTab === 'changes') {
          /* keep changes tab */
        }
      }
    } finally {
      refreshing = false;
    }
  }

  setTab(activeTab);

  // Stacked sidebar: show history below changes (no tabs).
  if (options.layout === 'stacked') {
    historyPane.hidden = false;
    branchesPane.hidden = true;
  }

  return {
    root,
    refresh,
    setTab,
    getTab: () => activeTab,
    destroy: () => {
      window.removeEventListener(GIT_COMMIT_DIFF_CLOSED_EVENT, onDiffClosed);
      generateMessageAbort?.abort();
      closeGitPanelNamePopover();
      graphHandle?.destroy();
      graphHandle = null;
      root.remove();
    },
  };
}
