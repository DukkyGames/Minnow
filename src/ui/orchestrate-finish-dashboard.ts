/**
 * Finish dashboard shown when an Orchestrate board completes (MIN-208).
 */

import {
  buildDeterministicFinishReport,
  computeLocalFinishStats,
  fetchGitFinishStats,
  type FinishBoardStats,
} from '../chat/orchestrate/finish-stats.ts';
import {
  boardHasRecoverableTasks,
  isOrchestrateBoardFinished,
  isOrchestrateFinalTestFailedWithAllTasksComplete,
} from '../chat/orchestrate/plan-complete.ts';
import {
  enrichFinishReportWithRecommendations,
  enrichFinishReportWithRunInstructions,
} from '../chat/orchestrate/finish-recommendations.ts';
import { setAssistantBubbleContent } from '../markdown/renderer.ts';
import { emitBoardChange } from '../state/orchestrate-board-events.ts';
import {
  appendFinalTestFixTask,
  clearBoardWorktreesAfterLanding,
  markBoardIntegrationLanded,
  restartBoardAfterRequeueFailures,
} from '../state/orchestrate-board-actions.ts';
import {
  mergeIntegrationIntoWorkspace,
  openWorkspacePr,
} from '../state/worktree-service.ts';
import { gitCommit, gitPush } from '../state/git-api.ts';
import {
  findChatById,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions.ts';
import type { BoardTask, Chat, ChatGroup, OrchestrateBoardState } from '../types.ts';
import { createChatWithMode } from './sidebar.ts';
import { openSourceControlCenterLazy } from './source-control-center-entry.ts';

type CommitAction = 'commit-only' | 'commit-push' | 'commit-push-pr';

interface DashboardGitState {
  loading: boolean;
  stats: FinishBoardStats | null;
}

const gitStateByGroup = new Map<string, DashboardGitState>();

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const mRem = min % 60;
  return mRem > 0 ? `${hr}h ${mRem}m` : `${hr}h`;
}

