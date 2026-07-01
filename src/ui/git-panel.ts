/**

 * Git source control view inside the file sidebar (MIN-198 P1/P3).

 */



import {

  formatWorktreeOptionLabel,

  filterUserFacingBranches,

  parseWorktreeListPorcelain,

  type ParsedWorktree,

} from '../lib/worktree-list-parse';

import { subscribeAllBoardChanges } from '../state/orchestrate-board-events';

import {

  gitBranches,

  gitCheckout,

  gitCommit,

  gitDiff,

  gitDiscard,

  gitPull,

  gitPush,

  gitStage,

  gitStatus,

  gitUnstage,

  gitShow,

  gitDeleteBranch,

  gitWorktreeAdd,

  gitWorktreeRemove,

  type GitFileEntry,

  type GitOpResult,

} from '../state/git-api';

import { getFilePanelState, patchFilePanelState } from '../state/file-panel';

import { renderGitGraph } from './git-graph';

import { applyFileSidebarVisuals, isMobileLayout, openMobileFileSidebar } from './file-layout';

import { getActiveChat, sessionState } from '../state/sessions';

import { resolveChatWorktreeRoot } from '../state/worktree-isolation';

import { listWorktrees } from '../state/worktree-service';

import { getWorkspacePath } from '../state/workspace';

import {
  panelPathsEqual,
  resolvePanelWorktreeCwd,
} from './panel-worktree-cwd';

import { getFileTreeSidebarTitleSuffix } from './file-tree-listing-root';

import { parseUnifiedPatchToDiffLines } from './git-patch-parse';

import { renderUnifiedPromptDiff } from './prompt-diff-unified';

import { fetchGitCommitMessage } from './git-commit-message-client';

import { showToast } from './toast';

import {
  closeGitPanelNamePopover,
  openGitPanelNamePopover,
} from './git-panel-name-popover';



const POLL_MS = 5000;



let panelRoot: HTMLElement | null = null;

let scrollMount: HTMLElement | null = null;

let bodyMount: HTMLElement | null = null;

let branchSelect: HTMLSelectElement | null = null;
let branchDeleteBtn: HTMLButtonElement | null = null;

let cwdSelect: HTMLSelectElement | null = null;
let worktreeDeleteBtn: HTMLButtonElement | null = null;

let cwdWrap: HTMLElement | null = null;

let aheadBehindEl: HTMLElement | null = null;

let commitInput: HTMLTextAreaElement | null = null;

let commitBtn: HTMLButtonElement | null = null;

let commitPushBtn: HTMLButtonElement | null = null;

let commitBusy = false;

let aiGenerateBtn: HTMLButtonElement | null = null;

let generateMessageAbort: AbortController | null = null;

let statusEl: HTMLElement | null = null;

let diffHost: HTMLElement | null = null;

let graphMount: HTMLElement | null = null;

let historySection: HTMLElement | null = null;

let historyBody: HTMLElement | null = null;



let pollTimer: number | undefined;

let bound = false;

let panelOpen = false;

let refreshing = false;



/** Effective cwd for git ops; undefined means server workspace root. */

let panelCwd: string | undefined;

let knownWorktrees: ParsedWorktree[] = [];
let currentBranchName = '';



let expandedDiffPath: string | null = null;

let expandedDiffStaged = false;

let selectedCommitSha: string | null = null;



let graphHandle: ReturnType<typeof renderGitGraph> | null = null;

const graphOptions: { cwd?: string; onSelectCommit?: (sha: string) => void } = {};



function getFileSidebar(): HTMLElement | null {

  return document.getElementById('fileSidebar');

}



function getGitMount(): HTMLElement | null {

  return document.getElementById('gitPanelRoot');

}



/** Current cwd passed to git API calls (undefined → server default). */

export function getGitPanelCwd(): string | undefined {

  return panelCwd;

}



function pathsEqual(a: string, b: string): boolean {
  return panelPathsEqual(a, b);
}



function createToolbarIconBtn(label: string, title: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'git-panel-toolbar-btn';
  btn.textContent = label;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  return btn;
}

function isMainWorktreePath(worktreePath: string): boolean {
  const ws = getWorkspacePath().trim();
  return Boolean(ws && pathsEqual(worktreePath, ws));
}

