/**
 * Orchestrate Board View: Kanban, plan panel, controls.
 */

import {
  deriveOrchestratorLastActivity,
  type OrchestratorActivity,
} from '../chat/orchestrate/last-activity';
import { stopGeneration } from '../chat/stop-generation';
import { isActiveChatStreaming } from '../chat/streaming-state';
import {
  cancelAllForParentTurn,
  getSubAgentRun,
  listActiveSubAgentRuns,
} from '../agents/orchestrator';
import { subscribeSubAgentRuns } from '../agents/sub-agent-events';
import type { SubAgentStatus } from '../agents/types';
import { getBoardProgressPercent } from '../state/orchestrate-board-store';
import { subscribeBoardChanges } from '../state/orchestrate-board-events';
import { getActiveChat, scheduleSaveSessions, touchChat } from '../state/sessions';
import type {
  BoardTask,
  BoardTaskStatus,
  Chat,
  PersistedSubAgentStatus,
} from '../types';
import { openSubAgentDrawer } from './sub-agent-drawer';
import {
  ensureBoardChatViewToggle,
  isOrchestrateBoardViewActive,
  setOrchestrateViewMode,
  syncViewModeToggleFromActiveChat,
} from './view-mode-toggle';

/** Agent status chip on a kanban task card. */
export type TaskAgentBadgeVariant = 'active' | 'failed' | 'complete';

export interface TaskAgentBadge {
  variant: TaskAgentBadgeVariant;
  label: string;
}

type RunStatusHint = SubAgentStatus | PersistedSubAgentStatus | null | undefined;

/** True when the user stopped the latest assistant message in this chat. */
function isUserStoppedChat(chat: Chat): boolean {
  for (let i = chat.history.length - 1; i >= 0; i--) {
    const msg = chat.history[i];
    if (msg.role === 'assistant' && 'stopped' in msg && msg.stopped) {
      return true;
    }
    if (msg.role === 'user') {
      return false;
    }
  }
  return false;
}

/** Badge copy for tasks linked to a sub-agent run (Active / Failed / Complete). */
export function deriveTaskAgentBadge(
  task: BoardTask,
  runStatus?: RunStatusHint,
): TaskAgentBadge | null {
  if (!task.assignedRunId?.trim()) return null;

  if (task.status === 'failed' || runStatus === 'failed' || runStatus === 'cancelled') {
    return { variant: 'failed', label: 'Failed' };
  }
  if (
    task.status === 'in_progress' ||
    task.status === 'testing' ||
    runStatus === 'queued' ||
    runStatus === 'running'
  ) {
    return { variant: 'active', label: 'Active' };
  }
  if (task.status === 'complete' || runStatus === 'completed') {
    return { variant: 'complete', label: 'Complete' };
  }
  return null;
}

/** Resolve live or persisted sub-agent status for a board task run id. */
function resolveRunStatusForTask(chat: Chat, runId: string): RunStatusHint {
  const live = getSubAgentRun(runId);
  if (live && live.parentChatId === chat.id) return live.status;
  return chat.subAgentRuns?.find((r) => r.runId === runId)?.status ?? null;
}

/** True when the task shows an agent badge and can open the sub-agent drawer. */
export function canOpenBoardTaskSubAgent(
  task: BoardTask,
  runStatus?: RunStatusHint,
): boolean {
  return deriveTaskAgentBadge(task, runStatus) !== null;
}

const RESUME_MESSAGE =
  "Resume the plan. Call board_get_state and continue from the first task whose status is not 'complete'.";

interface BoardSession {
  chatId: string;
  unsubBoard: () => void;
  unsubAgents: () => void;
}

let currentSession: BoardSession | null = null;
let boardLiveTickTimer: ReturnType<typeof setInterval> | null = null;

const BOARD_LIVE_TICK_MS = 1000;

function stopBoardLiveTick(): void {
  if (boardLiveTickTimer == null) return;
  clearInterval(boardLiveTickTimer);
  boardLiveTickTimer = null;
}

function startBoardLiveTick(): void {
  stopBoardLiveTick();
  boardLiveTickTimer = setInterval(() => {
    if (!isOrchestrateBoardViewActive()) {
      stopBoardLiveTick();
      return;
    }
    refreshActiveBoardIfMounted();
  }, BOARD_LIVE_TICK_MS);
}

