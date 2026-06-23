/**
 * Finish dashboard shown when an Orchestrate board completes (MIN-208).
 */

import {
  buildDeterministicFinishReport,
  computeLocalFinishStats,
  fetchGitFinishStats,
  type FinishBoardStats,
} from '../chat/orchestrate/finish-stats.ts';
import { setAssistantBubbleContent } from '../markdown/renderer.ts';
import { emitBoardChange } from '../state/orchestrate-board-events.ts';
import {
  commitIntegration,
  openIntegrationPr,
  pushIntegration,
} from '../state/worktree-service.ts';
import {
  findChatById,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions.ts';
import type { BoardTask, Chat, ChatGroup, OrchestrateBoardState } from '../types.ts';
import { createChatWithMode } from './sidebar.ts';

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

function ensureFinishReport(plannerChat: Chat, board: OrchestrateBoardState): string {
  if (board.finishReport?.trim()) return board.finishReport.trim();
  const report = buildDeterministicFinishReport(plannerChat, board);
  board.finishReport = report;
  touchChat(plannerChat);
  scheduleSaveSessions();
  return report;
}

function collectBoardIssues(
  board: OrchestrateBoardState,
): Array<{ task: BoardTask; reason: string }> {
  const failingIds = new Set(board.finalTest?.failingTaskIds ?? []);
  const issues: Array<{ task: BoardTask; reason: string }> = [];

  for (const task of board.tasks) {
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

function buildCommitSplitButton(
  group: ChatGroup,
  board: OrchestrateBoardState,
  git: FinishBoardStats | null,
  statusEl: HTMLElement,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'board-finish-dashboard__commit-split';

  const hasRemote = git?.hasRemote === true;
  const hasGh = git?.hasGh === true;

  let openMenu: HTMLElement | null = null;
  let busy = false;

  const setStatus = (text: string, kind: 'info' | 'ok' | 'err' = 'info'): void => {
    statusEl.textContent = text;
    statusEl.dataset.kind = kind;
    statusEl.hidden = !text;
  };

  const runChain = async (action: CommitAction): Promise<void> => {
    if (busy) return;
    const branch = board.integrationBranch?.trim();
    if (!branch) {
      setStatus('No integration branch on this board.', 'err');
      return;
    }
    busy = true;
    primary.disabled = true;
    caret.disabled = true;
    setStatus('Committing…', 'info');

    const planName =
      board.planPath?.split('/').pop()?.replace(/\.md$/i, '') || 'Orchestrate board';
    const commitMsg = `feat: ${planName} (orchestrate board ${group.id})`;

    const commitRes = await commitIntegration({
      boardId: group.id,
      message: commitMsg,
    });
    if (!commitRes.ok) {
      setStatus(commitRes.output || commitRes.error || 'Commit failed', 'err');
      busy = false;
      primary.disabled = false;
      caret.disabled = false;
      return;
    }
    if (!commitRes.committed) {
      setStatus('Working tree clean — nothing to commit.', 'info');
      busy = false;
      primary.disabled = false;
      caret.disabled = false;
      return;
    }

    if (action === 'commit-only') {
      setStatus('Committed to integration branch.', 'ok');
      busy = false;
      primary.disabled = false;
      caret.disabled = false;
      return;
    }

    if (!hasRemote) {
      setStatus('Committed locally. No origin remote — push skipped.', 'ok');
      busy = false;
      primary.disabled = false;
      caret.disabled = false;
      return;
    }

    setStatus('Pushing to origin…', 'info');
    const pushRes = await pushIntegration({ boardId: group.id, branch });
    if (!pushRes.ok || !pushRes.pushed) {
      setStatus(pushRes.output || pushRes.error || 'Push failed', 'err');
      busy = false;
      primary.disabled = false;
      caret.disabled = false;
      return;
    }

    if (action === 'commit-push') {
      setStatus(`Pushed \`${branch}\` to origin.`, 'ok');
      busy = false;
      primary.disabled = false;
      caret.disabled = false;
      return;
    }

    if (!hasGh) {
      setStatus(`Pushed \`${branch}\`. GitHub CLI not available — PR skipped.`, 'ok');
      busy = false;
      primary.disabled = false;
      caret.disabled = false;
      return;
    }

    setStatus('Opening pull request…', 'info');
    const prRes = await openIntegrationPr({
      boardId: group.id,
      branch,
      title: commitMsg,
      body: board.finishReport?.slice(0, 4000) || `Orchestrate board ${group.id}`,
    });
    if (!prRes.ok) {
      setStatus(
        `Pushed \`${branch}\`. PR failed: ${prRes.output || prRes.error || 'unknown'}`,
        'err',
      );
    } else {
      const url = prRes.url ? ` ${prRes.url}` : '';
      setStatus(`Pushed and opened PR.${url}`, 'ok');
    }
    busy = false;
    primary.disabled = false;
    caret.disabled = false;
  };

  const primary = document.createElement('button');
  primary.type = 'button';
  primary.className = 'board-btn board-btn--primary board-finish-dashboard__commit-primary';
  primary.textContent = 'Commit & push';
  if (!hasRemote) {
    primary.title = 'Will commit locally (no origin remote for push)';
  } else if (!hasGh) {
    primary.title = 'Commit and push (GitHub CLI not available for PR)';
  } else {
    primary.title = 'Commit, push, and open a pull request';
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
    void fetchGitFinishStats(group.id, board.isolationBaseRef).then((gitPart) => {
      const local = computeLocalFinishStats(plannerChat, board);
      const merged: FinishBoardStats = {
        ...local,
        ...gitPart,
        gitStatsLoading: false,
      };
      gitStateByGroup.set(group.id, { loading: false, stats: merged });
      renderStatsGrid(merged, grid);
      const newCommit = buildCommitSplitButton(group, board, merged, statusEl);
      commitWrap.replaceWith(newCommit);
    });
  }
}

/** Update elapsed (and other live fields) without rebuilding the whole dashboard. */
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

  const hero = document.createElement('div');
  hero.className = 'board-finish-dashboard__hero';
  const badge = document.createElement('div');
  badge.className = 'board-finish-dashboard__badge';
  badge.setAttribute('aria-hidden', 'true');
  badge.textContent = '✓';
  const heroCopy = document.createElement('div');
  heroCopy.className = 'board-finish-dashboard__hero-copy';
  const title = document.createElement('h3');
  title.className = 'board-finish-dashboard__title';
  title.textContent = 'Board complete';
  const subtitle = document.createElement('p');
  subtitle.className = 'board-finish-dashboard__subtitle';
  subtitle.textContent =
    'All tasks passed the final integration test. Review the summary below, then land the work or start a follow-up chat.';
  heroCopy.appendChild(title);
  heroCopy.appendChild(subtitle);
  hero.appendChild(badge);
  hero.appendChild(heroCopy);
  panel.appendChild(hero);

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
  const reportMarkdown = ensureFinishReport(plannerChat, board);
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

  const commitWrap = buildCommitSplitButton(group, board, null, gitStatus);

  actions.appendChild(backBtn);
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
