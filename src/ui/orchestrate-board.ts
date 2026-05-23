/**
 * Orchestrate Board View: Kanban, plan panel, controls.
 */

import {
  deriveOrchestratorLastActivity,
  type OrchestratorActivity,
} from '../chat/orchestrate/last-activity';
import {
  ORCHESTRATE_PLAN_COMPLETE_RESUME_HINT,
  resolveOrchestrateResumeMessage,
} from '../chat/orchestrate/resume-message';
import {
  hasIncompleteOrchestrateWork,
  isOrchestratePlanComplete,
} from '../chat/orchestrate/plan-complete';
import { isUserStoppedChat } from '../chat/orchestrate/user-stopped.ts';
import { shouldShowOrchestrateStallBadge } from '../agents/supervisor/state.ts';
import { stopGeneration } from '../chat/stop-generation';
import { isActiveChatStreaming, isChatStreaming } from '../chat/streaming-state';
import {
  cancelAllForParentTurn,
  getSubAgentRun,
  listActiveSubAgentRuns,
} from '../agents/orchestrator';
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
import { findChatById, getActiveChat, scheduleSaveSessions, touchChat } from '../state/sessions';
import { isExecutableOrchestratePlan } from '../chat/orchestrate/plan-path';
import type {
  BoardTask,
  BoardTaskStatus,
  Chat,
  PersistedSubAgentStatus,
} from '../types';
import { openSubAgentDrawer } from './sub-agent-drawer';
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
): TaskAgentBadge | null {
  if (!getBoardTaskPrimaryRunId(task)) return null;

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
  const chat = findChatById(session.chatId);
  if (!chat?.orchestrateBoard) {
    stopBoardLiveTick();
    return;
  }
  const activeRuns = listActiveSubAgentRuns().filter(
    (r) =>
      r.parentChatId === chat.id &&
      (r.status === 'queued' || r.status === 'running'),
  );
  syncOrchestrateBoardTimer(chat, boardTimerContextForChat(chat, activeRuns.length));
  if (
    isOrchestrateBoardViewActive() &&
    normalizeModeId(getActiveChat().modeId) === 'orchestrate' &&
    getActiveChat().id === chat.id
  ) {
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
  | 'stopped'
  | 'stalled';

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
  watchdogStalled = false,
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
  if (
    watchdogStalled &&
    incomplete &&
    !isStreaming &&
    activeRunCount === 0
  ) {
    return { variant: 'stalled', label: 'Stalled — Resume' };
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

/** Start vs Resume copy for the board header play control (idle state). */
function playPauseIdleLabel(status: BoardHeaderStatus): string {
  if (status.variant === 'complete') return 'Plan complete';
  if (status.variant === 'active') return 'Active';
  if (status.variant === 'stopped' || status.variant === 'ready') return 'Start';
  return 'Resume';
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
const BOARD_ICON_PLAY = 'M8 5v14l11-7z';
const BOARD_ICON_PAUSE = 'M6 4h4v16H6z M14 4h4v16h-4z';

function isBoardPlayPauseRunning(
  isStreaming: boolean,
  board: NonNullable<Chat['orchestrateBoard']>,
): boolean {
  return isStreaming && Boolean(board.activeParentTurnId);
}

/** Sync play/pause icon, labels, pressed state, and disabled state on live board refresh. */
function syncBoardPlayPauseButton(
  btn: HTMLButtonElement,
  board: NonNullable<Chat['orchestrateBoard']>,
  isStreaming: boolean,
  headerStatus: BoardHeaderStatus,
): void {
  const running = isBoardPlayPauseRunning(isStreaming, board);
  const playIcon = btn.querySelector('[data-board-icon="play"]');
  const pauseIcon = btn.querySelector('[data-board-icon="pause"]');
  playIcon?.classList.toggle('hidden', running);
  pauseIcon?.classList.toggle('hidden', !running);

  if (running) {
    btn.setAttribute('aria-label', 'Stop orchestrator');
    btn.title = 'Stop orchestrator';
    btn.setAttribute('aria-pressed', 'true');
    btn.disabled = false;
    btn.classList.add('board-header__icon-btn--danger');
  } else {
    const planComplete = isOrchestratePlanComplete(board);
    const agentsActive = headerStatus.variant === 'active';
    const idleLabel = playPauseIdleLabel(headerStatus);
    btn.setAttribute('aria-label', idleLabel);
    btn.title = planComplete ? ORCHESTRATE_PLAN_COMPLETE_RESUME_HINT : idleLabel;
    btn.setAttribute('aria-pressed', 'false');
    btn.disabled = isStreaming || planComplete || agentsActive;
    btn.classList.remove('board-header__icon-btn--danger');
  }
}

function createBoardPlayPauseButton(
  board: NonNullable<Chat['orchestrateBoard']>,
  isStreaming: boolean,
  headerStatus: BoardHeaderStatus,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn board-header__icon-btn';
  btn.dataset.boardAction = 'play-pause';

  const playSvg = createBoardHeaderIconSvg(BOARD_ICON_PLAY);
  playSvg.dataset.boardIcon = 'play';
  const pauseSvg = createBoardHeaderIconSvg(BOARD_ICON_PAUSE);
  pauseSvg.dataset.boardIcon = 'pause';
  pauseSvg.classList.add('hidden');
  btn.appendChild(playSvg);
  btn.appendChild(pauseSvg);

  syncBoardPlayPauseButton(btn, board, isStreaming, headerStatus);

  btn.addEventListener('click', () => {
    const activeChat = getActiveChat();
    const activeBoard = activeChat.orchestrateBoard;
    if (!activeBoard) return;
    if (isBoardPlayPauseRunning(isActiveChatStreaming(), activeBoard)) {
      stopGeneration();
      if (activeBoard.activeParentTurnId) {
        cancelAllForParentTurn(activeBoard.activeParentTurnId);
      }
      refreshActiveBoardIfMounted();
      return;
    }
    const message = resolveOrchestrateResumeMessage(activeBoard);
    if (!message) return;
    sendBoardMessage(message);
    refreshActiveBoardIfMounted();
  });

  return btn;
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
  controls.appendChild(createBoardPlayPauseButton(board, isStreaming, headerStatus));
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
  chat: Chat,
  board: NonNullable<Chat['orchestrateBoard']>,
  activeRunCount: number,
): BoardHeaderMetrics {
  syncOrchestrateBoardTimer(chat, boardTimerContextForChat(chat, activeRunCount));
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

function buildTaskCard(task: BoardTask, chat: Chat): HTMLElement {
  const primaryRunId = getBoardTaskPrimaryRunId(task);
  const runStatus = primaryRunId
    ? resolveRunStatusForTask(chat, primaryRunId)
    : null;
  const agentBadge = deriveTaskAgentBadge(task, runStatus);
  const openable = canOpenBoardTaskSubAgent(task, runStatus);
  const runIds = getBoardTaskRunIds(task);
  let selectedRunId = primaryRunId ?? runIds[runIds.length - 1] ?? null;

  const card = document.createElement('article');
  card.className = 'board-task-card';
  if (task.status === 'failed' || task.status === 'blocked') {
    card.classList.add('board-task-card--alert');
  }
  if (openable && selectedRunId) {
    card.classList.add('board-task-card--clickable');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute(
      'aria-label',
      `Open sub-agent for ${task.id}: ${task.title}${agentBadge ? `, ${agentBadge.label}` : ''}`,
    );
    const open = (): void => {
      const runId = selectedRunId ?? getBoardTaskPrimaryRunId(task);
      if (runId) openSubAgentDrawer(runId, chat.id);
    };
    card.addEventListener('click', (ev) => {
      if (
        ev.target instanceof HTMLElement &&
        ev.target.closest('.board-task-card__run-picker')
      ) {
        return;
      }
      open();
    });
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

  if (openable && runIds.length > 1) {
    const pickerWrap = document.createElement('div');
    pickerWrap.className = 'board-task-card__run-picker';
    const pickerLabel = document.createElement('label');
    pickerLabel.className = 'board-task-card__run-picker-label';
    pickerLabel.textContent = 'Run';
    const picker = document.createElement('select');
    picker.className = 'board-task-card__run-picker-select';
    picker.setAttribute('aria-label', `Sub-agent runs for ${task.id}`);
    for (let i = 0; i < runIds.length; i++) {
      const runId = runIds[i];
      const opt = document.createElement('option');
      opt.value = runId;
      const status = resolveRunStatusForTask(chat, runId);
      const shortId = runId.length > 8 ? `${runId.slice(0, 8)}…` : runId;
      opt.textContent = `Run ${i + 1} · ${status ?? 'unknown'} · ${shortId}`;
      if (runId === selectedRunId) opt.selected = true;
      picker.appendChild(opt);
    }
    picker.addEventListener('click', (ev) => ev.stopPropagation());
    picker.addEventListener('change', () => {
      selectedRunId = picker.value;
    });
    pickerLabel.appendChild(picker);
    pickerWrap.appendChild(pickerLabel);
    card.appendChild(pickerWrap);
  }

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
  const metrics = boardHeaderMetrics(chat, board, activeRuns.length);
  const userStopped = isUserStoppedChat(chat);
  const headerStatus = deriveBoardHeaderStatus(
    board,
    isStreaming,
    activeRuns.length,
    userStopped,
    shouldShowOrchestrateStallBadge(chat.id, board, {
      isStreaming,
      activeRunCount: activeRuns.length,
    }),
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

  const playPause = root.querySelector(
    '[data-board-action="play-pause"]',
  ) as HTMLButtonElement | null;
  if (playPause) {
    syncBoardPlayPauseButton(playPause, board, isStreaming, headerStatus);
  }

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

/** First user turn from Board onboarding before the model runs board_init (MIN-5). */
export const BOARD_ONBOARDING_KICKOFF_MESSAGE =
  'Initialize the board for the selected plan and begin execution.';

/** Busy phases shown in the onboarding status strip (plan fetch vs board_init stream). */
export type BoardOnboardingBusyPhase = 'idle' | 'plans' | 'init';

const BOARD_ONBOARDING_BUSY_LABEL: Record<Exclude<BoardOnboardingBusyPhase, 'idle'>, string> =
  {
    plans: 'Loading plans',
    init: 'Initializing board',
  };

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

/** Lightweight Kanban column silhouettes while board_init runs. */
function buildBoardOnboardingPreview(): HTMLElement {
  const preview = document.createElement('div');
  preview.className = 'board-onboarding__preview';
  preview.setAttribute('aria-hidden', 'true');
  preview.dataset.boardOnboardingPreview = '';
  const labels = ['Planned', 'In progress', 'Testing', 'Complete'];
  for (const label of labels) {
    const col = document.createElement('div');
    col.className = 'board-onboarding__preview-col';
    const cap = document.createElement('span');
    cap.className = 'board-onboarding__preview-cap';
    cap.textContent = label;
    const body = document.createElement('div');
    body.className = 'board-onboarding__preview-body';
    col.appendChild(cap);
    col.appendChild(body);
    preview.appendChild(col);
  }
  return preview;
}

/** Sync status label, dots, preview, and panel busy class from the resolved phase. */
export function syncBoardOnboardingBusyUI(
  wrap: HTMLElement,
  phase: BoardOnboardingBusyPhase,
): void {
  const panel = wrap.querySelector('.board-onboarding__panel');
  const status = wrap.querySelector('[data-board-onboarding-status]') as HTMLElement | null;
  const label = wrap.querySelector('[data-board-onboarding-status-label]') as HTMLElement | null;
  const dotsHost = wrap.querySelector('.board-onboarding__status-dots');
  const preview = wrap.querySelector('[data-board-onboarding-preview]');

  wrap.dataset.boardOnboardingBusy = phase === 'idle' ? '' : phase;
  if (panel instanceof HTMLElement) {
    panel.classList.toggle('board-onboarding__panel--busy', phase === 'init');
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

  const title = document.createElement('h2');
  title.className = 'board-onboarding__title';
  title.textContent = 'Orchestrate a plan';

  const desc = document.createElement('p');
  desc.className = 'board-onboarding__desc';
  desc.textContent =
    'Pick a plan file. Minnow initializes the Kanban from its waves and tasks, then runs the orchestrator.';

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
  startBtn.textContent = 'Start';

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

  panel.appendChild(title);
  panel.appendChild(desc);
  panel.appendChild(status);
  panel.appendChild(preview);
  panel.appendChild(field);
  panel.appendChild(hint);
  panel.appendChild(pickPlanHint);
  panel.appendChild(actions);

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
    const wrap = document.createElement('div');
    wrap.className = 'board-onboarding';
    root.appendChild(wrap);
    area.appendChild(root);
    ensureBoardSession(chatForRender.id);
    syncViewModeToggleFromActiveChat();
    void syncOrchestratePlanStripFromActiveChat();
    void mountBoardOnboardingPanel(wrap, chatForRender);
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
    shouldShowOrchestrateStallBadge(chatForRender.id, board, {
      isStreaming,
      activeRunCount: activeRuns.length,
    }),
  );
  const activity = deriveOrchestratorLastActivity(chatForRender, isStreaming);
  const metrics = boardHeaderMetrics(chatForRender, board, activeRuns.length);
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
  void syncOrchestratePlanStripFromActiveChat();
}

/** Tear down board listeners (test teardown). */
export function disposeBoardViewForTests(): void {
  disposeBoardSession();
}