function syncBranchDeleteButton(): void {
  if (!branchDeleteBtn || !branchSelect) return;
  const selected = branchSelect.value;
  const canDelete = Boolean(selected && selected !== currentBranchName);
  branchDeleteBtn.disabled = !canDelete;
}

function syncWorktreeDeleteButton(): void {
  if (!worktreeDeleteBtn || !cwdSelect) return;
  const selected = cwdSelect.value;
  const canDelete = Boolean(selected && !isMainWorktreePath(selected));
  worktreeDeleteBtn.disabled = !canDelete;
}

function openAddBranchPopover(anchor: HTMLButtonElement): void {
  openGitPanelNamePopover({
    anchor,
    title: 'New branch',
    label: 'Branch name',
    placeholder: 'feature/my-branch',
    onSubmit: async (branch) => {
      await runGitOp(
        () => gitCheckout({ branch, create: true, cwd: getEffectiveCwdArg() }),
        { successMessage: `Created branch ${branch}` },
      );
    },
  });
}

async function handleDeleteBranch(): Promise<void> {
  if (!branchSelect) return;
  const name = branchSelect.value;
  if (!name || name === currentBranchName) return;
  if (!window.confirm(`Delete branch "${name}"?`)) return;

  const cwd = getEffectiveCwdArg();
  const ok = await runGitOp(() => gitDeleteBranch({ branch: name, cwd }), {
    successMessage: `Deleted branch ${name}`,
  });
  if (ok) return;

  if (!window.confirm(`Branch "${name}" is not fully merged. Force delete?`)) return;
  await runGitOp(() => gitDeleteBranch({ branch: name, force: true, cwd }), {
    successMessage: `Deleted branch ${name}`,
  });
}

function openAddWorktreePopover(anchor: HTMLButtonElement): void {
  openGitPanelNamePopover({
    anchor,
    title: 'Add worktree',
    label: 'Branch name',
    placeholder: 'feature/my-worktree',
    onSubmit: async (branch) => {
      const cwd = getEffectiveCwdArg();
      const addResult = await gitWorktreeAdd({ branch, cwd });
      if (!addResult.ok) {
        const error = addResult.error ?? 'Could not add worktree';
        setStatus(error, true);
        showToast(error, 'error');
        return;
      }

      setStatus('');
      showToast('Worktree added', 'success');
      if (addResult.path) {
        panelCwd = addResult.path;
      }
      await refreshGitPanel();
      void syncFileTreeGitPollCwd();
    },
  });
}

async function handleDeleteWorktree(): Promise<void> {
  if (!cwdSelect) return;
  const targetPath = cwdSelect.value;
  if (!targetPath || isMainWorktreePath(targetPath)) return;
  if (!window.confirm(`Remove worktree at ${targetPath}?`)) return;

  const cwd = getEffectiveCwdArg();
  const ok = await runGitOp(() => gitWorktreeRemove({ path: targetPath, cwd }), {
    successMessage: 'Worktree removed',
  });
  if (ok) {
    const ws = getWorkspacePath().trim();
    panelCwd = ws || undefined;
    return;
  }

  if (!window.confirm('Worktree has uncommitted changes. Force remove?')) return;
  const forced = await runGitOp(
    () => gitWorktreeRemove({ path: targetPath, force: true, cwd }),
    { successMessage: 'Worktree removed' },
  );
  if (forced) {
    const ws = getWorkspacePath().trim();
    panelCwd = ws || undefined;
  }
}



function setStatus(message: string, isError = false): void {

  if (!statusEl) return;

  statusEl.textContent = message;

  statusEl.classList.toggle('is-err', isError);

  statusEl.hidden = !message;

}



type CommitActionKind = 'commit' | 'commit-push';



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

  if (commitInput) commitInput.disabled = true;

  if (aiGenerateBtn) aiGenerateBtn.disabled = true;

  const activeBtn = active === 'commit-push' ? commitPushBtn : commitBtn;

  const idleBtn = active === 'commit-push' ? commitBtn : commitPushBtn;

  if (activeBtn) setCommitButtonBusy(activeBtn, progressLabel);

  if (idleBtn) idleBtn.disabled = true;

}