function formatTokenCount(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

function ensureFinishReport(
  groupId: string,
  plannerChat: Chat,
  board: OrchestrateBoardState,
): string {
  const existing = board.finishReport?.trim();
  // Rebuild reports cached before the Completed tasks / LLM recommendations split.
  if (existing && !existing.includes('## Completed tasks')) {
    board.finishReport = buildDeterministicFinishReport(plannerChat, board);
    touchChat(plannerChat);
    scheduleSaveSessions();
  } else if (!existing) {
    board.finishReport = buildDeterministicFinishReport(plannerChat, board);
    touchChat(plannerChat);
    scheduleSaveSessions();
  }
  void enrichFinishReportWithRecommendations(groupId, plannerChat, board);
  void enrichFinishReportWithRunInstructions(groupId, plannerChat, board);
  return board.finishReport!.trim();
}

function collectBoardIssues(
  board: OrchestrateBoardState,
): Array<{ task: BoardTask; reason: string }> {
  const failingIds = new Set(board.finalTest?.failingTaskIds ?? []);
  const issues: Array<{ task: BoardTask; reason: string }> = [];

  for (const task of board.tasks) {
    if (task.status === 'quarantined') {
      const summary =
        task.quarantine?.summary?.trim() || task.error?.trim() || 'Quarantined';
      issues.push({ task, reason: summary });
      continue;
    }
    if (task.status === 'failed' || task.status === 'blocked') {
      issues.push({
        task,
        reason: task.error?.trim() || `Task ${task.status}`,
      });
      continue;
    }
    if (task.error?.trim()) {
      issues.push({ task, reason: task.error.trim() });
      continue;
    }
    if (task.testVerdict === 'fail') {
      issues.push({
        task,
        reason: task.testSummary?.trim() || 'Test verdict: fail',
      });
      continue;
    }
    if (failingIds.has(task.id)) {
      issues.push({
        task,
        reason: task.testSummary?.trim() || 'Failed final integration test',
      });
    }
  }
  return issues;
}

function buildFollowUpSeed(
  group: ChatGroup,
  plannerChat: Chat,
  board: OrchestrateBoardState,
  stats: FinishBoardStats | null,
): string {
  const planPath =
    group.orchestratePlanPath ??
    plannerChat.orchestratePlanPath ??
    board.planPath ??
    '';
  const tasks = board.tasks
    .filter((t) => t.status === 'complete')
    .map((t) => `- ${t.id}: ${t.title}`)
    .join('\n');
  const tokenLine =
    stats?.totalTokens != null
      ? `${stats.totalTokens.toLocaleString()} tokens`
      : 'token count unavailable';
  const elapsed = stats ? formatElapsed(stats.elapsedMs) : 'unknown duration';

  return [
    'Follow-up on a completed Orchestrate board.',
    '',
    `Board: ${group.name || planPath || group.id}`,
    `Plan: ${planPath || '(none)'}`,
    `Integration branch: ${board.integrationBranch ?? '(none)'}`,
    `Stats: ${elapsed}, ${tokenLine}`,
    '',
    'Completed tasks:',
    tasks || '(none listed)',
    '',
    'Help me review the integration work and decide what to do next.',
  ].join('\n');
}

function closeSplitMenu(menu: HTMLElement | null): void {
  menu?.remove();
}

type FinishGitActionKind =
  | 'commit'
  | 'clear'
  | 'cleared'
  /** No integration branch: commit the live workspace the agents wrote into. */
  | 'workspace-commit'
  | 'committed';

/** True when this board has an integration branch to merge from. */
function boardHasIntegration(board: OrchestrateBoardState): boolean {
  return Boolean(board.integrationBranch?.trim());
}

function resolveFinishGitActionKind(board: OrchestrateBoardState): FinishGitActionKind {
  // Isolation off — the work is already in the user's checkout, so there is
  // nothing to merge and no worktree to clear afterwards.
  if (!boardHasIntegration(board)) {
    return board.integrationLandedAt ? 'committed' : 'workspace-commit';
  }
  if (board.worktreesClearedAt) return 'cleared';
  if (board.integrationLandedAt) return 'clear';
  return 'commit';
}

/** Right-aligned footer slot shared by commit, clear-worktrees, and cleared label. */
function tagFinishGitAction(el: HTMLElement, kind: FinishGitActionKind): HTMLElement {
  el.classList.add('board-finish-dashboard__git-action');
  el.dataset.boardGitAction = kind;
  return el;
}

const FINISH_GIT_ACTION_KINDS: readonly FinishGitActionKind[] = [
  'commit',
  'clear',
  'cleared',
  'workspace-commit',
  'committed',
];

function readFinishGitActionKind(actions: HTMLElement): FinishGitActionKind | null {
  const el = actions.querySelector('[data-board-git-action]');
  const kind = el?.getAttribute('data-board-git-action');
  return FINISH_GIT_ACTION_KINDS.includes(kind as FinishGitActionKind)
    ? (kind as FinishGitActionKind)
    : null;
}

/** Mark integration landed and swap the primary git action to "Clear worktrees". */
function swapToClearWorktreesButton(
  wrap: HTMLElement,
  group: ChatGroup,
  board: OrchestrateBoardState,
  plannerChat: Chat,
  statusEl: HTMLElement,
): void {
  markBoardIntegrationLanded(group, plannerChat);
  const next = buildFinishGitAction(group, board, plannerChat, null, statusEl);
  wrap.replaceWith(next);
}

function buildClearWorktreesButton(
  group: ChatGroup,
  board: OrchestrateBoardState,
  plannerChat: Chat,
  statusEl: HTMLElement,
): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'board-btn board-btn--primary board-finish-dashboard__commit-primary';
  btn.textContent = 'Clear worktrees';
  btn.title = 'Remove all git worktrees created for this board';
  tagFinishGitAction(btn, 'clear');

  let busy = false;

  btn.addEventListener('click', () => {
    if (busy || board.worktreesClearedAt) return;
    busy = true;
    btn.disabled = true;
    statusEl.textContent = 'Removing board worktrees…';
    statusEl.dataset.kind = 'info';
    statusEl.hidden = false;

    void clearBoardWorktreesAfterLanding(group, plannerChat).then((res) => {
      busy = false;
      if (!res.ok) {
        btn.disabled = false;
        statusEl.textContent = res.error || 'Failed to clear worktrees';
        statusEl.dataset.kind = 'err';
        return;
      }
      btn.textContent = 'Worktrees cleared';
      btn.disabled = true;
      btn.title = 'All board worktrees have been removed';
      const removed = res.removed ?? 0;
      statusEl.textContent =
        removed > 0
          ? `Removed ${removed} worktree${removed === 1 ? '' : 's'}.`
          : 'Board worktrees cleared.';
      statusEl.dataset.kind = 'ok';
    });
  });

  return btn;
}

