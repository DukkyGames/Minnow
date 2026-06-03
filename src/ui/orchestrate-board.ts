/**
 * Orchestrate Board View: Kanban, plan panel, controls.
 */

import {
  deriveOrchestratorLastActivity,
  type OrchestratorActivity,
} from '../chat/orchestrate/last-activity';
import {
  deriveTaskCardActivity,
  type TaskCardActivity,
  type TaskCardSubAgentHint,
} from '../chat/orchestrate/task-activity';
import { listTaskRelatedChats } from '../chat/orchestrate/task-chats';
import {
  getMainTurnActivity,
  subscribeMainTurnActivity,
} from '../chat/main-turn-activity';
import { isOrchestratePlanComplete } from '../chat/orchestrate/plan-complete';
import { isUserStoppedChat } from '../chat/orchestrate/user-stopped.ts';
import { isActiveChatStreaming, isChatStreaming } from '../chat/streaming-state';
import { loadSubAgentConfig } from '../agents/sub-agent-config.ts';
import {
  getSubAgentRun,
  listActiveSubAgentRuns,
} from '../agents/orchestrator';
import {
  getActiveBoardGroup,
  getPlannerChatForGroup,
} from '../state/chat-groups.ts';
import {
  assignAgent,
  countRunningTaskChats,
  moveTaskStatus,
  startTask,
  startWave,
  stopTask,
  toggleWaveCollapsed,
} from '../state/orchestrate-board-actions.ts';
import { subscribeSubAgentRuns } from '../agents/sub-agent-events';
import type { SubAgentStatus } from '../agents/types';
import {
  getBoardProgressPercent,
  getOrchestrateBoardElapsedMs,
  syncOrchestrateBoardTimer,
  type OrchestrateBoardTimerContext,
} from '../state/orchestrate-board-store';
import { normalizeModeId } from '../chat/modes/types';
import { subscribeBoardChanges } from '../state/orchestrate-board-events';
import {
  findChatById,
  getActiveChat,
  getChatsSortedByUpdatedDesc,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import { isExecutableOrchestratePlan } from '../chat/orchestrate/plan-path';
import type {
  BoardTask,
  BoardTaskStatus,
  Chat,
  ChatGroup,
  PersistedSubAgentStatus,
} from '../types';

type BoardState = NonNullable<ChatGroup['orchestrateBoard']>;
import { switchChat } from './sidebar';
import {
  populateOrchestratePlanSelect,
  persistOrchestratePlanPathFromSelectValue,
} from './orchestrate-plan-picker';
import type { DiscoverOrchestratePlansResult } from '../chat/orchestrate/list-plans';
import { syncOrchestratePlanStripFromActiveChat } from './orchestrate-plan-selector';
import {
  ensureBoardChatViewToggle,
  isOrchestrateBoardViewActive,
  setOrchestrateViewMode,
  syncViewModeToggleFromActiveChat,
} from './view-mode-toggle';
import {
  getOrchestrateBoardMountElement,
  isOrchestrateInitSplitChromeActive,
} from './orchestrate-board-init-split';
import { isOrchestrateHubMounted, teardownOrchestrateHub } from './orchestrate-hub';
import { openSubAgentDrawer } from './sub-agent-drawer';
import { teardownHub } from './hub';
import { BOARD_ONBOARDING_KICKOFF_MESSAGE } from './orchestrate-board-kickoff';

/** Agent status chip on a kanban task card. */
export type TaskAgentBadgeVariant = 'active' | 'failed' | 'complete';

export interface TaskAgentBadge {
  variant: TaskAgentBadgeVariant;
  label: string;
}

type RunStatusHint = SubAgentStatus | PersistedSubAgentStatus | null | undefined;

/** Primary sub-agent run for a board task (active, or latest settled). */
export function getBoardTaskPrimaryRunId(task: BoardTask): string | null {
  const assigned = task.assignedRunId?.trim();
  if (assigned) return assigned;
  const last = task.lastRunId?.trim();
  if (last) return last;
  const history = task.runHistory;
  if (history?.length) {
    for (let i = history.length - 1; i >= 0; i--) {
      const id = history[i]?.trim();
      if (id) return id;
    }
  }
  return null;
}

/** All inspectable run ids for a task (history order, deduped). */
export function getBoardTaskRunIds(task: BoardTask): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  const push = (raw?: string): void => {
    const id = raw?.trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  for (const id of task.runHistory ?? []) push(id);
  push(task.lastRunId);
  push(task.assignedRunId);
  return ids;
}

export { isUserStoppedChat };

/** Badge copy for tasks linked to a sub-agent run (Active / Failed / Complete / Cancelled). */
export function deriveTaskAgentBadge(
  task: BoardTask,
  runStatus?: RunStatusHint,
  taskChatStreaming = false,
): TaskAgentBadge | null {
  if (task.chatId && taskChatStreaming) {
    return { variant: 'active', label: 'Running' };
  }
  if (!getBoardTaskPrimaryRunId(task) && !task.chatId) return null;

  if (runStatus === 'cancelled') {
    return { variant: 'failed', label: 'Cancelled' };
  }
  if (task.status === 'failed' || runStatus === 'failed') {
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

interface BoardSession {
  groupId: string;
  plannerChatId: string;
  unsubBoard: () => void;
  unsubAgents: () => void;
  unsubMainTurn: () => void;
}

let currentSession: BoardSession | null = null;
let boardLiveTickTimer: ReturnType<typeof setInterval> | null = null;
/** Last kanban paint fingerprint — skip DOM rebuild when unchanged (keeps open selects alive). */
let lastKanbanRefreshKey = '';
/** Kanban rebuild deferred while a task-card control (e.g. agent select) has focus. */
let pendingKanbanRefresh = false;
let kanbanInteractionReleaseBound = false;

const BOARD_LIVE_TICK_MS = 1000;

function stopBoardLiveTick(): void {
  if (boardLiveTickTimer == null) return;
  clearInterval(boardLiveTickTimer);
  boardLiveTickTimer = null;
}

/** Build timer sync context for a chat (uses per-chat streaming, not active-chat only). */
function boardTimerContextForChat(
  chat: Chat,
  activeRunCount: number,
): OrchestrateBoardTimerContext {
  return {
    isStreaming: isChatStreaming(chat.id),
    activeRunCount,
    userStopped: isUserStoppedChat(chat),
  };
}

function tickOrchestrateBoardSession(): void {
  const session = currentSession;
  if (!session) {
    stopBoardLiveTick();
    return;
  }
  const group = getActiveBoardGroup();
  const planner = findChatById(session.plannerChatId);
  if (!group?.orchestrateBoard || !planner || group.id !== session.groupId) {
    stopBoardLiveTick();
    return;
  }
  const activeRuns = listActiveSubAgentRuns().filter(
    (r) =>
      r.parentChatId === planner.id &&
      (r.status === 'queued' || r.status === 'running'),
  );
  syncOrchestrateBoardTimer(
    group,
    planner,
    boardTimerContextForChat(planner, activeRuns.length),
  );
  if (!isOrchestrateHubMounted() && (isOrchestrateBoardViewActive() || isOrchestrateInitSplitChromeActive())) {
    refreshActiveBoardIfMounted();
  }
}

function startBoardLiveTick(): void {
  stopBoardLiveTick();
  boardLiveTickTimer = setInterval(() => {
    tickOrchestrateBoardSession();
  }, BOARD_LIVE_TICK_MS);
}

function disposeBoardSession(): void {
  stopBoardLiveTick();
  if (!currentSession) return;
  currentSession.unsubBoard();
  currentSession.unsubAgents();
  currentSession.unsubMainTurn();
  currentSession = null;
  lastKanbanRefreshKey = '';
  pendingKanbanRefresh = false;
}

/** True when focus is on a field control inside the kanban (e.g. open agent select). */
function isKanbanFormControlFocused(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  if (!active.closest('.board-kanban-waves')) return false;
  // Buttons (Reopen, wave caret, Start) must not block refresh — after click they stay
  // focused in real browsers, which left the kanban stale until another interaction.
  return active.matches('select, input, textarea');
}

function resolveKanbanGroup(
  board: BoardState,
  plannerChat: Chat,
  group?: ChatGroup,
): ChatGroup {
  if (group) return group;
  const id = plannerChat.boardGroupId ?? plannerChat.groupId ?? 'board';
  return {
    id,
    name: '',
    workspacePath: plannerChat.workspacePath,
    collapsed: false,
    order: 0,
    createdAt: 0,
    orchestrateBoard: board,
  };
}

/** Stable key for kanban DOM — only rebuild when task/run/streaming presentation changes. */
export function buildKanbanRefreshKey(
  board: BoardState,
  plannerChat: Chat,
  group?: ChatGroup,
): string {
  const folder = resolveKanbanGroup(board, plannerChat, group);
  const cap = board.maxConcurrentTasks ?? 3;
  const running = countRunningTaskChats(board);
  const parts: string[] = [
    `run:${running}/${cap}`,
    `stream:${isChatStreaming(plannerChat.id) ? 1 : 0}`,
  ];
  for (const wave of board.waves) {
    parts.push(
      `w:${wave.id}:${wave.collapsed ? 1 : 0}:${wave.status ?? ''}:${wave.taskCount ?? 0}:${wave.completeCount ?? 0}`,
    );
  }
  const allChats = getChatsSortedByUpdatedDesc();
  for (const task of board.tasks) {
    const streaming = task.chatId && isChatStreaming(task.chatId) ? 1 : 0;
    const runId = getBoardTaskPrimaryRunId(task);
    const runStatus = runId ? resolveRunStatusForTask(plannerChat, runId) ?? '' : '';
    const taskChat = task.chatId ? findChatById(task.chatId) : undefined;
    const mainTurn = task.chatId ? getMainTurnActivity(task.chatId) : undefined;
    const activity = deriveTaskCardActivity(task, plannerChat, {
      taskChat,
      mainTurn,
      subAgentHint: resolveTaskCardSubAgentHint(task, plannerChat),
    });
    const relatedChats = listTaskRelatedChats(task, folder, allChats);
    parts.push(
      [
        task.id,
        task.status,
        task.agentType ?? '',
        task.chatId ?? '',
        streaming,
        runStatus,
        task.error ?? '',
        task.title,
        task.category,
        activity ? `${activity.kind}:${activity.text}` : '',
        relatedChats.map((c) => `${c.chatId}:${c.streaming ? 1 : 0}`).join(','),
      ].join('|'),
    );
  }
  return parts.join(';');
}

/** After agent select blur, apply a deferred kanban refresh if board state changed underneath. */
function ensureKanbanInteractionReleaseListener(): void {
  if (kanbanInteractionReleaseBound) return;
  kanbanInteractionReleaseBound = true;
  document.addEventListener('focusout', (event) => {
    if (!pendingKanbanRefresh) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.closest('.board-kanban-waves')) return;
    window.setTimeout(() => {
      if (!pendingKanbanRefresh || isKanbanFormControlFocused()) return;
      pendingKanbanRefresh = false;
      refreshActiveBoardIfMounted();
    }, 0);
  });
}

function mountKanbanInMain(
  main: HTMLElement,
  board: BoardState,
  group: ChatGroup,
  plannerChat: Chat,
): void {
  const planPanel = main.querySelector('.board-plan-panel');
  const newKanban = renderKanban(board, group, plannerChat);
  const oldKanban = main.querySelector('.board-kanban-waves');
  if (oldKanban) {
    oldKanban.replaceWith(newKanban);
  } else if (planPanel) {
    main.insertBefore(newKanban, planPanel);
  } else {
    main.prepend(newKanban);
  }
}

/** Refresh board UI when store or sub-agents change (stable handler per folder). */
function scheduleBoardUiRefresh(groupId: string): void {
  if (isOrchestrateHubMounted()) return;
  if (!isOrchestrateBoardViewActive() && !isOrchestrateInitSplitChromeActive()) return;
  if (getActiveBoardGroup()?.id !== groupId) return;
  refreshActiveBoardIfMounted();
}

/** Wire board + sub-agent listeners once per folder (idempotent). */
function ensureBoardSession(group: ChatGroup, plannerChat: Chat): void {
  if (
    currentSession?.groupId === group.id &&
    currentSession.plannerChatId === plannerChat.id
  ) {
    return;
  }
  disposeBoardSession();
  currentSession = {
    groupId: group.id,
    plannerChatId: plannerChat.id,
    unsubBoard: subscribeBoardChanges(group.id, () => scheduleBoardUiRefresh(group.id)),
    unsubAgents: subscribeSubAgentRuns((run) => {
      if (run.parentChatId === plannerChat.id) scheduleBoardUiRefresh(group.id);
    }),
    unsubMainTurn: subscribeMainTurnActivity(() => scheduleBoardUiRefresh(group.id)),
  };
  startBoardLiveTick();
}

function plannerForGroup(group: ChatGroup): Chat {
  return getPlannerChatForGroup(group) ?? getActiveChat();
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
  board: BoardState,
  isStreaming: boolean,
  activeRunCount: number,
  userStopped = false,
): BoardHeaderStatus {
  const tasks = board.tasks;
  const total = tasks.length;
  const completeCount = tasks.filter((t) => t.status === 'complete').length;
  const incomplete = total > 0 && completeCount < total;
  const hasFailed = tasks.some((t) => t.status === 'failed');
  const hasBlocked = tasks.some((t) => t.status === 'blocked');
  const hasInFlight = tasks.some(
    (t) => t.status === 'in_progress' || t.status === 'testing',
  );

  if (isStreaming && board.activeParentTurnId) {
    return { variant: 'running', label: 'Running' };
  }
  if (total > 0 && completeCount === total) {
    return { variant: 'complete', label: 'Complete' };
  }
  if (userStopped && incomplete && !isStreaming && activeRunCount === 0) {
    return { variant: 'stopped', label: 'Stopped' };
  }
  if (hasFailed) {
    return { variant: 'failed', label: 'Failed' };
  }
  if (hasBlocked && activeRunCount === 0 && !hasInFlight) {
    return { variant: 'blocked', label: 'Blocked' };
  }
  const runningTasks = countRunningTaskChats(board);
  if (runningTasks > 0 || activeRunCount > 0 || hasInFlight) {
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

/** Build an inline SVG icon for board header icon buttons. */
function createBoardHeaderIconSvg(pathD: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon-svg board-header__icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathD);
  svg.appendChild(path);
  return svg;
}

/** Icon-only board header control (Plan, play/pause) matching top-bar icon buttons. */
function createBoardHeaderIconButton(
  action: string,
  iconPath: string,
  labels: { ariaLabel: string; title: string },
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn board-header__icon-btn';
  btn.dataset.boardAction = action;
  btn.setAttribute('aria-label', labels.ariaLabel);
  btn.title = labels.title;
  btn.appendChild(createBoardHeaderIconSvg(iconPath));
  return btn;
}

const BOARD_ICON_PLAN =
  'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8';
function wireBoardHeaderControls(controls: HTMLElement, planPath: string): void {
  controls.replaceChildren();

  const openPlan = createBoardHeaderIconButton(
    'open-plan',
    BOARD_ICON_PLAN,
    {
      ariaLabel: 'Open plan',
      title: planPath ? `Open ${planPath} in file viewer` : 'No plan path set',
    },
  );
  openPlan.disabled = !planPath;
  openPlan.addEventListener('click', () => {
    if (!planPath) return;
    void import('./file-viewer').then((m) => m.openFileInViewer(planPath));
  });

  controls.appendChild(openPlan);
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
  board: BoardState,
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
  wireBoardHeaderControls(controls, planPath);

  toolbar.appendChild(leading);
  toolbar.appendChild(controls);

  const meta = document.createElement('div');
  meta.className = 'board-header__meta';
  meta.appendChild(buildBoardHeaderBench(metrics, board));

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

  meta.appendChild(bar);
  header.appendChild(toolbar);
  header.appendChild(meta);
  return header;
}

/** One instrumentation cell in the board header bench (mono value + label). */
function createBoardBenchCell(
  value: string,
  label: string,
  benchKey: string,
): HTMLElement {
  const cell = document.createElement('div');
  cell.className = 'board-bench__cell';
  cell.dataset.boardBench = benchKey;
  const valueEl = document.createElement('span');
  valueEl.className = 'board-bench__value';
  valueEl.textContent = value;
  const labelEl = document.createElement('span');
  labelEl.className = 'board-bench__label';
  labelEl.textContent = label;
  cell.appendChild(valueEl);
  cell.appendChild(labelEl);
  return cell;
}

/** Compact metrics row under the board toolbar (stats-strip family). */
function buildBoardHeaderBench(
  metrics: BoardHeaderMetrics,
  board: BoardState,
): HTMLElement {
  const bench = document.createElement('div');
  bench.className = 'board-header__bench';
  bench.setAttribute('role', 'group');
  bench.setAttribute('aria-label', 'Board metrics');
  const cap = board.maxConcurrentTasks ?? 3;
  const running = countRunningTaskChats(board);
  bench.appendChild(
    createBoardBenchCell(
      `${metrics.done}/${metrics.totalTasks}`,
      'Tasks',
      'tasks',
    ),
  );
  bench.appendChild(
    createBoardBenchCell(
      `${metrics.wavesComplete}/${metrics.totalWaves}`,
      'Waves',
      'waves',
    ),
  );
  bench.appendChild(
    createBoardBenchCell(`${running}/${cap}`, 'Running', 'running'),
  );
  bench.appendChild(
    createBoardBenchCell(metrics.elapsed, 'Elapsed', 'elapsed'),
  );
  return bench;
}

function syncBoardHeaderBench(
  header: Element,
  metrics: BoardHeaderMetrics,
  board: BoardState,
): void {
  const cap = board.maxConcurrentTasks ?? 3;
  const running = countRunningTaskChats(board);
  const values: Record<string, string> = {
    tasks: `${metrics.done}/${metrics.totalTasks}`,
    waves: `${metrics.wavesComplete}/${metrics.totalWaves}`,
    running: `${running}/${cap}`,
    elapsed: metrics.elapsed,
  };
  for (const [key, text] of Object.entries(values)) {
    const cell = header.querySelector(`[data-board-bench="${key}"] .board-bench__value`);
    if (cell) cell.textContent = text;
  }
}

function boardHeaderMetrics(
  group: ChatGroup,
  plannerChat: Chat,
  board: BoardState,
  activeRunCount: number,
): BoardHeaderMetrics {
  syncOrchestrateBoardTimer(
    group,
    plannerChat,
    boardTimerContextForChat(plannerChat, activeRunCount),
  );
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
    elapsed: formatElapsed(getOrchestrateBoardElapsedMs(board)),
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

/** Advance-action icon on kanban task cards (stroke paths, matches `.icon-svg`). */
type BoardAdvanceIconKind = 'forward' | 'check' | 'recycle';

const BOARD_ADVANCE_ICON_PATHS: Record<BoardAdvanceIconKind, readonly string[]> = {
  forward: ['M5 12h14', 'M12 5l7 7-7 7'],
  check: ['M20 6 9 17l-5-5'],
  recycle: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'],
};

function createBoardAdvanceIcon(kind: BoardAdvanceIconKind): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon-svg board-task-card__advance-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of BOARD_ADVANCE_ICON_PATHS[kind]) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

function buildStatusActionButtons(
  task: BoardTask,
  group: ChatGroup,
  plannerChat: Chat,
  row: HTMLElement,
): void {
  const addBtn = (
    label: string,
    status: BoardTaskStatus,
    icon: BoardAdvanceIconKind,
  ): void => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'board-task-card__advance-btn';
    btn.appendChild(createBoardAdvanceIcon(icon));
    const text = document.createElement('span');
    text.className = 'board-task-card__advance-label';
    text.textContent = label;
    btn.appendChild(text);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      moveTaskStatus(group, task.id, status, plannerChat);
      refreshActiveBoardIfMounted();
    });
    row.appendChild(btn);
  };
  if (task.status === 'planned' || task.status === 'blocked') {
    addBtn('In progress', 'in_progress', 'forward');
  }
  if (task.status === 'in_progress') {
    addBtn('Testing', 'testing', 'forward');
  }
  if (task.status === 'testing') {
    addBtn('Complete', 'complete', 'check');
    addBtn('Failed', 'failed', 'forward');
  }
  if (task.status === 'complete' || task.status === 'failed') {
    addBtn('Reopen', 'planned', 'recycle');
  }
}