function clearCommitActionsBusy(): void {

  commitBusy = false;

  if (commitInput) commitInput.disabled = false;

  if (aiGenerateBtn) {

    aiGenerateBtn.disabled = false;

    aiGenerateBtn.removeAttribute('aria-busy');

  }

  if (commitBtn) {

    commitBtn.classList.remove('is-busy');

    commitBtn.removeAttribute('aria-busy');

    commitBtn.disabled = false;

    commitBtn.textContent = 'Commit';

  }

  if (commitPushBtn) {

    commitPushBtn.classList.remove('is-busy');

    commitPushBtn.removeAttribute('aria-busy');

    commitPushBtn.disabled = false;

    commitPushBtn.textContent = 'Commit & Push';

  }

}



function getEffectiveCwdArg(): string | undefined {
  return resolvePanelWorktreeCwd(panelCwd);
}



function syncSidebarChrome(): void {
  const sidebar = getFileSidebar();
  const filesView = document.getElementById('fileSidebarFilesView');
  const gitMount = getGitMount();
  const title = document.getElementById('fileSidebarTitle');
  const open = isGitSidePanelOpen();

  sidebar?.classList.toggle('file-sidebar--git', open);
  sidebar?.setAttribute('aria-label', open ? 'Source control' : 'Project files');

  if (filesView) {
    filesView.toggleAttribute('hidden', open);
  }
  if (gitMount) {
    gitMount.toggleAttribute('hidden', !open);
  }
  if (title) {
    title.textContent = open ? 'Source Control' : `Files${getFileTreeSidebarTitleSuffix()}`;
  }

  syncToggleButtonState();
}