function buildWorktreesClearedLabel(): HTMLElement {
  const el = document.createElement('span');
  el.className = 'board-finish-dashboard__worktrees-cleared';
  el.textContent = 'Worktrees cleared';
  return tagFinishGitAction(el, 'cleared');
}

/** Terminal state for the no-worktree path — nothing left to clear. */
function buildWorkspaceCommittedLabel(): HTMLElement {
  const el = document.createElement('span');
  el.className = 'board-finish-dashboard__worktrees-cleared';
  el.textContent = 'Committed';
  return tagFinishGitAction(el, 'committed');
}

/** Primary git action on the finish dashboard: commit, clear worktrees, or cleared label. */
function buildFinishGitAction(
  group: ChatGroup,
  board: OrchestrateBoardState,
  plannerChat: Chat,
  git: FinishBoardStats | null,
  statusEl: HTMLElement,
): HTMLElement {
  const kind = resolveFinishGitActionKind(board);
  if (kind === 'committed') return buildWorkspaceCommittedLabel();
  if (kind === 'cleared') return buildWorktreesClearedLabel();
  if (kind === 'clear') {
    return buildClearWorktreesButton(group, board, plannerChat, statusEl);
  }
  return buildCommitSplitButton(group, board, plannerChat, git, statusEl);
}