const TASK_CARD_MAX_CHAT_ROWS = 2;

/** Sub-agent activity when a task has a run but no task chat yet. */
function resolveTaskCardSubAgentHint(
  task: BoardTask,
  plannerChat: Chat,
): TaskCardSubAgentHint | null {
  if (task.chatId?.trim()) return null;
  const runId = getBoardTaskPrimaryRunId(task);
  if (!runId) return null;
  const live = getSubAgentRun(runId);
  const persisted = plannerChat.subAgentRuns?.find((r) => r.runId === runId);
  const status = live?.status ?? persisted?.status;
  if (status !== 'queued' && status !== 'running') return null;
  return {
    status,
    taskLabel: (live?.task ?? persisted?.task ?? '').trim(),
  };
}

function appendTaskCardActivityLine(
  card: HTMLElement,
  activity: TaskCardActivity,
): void {
  const line = document.createElement('p');
  line.className = `board-task-card__activity board-task-card__activity--${activity.kind}`;
  line.textContent = activity.text;
  line.title = activity.title;
  line.addEventListener('click', (e) => e.stopPropagation());
  card.appendChild(line);
}

function appendTaskCardChats(
  card: HTMLElement,
  chats: ReturnType<typeof listTaskRelatedChats>,
): void {
  if (!chats.length) return;

  const list = document.createElement('ul');
  list.className = 'board-task-card__chats';

  const visible = chats.slice(0, TASK_CARD_MAX_CHAT_ROWS);
  const overflow = chats.length - visible.length;

  for (const row of visible) {
    const item = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'board-task-card__chat-row';
    if (row.streaming) {
      btn.classList.add('board-task-card__chat-row--streaming');
    }
    btn.setAttribute('aria-label', `Open task chat: ${row.title}`);
    btn.title = row.title;

    const dot = document.createElement('span');
    dot.className = 'board-task-card__chat-dot';
    dot.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'board-task-card__chat-title';
    label.textContent = row.title;

    btn.appendChild(dot);
    btn.appendChild(label);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      switchChat(row.chatId);
    });
    item.appendChild(btn);
    list.appendChild(item);
  }

  if (overflow > 0) {
    const more = document.createElement('li');
    more.className = 'board-task-card__chats-more';
    more.textContent = `+${overflow} more`;
    list.appendChild(more);
  }

  list.addEventListener('click', (e) => e.stopPropagation());
  card.appendChild(list);
}