function disposeBoardSession(): void {
  stopBoardLiveTick();
  if (!currentSession) return;
  currentSession.unsubBoard();
  currentSession.unsubAgents();
  currentSession = null;
}

/** Refresh board UI when store or sub-agents change (stable handler per chat). */
function scheduleBoardUiRefresh(chatId: string): void {
  if (!isOrchestrateBoardViewActive()) return;
  if (getActiveChat().id !== chatId) return;
  refreshActiveBoardIfMounted();
}

/** Wire board + sub-agent listeners once per chat (idempotent). */
function ensureBoardSession(chatId: string): void {
  if (currentSession?.chatId === chatId) return;
  disposeBoardSession();
  currentSession = {
    chatId,
    unsubBoard: subscribeBoardChanges(chatId, () => scheduleBoardUiRefresh(chatId)),
    unsubAgents: subscribeSubAgentRuns((run) => {
      if (run.parentChatId === chatId) scheduleBoardUiRefresh(chatId);
    }),
  };
  startBoardLiveTick();
}

function shortPlanName(planPath: string): string {
  return planPath.replace(/^documentation\/plans\//, '');
}

/** Visual + copy variant for the board header status badge. */
export type BoardHeaderStatusVariant =
  | 'running'
  | 'active'
  | 'paused'
  | 'ready'
  | 'complete'
  | 'failed'
  | 'blocked'
  | 'stopped';

export interface BoardHeaderStatus {
  variant: BoardHeaderStatusVariant;
  label: string;
}

/** Derive orchestration status from board tasks, sub-agents, and parent stream. */
export function deriveBoardHeaderStatus(
  board: NonNullable<Chat['orchestrateBoard']>,
  isStreaming: boolean,
  activeRunCount: number,
  userStopped = false,
): BoardHeaderStatus {
  const tasks = board.tasks;
  const total = tasks.length;
  const completeCount = tasks.filter((t) => t.status === 'complete').length;
  const hasFailed = tasks.some((t) => t.status === 'failed');
  const hasBlocked = tasks.some((t) => t.status === 'blocked');
  const hasInFlight = tasks.some(
    (t) => t.status === 'in_progress' || t.status === 'testing',
  );

  if (isStreaming && board.activeParentTurnId) {
    return { variant: 'running', label: 'Running' };
  }
  if (userStopped && total > 0 && completeCount < total) {
    return { variant: 'stopped', label: 'Stopped' };
  }
  if (hasFailed) {
    return { variant: 'failed', label: 'Failed' };
  }
  if (hasBlocked && activeRunCount === 0 && !hasInFlight) {
    return { variant: 'blocked', label: 'Blocked' };
  }
  if (total > 0 && completeCount === total) {
    return { variant: 'complete', label: 'Complete' };
  }
  if (activeRunCount > 0 || hasInFlight) {
    return { variant: 'active', label: 'Active' };
  }
  if (completeCount > 0) {
    return { variant: 'paused', label: 'Paused' };
  }
  return { variant: 'ready', label: 'Ready' };
}

function buildBoardStatusBadge(status: BoardHeaderStatus): HTMLElement {
  const badge = document.createElement('span');
  badge.className = `board-header__badge board-header__badge--${status.variant}`;
  badge.setAttribute('role', 'status');
  const dot = document.createElement('span');
  dot.className = 'board-header__badge-dot';
  dot.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'board-header__badge-label';
  label.textContent = status.label;
  badge.appendChild(dot);
  badge.appendChild(label);
  return badge;
}

function syncBoardHeaderStatusBadge(
  header: Element,
  status: BoardHeaderStatus,
): void {
  const badge = header.querySelector('.board-header__badge');
  if (!(badge instanceof HTMLElement)) return;
  badge.className = `board-header__badge board-header__badge--${status.variant}`;
  const label = badge.querySelector('.board-header__badge-label');
  if (label) label.textContent = status.label;
}

const ACTIVITY_KIND_LABEL: Record<OrchestratorActivity['kind'], string> = {
  tool: 'Tool',
  message: 'Message',
  thinking: 'Thinking',
  waiting: 'Working',
};

function wireBoardActivityOpenChat(chip: HTMLElement): void {
  if (chip.dataset.boardActivityWired === 'true') return;
  chip.dataset.boardActivityWired = 'true';
  chip.addEventListener('click', () => setOrchestrateViewMode('chat'));
}

function buildBoardActivityBadge(activity: OrchestratorActivity): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `board-header__activity board-header__activity--${activity.kind}`;
  el.setAttribute('aria-label', `Open chat view: ${activity.title}`);
  el.title = `${activity.title}\nClick to open chat view`;
  const kind = document.createElement('span');
  kind.className = 'board-header__activity-kind';
  kind.setAttribute('aria-hidden', 'true');
  kind.textContent = ACTIVITY_KIND_LABEL[activity.kind];
  const text = document.createElement('span');
  text.className = 'board-header__activity-text';
  text.textContent = activity.text;
  el.appendChild(kind);
  el.appendChild(text);
  wireBoardActivityOpenChat(el);
  return el;
}