function buildCommitSplitButton(
  group: ChatGroup,
  board: OrchestrateBoardState,
  plannerChat: Chat,
  git: FinishBoardStats | null,
  statusEl: HTMLElement,
): HTMLElement {
  // No integration branch: the agents wrote into the live checkout, so there is
  // nothing to merge — commit the workspace itself instead of dead-ending.
  const isWorkspaceMode = !boardHasIntegration(board);

  const wrap = document.createElement('div');
  wrap.className = isWorkspaceMode
    ? 'board-finish-dashboard__commit-split board-finish-dashboard__commit-split--workspace'
    : 'board-finish-dashboard__commit-split';
  tagFinishGitAction(wrap, isWorkspaceMode ? 'workspace-commit' : 'commit');

  const hasRemote = git?.hasRemote === true;
  const hasGh = git?.hasGh === true;

  let openMenu: HTMLElement | null = null;
  let busy = false;

  const setStatus = (text: string, kind: 'info' | 'ok' | 'err' = 'info'): void => {
    statusEl.textContent = text;
    statusEl.dataset.kind = kind;
    statusEl.hidden = !text;
  };

  /** After commit succeeds, persist landed state and swap to the follow-on action. */
  const finishLanding = (): void => {
    if (isWorkspaceMode) {
      // Nothing was ever checked out elsewhere, so there are no worktrees to clear.
      markBoardIntegrationLanded(group, plannerChat);
      wrap.replaceWith(buildWorkspaceCommittedLabel());
      return;
    }
    swapToClearWorktreesButton(wrap, group, board, plannerChat, statusEl);
  };

  const runChain = async (action: CommitAction): Promise<void> => {
    if (busy) return;
    const branch = board.integrationBranch?.trim();
    if (!branch && !isWorkspaceMode) {
      setStatus('No integration branch on this board.', 'err');
      return;
    }
    busy = true;
    primary.disabled = true;
    caret.disabled = true;

    const planName =
      board.planPath?.split('/').pop()?.replace(/\.md$/i, '') || 'Orchestrate board';
    const commitMsg = `feat: ${planName} (orchestrate board ${group.id})`;

    /** Did the run actually move work onto the current branch? */
    let merged = false;
    if (!isWorkspaceMode && branch) {
      setStatus('Merging integration branch into workspace…', 'info');
      const mergeRes = await mergeIntegrationIntoWorkspace({
        branch,
        message: `Merge ${branch}`,
      });
      if (!mergeRes.ok) {
        const detail = mergeRes.output || mergeRes.error || 'Merge failed';
        if (mergeRes.error === 'merge_conflict' || mergeRes.conflict) {
          setStatus(
            `Merge conflict — resolve in your workspace, then try again. ${detail}`,
            'err',
          );
        } else {
          setStatus(detail, 'err');
        }
        busy = false;
        primary.disabled = false;
        caret.disabled = false;
        return;
      }
      merged = mergeRes.merged === true;
    }

    setStatus(isWorkspaceMode ? 'Committing workspace changes…' : 'Committing…', 'info');
    const commitRes = await gitCommit({ message: commitMsg });
    const commitClean =
      !commitRes.ok &&
      typeof commitRes.error === 'string' &&
      commitRes.error.includes('nothing to commit');
    if (!commitRes.ok && !commitClean) {
      setStatus(commitRes.error || 'Commit failed', 'err');
      busy = false;
      primary.disabled = false;
      caret.disabled = false;
      return;
    }

    const hadNewCommit = commitRes.ok === true;

    if (action === 'commit-only') {
      if (hadNewCommit) {
        setStatus(
          isWorkspaceMode
            ? 'Committed workspace changes to your current branch.'
            : 'Merged and committed to your current branch.',
          'ok',
        );
      } else if (merged) {
        setStatus('Merged integration branch into your current branch.', 'ok');
      } else {
        setStatus(
          isWorkspaceMode
            ? 'Nothing to commit; workspace is clean.'
            : 'Integration branch already merged; workspace is clean.',
          'info',
        );
      }
      finishLanding();
      busy = false;
      return;
    }

    if (!hasRemote) {
      setStatus(
        hadNewCommit || merged
          ? 'Committed locally. No origin remote — push skipped.'
          : 'No origin remote — push skipped.',
        'ok',
      );
      finishLanding();
      busy = false;
      return;
    }

    setStatus('Pushing current branch…', 'info');
    const pushRes = await gitPush({});
    if (!pushRes.ok) {
      setStatus(pushRes.error || pushRes.stdout || 'Push failed', 'err');
      finishLanding();
      busy = false;
      return;
    }

    if (action === 'commit-push') {
      setStatus(
        isWorkspaceMode
          ? 'Committed and pushed your current branch.'
          : 'Merged and pushed your current branch.',
        'ok',
      );
      finishLanding();
      busy = false;
      return;
    }

    if (!hasGh) {
      setStatus('Committed and pushed. GitHub CLI not available — PR skipped.', 'ok');
      finishLanding();
      busy = false;
      return;
    }

    setStatus('Opening pull request…', 'info');
    const prRes = await openWorkspacePr({
      title: commitMsg,
      body: board.finishReport?.slice(0, 4000) || `Orchestrate board ${group.id}`,
    });
    if (!prRes.ok) {
      setStatus(
        `Committed and pushed. PR failed: ${prRes.output || prRes.error || 'unknown'}`,
        'err',
      );
    } else {
      const url = prRes.url ? ` ${prRes.url}` : '';
      setStatus(`Committed, pushed, and opened PR.${url}`, 'ok');
    }
    finishLanding();
    busy = false;
  };

  const primary = document.createElement('button');
  primary.type = 'button';
  primary.className = 'board-btn board-btn--primary board-finish-dashboard__commit-primary';
  primary.textContent = isWorkspaceMode ? 'Review & commit' : 'Commit & push';
  if (isWorkspaceMode) {
    const dirty = git?.filesTouched;
    const fileNote =
      typeof dirty === 'number' && dirty > 0
        ? ` (${dirty} changed file${dirty === 1 ? '' : 's'})`
        : '';
    primary.title = !hasRemote
      ? `Commit the workspace changes locally${fileNote} (no origin remote for push)`
      : !hasGh
        ? `Commit the workspace changes and push${fileNote}`
        : `Commit the workspace changes, push, and open a pull request${fileNote}`;
  } else if (!hasRemote) {
    primary.title = 'Merge into current branch and commit locally (no origin remote for push)';
  } else if (!hasGh) {
    primary.title = 'Merge into current branch, commit, and push';
  } else {
    primary.title = 'Merge into current branch, commit, push, and open a pull request';
  }
  primary.addEventListener('click', () => {
    void runChain(hasRemote && hasGh ? 'commit-push-pr' : hasRemote ? 'commit-push' : 'commit-only');
  });

  const caret = document.createElement('button');
  caret.type = 'button';
  caret.className = 'board-finish-dashboard__commit-caret';
  caret.setAttribute('aria-haspopup', 'menu');
  caret.setAttribute('aria-expanded', 'false');
  caret.setAttribute('aria-label', 'More commit options');
  caret.textContent = '▾';

  caret.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (openMenu) {
      closeSplitMenu(openMenu);
      openMenu = null;
      caret.setAttribute('aria-expanded', 'false');
      return;
    }

    const menu = document.createElement('div');
    menu.className = 'board-finish-dashboard__commit-menu';
    menu.setAttribute('role', 'menu');

    const options: Array<{ id: CommitAction; label: string; disabled: boolean; hint?: string }> =
      [
        {
          id: 'commit-push-pr',
          label: 'Commit + push + open PR',
          disabled: !hasRemote || !hasGh,
          hint: !hasRemote
            ? 'No origin remote'
            : !hasGh
              ? 'gh CLI not available'
              : undefined,
        },
        {
          id: 'commit-push',
          label: 'Commit + push',
          disabled: !hasRemote,
          hint: !hasRemote ? 'No origin remote' : undefined,
        },
        { id: 'commit-only', label: 'Commit only', disabled: false },
      ];

    for (const opt of options) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'board-finish-dashboard__commit-menuitem';
      item.setAttribute('role', 'menuitem');
      item.textContent = opt.label;
      item.disabled = opt.disabled;
      if (opt.hint) item.title = opt.hint;
      item.addEventListener('click', (itemEv) => {
        itemEv.stopPropagation();
        closeSplitMenu(menu);
        openMenu = null;
        caret.setAttribute('aria-expanded', 'false');
        void runChain(opt.id);
      });
      menu.appendChild(item);
    }

    wrap.appendChild(menu);
    openMenu = menu;
    caret.setAttribute('aria-expanded', 'true');

    const onDoc = (docEv: MouseEvent): void => {
      const t = docEv.target as Node;
      if (menu.contains(t) || caret.contains(t)) return;
      closeSplitMenu(menu);
      openMenu = null;
      caret.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', onDoc, true);
    };
    const onKey = (keyEv: KeyboardEvent): void => {
      if (keyEv.key === 'Escape') {
        closeSplitMenu(menu);
        openMenu = null;
        caret.setAttribute('aria-expanded', 'false');
        document.removeEventListener('keydown', onKey);
      }
    };
    requestAnimationFrame(() => {
      document.addEventListener('click', onDoc, true);
      document.addEventListener('keydown', onKey);
    });
  });

  wrap.appendChild(primary);
  wrap.appendChild(caret);

  // Committing the live checkout is unreviewed by definition — offer the diff first.
  if (isWorkspaceMode) {
    const review = document.createElement('button');
    review.type = 'button';
    review.className = 'board-finish-dashboard__review-link';
    review.textContent = 'Open in Source Control';
    review.title = 'Review the uncommitted workspace changes before committing';
    review.addEventListener('click', () => {
      void openSourceControlCenterLazy({ section: 'changes' });
    });
    wrap.appendChild(review);
  }

  return wrap;
}