function buildTaskCard(
  task: BoardTask,
  group: ChatGroup,
  plannerChat: Chat,
  agentOptions: Array<{ id: string; label: string }>,
): HTMLElement {
  const taskStreaming = Boolean(task.chatId && isChatStreaming(task.chatId));
  const primaryRunId = getBoardTaskPrimaryRunId(task);
  const runStatus = primaryRunId
    ? resolveRunStatusForTask(plannerChat, primaryRunId)
    : null;
  const agentBadge = deriveTaskAgentBadge(task, runStatus, taskStreaming);
  const board = group.orchestrateBoard!;
  const cap = board.maxConcurrentTasks ?? 3;
  const atCap = countRunningTaskChats(board) >= cap && !taskStreaming;

  const card = document.createElement('article');
  card.className = 'board-task-card';
  if (task.status === 'failed' || task.status === 'blocked') {
    card.classList.add('board-task-card--alert');
  }
  if (taskStreaming) {
    card.classList.add('board-task-card--running');
  }

  const openableRunId = primaryRunId && canOpenBoardTaskSubAgent(task, runStatus);
  if (openableRunId) {
    card.classList.add('board-task-card--clickable');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.title = 'Open sub-agent run';
    const openRun = (): void => {
      if (primaryRunId) openSubAgentDrawer(primaryRunId, plannerChat.id);
    };
    card.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('.board-task-card__footer')) return;
      if (target.closest('.board-task-card__activity')) return;
      if (target.closest('.board-task-card__chats')) return;
      openRun();
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openRun();
      }
    });
  }

  const top = document.createElement('div');
  top.className = 'board-task-card__top';
  const id = document.createElement('span');
  id.className = 'board-task-card__id';
  id.textContent = task.id;
  top.appendChild(id);

  const trail = document.createElement('div');
  trail.className = 'board-task-card__trail';
  const chip = document.createElement('span');
  chip.className = `board-task-card__cat bt--${task.category}`;
  chip.textContent = task.category;
  trail.appendChild(chip);
  if (agentBadge) {
    trail.appendChild(buildTaskAgentBadge(agentBadge));
  }
  top.appendChild(trail);
  card.appendChild(top);

  const title = document.createElement('h4');
  title.className = 'board-task-card__title';
  title.textContent = task.title;
  title.title = task.title;
  card.appendChild(title);

  const taskChat = task.chatId ? findChatById(task.chatId) : undefined;
  const activity = deriveTaskCardActivity(task, plannerChat, {
    taskChat,
    mainTurn: task.chatId ? getMainTurnActivity(task.chatId) : undefined,
    subAgentHint: resolveTaskCardSubAgentHint(task, plannerChat),
  });
  if (activity) appendTaskCardActivityLine(card, activity);

  const relatedChats = listTaskRelatedChats(
    task,
    group,
    getChatsSortedByUpdatedDesc(),
  );
  appendTaskCardChats(card, relatedChats);

  const footer = document.createElement('div');
  footer.className = 'board-task-card__footer';

  const assignRow = document.createElement('div');
  assignRow.className = 'board-task-card__assign';
  const agentLabel = document.createElement('label');
  agentLabel.className = 'board-task-card__assign-label';
  agentLabel.textContent = 'Agent';
  const agentSelect = document.createElement('select');
  agentSelect.className = 'board-select board-select--compact board-task-card__agent-select';
  agentSelect.setAttribute('aria-label', `Agent for ${task.id}`);
  const emptyOpt = document.createElement('option');
  emptyOpt.value = '';
  emptyOpt.textContent = 'Choose…';
  agentSelect.appendChild(emptyOpt);
  for (const { id, label } of agentOptions) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = label;
    if (task.agentType === id) opt.selected = true;
    agentSelect.appendChild(opt);
  }
  const stopCardBubble = (e: Event): void => e.stopPropagation();
  agentSelect.addEventListener('mousedown', stopCardBubble);
  agentSelect.addEventListener('click', stopCardBubble);
  agentSelect.addEventListener('change', (e) => {
    e.stopPropagation();
    const v = agentSelect.value.trim();
    if (v) assignAgent(group, task.id, v, plannerChat);
    refreshActiveBoardIfMounted();
  });
  agentLabel.appendChild(agentSelect);
  assignRow.appendChild(agentLabel);
  footer.appendChild(assignRow);

  const toolbar = document.createElement('div');
  toolbar.className = 'board-task-card__toolbar';
  const hasAgent = Boolean(task.agentType?.trim());
  if (taskStreaming) {
    const stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.className = 'board-btn board-btn--compact board-btn--mn-danger board-task-card__btn--stop';
    stopBtn.textContent = 'Stop';
    stopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void stopTask(group, task.id, plannerChat).then(() => refreshActiveBoardIfMounted());
    });
    toolbar.appendChild(stopBtn);
  } else {
    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'board-btn board-btn--compact board-btn--primary board-task-card__btn--start';
    startBtn.textContent = 'Start';
    startBtn.disabled = !hasAgent || atCap;
    startBtn.title = atCap ? `Concurrency cap (${cap}) reached` : !hasAgent ? 'Assign an agent first' : '';
    startBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void startTask(group, task.id, plannerChat).then(() => refreshActiveBoardIfMounted());
    });
    toolbar.appendChild(startBtn);
  }
  footer.appendChild(toolbar);

  const advanceRow = document.createElement('div');
  advanceRow.className = 'board-task-card__advance';
  buildStatusActionButtons(task, group, plannerChat, advanceRow);
  if (advanceRow.childElementCount) {
    footer.appendChild(advanceRow);
  }

  card.appendChild(footer);

  if (task.error) {
    const err = document.createElement('p');
    err.className = 'board-task-card__error';
    err.textContent = task.error;
    card.appendChild(err);
  }
  return card;
}