function ensurePanelDom(): HTMLElement {

  const mount = getGitMount();

  if (panelRoot?.isConnected && mount?.contains(panelRoot)) return panelRoot;



  panelRoot = document.createElement('div');

  panelRoot.id = 'gitSidePanel';

  panelRoot.className = 'git-panel-root__inner';

  panelRoot.setAttribute('role', 'region');

  panelRoot.setAttribute('aria-label', 'Source control');



  const toolbar = document.createElement('div');

  toolbar.className = 'git-panel-toolbar';



  cwdWrap = document.createElement('div');

  cwdWrap.className = 'git-panel-cwd-wrap';

  cwdWrap.hidden = true;

  const cwdLabel = document.createElement('label');

  cwdLabel.className = 'git-panel-cwd-label';

  cwdLabel.textContent = 'Worktree';

  cwdLabel.htmlFor = 'gitPanelCwdSelect';

  const cwdFieldRow = document.createElement('div');

  cwdFieldRow.className = 'git-panel-field-row';

  cwdSelect = document.createElement('select');

  cwdSelect.id = 'gitPanelCwdSelect';

  cwdSelect.className = 'git-panel-cwd-select';

  cwdSelect.title = 'Git worktree root';

  cwdSelect.addEventListener('change', () => {

    const value = cwdSelect?.value ?? '';

    panelCwd = value || undefined;

    syncWorktreeDeleteButton();

    void refreshGitPanel();

    void syncFileTreeGitPollCwd();

  });

  const worktreeAddBtn = createToolbarIconBtn('+', 'Add worktree');

  worktreeAddBtn.addEventListener('click', () => openAddWorktreePopover(worktreeAddBtn));

  worktreeDeleteBtn = createToolbarIconBtn('−', 'Remove worktree');

  worktreeDeleteBtn.disabled = true;

  worktreeDeleteBtn.addEventListener('click', () => void handleDeleteWorktree());

  cwdFieldRow.append(cwdSelect, worktreeAddBtn, worktreeDeleteBtn);

  cwdWrap.append(cwdLabel, cwdFieldRow);



  const branchWrap = document.createElement('div');

  branchWrap.className = 'git-panel-branch-wrap';

  const branchLabel = document.createElement('label');

  branchLabel.className = 'git-panel-cwd-label';

  branchLabel.textContent = 'Branch';

  branchLabel.htmlFor = 'gitPanelBranchSelect';

  const branchFieldRow = document.createElement('div');

  branchFieldRow.className = 'git-panel-field-row';

  branchSelect = document.createElement('select');

  branchSelect.id = 'gitPanelBranchSelect';

  branchSelect.className = 'git-panel-branch-select';

  branchSelect.title = 'Current branch';

  branchSelect.addEventListener('change', () => {

    syncBranchDeleteButton();

    void handleBranchChange();

  });

  const branchAddBtn = createToolbarIconBtn('+', 'New branch');

  branchAddBtn.addEventListener('click', () => openAddBranchPopover(branchAddBtn));

  branchDeleteBtn = createToolbarIconBtn('−', 'Delete branch');

  branchDeleteBtn.disabled = true;

  branchDeleteBtn.addEventListener('click', () => void handleDeleteBranch());

  branchFieldRow.append(branchSelect, branchAddBtn, branchDeleteBtn);

  branchWrap.append(branchLabel, branchFieldRow);



  const branchRow = document.createElement('div');

  branchRow.className = 'git-panel-sync-row';



  aheadBehindEl = document.createElement('span');

  aheadBehindEl.className = 'git-panel-ahead-behind';



  const pullBtn = document.createElement('button');

  pullBtn.type = 'button';

  pullBtn.className = 'git-panel-action-btn';

  pullBtn.textContent = 'Pull';

  pullBtn.addEventListener('click', () =>
    void runGitOp(() => gitPull(getEffectiveCwdArg()), { successMessage: 'Pulled changes' }),
  );



  const pushBtn = document.createElement('button');

  pushBtn.type = 'button';

  pushBtn.className = 'git-panel-action-btn';

  pushBtn.textContent = 'Push';

  pushBtn.addEventListener('click', () =>
    void runGitOp(() => gitPush({ cwd: getEffectiveCwdArg() }), { successMessage: 'Pushed changes' }),
  );



  branchRow.append(aheadBehindEl, pullBtn, pushBtn);

  toolbar.append(cwdWrap, branchWrap, branchRow);



  scrollMount = document.createElement('div');

  scrollMount.className = 'git-panel-scroll';



  statusEl = document.createElement('p');

  statusEl.className = 'git-panel-status';

  statusEl.setAttribute('role', 'status');

  statusEl.setAttribute('aria-live', 'polite');

  statusEl.hidden = true;



  const commitBox = document.createElement('div');

  commitBox.className = 'git-panel-commit-box';

  commitInput = document.createElement('textarea');

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

  aiGenerateBtn = document.createElement('button');

  aiGenerateBtn.type = 'button';

  aiGenerateBtn.className = 'git-panel-action-btn git-panel-action-btn--ai git-panel-action-btn--icon';

  aiGenerateBtn.title = 'Generate commit message with AI';

  aiGenerateBtn.setAttribute('aria-label', 'Generate commit message with AI');

  const aiGenerateIcon = document.createElement('img');

  aiGenerateIcon.className = 'icon-img git-panel-action-btn__icon';

  aiGenerateIcon.src = '/icons/sparkles.png';

  aiGenerateIcon.width = 12;

  aiGenerateIcon.height = 12;

  aiGenerateIcon.alt = '';

  aiGenerateIcon.setAttribute('aria-hidden', 'true');

  aiGenerateBtn.append(aiGenerateIcon);

  aiGenerateBtn.addEventListener('click', () => void handleGenerateCommitMessage());

  commitBtn = document.createElement('button');

  commitBtn.type = 'button';

  commitBtn.className = 'git-panel-action-btn git-panel-action-btn--primary';

  commitBtn.textContent = 'Commit';

  commitBtn.addEventListener('click', () => void handleCommit(false));



  commitPushBtn = document.createElement('button');

  commitPushBtn.type = 'button';

  commitPushBtn.className = 'git-panel-action-btn';

  commitPushBtn.textContent = 'Commit & Push';

  commitPushBtn.addEventListener('click', () => void handleCommit(true));



  commitActions.append(commitBtn, commitPushBtn, aiGenerateBtn);

  commitBox.append(commitInput, commitActions);



  bodyMount = document.createElement('div');

  bodyMount.className = 'git-panel-sections';



  diffHost = document.createElement('div');

  diffHost.className = 'git-panel-diff-host';

  diffHost.hidden = true;



  historySection = document.createElement('section');

  historySection.className = 'git-panel-section git-panel-section--history';



  const historyHdr = document.createElement('button');

  historyHdr.type = 'button';

  historyHdr.className = 'git-panel-section__hdr';

  historyHdr.setAttribute('aria-expanded', 'true');

  const historyTitle = document.createElement('span');

  historyTitle.textContent = 'History';

  historyHdr.appendChild(historyTitle);



  historyBody = document.createElement('div');

  historyBody.className = 'git-panel-section__body git-panel-section__body--history';



  graphMount = document.createElement('div');

  graphMount.id = 'gitGraphMount';

  graphMount.className = 'git-panel-graph-mount';

  historyBody.appendChild(graphMount);



  historyHdr.addEventListener('click', () => {

    const open = historyHdr.getAttribute('aria-expanded') === 'true';

    historyHdr.setAttribute('aria-expanded', open ? 'false' : 'true');

    historyBody!.hidden = open;

  });



  historySection.append(historyHdr, historyBody);



  scrollMount.append(statusEl, commitBox, bodyMount, diffHost, historySection);

  panelRoot.append(toolbar, scrollMount);



  mount?.replaceChildren(panelRoot);

  return panelRoot;

}