function renderStatsGrid(stats: FinishBoardStats, grid: HTMLElement): void {
  grid.replaceChildren();

  const cells: Array<{ label: string; value: string }> = [
    { label: 'Elapsed', value: formatElapsed(stats.elapsedMs) },
    {
      label: 'Tokens',
      value: formatTokenCount(stats.totalTokens),
    },
    {
      label: 'Files',
      value: stats.gitStatsLoading
        ? '…'
        : stats.filesTouched != null
          ? String(stats.filesTouched)
          : '—',
    },
    {
      label: 'Lines',
      value: stats.gitStatsLoading
        ? '…'
        : stats.additions != null && stats.deletions != null
          ? `+${stats.additions} / −${stats.deletions}`
          : '—',
    },
  ];

  for (const cell of cells) {
    const el = document.createElement('div');
    el.className = 'board-finish-dashboard__stat';
    const label = document.createElement('span');
    label.className = 'board-finish-dashboard__stat-label';
    label.textContent = cell.label;
    const value = document.createElement('span');
    value.className = 'board-finish-dashboard__stat-value';
    value.textContent = cell.value;
    el.appendChild(label);
    el.appendChild(value);
    grid.appendChild(el);
  }
}

function syncFinishGitAction(
  root: HTMLElement,
  group: ChatGroup,
  board: OrchestrateBoardState,
  plannerChat: Chat,
): void {
  const actions = root.querySelector('.board-finish-dashboard__actions');
  const statusEl = root.querySelector('.board-finish-dashboard__git-status');
  if (!(actions instanceof HTMLElement) || !(statusEl instanceof HTMLElement)) return;

  const expected = resolveFinishGitActionKind(board);
  if (readFinishGitActionKind(actions) === expected) return;

  const existing = actions.querySelector('[data-board-git-action]');
  const git = gitStateByGroup.get(group.id)?.stats ?? null;
  const next = buildFinishGitAction(group, board, plannerChat, git, statusEl);
  if (existing) {
    existing.replaceWith(next);
  } else {
    actions.appendChild(next);
  }
}