function syncBoardHeaderActivity(
  header: Element,
  activity: OrchestratorActivity | null,
): void {
  const leading = header.querySelector('.board-header__leading');
  if (!leading) return;
  let chip = leading.querySelector('.board-header__activity');
  if (!activity) {
    chip?.remove();
    return;
  }
  if (!(chip instanceof HTMLElement)) {
    const statusBadge = leading.querySelector('.board-header__badge');
    const next = buildBoardActivityBadge(activity);
    if (statusBadge) {
      statusBadge.insertAdjacentElement('afterend', next);
    } else {
      leading.appendChild(next);
    }
    return;
  }
  wireBoardActivityOpenChat(chip);
  chip.className = `board-header__activity board-header__activity--${activity.kind}`;
  chip.setAttribute('aria-label', `Open chat view: ${activity.title}`);
  chip.title = `${activity.title}\nClick to open chat view`;
  const kindEl = chip.querySelector('.board-header__activity-kind');
  const textEl = chip.querySelector('.board-header__activity-text');
  if (kindEl) kindEl.textContent = ACTIVITY_KIND_LABEL[activity.kind];
  if (textEl) textEl.textContent = activity.text;
}

function resumeButtonLabel(status: BoardHeaderStatus): string {
  if (status.variant === 'stopped' || status.variant === 'ready') return 'Start';
  return 'Resume';
}

function wireBoardHeaderControls(
  controls: HTMLElement,
  chat: Chat,
  board: NonNullable<Chat['orchestrateBoard']>,
  planPath: string,
  isStreaming: boolean,
  headerStatus: BoardHeaderStatus,
): void {
  controls.replaceChildren();

  const openPlan = document.createElement('button');
  openPlan.type = 'button';
  openPlan.className = 'board-btn';
  openPlan.dataset.boardAction = 'open-plan';
  openPlan.textContent = 'Open plan';
  openPlan.disabled = !planPath;
  openPlan.title = planPath ? `Open ${planPath} in file viewer` : 'No plan path set';
  openPlan.addEventListener('click', () => {
    if (!planPath) return;
    void import('./file-viewer').then((m) => m.openFileInViewer(planPath));
  });

  const resume = document.createElement('button');
  resume.type = 'button';
  resume.className = 'board-btn board-btn--primary';
  resume.dataset.boardAction = 'resume';
  resume.textContent = resumeButtonLabel(headerStatus);
  resume.disabled = isStreaming;
  resume.addEventListener('click', () => {
    sendBoardMessage(RESUME_MESSAGE);
    refreshActiveBoardIfMounted();
  });

  const stopOrch = document.createElement('button');
  stopOrch.type = 'button';
  stopOrch.className = 'board-btn board-btn--danger';
  stopOrch.dataset.boardAction = 'stop-orchestrator';
  stopOrch.textContent = 'Stop';
  stopOrch.disabled = !isStreaming || !board.activeParentTurnId;
  stopOrch.addEventListener('click', () => {
    stopGeneration();
    if (board.activeParentTurnId) {
      cancelAllForParentTurn(board.activeParentTurnId);
    }
    refreshActiveBoardIfMounted();
  });

  controls.appendChild(openPlan);
  controls.appendChild(resume);
  controls.appendChild(stopOrch);

  ensureBoardChatViewToggle(controls);
}

interface BoardHeaderMetrics {
  progress: number;
  done: number;
  totalTasks: number;
  wavesComplete: number;
  totalWaves: number;
  activeRuns: number;
  elapsed: string;
}