async function syncFileTreeGitPollCwd(): Promise<void> {
  const { syncFileTreeToPanelWorktree } = await import('./file-tree');
  await syncFileTreeToPanelWorktree(panelCwd);
}



async function handleBranchChange(): Promise<void> {

  if (!branchSelect) return;

  const value = branchSelect.value;

  if (!value) return;

  await runGitOp(() => gitCheckout({ branch: value, cwd: getEffectiveCwdArg() }), {
    successMessage: `Switched to ${value}`,
  });

}



async function handleGenerateCommitMessage(): Promise<void> {

  if (!commitInput) return;

  generateMessageAbort?.abort();

  const controller = new AbortController();

  generateMessageAbort = controller;

  if (aiGenerateBtn) {

    aiGenerateBtn.disabled = true;

    aiGenerateBtn.setAttribute('aria-busy', 'true');

  }

  try {

    const cwd = getEffectiveCwdArg();

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

    setStatus('Generating commit message…');

    const result = await fetchGitCommitMessage({
      stagedPaths: useStagedOnly
        ? staged.map((file) => file.path)
        : allChanges.map((file) => file.path),

      patch: diffResult.patch,

      signal: controller.signal,

      onPartial: (text) => {

        commitInput!.value = text;

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

    if (generateMessageAbort === controller) {

      generateMessageAbort = null;

    }

    if (aiGenerateBtn) {

      aiGenerateBtn.disabled = false;

      aiGenerateBtn.removeAttribute('aria-busy');

    }

  }

}



async function handleCommit(andPush: boolean): Promise<void> {

  if (commitBusy) return;

  const message = commitInput?.value.trim() ?? '';

  if (!message) {

    setStatus('Enter a commit message', true);

    return;

  }

  const cwd = getEffectiveCwdArg();

  const action: CommitActionKind = andPush ? 'commit-push' : 'commit';

  setCommitActionsBusy(action, 'Committing…');

  try {

    const ok = await runGitOp(() => gitCommit({ message, cwd }), {
      successMessage: andPush ? undefined : 'Committed changes',
    });

    if (!ok) return;

    if (commitInput) commitInput.value = '';

    if (andPush) {

      setCommitActionsBusy(action, 'Pushing…');

      await runGitOp(() => gitPush({ cwd }), { successMessage: 'Committed and pushed' });

    }

  } finally {

    clearCommitActionsBusy();

  }

}



type RunGitOpOptions = {

  successMessage?: string;

};



async function runGitOp(

  fn: () => Promise<GitOpResult>,

  options?: RunGitOpOptions,

): Promise<boolean> {

  const result = await fn();

  if (!result.ok) {

    const error = result.error ?? 'Git operation failed';

    setStatus(error, true);

    showToast(error, 'error');

    return false;

  }

  setStatus('');

  if (options?.successMessage) {

    showToast(options.successMessage, 'success');

  }

  await refreshGitPanel();

  void syncFileTreeGitPollCwd();

  return true;

}



function statusBadgeLetter(status: string): string {

  if (status === '?') return '?';

  if (status === 'A' || status === 'M' || status === 'D' || status === 'R' || status === 'C') {

    return status;

  }

  return status.slice(0, 1).toUpperCase() || 'M';

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

          ? gitUnstage({ paths: [entry.path], cwd: getEffectiveCwdArg() })

          : gitStage({ paths: [entry.path], cwd: getEffectiveCwdArg() }),

      {

        successMessage: staged ? `Unstaged ${entry.path}` : `Staged ${entry.path}`,

      },

    );

  });



  const discardBtn = document.createElement('button');

  discardBtn.type = 'button';

  discardBtn.className = 'git-panel-file-btn git-panel-file-btn--danger';

  discardBtn.textContent = '↩';

  discardBtn.title = 'Discard changes';

  discardBtn.addEventListener('click', () => {

    if (!window.confirm(`Discard changes to ${entry.path}?`)) return;

    void runGitOp(() => gitDiscard({ paths: [entry.path], cwd: getEffectiveCwdArg() }), {
      successMessage: `Discarded changes to ${entry.path}`,
    });

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

      void runGitOp(bulkAction.fn, { successMessage: bulkAction.successMessage });

    });

    hdr.appendChild(bulk);

  }



  const body = document.createElement('div');

  body.className = 'git-panel-section__body';

  for (const file of files) {

    body.appendChild(buildFileRow(file, staged));

  }



  hdr.addEventListener('click', () => {

    const open = hdr.getAttribute('aria-expanded') === 'true';

    hdr.setAttribute('aria-expanded', open ? 'false' : 'true');

    body.hidden = open;

  });



  section.append(hdr, body);

  return section;

}