/** Semantic chip variant for collapsed-wave task tokens (status + live stream). */
function compactTaskChipVariant(task: BoardTask, taskStreaming: boolean): string {
  if (taskStreaming) return 'running';
  switch (task.status) {
    case 'complete':
      return 'complete';
    case 'failed':
    case 'blocked':
      return 'failed';
    case 'in_progress':
    case 'testing':
      return 'active';
    default:
      return 'planned';
  }
}

/** Human-readable status for compact chip tooltips. */
function compactTaskStatusLabel(task: BoardTask, taskStreaming: boolean): string {
  if (taskStreaming) return 'Running';
  switch (task.status) {
    case 'planned':
      return 'Planned';
    case 'blocked':
      return 'Blocked';
    case 'in_progress':
      return 'In progress';
    case 'testing':
      return 'Testing';
    case 'complete':
      return 'Complete';
    case 'failed':
      return 'Failed';
    default:
      return task.status;
  }
}

/** Horizontal task strip shown while a wave kanban is collapsed. */
function buildWaveCompactSummary(
  waveTasks: BoardTask[],
  group: ChatGroup,
  plannerChat: Chat,
  waveId: number | string,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'board-wave-compact';
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', `Wave ${waveId} tasks`);

  const laneMeta = document.createElement('div');
  laneMeta.className = 'board-wave-compact__lanes';
  laneMeta.setAttribute('aria-hidden', 'true');
  const lanes: Array<{ label: string; statuses: BoardTaskStatus[] }> = [
    { label: 'Plan', statuses: ['planned', 'blocked'] },
    { label: 'Run', statuses: ['in_progress'] },
    { label: 'Test', statuses: ['testing'] },
    { label: 'Done', statuses: ['complete', 'failed'] },
  ];
  for (const lane of lanes) {
    const count = waveTasks.filter((t) => lane.statuses.includes(t.status)).length;
    const cell = document.createElement('span');
    cell.className = 'board-wave-compact__lane';
    const label = document.createElement('span');
    label.className = 'board-wave-compact__lane-label';
    label.textContent = lane.label;
    const value = document.createElement('span');
    value.className = 'board-wave-compact__lane-count';
    value.textContent = String(count);
    cell.appendChild(label);
    cell.appendChild(value);
    laneMeta.appendChild(cell);
  }
  wrap.appendChild(laneMeta);

  const strip = document.createElement('div');
  strip.className = 'board-wave-compact__strip';
  strip.setAttribute('role', 'list');
  for (const task of waveTasks) {
    const taskStreaming = Boolean(task.chatId && isChatStreaming(task.chatId));
    const variant = compactTaskChipVariant(task, taskStreaming);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `board-wave-compact__chip board-wave-compact__chip--${variant}`;
    chip.setAttribute('role', 'listitem');
    chip.title = `${task.id}: ${task.title} (${compactTaskStatusLabel(task, taskStreaming)})`;
    chip.setAttribute('aria-label', chip.title);

    const dot = document.createElement('span');
    dot.className = 'board-wave-compact__dot';
    dot.setAttribute('aria-hidden', 'true');
    chip.appendChild(dot);

    const id = document.createElement('span');
    id.className = 'board-wave-compact__id';
    id.textContent = task.id;
    chip.appendChild(id);

    const title = document.createElement('span');
    title.className = 'board-wave-compact__title';
    title.textContent = task.title;
    chip.appendChild(title);

    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleWaveCollapsed(group, waveId);
      refreshActiveBoardIfMounted();
    });
    strip.appendChild(chip);
  }
  wrap.appendChild(strip);
  return wrap;
}