function buildBoardHeader(
  chat: Chat,
  board: NonNullable<Chat['orchestrateBoard']>,
  planPath: string,
  metrics: BoardHeaderMetrics,
  isStreaming: boolean,
  headerStatus: BoardHeaderStatus,
  activity: OrchestratorActivity | null,
): HTMLElement {
  const header = document.createElement('header');
  header.className = 'board-header';

  const toolbar = document.createElement('div');
  toolbar.className = 'board-header__toolbar';

  const leading = document.createElement('div');
  leading.className = 'board-header__leading';

  const title = document.createElement('h2');
  title.className = 'board-header__title';
  title.textContent = shortPlanName(planPath);
  leading.appendChild(title);
  leading.appendChild(buildBoardStatusBadge(headerStatus));
  if (activity) {
    leading.appendChild(buildBoardActivityBadge(activity));
  }

  const controls = document.createElement('div');
  controls.className = 'board-header__controls';
  wireBoardHeaderControls(controls, chat, board, planPath, isStreaming, headerStatus);

  toolbar.appendChild(leading);
  toolbar.appendChild(controls);

  const meta = document.createElement('div');
  meta.className = 'board-header__meta';

  const stats = document.createElement('p');
  stats.className = 'board-header__stats';
  stats.textContent = `${metrics.done}/${metrics.totalTasks} tasks · ${metrics.wavesComplete}/${metrics.totalWaves} waves · ${metrics.activeRuns} active · ${metrics.elapsed}`;

  const bar = document.createElement('div');
  bar.className = 'board-header__progress';
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuenow', String(metrics.progress));
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  const fill = document.createElement('div');
  fill.className = 'board-header__progress-fill';
  fill.style.setProperty('--progress-scale', String(metrics.progress / 100));
  bar.appendChild(fill);

  meta.appendChild(stats);
  meta.appendChild(bar);
  header.appendChild(toolbar);
  header.appendChild(meta);
  return header;
}

function boardHeaderMetrics(
  board: NonNullable<Chat['orchestrateBoard']>,
  activeRunCount: number,
): BoardHeaderMetrics {
  const progress = getBoardProgressPercent(board);
  const wavesComplete = board.waves.filter((w) => w.status === 'complete').length;
  const done = board.tasks.filter((t) => t.status === 'complete').length;
  return {
    progress,
    done,
    totalTasks: board.tasks.length,
    wavesComplete,
    totalWaves: board.waves.length,
    activeRuns: activeRunCount,
    elapsed: formatElapsed(Date.now() - board.startedAt),
  };
}

function formatElapsed(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

function buildTaskAgentBadge(badge: TaskAgentBadge): HTMLElement {
  const el = document.createElement('span');
  el.className = `board-task-card__agent board-task-card__agent--${badge.variant}`;
  el.setAttribute('role', 'status');
  const dot = document.createElement('span');
  dot.className = 'board-task-card__agent-dot';
  dot.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.textContent = badge.label;
  el.appendChild(dot);
  el.appendChild(label);
  return el;
}

function buildTaskCard(task: BoardTask, chat: Chat): HTMLElement {
  const runStatus = task.assignedRunId
    ? resolveRunStatusForTask(chat, task.assignedRunId)
    : null;
  const agentBadge = deriveTaskAgentBadge(task, runStatus);
  const openable = canOpenBoardTaskSubAgent(task, runStatus);

  const card = document.createElement('article');
  card.className = 'board-task-card';
  if (task.status === 'failed' || task.status === 'blocked') {
    card.classList.add('board-task-card--alert');
  }
  if (openable) {
    card.classList.add('board-task-card--clickable');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute(
      'aria-label',
      `Open sub-agent for ${task.id}: ${task.title}${agentBadge ? `, ${agentBadge.label}` : ''}`,
    );
    const open = (): void => {
      openSubAgentDrawer(task.assignedRunId!, chat.id);
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        open();
      }
    });
  }

  const head = document.createElement('div');
  head.className = 'board-task-card__head';
  const id = document.createElement('span');
  id.className = 'board-task-card__id';
  id.textContent = task.id;
  head.appendChild(id);
  if (agentBadge) {
    head.appendChild(buildTaskAgentBadge(agentBadge));
  }
  card.appendChild(head);

  const title = document.createElement('p');
  title.className = 'board-task-card__title';
  title.textContent = task.title;
  const chip = document.createElement('span');
  chip.className = `board-task-card__cat bt--${task.category}`;
  chip.textContent = task.category;
  card.appendChild(title);
  card.appendChild(chip);
  if (typeof task.filesChanged === 'number' && task.filesChanged > 0) {
    const fc = document.createElement('span');
    fc.className = 'board-task-card__files';
    fc.textContent = `${task.filesChanged} file(s)`;
    card.appendChild(fc);
  }
  if (task.error) {
    const err = document.createElement('p');
    err.className = 'board-task-card__error';
    err.textContent = task.error;
    card.appendChild(err);
  }
  return card;
}