function ensureGitGraph(): void {

  if (!graphMount || graphHandle) return;

  graphOptions.onSelectCommit = (sha) => void showCommitDiff(sha);

  graphHandle = renderGitGraph(graphMount, graphOptions);

}



async function showCommitDiff(sha: string): Promise<void> {

  if (!diffHost) return;

  if (selectedCommitSha === sha) {

    selectedCommitSha = null;

    diffHost.hidden = true;

    diffHost.replaceChildren();

    return;

  }



  const result = await gitShow({ sha, cwd: getEffectiveCwdArg() });

  if (!result.ok) {

    setStatus(result.error ?? 'Could not load commit', true);

    return;

  }



  expandedDiffPath = null;

  selectedCommitSha = sha;

  diffHost.hidden = false;

  diffHost.replaceChildren();



  const label = document.createElement('p');

  label.className = 'git-panel-diff-label';

  const shortSha = sha.slice(0, 7);

  const statLine = result.stat?.trim().split('\n').pop()?.trim();

  label.textContent = statLine ? `Commit ${shortSha} — ${statLine}` : `Commit ${shortSha}`;



  diffHost.appendChild(label);

  if (result.patch) {

    const mount = document.createElement('div');

    diffHost.appendChild(mount);

    renderUnifiedPromptDiff(mount, parseUnifiedPatchToDiffLines(result.patch));

  }



  diffHost.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

}



async function showFileDiff(path: string, staged: boolean): Promise<void> {

  if (!diffHost) return;

  if (expandedDiffPath === path && expandedDiffStaged === staged) {

    expandedDiffPath = null;

    diffHost.hidden = true;

    diffHost.replaceChildren();

    return;

  }



  selectedCommitSha = null;



  const result = await gitDiff({ path, cached: staged, cwd: getEffectiveCwdArg() });

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

  const mount = document.createElement('div');

  diffHost.appendChild(mount);

  renderUnifiedPromptDiff(mount, parseUnifiedPatchToDiffLines(result.patch));

  diffHost.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

}



function renderSections(status: GitOpResult): void {

  if (!bodyMount) return;

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

        fn: () => gitUnstage({ paths: staged.map((f) => f.path), cwd: getEffectiveCwdArg() }),

        successMessage: 'Unstaged all changes',

      }),

    );

  }

  if (unstaged.length > 0) {
    bodyMount.appendChild(buildSection('Changes', unstaged, false));
  }

  if (untracked.length > 0) {

    bodyMount.appendChild(buildSection('Untracked', untracked, false));

  }

}