function loadGitStats(
  group: ChatGroup,
  board: OrchestrateBoardState,
  plannerChat: Chat,
  grid: HTMLElement,
  commitWrap: HTMLElement,
  statusEl: HTMLElement,
): void {
  let state = gitStateByGroup.get(group.id);
  if (!state) {
    const local = computeLocalFinishStats(plannerChat, board);
    state = {
      loading: true,
      stats: {
        ...local,
        filesTouched: null,
        additions: null,
        deletions: null,
        hasRemote: false,
        hasGh: false,
        gitStatsLoading: true,
      },
    };
    gitStateByGroup.set(group.id, state);
  }

  if (state.stats) renderStatsGrid(state.stats, grid);
  if (state.loading) {
    void fetchGitFinishStats(board.integrationBranch ?? '').then((gitPart) => {
      const local = computeLocalFinishStats(plannerChat, board);
      const merged: FinishBoardStats = {
        ...local,
        ...gitPart,
        gitStatsLoading: false,
      };
      gitStateByGroup.set(group.id, { loading: false, stats: merged });
      renderStatsGrid(merged, grid);

      if (gitPart.alreadyLanded && !board.integrationLandedAt && !board.worktreesClearedAt) {
        markBoardIntegrationLanded(group, plannerChat);
      }

      const panel = commitWrap.closest('.board-finish-dashboard');
      if (panel instanceof HTMLElement) {
        syncFinishGitAction(panel, group, board, plannerChat);
        return;
      }

      if (board.integrationLandedAt || board.worktreesClearedAt) {
        commitWrap.replaceWith(
          buildFinishGitAction(group, board, plannerChat, merged, statusEl),
        );
        return;
      }
      const newCommit = buildCommitSplitButton(group, board, plannerChat, merged, statusEl);
      commitWrap.replaceWith(newCommit);
    });
  }
}

/** Update elapsed (stats) and report markdown without rebuilding the whole dashboard. */
export function syncFinishDashboard(
  root: HTMLElement,
  group: ChatGroup,
  plannerChat: Chat,
  board: OrchestrateBoardState,
): void {
  const grid = root.querySelector('.board-finish-dashboard__stats');
  if (!(grid instanceof HTMLElement)) return;
  const state = gitStateByGroup.get(group.id);
  const local = computeLocalFinishStats(plannerChat, board);
  const merged: FinishBoardStats = {
    ...(state?.stats ?? {
      filesTouched: null,
      additions: null,
      deletions: null,
      hasRemote: false,
      hasGh: false,
      gitStatsLoading: state?.loading ?? false,
    }),
    ...local,
  };
  if (state?.stats) {
    state.stats.elapsedMs = local.elapsedMs;
    state.stats.totalTokens = local.totalTokens;
    state.stats.promptTokens = local.promptTokens;
    state.stats.completionTokens = local.completionTokens;
  }
  renderStatsGrid(merged, grid);

  syncFinishGitAction(root, group, board, plannerChat);

  const reportBody = root.querySelector('.board-finish-dashboard__report');
  const reportMarkdown = board.finishReport?.trim();
  if (reportBody instanceof HTMLElement && reportMarkdown) {
    if (reportBody.dataset.finishReport !== reportMarkdown) {
      reportBody.dataset.finishReport = reportMarkdown;
      setAssistantBubbleContent(reportBody, reportMarkdown, { modeId: plannerChat.modeId });
    }
  }
}