function renderKanbanColumns(
  tasks: BoardTask[],
  group: ChatGroup,
  plannerChat: Chat,
  agentOptions: Array<{ id: string; label: string }>,
): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'kanban-grid';
  const columns: Array<{ label: string; statuses: BoardTaskStatus[] }> = [
    { label: 'Planned', statuses: ['planned', 'blocked'] },
    { label: 'In Progress', statuses: ['in_progress'] },
    { label: 'Testing', statuses: ['testing'] },
    { label: 'Complete', statuses: ['complete', 'failed'] },
  ];
  for (const col of columns) {
    const column = document.createElement('section');
    column.className = 'kanban-column';
    const colTasks = tasks.filter((t) => col.statuses.includes(t.status));
    const h = document.createElement('h3');
    const colLabel = document.createElement('span');
    colLabel.className = 'kanban-column__label';
    colLabel.textContent = col.label;
    const colCount = document.createElement('span');
    colCount.className = 'kanban-column__count';
    colCount.textContent = String(colTasks.length);
    colCount.setAttribute('aria-label', `${colTasks.length} tasks`);
    h.appendChild(colLabel);
    h.appendChild(colCount);
    column.appendChild(h);
    const list = document.createElement('div');
    list.className = 'kanban-column__list';
    let entranceIndex = 0;
    const staggerEntrance =
      isOrchestrateInitSplitChromeActive() && isChatStreaming(plannerChat.id);
    for (const task of colTasks) {
      const card = buildTaskCard(task, group, plannerChat, agentOptions);
      if (staggerEntrance) {
        card.classList.add('board-task-card--enter');
        card.style.setProperty(
          '--board-task-enter-delay',
          `${entranceIndex * 55}ms`,
        );
        entranceIndex += 1;
      }
      list.appendChild(card);
    }
    column.appendChild(list);
    grid.appendChild(column);
  }
  return grid;
}

async function populateKanbanWaves(
  wrap: HTMLElement,
  board: BoardState,
  group: ChatGroup,
  plannerChat: Chat,
): Promise<void> {
  const cfg = await loadSubAgentConfig();
  const types = Object.entries(cfg.types)
    .filter(([, t]) => t.enabled !== false)
    .map(([id, t]) => ({ id, label: t.label?.trim() || id }));
  wrap.replaceChildren();
  for (const wave of board.waves) {
    const waveTasks = board.tasks.filter((t) => t.wave === wave.id);
    if (!waveTasks.length) continue;
    const collapsed = wave.collapsed === true;
    const block = document.createElement('section');
    block.className = 'board-wave-block';
    if (collapsed) block.classList.add('board-wave-block--collapsed');

    const header = document.createElement('div');
    header.className = 'board-wave-block__header';

    const caret = document.createElement('button');
    caret.type = 'button';
    caret.className = 'board-wave-block__caret';
    caret.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    caret.setAttribute(
      'aria-label',
      collapsed ? `Expand wave ${wave.id}` : `Collapse wave ${wave.id}`,
    );
    caret.textContent = collapsed ? '▸' : '▾';
    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleWaveCollapsed(group, wave.id);
      refreshActiveBoardIfMounted();
    });
    header.appendChild(caret);

    const title = document.createElement('h3');
    title.className = 'board-wave-block__title';
    const waveId = document.createElement('span');
    waveId.className = 'board-wave-block__id';
    waveId.textContent = String(wave.id);
    title.appendChild(document.createTextNode('Wave'));
    title.appendChild(waveId);
    header.appendChild(title);

    const completeCount = waveTasks.filter((t) => t.status === 'complete').length;
    const progress = document.createElement('span');
    progress.className = 'board-wave-block__progress';
    progress.textContent = `${completeCount}/${waveTasks.length}`;
    progress.setAttribute(
      'aria-label',
      `${completeCount} of ${waveTasks.length} tasks complete`,
    );
    header.appendChild(progress);

    const startWaveBtn = document.createElement('button');
    startWaveBtn.type = 'button';
    startWaveBtn.className = 'board-btn board-btn--compact board-wave-block__start';
    startWaveBtn.textContent = 'Start wave';
    const hasPlanned = waveTasks.some((t) => t.status === 'planned');
    startWaveBtn.disabled = !hasPlanned;
    startWaveBtn.addEventListener('click', () => {
      void startWave(group, wave.id, plannerChat).then(() => refreshActiveBoardIfMounted());
    });
    header.appendChild(startWaveBtn);
    block.appendChild(header);

    if (collapsed) {
      block.appendChild(buildWaveCompactSummary(waveTasks, group, plannerChat, wave.id));
    }

    const body = document.createElement('div');
    body.className = 'board-wave-block__body';
    body.hidden = collapsed;
    body.appendChild(renderKanbanColumns(waveTasks, group, plannerChat, types));
    block.appendChild(body);
    wrap.appendChild(block);
  }
}

function renderKanban(
  board: BoardState,
  group: ChatGroup,
  plannerChat: Chat,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'board-kanban-waves';
  void populateKanbanWaves(wrap, board, group, plannerChat);
  return wrap;
}