function renderAheadBehind(status: GitOpResult): void {

  if (!aheadBehindEl) return;

  const ahead = status.ahead ?? 0;

  const behind = status.behind ?? 0;

  if (ahead === 0 && behind === 0) {

    aheadBehindEl.textContent = '';

    return;

  }

  const parts: string[] = [];

  if (ahead > 0) parts.push(`↑${ahead}`);

  if (behind > 0) parts.push(`↓${behind}`);

  aheadBehindEl.textContent = parts.join(' ');

}



async function refreshBranchSelect(): Promise<void> {

  if (!branchSelect) return;

  const result = await gitBranches(getEffectiveCwdArg());

  branchSelect.replaceChildren();



  if (!result.ok) return;

  currentBranchName = result.current ?? '';

  for (const branch of filterUserFacingBranches(result.local ?? [])) {

    const opt = document.createElement('option');

    opt.value = branch;

    opt.textContent = branch;

    if (branch === result.current) opt.selected = true;

    branchSelect.appendChild(opt);

  }

  syncBranchDeleteButton();

}



async function refreshWorktreeDropdown(): Promise<void> {

  if (!cwdSelect || !cwdWrap) return;



  const ws = getWorkspacePath().trim();

  const listResult = await listWorktrees();

  if (!listResult.ok || !listResult.output) {

    knownWorktrees = ws ? [{ path: ws, head: '', branch: undefined, detached: false }] : [];

    cwdWrap.hidden = knownWorktrees.length === 0;

    if (knownWorktrees.length > 0) {

      cwdSelect.replaceChildren();

      const opt = document.createElement('option');

      opt.value = knownWorktrees[0].path;

      opt.textContent = formatWorktreeOptionLabel(knownWorktrees[0], ws);

      opt.selected = true;

      cwdSelect.appendChild(opt);

      syncWorktreeDeleteButton();

    }

    return;

  }



  knownWorktrees = parseWorktreeListPorcelain(listResult.output);

  cwdWrap.hidden = knownWorktrees.length === 0;

  if (knownWorktrees.length === 0) return;

  const selected = panelCwd ?? ws;

  cwdSelect.replaceChildren();



  for (const wt of knownWorktrees) {

    const opt = document.createElement('option');

    opt.value = wt.path;

    opt.textContent = formatWorktreeOptionLabel(wt, ws);

    if (selected && pathsEqual(wt.path, selected)) {

      opt.selected = true;

    }

    cwdSelect.appendChild(opt);

  }

  syncWorktreeDeleteButton();

}



export async function refreshGitPanel(): Promise<void> {

  if (!panelOpen || refreshing) return;

  refreshing = true;

  try {

    await refreshWorktreeDropdown();

    const status = await gitStatus(getEffectiveCwdArg());

    if (!status.ok) {

      setStatus(status.error ?? 'Could not read git status', true);

      if (bodyMount) {

        bodyMount.replaceChildren();

        const err = document.createElement('p');

        err.className = 'git-panel-empty';

        err.textContent = status.error ?? 'Not a git repository';

        bodyMount.appendChild(err);

      }

      return;

    }



    setStatus('');

    renderAheadBehind(status);

    renderSections(status);

    await refreshBranchSelect();



    ensureGitGraph();

    graphOptions.cwd = getEffectiveCwdArg();

    await graphHandle?.refresh();

  } finally {

    refreshing = false;

  }

}



function startPolling(): void {

  stopPolling();

  pollTimer = window.setInterval(() => {

    void refreshGitPanel();

  }, POLL_MS);

}



function stopPolling(): void {

  if (pollTimer) {

    clearInterval(pollTimer);

    pollTimer = undefined;

  }

}



function syncToggleButtonState(): void {

  const toggleBtn = document.getElementById('btnGitPanelToggle');

  if (!toggleBtn) return;

  const open = isGitSidePanelOpen();

  toggleBtn.classList.toggle('is-active', open);

  toggleBtn.setAttribute('aria-pressed', open ? 'true' : 'false');

}