function renderKanban(
  board: NonNullable<Chat['orchestrateBoard']>,
  chat: Chat,
): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'kanban-grid';
  const columns: Array<{ key: string; label: string; statuses: BoardTaskStatus[] }> = [
    { key: 'planned', label: 'Planned', statuses: ['planned', 'blocked'] },
    { key: 'in_progress', label: 'In Progress', statuses: ['in_progress'] },
    { key: 'testing', label: 'Testing', statuses: ['testing'] },
    { key: 'complete', label: 'Complete', statuses: ['complete', 'failed'] },
  ];
  for (const col of columns) {
    const column = document.createElement('section');
    column.className = 'kanban-column';
    const h = document.createElement('h3');
    h.textContent = col.label;
    column.appendChild(h);
    const list = document.createElement('div');
    list.className = 'kanban-column__list';
    for (const task of board.tasks) {
      if (!col.statuses.includes(task.status)) continue;
      list.appendChild(buildTaskCard(task, chat));
    }
    column.appendChild(list);
    grid.appendChild(column);
  }
  return grid;
}

/** Update header and kanban without tearing down event subscriptions. */
function refreshBoardDom(
  root: HTMLElement,
  chat: Chat,
  board: NonNullable<Chat['orchestrateBoard']>,
): void {
  const planPath = chat.orchestratePlanPath ?? board.planPath ?? '';
  const activeRuns = listActiveSubAgentRuns().filter(
    (r) =>
      r.parentChatId === chat.id &&
      (r.status === 'queued' || r.status === 'running'),
  );
  const isStreaming = isActiveChatStreaming();
  const metrics = boardHeaderMetrics(board, activeRuns.length);
  const userStopped = isUserStoppedChat(chat);
  const headerStatus = deriveBoardHeaderStatus(
    board,
    isStreaming,
    activeRuns.length,
    userStopped,
  );
  const activity = deriveOrchestratorLastActivity(chat, isStreaming);

  const header = root.querySelector('.board-header');
  if (header) {
    syncBoardHeaderStatusBadge(header, headerStatus);
    syncBoardHeaderActivity(header, activity);
  }

  const title = root.querySelector('.board-header__title');
  if (title) title.textContent = shortPlanName(planPath);

  const stats = root.querySelector('.board-header__stats');
  if (stats) {
    stats.textContent = `${metrics.done}/${metrics.totalTasks} tasks · ${metrics.wavesComplete}/${metrics.totalWaves} waves · ${metrics.activeRuns} active · ${metrics.elapsed}`;
  }

  const fill = root.querySelector(
    '.board-header__progress-fill',
  ) as HTMLElement | null;
  if (fill) fill.style.setProperty('--progress-scale', String(metrics.progress / 100));

  const bar = root.querySelector('.board-header__progress');
  if (bar) bar.setAttribute('aria-valuenow', String(metrics.progress));

  const stopOrch = root.querySelector(
    '[data-board-action="stop-orchestrator"]',
  ) as HTMLButtonElement | null;
  if (stopOrch) {
    stopOrch.disabled = !isStreaming || !board.activeParentTurnId;
  }

  const resume = root.querySelector(
    '[data-board-action="resume"]',
  ) as HTMLButtonElement | null;
  if (resume) {
    resume.disabled = isStreaming;
    resume.textContent = resumeButtonLabel(headerStatus);
  }

  const send = root.querySelector(
    '[data-board-action="send"]',
  ) as HTMLButtonElement | null;
  if (send) send.disabled = isStreaming;

  const controls = root.querySelector('.board-header__controls');
  if (controls instanceof HTMLElement) {
    ensureBoardChatViewToggle(controls);
  }
  syncViewModeToggleFromActiveChat();

  const main = root.querySelector('.board-main');
  if (main) {
    const planPanel = main.querySelector('.board-plan-panel');
    const newKanban = renderKanban(board, chat);
    const oldKanban = main.querySelector('.kanban-grid');
    if (oldKanban) {
      oldKanban.replaceWith(newKanban);
    } else if (planPanel) {
      main.insertBefore(newKanban, planPanel);
    } else {
      main.prepend(newKanban);
    }
  }

}