/** Update header and kanban without tearing down event subscriptions. */
function refreshBoardDom(
  root: HTMLElement,
  group: ChatGroup,
  plannerChat: Chat,
  board: BoardState,
): void {
  const planPath =
    group.orchestratePlanPath ?? plannerChat.orchestratePlanPath ?? board.planPath ?? '';
  const activeRuns = listActiveSubAgentRuns().filter(
    (r) =>
      r.parentChatId === plannerChat.id &&
      (r.status === 'queued' || r.status === 'running'),
  );
  const isStreaming = isChatStreaming(plannerChat.id);
  const metrics = boardHeaderMetrics(group, plannerChat, board, activeRuns.length);
  const userStopped = isUserStoppedChat(plannerChat);
  const headerStatus = deriveBoardHeaderStatus(
    board,
    isStreaming,
    activeRuns.length,
    userStopped,
  );
  const activity = deriveOrchestratorLastActivity(plannerChat, isStreaming);

  const header = root.querySelector('.board-header');
  if (header) {
    syncBoardHeaderStatusBadge(header, headerStatus);
    syncBoardHeaderActivity(header, activity);
  }

  const title = root.querySelector('.board-header__title');
  if (title) title.textContent = shortPlanName(planPath);

  const headerEl = root.querySelector('.board-header');
  if (headerEl) {
    syncBoardHeaderBench(headerEl, metrics, board);
  }

  const fill = root.querySelector(
    '.board-header__progress-fill',
  ) as HTMLElement | null;
  if (fill) fill.style.setProperty('--progress-scale', String(metrics.progress / 100));

  const bar = root.querySelector('.board-header__progress');
  if (bar) bar.setAttribute('aria-valuenow', String(metrics.progress));

  const openPlanBtn = root.querySelector(
    '[data-board-action="open-plan"]',
  ) as HTMLButtonElement | null;
  if (openPlanBtn) {
    openPlanBtn.disabled = !planPath;
    const planTitle = planPath
      ? `Open ${planPath} in file viewer`
      : 'No plan path set';
    openPlanBtn.setAttribute('aria-label', 'Open plan');
    openPlanBtn.title = planTitle;
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
  if (main instanceof HTMLElement) {
    ensureKanbanInteractionReleaseListener();
    const kanbanKey = buildKanbanRefreshKey(board, plannerChat, group);
    const kanbanFocused = isKanbanFormControlFocused();
    if (kanbanKey !== lastKanbanRefreshKey) {
      if (kanbanFocused) {
        pendingKanbanRefresh = true;
      } else {
        mountKanbanInMain(main, board, group, plannerChat);
        lastKanbanRefreshKey = kanbanKey;
        pendingKanbanRefresh = false;
      }
    } else if (pendingKanbanRefresh && !kanbanFocused) {
      mountKanbanInMain(main, board, group, plannerChat);
      lastKanbanRefreshKey = kanbanKey;
      pendingKanbanRefresh = false;
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

/** Parse the active plan and call board_init (hub / plan screen entry). */
export function kickoffOrchestrateBoardBuild(): void {
  sendBoardMessage(BOARD_ONBOARDING_KICKOFF_MESSAGE);
}

export { BOARD_ONBOARDING_KICKOFF_MESSAGE } from './orchestrate-board-kickoff';

/** Busy phases shown in the onboarding status strip (plan fetch vs board_init stream). */
export type BoardOnboardingBusyPhase = 'idle' | 'plans' | 'init';

const BOARD_ONBOARDING_BUSY_LABEL: Record<Exclude<BoardOnboardingBusyPhase, 'idle'>, string> =
  {
    plans: 'Loading plans',
    init: 'Initializing board',
  };

/** Kanban lane titles (must match `renderKanbanColumns`). */
const BOARD_ONBOARDING_KANBAN_COLUMNS = [
  'Planned',
  'In Progress',
  'Testing',
  'Complete',
] as const;

/** Skeleton task tiles per lane while board_init streams (visual weight only). */
const BOARD_ONBOARDING_SKELETON_CARD_COUNTS = [2, 1, 1, 0] as const;

/** Basename for the init banner (plan path from the select). */
export function formatBoardOnboardingPlanDisplay(planPath: string): string {
  const trimmed = planPath.trim();
  if (!trimmed) return 'Plan file';
  const parts = trimmed.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? trimmed;
}

/** Resolve which loading affordance the onboarding shell should show. */
export function resolveBoardOnboardingBusyPhase(
  plansLoading: boolean,
): BoardOnboardingBusyPhase {
  if (plansLoading) return 'plans';
  if (isActiveChatStreaming()) return 'init';
  return 'idle';
}

/** Three ink dots (matches stream-status) for plan discovery; one dot for board init. */
function buildBoardOnboardingStatusDots(phase: Exclude<BoardOnboardingBusyPhase, 'idle'>): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'board-onboarding__status-dots';
  wrap.setAttribute('aria-hidden', 'true');
  const count = phase === 'plans' ? 3 : 1;
  for (let i = 0; i < count; i += 1) {
    const dot = document.createElement('span');
    dot.className = 'board-onboarding__status-dot';
    wrap.appendChild(dot);
  }
  return wrap;
}

/** Kanban-shaped skeleton (real lane chrome + task tiles) while board_init runs. */
function buildBoardOnboardingPreview(): HTMLElement {
  const preview = document.createElement('div');
  preview.className = 'board-onboarding__preview';
  preview.setAttribute('aria-hidden', 'true');
  preview.dataset.boardOnboardingPreview = '';

  const grid = document.createElement('div');
  grid.className = 'kanban-grid board-onboarding__kanban-skeleton';

  BOARD_ONBOARDING_KANBAN_COLUMNS.forEach((label, laneIndex) => {
    const column = document.createElement('section');
    column.className = 'kanban-column';

    const header = document.createElement('h3');
    const colLabel = document.createElement('span');
    colLabel.className = 'kanban-column__label';
    colLabel.textContent = label;
    const colCount = document.createElement('span');
    colCount.className = 'kanban-column__count';
    colCount.textContent = '—';
    colCount.setAttribute('aria-hidden', 'true');
    header.appendChild(colLabel);
    header.appendChild(colCount);
    column.appendChild(header);

    const list = document.createElement('div');
    list.className = 'kanban-column__list';
    const cardCount = BOARD_ONBOARDING_SKELETON_CARD_COUNTS[laneIndex] ?? 0;
    for (let i = 0; i < cardCount; i += 1) {
      const card = document.createElement('div');
      card.className = 'board-onboarding__skeleton-card';
      const idLine = document.createElement('span');
      idLine.className =
        'board-onboarding__skeleton-line board-onboarding__skeleton-line--id';
      const titleLine = document.createElement('span');
      titleLine.className =
        'board-onboarding__skeleton-line board-onboarding__skeleton-line--title';
      card.appendChild(idLine);
      card.appendChild(titleLine);
      list.appendChild(card);
    }
    column.appendChild(list);
    grid.appendChild(column);
  });

  preview.appendChild(grid);
  return preview;
}

/** Sync status label, dots, preview, and panel busy class from the resolved phase. */
export function syncBoardOnboardingBusyUI(
  wrap: HTMLElement,
  phase: BoardOnboardingBusyPhase,
): void {
  const panel = wrap.querySelector('.board-onboarding__panel');
  const setup = wrap.querySelector('[data-board-onboarding-setup]');
  const initLead = wrap.querySelector('[data-board-onboarding-init-lead]');
  const initPlan = wrap.querySelector('[data-board-onboarding-init-plan]') as HTMLElement | null;
  const initProgress = wrap.querySelector('[data-board-onboarding-init-progress]');
  const status = wrap.querySelector('[data-board-onboarding-status]') as HTMLElement | null;
  const label = wrap.querySelector('[data-board-onboarding-status-label]') as HTMLElement | null;
  const dotsHost = wrap.querySelector('.board-onboarding__status-dots');
  const preview = wrap.querySelector('[data-board-onboarding-preview]');
  const planSelect = wrap.querySelector('#boardOnboardingPlanSelect') as HTMLSelectElement | null;

  wrap.dataset.boardOnboardingBusy = phase === 'idle' ? '' : phase;
  if (panel instanceof HTMLElement) {
    panel.classList.toggle('board-onboarding__panel--busy', phase === 'init');
  }
  if (setup instanceof HTMLElement) {
    setup.classList.toggle('hidden', phase === 'init');
    setup.hidden = phase === 'init';
  }
  if (initLead instanceof HTMLElement) {
    initLead.classList.toggle('hidden', phase !== 'init');
    initLead.hidden = phase !== 'init';
  }
  if (initProgress instanceof HTMLElement) {
    initProgress.classList.toggle('hidden', phase !== 'init');
    initProgress.hidden = phase !== 'init';
    initProgress.setAttribute('aria-hidden', phase === 'init' ? 'false' : 'true');
  }
  if (initPlan && planSelect) {
    initPlan.textContent = formatBoardOnboardingPlanDisplay(planSelect.value);
    initPlan.title = planSelect.value.trim() || undefined;
  }

  if (!status || !label) return;

  if (phase === 'idle') {
    status.classList.add('hidden');
    status.hidden = true;
    if (preview) preview.classList.add('hidden');
    return;
  }

  status.classList.remove('hidden');
  status.hidden = false;
  label.textContent = BOARD_ONBOARDING_BUSY_LABEL[phase];

  if (dotsHost) {
    dotsHost.replaceWith(buildBoardOnboardingStatusDots(phase));
  }

  if (preview) {
    preview.classList.toggle('hidden', phase !== 'init');
  }
}

export interface MountBoardOnboardingPanelOptions {
  /** Test-only: inject fake plan discovery instead of hitting the local tool server. */
  discoverPlans?: () => Promise<DiscoverOrchestratePlansResult>;
}

/** Keeps Start / Open plan / refresh aligned with streaming and executable plan paths. */
function syncBoardOnboardingControls(
  sel: HTMLSelectElement,
  startBtn: HTMLButtonElement,
  openPlanBtn: HTMLButtonElement,
  refreshBtn: HTMLButtonElement,
  pickPlanHint: HTMLElement,
  plansCount: number,
  plansLoading: boolean,
): void {
  const streaming = isActiveChatStreaming();
  const path = sel.value.trim();
  const executable = isExecutableOrchestratePlan(path);
  const busy = plansLoading || streaming;
  sel.disabled = busy;
  sel.setAttribute('aria-busy', plansLoading ? 'true' : 'false');
  refreshBtn.disabled = busy;
  refreshBtn.setAttribute('aria-busy', plansLoading ? 'true' : 'false');
  startBtn.disabled = busy || !executable;
  openPlanBtn.disabled = busy || !executable;
  if (!streaming && !executable && plansCount > 0 && !plansLoading) {
    pickPlanHint.textContent = 'Select a plan first.';
    pickPlanHint.classList.remove('hidden');
  } else {
    pickPlanHint.classList.add('hidden');
  }
}

/**
 * Called from the send loop when streaming toggles so onboarding controls stay disabled in-flight.
 */
export function refreshBoardOnboardingIfMounted(): void {
  const sel = document.getElementById(
    'boardOnboardingPlanSelect',
  ) as HTMLSelectElement | null;
  if (!sel) return;
  const wrap = sel.closest('.board-onboarding') as HTMLElement | null;
  if (!wrap) return;
  const startBtn = wrap.querySelector(
    '[data-board-onboarding-start]',
  ) as HTMLButtonElement | null;
  const openPlanBtn = wrap.querySelector(
    '[data-board-onboarding-open-plan]',
  ) as HTMLButtonElement | null;
  const refreshBtn = wrap.querySelector(
    '[data-board-onboarding-refresh]',
  ) as HTMLButtonElement | null;
  const pickPlanHint = wrap.querySelector(
    '[data-board-onboarding-start-hint]',
  ) as HTMLElement | null;
  if (!startBtn || !openPlanBtn || !refreshBtn || !pickPlanHint) return;
  const plansCount = Number(wrap.dataset.boardOnboardingPlansCount ?? '0');
  const plansLoading = wrap.dataset.boardOnboardingPlansLoading === 'true';
  syncBoardOnboardingControls(
    sel,
    startBtn,
    openPlanBtn,
    refreshBtn,
    pickPlanHint,
    plansCount,
    plansLoading,
  );
  syncBoardOnboardingBusyUI(
    wrap,
    resolveBoardOnboardingBusyPhase(plansLoading),
  );
}

/**
 * Builds the guided Orchestrate empty board: plan list, Start kickoff, and escape to chat view.
 */
export async function mountBoardOnboardingPanel(
  container: HTMLElement,
  chat: Chat,
  options: MountBoardOnboardingPanelOptions = {},
): Promise<void> {
  container.replaceChildren();

  const panel = document.createElement('div');
  panel.className = 'board-onboarding__panel';
  container.appendChild(panel);

  const initLead = document.createElement('div');
  initLead.className = 'board-onboarding__init-lead hidden';
  initLead.dataset.boardOnboardingInitLead = '';
  initLead.hidden = true;

  const initPlan = document.createElement('p');
  initPlan.className = 'board-onboarding__init-plan';
  initPlan.dataset.boardOnboardingInitPlan = '';
  initPlan.textContent = 'Plan file';

  const initProgress = document.createElement('div');
  initProgress.className = 'board-onboarding__init-progress hidden';
  initProgress.dataset.boardOnboardingInitProgress = '';
  initProgress.setAttribute('role', 'progressbar');
  initProgress.setAttribute('aria-label', 'Board initialization');
  initProgress.setAttribute('aria-valuetext', 'Initializing');
  initProgress.hidden = true;
  const initProgressFill = document.createElement('div');
  initProgressFill.className = 'board-onboarding__init-progress-fill';
  initProgress.appendChild(initProgressFill);

  initLead.appendChild(initPlan);
  initLead.appendChild(initProgress);

  const status = document.createElement('div');
  status.className = 'board-onboarding__status hidden';
  status.dataset.boardOnboardingStatus = '';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const statusDots = buildBoardOnboardingStatusDots('plans');
  const statusLabel = document.createElement('span');
  statusLabel.className = 'board-onboarding__status-label';
  statusLabel.dataset.boardOnboardingStatusLabel = '';
  status.appendChild(statusDots);
  status.appendChild(statusLabel);

  const preview = buildBoardOnboardingPreview();
  preview.classList.add('hidden');

  const setup = document.createElement('div');
  setup.className = 'board-onboarding__setup';
  setup.dataset.boardOnboardingSetup = '';

  const title = document.createElement('h2');
  title.className = 'board-onboarding__title';
  title.textContent = 'Orchestrate a plan';

  const desc = document.createElement('p');
  desc.className = 'board-onboarding__desc';
  desc.textContent =
    'Pick a plan file. Minnow initializes the Kanban from its waves and tasks, then runs the orchestrator.';

  const field = document.createElement('div');
  field.className = 'board-onboarding__field';

  const label = document.createElement('label');
  label.className = 'board-onboarding__label';
  label.htmlFor = 'boardOnboardingPlanSelect';
  label.textContent = 'Plan';

  const planRow = document.createElement('div');
  planRow.className = 'board-onboarding__plan-row';

  const sel = document.createElement('select');
  sel.id = 'boardOnboardingPlanSelect';
  sel.className = 'board-select';
  sel.dataset.testid = 'boardOnboardingPlanSelect';
  sel.setAttribute('aria-label', 'Orchestrate plan file');

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.className = 'board-btn board-onboarding__refresh';
  refreshBtn.dataset.boardOnboardingRefresh = '';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.title = 'Reload plan list from workspace';

  planRow.appendChild(sel);
  planRow.appendChild(refreshBtn);

  field.appendChild(label);
  field.appendChild(planRow);

  const hint = document.createElement('p');
  hint.className = 'board-onboarding__hint hidden';
  hint.setAttribute('aria-live', 'polite');

  const pickPlanHint = document.createElement('p');
  pickPlanHint.className = 'board-onboarding__start-hint hidden';
  pickPlanHint.dataset.boardOnboardingStartHint = '';

  const actions = document.createElement('div');
  actions.className = 'board-onboarding__actions';

  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.className = 'board-btn board-btn--primary';
  startBtn.dataset.boardOnboardingStart = '';
  startBtn.textContent = 'Build board';

  const openPlanBtn = document.createElement('button');
  openPlanBtn.type = 'button';
  openPlanBtn.className = 'board-btn';
  openPlanBtn.dataset.boardOnboardingOpenPlan = '';
  openPlanBtn.textContent = 'Open plan in editor';

  const chatBtn = document.createElement('button');
  chatBtn.type = 'button';
  chatBtn.className = 'board-onboarding__chat-link';
  chatBtn.textContent = 'Chat view';

  actions.appendChild(startBtn);
  actions.appendChild(openPlanBtn);
  actions.appendChild(chatBtn);

  setup.appendChild(title);
  setup.appendChild(desc);
  setup.appendChild(field);
  setup.appendChild(hint);
  setup.appendChild(pickPlanHint);
  setup.appendChild(actions);

  panel.appendChild(initLead);
  panel.appendChild(status);
  panel.appendChild(preview);
  panel.appendChild(setup);

  container.className = 'board-onboarding';
  let latestPlanCount = 0;
  let plansLoading = false;

  const applySync = () => {
    syncBoardOnboardingControls(
      sel,
      startBtn,
      openPlanBtn,
      refreshBtn,
      pickPlanHint,
      latestPlanCount,
      plansLoading,
    );
    syncBoardOnboardingBusyUI(
      container,
      resolveBoardOnboardingBusyPhase(plansLoading),
    );
  };

  const loadPlans = async () => {
    plansLoading = true;
    container.dataset.boardOnboardingPlansLoading = 'true';
    applySync();
    try {
      const { plans } = await populateOrchestratePlanSelect(sel, hint, chat, {
        autoSelectSingle: true,
        discoverPlans: options.discoverPlans,
      });
      latestPlanCount = plans.length;
      container.dataset.boardOnboardingPlansCount = String(plans.length);
      syncViewModeToggleFromActiveChat();
      void syncOrchestratePlanStripFromActiveChat();
    } finally {
      plansLoading = false;
      delete container.dataset.boardOnboardingPlansLoading;
      applySync();
    }
  };

  sel.addEventListener('change', () => {
    if (isActiveChatStreaming()) return;
    persistOrchestratePlanPathFromSelectValue(chat, sel.value);
    syncViewModeToggleFromActiveChat();
    void syncOrchestratePlanStripFromActiveChat();
    applySync();
  });

  refreshBtn.addEventListener('click', () => {
    void loadPlans();
  });

  startBtn.addEventListener('click', () => {
    if (startBtn.disabled) return;
    persistOrchestratePlanPathFromSelectValue(chat, sel.value);
    sendBoardMessage(BOARD_ONBOARDING_KICKOFF_MESSAGE);
  });

  openPlanBtn.addEventListener('click', () => {
    const path = sel.value.trim();
    if (!isExecutableOrchestratePlan(path)) return;
    void import('./file-viewer').then((m) => m.openFileInViewer(path));
  });

  chatBtn.addEventListener('click', () => {
    setOrchestrateViewMode('chat');
  });

  await loadPlans();
}

/**
 * Update the mounted board shell from session state (kanban, timer, controls).
 * Falls back to a full render when the DOM is missing or still empty.
 */
export function refreshActiveBoardIfMounted(): void {
  if (isOrchestrateHubMounted()) return;
  if (!isOrchestrateBoardViewActive() && !isOrchestrateInitSplitChromeActive()) return;
  const group = getActiveBoardGroup();
  if (!group) return;
  const plannerChat = plannerForGroup(group);
  const mount = getOrchestrateBoardMountElement();

  const board = group.orchestrateBoard;
  const root = mount.querySelector(':scope > .board-root') as HTMLElement | null;
  if (root && board && root.querySelector('.board-main')) {
    refreshBoardDom(root, group, plannerChat, board);
    return;
  }
  if (root && !board) return;
  renderBoardView(group);
}

/** Render Orchestrate board into the board mount (#chatArea or split top pane). */
export function renderBoardView(group: ChatGroup): void {
  teardownOrchestrateHub();
  teardownHub();
  const area = document.getElementById('chatArea');
  if (!area) return;
  const mount = getOrchestrateBoardMountElement();
  const splitActive = mount !== area;

  const plannerChat = plannerForGroup(group);
  const board = group.orchestrateBoard;
  const sameGroupSession = currentSession?.groupId === group.id;
  const existingRoot = mount.querySelector(':scope > .board-root') as HTMLElement | null;
  const chatMount = splitActive
    ? area.querySelector('[data-testid="boardInitSplitChat"]')
    : null;
  const chatBubblesPresent = Boolean(
    chatMount
      ? chatMount.querySelector('.msg, #emptyState')
      : area.querySelector(':scope > .msg, :scope > #emptyState'),
  );
  const canRefreshInPlace =
    Boolean(board) &&
    sameGroupSession &&
    !chatBubblesPresent &&
    Boolean(existingRoot?.querySelector('.board-main')) &&
    Boolean(existingRoot?.querySelector(`#btnViewModeToggleChat`));

  if (canRefreshInPlace && board) {
    refreshBoardDom(existingRoot!, group, plannerChat, board);
    ensureBoardSession(group, plannerChat);
    syncViewModeToggleFromActiveChat();
    return;
  }

  if (!sameGroupSession) disposeBoardSession();
  if (splitActive) {
    mount.replaceChildren();
  } else {
    area.innerHTML = '';
  }

  const root = document.createElement('section');
  root.className = 'board-root';

  const planPath =
    group.orchestratePlanPath ?? plannerChat.orchestratePlanPath ?? board?.planPath ?? '';

  if (!board) {
    const wrap = document.createElement('div');
    wrap.className = 'board-onboarding';
    root.appendChild(wrap);
    mount.appendChild(root);
    ensureBoardSession(group, plannerChat);
    syncViewModeToggleFromActiveChat();
    void syncOrchestratePlanStripFromActiveChat();
    void mountBoardOnboardingPanel(wrap, plannerChat);
    return;
  }

  const activeRuns = listActiveSubAgentRuns().filter(
    (r) =>
      r.parentChatId === plannerChat.id &&
      (r.status === 'queued' || r.status === 'running'),
  );
  const isStreaming = isChatStreaming(plannerChat.id);

  const headerStatus = deriveBoardHeaderStatus(
    board,
    isStreaming,
    activeRuns.length,
    isUserStoppedChat(plannerChat),
  );
  const activity = deriveOrchestratorLastActivity(plannerChat, isStreaming);
  const metrics = boardHeaderMetrics(group, plannerChat, board, activeRuns.length);
  const header = buildBoardHeader(
    plannerChat,
    board,
    planPath,
    metrics,
    isStreaming,
    headerStatus,
    activity,
  );

  const main = document.createElement('div');
  main.className = 'board-main';
  main.appendChild(renderKanban(board, group, plannerChat));

  root.appendChild(header);
  root.appendChild(main);
  mount.appendChild(root);

  ensureBoardSession(group, plannerChat);
  syncViewModeToggleFromActiveChat();
  void syncOrchestratePlanStripFromActiveChat();
}

/** Tear down board listeners (test teardown). */
export function disposeBoardViewForTests(): void {
  disposeBoardSession();
  kanbanInteractionReleaseBound = false;
}