function ensureSidebarExpandedForGit(): void {
  if (isMobileLayout()) {
    openMobileFileSidebar();
  }

  const state = getFilePanelState();

  if (!state.fileSidebarCollapsed) return;

  patchFilePanelState({ fileSidebarCollapsed: false });

  applyFileSidebarVisuals();
}



/** Whether the git view is visible in the file sidebar. */

export function isGitSidePanelOpen(): boolean {

  return panelOpen;

}



/** Open the git view in the file sidebar. */

export async function openGitSidePanel(): Promise<void> {

  ensurePanelDom();

  panelOpen = true;

  syncSidebarChrome();

  ensureSidebarExpandedForGit();

  await refreshGitPanel();

  startPolling();

  void syncFileTreeGitPollCwd();

}



/** Hide the git view and return to the file tree. */

export function closeGitSidePanel(): void {

  panelOpen = false;

  syncSidebarChrome();

  stopPolling();

}



/** Toggle git view visibility in the file sidebar. */

export function toggleGitSidePanel(): void {

  const state = getFilePanelState();

  if (state.fileSidebarCollapsed) {
    void openGitSidePanel();
    return;
  }

  if (isGitSidePanelOpen()) closeGitSidePanel();

  else void openGitSidePanel();

}



/**

 * When an orchestrator board task chat is active, point the panel at that task's

 * worktree cwd (falls back to workspace root for non-board chats).

 */

export function syncGitPanelFromOrchestrator(): void {

  // No-op without session state: this can run from a deferred dynamic import
  // (sidebar switchChat) after teardown, where getActiveChat() would throw.
  if (!sessionState) return;

  const chat = getActiveChat();

  const groups = sessionState?.groups;

  const worktreeRoot = resolveChatWorktreeRoot(chat, groups);



  if (worktreeRoot) {

    panelCwd = worktreeRoot;

  } else {

    const ws = getWorkspacePath().trim();

    panelCwd = ws || undefined;

  }



  if (cwdSelect) {

    const target = panelCwd ?? getWorkspacePath();

    for (const opt of cwdSelect.options) {

      if (pathsEqual(opt.value, target)) {

        cwdSelect.value = opt.value;

        break;

      }

    }

  }



  if (panelOpen) {

    void refreshGitPanel();

  }

  void syncFileTreeGitPollCwd();

}



/** Wire toggle button, polling, orchestrator subscriptions. */

export function initGitPanel(): void {

  if (bound) return;

  bound = true;



  ensurePanelDom();

  syncSidebarChrome();



  const toggleBtn = document.getElementById('btnGitPanelToggle');

  toggleBtn?.addEventListener('click', () => toggleGitSidePanel());



  window.addEventListener('focus', () => {

    if (panelOpen) void refreshGitPanel();

  });



  subscribeAllBoardChanges(() => {

    syncGitPanelFromOrchestrator();

  });



  syncGitPanelFromOrchestrator();

}



/** Reset module state (tests). */

export function resetGitPanelForTests(): void {

  bound = false;

  panelOpen = false;

  panelCwd = undefined;

  knownWorktrees = [];
  currentBranchName = '';

  stopPolling();

  closeGitPanelNamePopover();

  panelRoot?.remove();

  panelRoot = null;

  scrollMount = null;

  bodyMount = null;

  branchSelect = null;
  branchDeleteBtn = null;

  cwdSelect = null;
  worktreeDeleteBtn = null;

  cwdWrap = null;

  aheadBehindEl = null;

  commitInput = null;

  commitBtn = null;

  commitPushBtn = null;

  commitBusy = false;

  aiGenerateBtn = null;

  generateMessageAbort?.abort();

  generateMessageAbort = null;

  statusEl = null;

  diffHost = null;

  graphMount = null;

  historySection = null;

  historyBody = null;

  graphHandle?.destroy();

  graphHandle = null;

  selectedCommitSha = null;

  getFileSidebar()?.classList.remove('file-sidebar--git');

  document.getElementById('fileSidebarFilesView')?.removeAttribute('hidden');

  getGitMount()?.setAttribute('hidden', '');

  const titleEl = document.getElementById('fileSidebarTitle');
  if (titleEl) titleEl.textContent = 'Files';

  syncToggleButtonState();
}