function sendBoardMessage(text: string): void {
  const input = document.getElementById('msgInput') as HTMLTextAreaElement | null;
  if (!input) return;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  void import('../chat/messaging').then((m) => m.sendMessage());
}

/**
 * Update the mounted board shell from session state (kanban, timer, controls).
 * Falls back to a full render when the DOM is missing or still empty.
 */
export function refreshActiveBoardIfMounted(): void {
  if (!isOrchestrateBoardViewActive()) return;
  const chat = getActiveChat();
  const area = document.getElementById('chatArea');
  if (!area) return;

  const board = chat.orchestrateBoard;
  const root = area.querySelector(':scope > .board-root') as HTMLElement | null;
  if (root && board && root.querySelector('.board-main')) {
    refreshBoardDom(root, chat, board);
    return;
  }
  if (root && !board) return;
  renderBoardView(chat);
}

/** Render Orchestrate board into #chatArea. */
export function renderBoardView(chat: Chat): void {
  const area = document.getElementById('chatArea');
  if (!area) return;

  const active = getActiveChat();
  const board = active.id === chat.id ? active.orchestrateBoard : chat.orchestrateBoard;
  const chatForRender = active.id === chat.id ? active : chat;
  const sameChatSession = currentSession?.chatId === chatForRender.id;
  const existingRoot = area.querySelector(':scope > .board-root') as HTMLElement | null;
  const chatBubblesPresent = Boolean(
    area.querySelector(':scope > .msg, :scope > #emptyState'),
  );
  const canRefreshInPlace =
    Boolean(board) &&
    sameChatSession &&
    !chatBubblesPresent &&
    Boolean(existingRoot?.querySelector('.board-main')) &&
    Boolean(existingRoot?.querySelector(`#btnViewModeToggleChat`));

  if (canRefreshInPlace && board) {
    refreshBoardDom(existingRoot!, chatForRender, board);
    ensureBoardSession(chatForRender.id);
    syncViewModeToggleFromActiveChat();
    return;
  }

  if (!sameChatSession) disposeBoardSession();
  area.innerHTML = '';

  const root = document.createElement('section');
  root.className = 'board-root';

  const planPath = chatForRender.orchestratePlanPath ?? board?.planPath ?? '';

  if (!board) {
    const empty = document.createElement('div');
    empty.className = 'board-empty';
    empty.innerHTML =
      '<p>Run the orchestrator to initialize the board (<code>board_init</code>).</p>' +
      '<button type="button" class="board-empty__chat">Switch to Chat</button>';
    empty.querySelector('button')?.addEventListener('click', () => {
      setOrchestrateViewMode('chat');
    });
    root.appendChild(empty);
    area.appendChild(root);
    ensureBoardSession(chatForRender.id);
    syncViewModeToggleFromActiveChat();
    return;
  }

  const activeRuns = listActiveSubAgentRuns().filter(
    (r) =>
      r.parentChatId === chatForRender.id &&
      (r.status === 'queued' || r.status === 'running'),
  );
  const isStreaming = isActiveChatStreaming();

  const headerStatus = deriveBoardHeaderStatus(
    board,
    isStreaming,
    activeRuns.length,
    isUserStoppedChat(chatForRender),
  );
  const activity = deriveOrchestratorLastActivity(chatForRender, isStreaming);
  const metrics = boardHeaderMetrics(board, activeRuns.length);
  const header = buildBoardHeader(
    chatForRender,
    board,
    planPath,
    metrics,
    isStreaming,
    headerStatus,
    activity,
  );

  const main = document.createElement('div');
  main.className = 'board-main';
  main.appendChild(renderKanban(board, chatForRender));

  root.appendChild(header);
  root.appendChild(main);
  area.appendChild(root);

  ensureBoardSession(chatForRender.id);
  syncViewModeToggleFromActiveChat();
}

/** Tear down board listeners (test teardown). */
export function disposeBoardViewForTests(): void {
  disposeBoardSession();
}