/** Build the finish dashboard root element. */
export function renderFinishDashboard(
  group: ChatGroup,
  plannerChat: Chat,
  board: OrchestrateBoardState,
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'board-finish-dashboard';
  root.dataset.boardGroupId = group.id;

  const panel = document.createElement('div');
  panel.className = 'board-finish-dashboard__panel';

  const passedFinal = isOrchestrateBoardFinished(board);
  const finalFailed = isOrchestrateFinalTestFailedWithAllTasksComplete(board);
  const blockedRun = board.terminalBlocked === true || finalFailed;

  const hero = document.createElement('div');
  hero.className = 'board-finish-dashboard__hero';
  const badge = document.createElement('div');
  badge.className = 'board-finish-dashboard__badge';
  badge.setAttribute('aria-hidden', 'true');
  badge.textContent = passedFinal ? '✓' : '!';
  const heroCopy = document.createElement('div');
  heroCopy.className = 'board-finish-dashboard__hero-copy';
  const title = document.createElement('h3');
  title.className = 'board-finish-dashboard__title';
  title.textContent = passedFinal
    ? 'Board complete'
    : blockedRun
      ? 'Board blocked'
      : 'Board finished';
  const subtitle = document.createElement('p');
  subtitle.className = 'board-finish-dashboard__subtitle';
  subtitle.textContent = passedFinal
    ? 'All tasks passed the final integration test. Review the summary below, merge into your branch, or start a follow-up chat.'
    : finalFailed
      ? 'Tasks merged, but the final integration test failed. Use Fix integration failures to add a fix task seeded from the tester report, or rerun failed tasks.'
      : 'Some tasks are quarantined or blocked. Rerun failed tasks to put them back on the board and resume auto run.';
  heroCopy.appendChild(title);
  heroCopy.appendChild(subtitle);
  hero.appendChild(badge);
  hero.appendChild(heroCopy);
  panel.appendChild(hero);

  // What the tester actually said, rather than only the generic subtitle.
  if (finalFailed) {
    const detail = document.createElement('div');
    detail.className = 'board-finish-dashboard__final-test';
    detail.dataset.boardSection = 'final-test-failure';

    const heading = document.createElement('h4');
    heading.className = 'board-finish-dashboard__section-title';
    heading.textContent = 'Final integration test';
    detail.appendChild(heading);

    const summary = document.createElement('p');
    summary.className = 'board-finish-dashboard__final-test-summary';
    summary.textContent =
      board.finalTest?.summary?.trim() || 'The tester reported a failure without a summary.';
    detail.appendChild(summary);

    const failingIds = board.finalTest?.failingTaskIds ?? [];
    if (failingIds.length) {
      const blamed = document.createElement('p');
      blamed.className = 'board-finish-dashboard__final-test-tasks';
      blamed.textContent = `Tasks held responsible: ${failingIds.join(', ')}`;
      detail.appendChild(blamed);
    }
    panel.appendChild(detail);
  }

  const statsGrid = document.createElement('div');
  statsGrid.className = 'board-finish-dashboard__stats';
  statsGrid.setAttribute('aria-label', 'Board run stats');
  panel.appendChild(statsGrid);

  const issues = collectBoardIssues(board);
  const issuesSection = document.createElement('section');
  issuesSection.className = 'board-finish-dashboard__section';
  const issuesHeading = document.createElement('h4');
  issuesHeading.className = 'board-finish-dashboard__section-title';
  issuesHeading.textContent = 'Issues';
  issuesSection.appendChild(issuesHeading);
  if (issues.length === 0) {
    const none = document.createElement('p');
    none.className = 'board-finish-dashboard__issues-none';
    none.textContent = 'No blocked or failed tasks.';
    issuesSection.appendChild(none);
  } else {
    const list = document.createElement('ul');
    list.className = 'board-finish-dashboard__issues-list';
    for (const { task, reason } of issues) {
      const li = document.createElement('li');
      li.className = 'board-finish-dashboard__issue';
      const id = document.createElement('span');
      id.className = 'board-finish-dashboard__issue-id';
      id.textContent = task.id;
      const text = document.createElement('span');
      text.className = 'board-finish-dashboard__issue-text';
      text.textContent = reason;
      li.appendChild(id);
      li.appendChild(text);
      if (task.chatId) {
        const chat = findChatById(task.chatId);
        if (chat) {
          const link = document.createElement('button');
          link.type = 'button';
          link.className = 'board-finish-dashboard__issue-link';
          link.textContent = 'Open task chat';
          link.addEventListener('click', () => {
            void import('./sidebar.ts').then((m) => m.switchChat(task.chatId!));
          });
          li.appendChild(link);
        }
      }
      list.appendChild(li);
    }
    issuesSection.appendChild(list);
  }
  panel.appendChild(issuesSection);

  const reportSection = document.createElement('section');
  reportSection.className = 'board-finish-dashboard__section';
  const reportHeading = document.createElement('h4');
  reportHeading.className = 'board-finish-dashboard__section-title';
  reportHeading.textContent = 'Report';
  const reportBody = document.createElement('div');
  reportBody.className = 'board-finish-dashboard__report msg-bubble msg-bubble--md';
  const reportMarkdown = ensureFinishReport(group.id, plannerChat, board);
  setAssistantBubbleContent(reportBody, reportMarkdown, { modeId: plannerChat.modeId });
  reportSection.appendChild(reportHeading);
  reportSection.appendChild(reportBody);
  panel.appendChild(reportSection);

  const footer = document.createElement('div');
  footer.className = 'board-finish-dashboard__footer';

  const actions = document.createElement('div');
  actions.className = 'board-finish-dashboard__actions';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'board-btn board-btn--compact';
  backBtn.textContent = 'Back to board';
  backBtn.addEventListener('click', () => {
    board.dashboardDismissed = true;
    touchChat(plannerChat);
    scheduleSaveSessions();
    emitBoardChange(group.id);
  });

  // No mode gate: an AFK board's failures are exactly as rerunnable as any other's.
  const showRerunFailed = boardHasRecoverableTasks(board) || finalFailed;
  let rerunBtn: HTMLButtonElement | null = null;
  if (showRerunFailed) {
    rerunBtn = document.createElement('button');
    rerunBtn.type = 'button';
    rerunBtn.className = 'board-btn board-btn--compact board-btn--primary';
    rerunBtn.textContent = 'Rerun failed tasks';
    rerunBtn.title = 'Requeue failed, blocked, or quarantined tasks and restart the board';
    rerunBtn.addEventListener('click', () => {
      rerunBtn!.disabled = true;
      void restartBoardAfterRequeueFailures(group, plannerChat)
        .then(() => emitBoardChange(group.id))
        .finally(() => {
          rerunBtn!.disabled = false;
        });
    });
  }

  // The final test failing is a gap *between* tasks that each passed their own
  // tests, so reopening those tasks is the wrong shape — append a real fix task.
  let fixBtn: HTMLButtonElement | null = null;
  if (finalFailed) {
    fixBtn = document.createElement('button');
    fixBtn.type = 'button';
    fixBtn.className = 'board-btn board-btn--compact board-btn--primary';
    fixBtn.dataset.boardAction = 'fix-final-test';
    fixBtn.textContent = 'Fix integration failures';
    fixBtn.title =
      'Add a fix task in a new wave seeded from the tester report, then re-run the final test';
    fixBtn.addEventListener('click', () => {
      fixBtn!.disabled = true;
      void appendFinalTestFixTask(group, plannerChat)
        .then(() => emitBoardChange(group.id))
        .finally(() => {
          fixBtn!.disabled = false;
        });
    });
  }

  const followUpBtn = document.createElement('button');
  followUpBtn.type = 'button';
  followUpBtn.className = 'board-btn board-btn--compact';
  followUpBtn.textContent = 'Start follow-up chat';
  followUpBtn.addEventListener('click', () => {
    const git = gitStateByGroup.get(group.id)?.stats ?? null;
    const local = computeLocalFinishStats(plannerChat, board);
    const stats: FinishBoardStats = git ?? {
      ...local,
      filesTouched: null,
      additions: null,
      deletions: null,
      hasRemote: false,
      hasGh: false,
      gitStatsLoading: false,
    };
    createChatWithMode({
      modeId: 'general',
      initialUserMessage: buildFollowUpSeed(group, plannerChat, board, stats),
    });
  });

  const gitStatus = document.createElement('p');
  gitStatus.className = 'board-finish-dashboard__git-status';
  gitStatus.hidden = true;
  gitStatus.setAttribute('role', 'status');

  const commitWrap = buildFinishGitAction(group, board, plannerChat, null, gitStatus);

  actions.appendChild(backBtn);
  if (fixBtn) actions.appendChild(fixBtn);
  if (rerunBtn) actions.appendChild(rerunBtn);
  actions.appendChild(followUpBtn);
  actions.appendChild(commitWrap);
  footer.appendChild(actions);
  footer.appendChild(gitStatus);
  panel.appendChild(footer);
  root.appendChild(panel);

  const local = computeLocalFinishStats(plannerChat, board);
  renderStatsGrid(
    {
      ...local,
      filesTouched: null,
      additions: null,
      deletions: null,
      hasRemote: false,
      hasGh: false,
      gitStatsLoading: true,
    },
    statsGrid,
  );
  loadGitStats(group, board, plannerChat, statsGrid, commitWrap, gitStatus);

  return root;
}

/** Clear cached git stats (test teardown). */
export function clearFinishDashboardStateForTests(): void {
  gitStateByGroup.clear();
}
