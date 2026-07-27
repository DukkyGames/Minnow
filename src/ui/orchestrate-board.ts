import { appAlert, appConfirm, appPrompt } from './app-dialog';
/**
 * Orchestrate Board View: Kanban, plan panel, controls.
 */

import {
  deriveOrchestratorLastActivity,
  type OrchestratorActivity,
} from '../chat/orchestrate/last-activity';
import {
  renderFinishDashboard,
  syncFinishDashboard,
} from './orchestrate-finish-dashboard';
import {
  deriveTaskCardActivity,
  type TaskCardActivity,
  type TaskCardSubAgentHint,
} from '../chat/orchestrate/task-activity';
import { deriveTaskCategoryBadge } from '../chat/orchestrate/task-category-badge';
import { listTaskRelatedChats } from '../chat/orchestrate/task-chats';
import {
  getMainTurnActivity,
  subscribeMainTurnActivity,
} from '../chat/main-turn-activity';
import { isOrchestrateBoardFinished, isOrchestratePlanComplete } from '../chat/orchestrate/plan-complete';
import { isUserStoppedChat } from '../chat/orchestrate/user-stopped.ts';
import { sumUsageSegments } from '../chat/orchestrate/stats-math';
import {
  isActiveChatStreaming,
  isChatStreaming,
  subscribeChatStreamActivity,
} from '../chat/streaming-state';
import {
  getSubAgentRun,
  listActiveSubAgentRuns,
} from '../agents/orchestrator';
import {
  chatTaskRunId,
  formatHeartbeatBadge,
  getHeartbeatConfig,
  getRunSupervision,
  type RunSupervision,
} from '../agents/controller/wrapper';
import { getAutopilotMetaSync } from '../config/autopilot-meta.ts';
import {
  getActiveBoardGroup,
  getPlannerChatForGroup,
} from '../state/chat-groups.ts';
import { isOomPauseActive } from '../chat/orchestrate/oom-recovery.ts';
import {
  activateAfk,
  cancelPendingAfk,
  continueBoardTask,
  countRunningTaskChats,
  recoverMergingBoardTask,
  getBoardExecutionMode,
  isBoardRunning,
  isTaskChatActive,
  isTaskChatActiveForStallCheck,
  listRunningBoardTaskSlots,
  moveTaskStatus,
  moveTaskToNewChat,
  requeueBoardTask,
  resolveEffectiveMaxConcurrent,
  restartBoardTask,
  setBoardExecutionMode,
  setBoardIsolationMode,
  setBoardMaxConcurrent,
  startBoardAutoRun,
  startFinalIntegrationTestForPlannerChat,
  startTask,
  startTaskTestingForPlannerChat,
  startWave,
  stopBoardAutoRun,
  stopRunningBoardSlot,
  stopTask,
  toggleWaveCollapsed,
  type RunningBoardTaskSlot,
} from '../state/orchestrate-board-actions.ts';
import { subscribeSubAgentRuns } from '../agents/sub-agent-events';
import type { SubAgentStatus, RunLifecycle } from '../agents/types';
import { deriveLifecycleFromStatus } from '../agents/types';
import {
  applyOpenBoardWaveCollapse,
  countBoardTasksProgressed,
  countBoardWavesProgressed,
  getBoardProgressPercent,
  getOrchestrateBoardElapsedMs,
  isTaskStalledForRestart,
  syncOrchestrateBoardTimer,
  type OrchestrateBoardTimerContext,
} from '../state/orchestrate-board-store';
import { normalizeModeId } from '../chat/modes/types';
import { refreshMetricsStripForChat } from '../chat/orchestrate/board-stats-aggregate';
import { subscribeBoardChanges, emitBoardChange } from '../state/orchestrate-board-events';
import {
  countBoardLogAlerts,
  openBoardTimelineDrawer,
} from './board-timeline-drawer.ts';
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
  Usage,
} from '../types';

type BoardState = NonNullable<ChatGroup['orchestrateBoard']>;
import { createBoardCategoryIcon } from './board-category-icons';
import { createIcon, type IconName } from './icon';
import { switchChat } from './sidebar';
import {
  populateOrchestratePlanSelect,
  persistOrchestratePlanPathFromSelectValue,
} from './orchestrate-plan-picker';
import type { DiscoverOrchestratePlansResult } from '../chat/orchestrate/list-plans';
import { syncOrchestratePlanStripFromActiveChat } from './orchestrate-plan-selector';
import {
  openBoardTaskChat,
  setBoardTaskPlanSelection,
  showBoardTaskPlanPanel,
  syncBoardTaskPlanPanel,
  taskCardOpensPlanPanel,
} from './board-task-plan-panel';
import {
  isOrchestrateBoardViewActive,
  setOrchestrateViewMode,
  syncViewModeToggleFromActiveChat,
} from './view-mode-toggle';
import {
  getOrchestrateBoardMountElement,
  isOrchestrateInitSplitChromeActive,
} from './orchestrate-board-init-split';
import { isOrchestrateHubMounted, teardownOrchestrateHub } from './orchestrate-hub';
import { isMainColumnOverlaySuppressingChatDom } from './main-column-overlay';
import { teardownHub } from './hub';
import { kickoffOrchestrateBoardBuild } from './orchestrate-board-kickoff';
import {
  isBoardKickoffInProgress,
} from './orchestrate-board-onboarding-state';
import { BOARD_ONBOARDING_QUESTIONS_ID } from './orchestrate-board-onboarding-questions';
import {
  createBoardGitSetupPrompt,
  createBoardOnboardingHeroIcon,
  disposeBoardOnboardingUiTimers,
  resolveBoardOnboardingBusyPhase,
  syncBoardOnboardingBusyUI,
  wireBoardOnboardingInteractions,
  type BoardOnboardingBusyPhase,
} from './orchestrate-board-onboarding-ui';
import { formatBoardOnboardingPlanDisplay } from './orchestrate-board-plan-display';

export { formatBoardOnboardingPlanDisplay };
export type { BoardOnboardingBusyPhase };
export { resolveBoardOnboardingBusyPhase, syncBoardOnboardingBusyUI };

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

/**
 * True when the user stopped this board. Prefers the persisted board flag
 * (set the moment Stop is pressed, survives reloads and the live tick) and
 * falls back to the planner transcript for boards saved before the flag.
 */
function isBoardUserStopped(board: BoardState, plannerChat: Chat): boolean {
  return board.userStopped === true || isUserStoppedChat(plannerChat);
}

/** Badge copy for tasks linked to a sub-agent run (Active / Failed / Complete / Cancelled). */
export function deriveTaskAgentBadge(
  task: BoardTask,
  runStatus?: RunStatusHint,
  taskChatStreaming = false,
  testChatStreaming = false,
): TaskAgentBadge | null {
  if (task.chatId && taskChatStreaming) {
    return { variant: 'active', label: 'Running' };
  }
  if (testChatStreaming) {
    return { variant: 'active', label: 'Testing…' };
  }
  if (!getBoardTaskPrimaryRunId(task) && !task.chatId) return null;

  if (runStatus === 'cancelled') {
    return { variant: 'failed', label: 'Cancelled' };
  }
  if (task.status === 'failed' || runStatus === 'failed') {
    return { variant: 'failed', label: 'Failed' };
  }
  if (runStatus === 'queued' || runStatus === 'running') {
    return { variant: 'active', label: 'Active' };
  }
  if (task.status === 'in_progress') {
    return { variant: 'active', label: 'Idle' };
  }
  if (task.status === 'testing') {
    return { variant: 'active', label: 'Awaiting test' };
  }
  if (task.status === 'complete' || runStatus === 'completed') {
    return { variant: 'complete', label: 'Complete' };
  }
  return null;
}

/** Resolve live supervision for a running board task (sub-agent or chat-backed). */
export function resolveTaskSupervision(
  task: BoardTask,
  plannerChat: Chat,
  taskStreaming = false,
): RunSupervision | null {
  const primaryRunId = getBoardTaskPrimaryRunId(task);
  if (primaryRunId) {
    const live = getSubAgentRun(primaryRunId);
    if (
      live &&
      live.parentChatId === plannerChat.id &&
      (live.status === 'queued' || live.status === 'running')
    ) {
      return {
        lastHeartbeatAt: live.lastHeartbeatAt ?? null,
        lastProgressAt: live.lastProgressAt ?? null,
        progressSeq: live.progressSeq ?? 0,
        attempt: live.attempt ?? 1,
        idempotencyKey: live.idempotencyKey ?? null,
        committedResultRef: live.committedResultRef ?? null,
      };
    }
  }
  if (taskStreaming && task.chatId) {
    return getRunSupervision(chatTaskRunId(task.chatId));
  }
  return null;
}

function appendTaskHeartbeatBadge(
  trail: HTMLElement,
  supervision: RunSupervision,
): void {
  const label = formatHeartbeatBadge(supervision, getHeartbeatConfig());
  if (!label) return;
  const badge = document.createElement('span');
  badge.className = 'board-task-card__heartbeat';
  badge.textContent = label;
  badge.title = 'Run heartbeat age';
  trail.appendChild(badge);
}

/**
 * Patch heartbeat badge text in place — avoids rebuilding the kanban every tick.
 * Heartbeat age is time-derived; including it in `buildKanbanRefreshKey` replaced
 * the whole board surface and made cards unclickable during runs.
 */
function syncKanbanHeartbeatBadges(
  kanban: HTMLElement,
  board: BoardState,
  plannerChat: Chat,
): void {
  for (const task of board.tasks) {
    const card = kanban.querySelector(
      `[data-board-task-id="${task.id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`,
    );
    if (!(card instanceof HTMLElement)) continue;

    const supervision = resolveTaskSupervision(
      task,
      plannerChat,
      Boolean(task.chatId && isChatStreaming(task.chatId)),
    );
    const trail = card.querySelector('.board-task-card__trail');
    if (!(trail instanceof HTMLElement)) continue;

    let badge = trail.querySelector<HTMLElement>('.board-task-card__heartbeat');
    const label = supervision
      ? formatHeartbeatBadge(supervision, getHeartbeatConfig())
      : null;

    if (!label) {
      badge?.remove();
      continue;
    }

    if (!(badge instanceof HTMLElement)) {
      badge = document.createElement('span');
      badge.className = 'board-task-card__heartbeat';
      badge.title = 'Run heartbeat age';
      trail.appendChild(badge);
    }

    if (badge.textContent !== label) {
      badge.textContent = label;
    }
  }
}

const LIFECYCLE_BADGE_LABELS: Partial<Record<RunLifecycle, string>> = {
  suspect: 'Suspect',
  recovering: 'Recovering',
};

function resolveTaskRunLifecycle(
  task: BoardTask,
  plannerChat: Chat,
): RunLifecycle | null {
  const runId = getBoardTaskPrimaryRunId(task);
  if (!runId) return null;
  const live = getSubAgentRun(runId);
  if (!live || live.parentChatId !== plannerChat.id) return null;
  if (live.status !== 'queued' && live.status !== 'running') return null;
  return live.lifecycle ?? deriveLifecycleFromStatus(live.status);
}

function appendTaskLifecycleBadge(
  trail: HTMLElement,
  lifecycle: RunLifecycle,
  taskStatus: BoardTask['status'],
): void {
  if (taskStatus === 'blocked') {
    const badge = document.createElement('span');
    badge.className = 'board-task-card__lifecycle board-task-card__lifecycle--blocked';
    badge.textContent = 'Blocked';
    badge.title = 'Watchdog tier-2 — needs human approval';
    trail.appendChild(badge);
    return;
  }
  if (taskStatus === 'quarantined') {
    const badge = document.createElement('span');
    badge.className = 'board-task-card__lifecycle board-task-card__lifecycle--quarantined';
    badge.textContent = 'Quarantined';
    badge.title = 'Task parked — use Requeue to retry or wait for Phase 2 self-heal';
    trail.appendChild(badge);
    return;
  }

  const label = LIFECYCLE_BADGE_LABELS[lifecycle];
  if (!label) return;
  const badge = document.createElement('span');
  badge.className = `board-task-card__lifecycle board-task-card__lifecycle--${lifecycle}`;
  badge.textContent = label;
  badge.title =
    lifecycle === 'suspect'
      ? 'Run appears stuck or repetitive'
      : 'Watchdog tier-1 recovery in progress';
  trail.appendChild(badge);
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
  unsubStream: () => void;
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
  board: BoardState,
): OrchestrateBoardTimerContext {
  return {
    isStreaming: isChatStreaming(chat.id),
    activeRunCount,
    userStopped: isBoardUserStopped(board, chat),
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
    boardTimerContextForChat(planner, activeRuns.length, group.orchestrateBoard),
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
  currentSession.unsubStream();
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
  const cap = resolveEffectiveMaxConcurrent(board);
  const running = countRunningTaskChats(board);
  const parts: string[] = [
    `run:${running}/${cap}`,
    `mode:${getBoardExecutionMode(board)}`,
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
      subAgentRunId: runId,
    });
    const relatedChats = listTaskRelatedChats(task, folder, allChats);
    // Heartbeat age and progressSeq are time/stream-derived; synced in place via
    // syncKanbanHeartbeatBadges so they must not force a kanban rebuild every tick.
    const runLifecycle = resolveTaskRunLifecycle(task, plannerChat) ?? '';
    parts.push(
      [
        task.id,
        task.status,
        task.chatId ?? '',
        streaming,
        runStatus,
        task.error ?? '',
        task.title,
        task.category,
        task.testAttempts ?? 0,
        deriveTaskCategoryBadge(task).cssVariant,
        activity ? `${activity.kind}:${activity.text}` : '',
        relatedChats.map((c) => `${c.chatId}:${c.streaming ? 1 : 0}`).join(','),
        runLifecycle,
        `d${(task.dependsOn ?? []).join('.')}`,
      ].join('|'),
    );
  }
  return parts.join(';');
}

/** After a full mount, record the kanban fingerprint so live ticks do not rebuild immediately. */
function seedKanbanRefreshKey(
  board: BoardState,
  plannerChat: Chat,
  group: ChatGroup,
): void {
  if (shouldShowFinishDashboard(board)) {
    lastKanbanRefreshKey = 'dashboard';
    return;
  }
  lastKanbanRefreshKey = `kanban:${buildKanbanRefreshKey(board, plannerChat, group)}`;
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

/** Capture scrollTop/scrollLeft of keyed scroll containers so a rebuild doesn't reset them. */
function captureBoardScrollPositions(
  root: ParentNode,
): Map<string, { top: number; left: number }> {
  const positions = new Map<string, { top: number; left: number }>();
  const nodes = root.querySelectorAll<HTMLElement>('[data-board-scroll-key]');
  // The root itself can be a keyed scroll container (e.g. the .board-kanban-waves
  // wave stack), which querySelectorAll on descendants would miss.
  const all =
    root instanceof HTMLElement && root.dataset.boardScrollKey
      ? [root, ...nodes]
      : [...nodes];
  for (const node of all) {
    const key = node.dataset.boardScrollKey;
    if (!key) continue;
    if (node.scrollTop === 0 && node.scrollLeft === 0) continue;
    positions.set(key, { top: node.scrollTop, left: node.scrollLeft });
  }
  return positions;
}

/** Restore previously-captured scroll positions onto the rebuilt scroll containers. */
function restoreBoardScrollPositions(
  root: ParentNode,
  positions: Map<string, { top: number; left: number }>,
): void {
  if (positions.size === 0) return;
  const nodes = root.querySelectorAll<HTMLElement>('[data-board-scroll-key]');
  const all =
    root instanceof HTMLElement && root.dataset.boardScrollKey
      ? [root, ...nodes]
      : [...nodes];
  for (const node of all) {
    const key = node.dataset.boardScrollKey;
    if (!key) continue;
    const saved = positions.get(key);
    if (!saved) continue;
    if (saved.top) node.scrollTop = saved.top;
    if (saved.left) node.scrollLeft = saved.left;
  }
}

function mountKanbanInMain(
  main: HTMLElement,
  board: BoardState,
  group: ChatGroup,
  plannerChat: Chat,
): void {
  const planPanel = main.querySelector('.board-plan-panel');
  const oldKanban = main.querySelector('.board-kanban-waves');
  const oldDashboard = main.querySelector('.board-finish-dashboard');
  // Preserve the user's manual scroll across the live-tick rebuild (MIN-259).
  const savedScroll = oldKanban ? captureBoardScrollPositions(oldKanban) : null;
  const newKanban = renderKanban(board, group, plannerChat);
  if (oldDashboard) oldDashboard.remove();
  if (oldKanban) {
    oldKanban.replaceWith(newKanban);
  } else if (planPanel) {
    main.insertBefore(newKanban, planPanel);
  } else {
    main.prepend(newKanban);
  }
  if (savedScroll) restoreBoardScrollPositions(newKanban, savedScroll);
  syncBoardTaskPlanPanel(main, board, group);
}

/** True when the finish dashboard should replace the kanban (MIN-208). */
function shouldShowFinishDashboard(board: BoardState): boolean {
  return isOrchestrateBoardFinished(board) && board.dashboardDismissed !== true;
}

function mountFinishDashboardInMain(
  main: HTMLElement,
  board: BoardState,
  group: ChatGroup,
  plannerChat: Chat,
): void {
  const oldKanban = main.querySelector('.board-kanban-waves');
  const existing = main.querySelector('.board-finish-dashboard');
  if (existing instanceof HTMLElement) {
    syncFinishDashboard(existing, group, plannerChat, board);
    return;
  }
  if (oldKanban) oldKanban.remove();
  const dashboard = renderFinishDashboard(group, plannerChat, board);
  const planPanel = main.querySelector('.board-plan-panel');
  if (planPanel) {
    main.insertBefore(dashboard, planPanel);
  } else {
    main.prepend(dashboard);
  }
}

function mountBoardMainSurface(
  main: HTMLElement,
  board: BoardState,
  group: ChatGroup,
  plannerChat: Chat,
): void {
  if (shouldShowFinishDashboard(board)) {
    mountFinishDashboardInMain(main, board, group, plannerChat);
    return;
  }
  mountKanbanInMain(main, board, group, plannerChat);
}

/** Keep the header Board ⇄ Dashboard toggle label in sync after live refresh. */
function syncBoardDashboardToggle(root: HTMLElement, board: BoardState): void {
  const toggle = root.querySelector(
    '[data-board-action="dashboard-toggle"]',
  ) as HTMLButtonElement | null;
  if (!toggle) return;
  const showingDashboard = shouldShowFinishDashboard(board);
  toggle.textContent = showingDashboard ? 'Board' : 'Dashboard';
  toggle.title = showingDashboard
    ? 'Return to the kanban board'
    : 'Open the finish dashboard';
  toggle.setAttribute(
    'aria-label',
    showingDashboard ? 'Back to board' : 'Open finish dashboard',
  );
}

let boardUiRefreshFrame: number | undefined;

/**
 * Refresh board UI when store or sub-agents change (stable handler per folder).
 *
 * Coalesces bursts into a single refresh per animation frame. High-frequency
 * sources — notably per-token `subscribeChatStreamActivity` during a board run —
 * would otherwise drive a synchronous O(tasks × chats) `buildKanbanRefreshKey`
 * pass hundreds of times a second, saturating the main thread (blank, frozen,
 * non-recovering UI on large boards). `refreshActiveBoardIfMounted` reads live
 * state when the frame fires, so dropped intermediate events lose no data.
 */
function scheduleBoardUiRefresh(groupId: string): void {
  if (isOrchestrateHubMounted()) return;
  if (isMainColumnOverlaySuppressingChatDom()) return;
  if (!isOrchestrateBoardViewActive() && !isOrchestrateInitSplitChromeActive()) return;
  if (getActiveBoardGroup()?.id !== groupId) return;
  if (boardUiRefreshFrame !== undefined) return;
  if (typeof requestAnimationFrame !== 'function') {
    refreshActiveBoardIfMounted();
    return;
  }
  boardUiRefreshFrame = requestAnimationFrame(() => {
    boardUiRefreshFrame = undefined;
    refreshActiveBoardIfMounted();
  });
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
    unsubStream: subscribeChatStreamActivity((chatId) => {
      const chat = findChatById(chatId);
      if (chat?.boardGroupId === group.id) scheduleBoardUiRefresh(group.id);
    }),
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
  | 'stopped'
  | 'quarantined';

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
  const quarantinedCount = tasks.filter((t) => t.status === 'quarantined').length;
  const terminalCount = completeCount + quarantinedCount;
  const incomplete = total > 0 && terminalCount < total;
  const hasFailed = tasks.some((t) => t.status === 'failed');
  const hasBlocked = tasks.some((t) => t.status === 'blocked');
  const hasInFlight = tasks.some(
    (t) =>
      t.status === 'in_progress' ||
      t.status === 'testing' ||
      t.status === 'merging',
  );

  if (isStreaming && board.activeParentTurnId) {
    return { variant: 'running', label: 'Running' };
  }
  if (total > 0 && completeCount === total) {
    const finalTest = board.finalTest;
    if (!finalTest || finalTest.status !== 'passed') {
      if (finalTest?.status === 'in_progress') {
        return { variant: 'active', label: 'Final test' };
      }
      if (finalTest?.status === 'failed') {
        return { variant: 'failed', label: 'Final test failed' };
      }
      return { variant: 'paused', label: 'Awaiting final test' };
    }
    return { variant: 'complete', label: 'Complete' };
  }
  // All tasks are terminal but some are quarantined — board is done (blocked).
  if (total > 0 && terminalCount === total && quarantinedCount > 0) {
    const label =
      quarantinedCount === total
        ? `Blocked — ${quarantinedCount} quarantined`
        : `Blocked — ${quarantinedCount} quarantined`;
    return { variant: 'quarantined', label };
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
  if (runningTasks > 0 || activeRunCount > 0) {
    return { variant: 'active', label: 'Active' };
  }
  if (tasks.some((t) => t.status === 'merging')) {
    return { variant: 'active', label: 'Merging' };
  }
  if (hasInFlight) {
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

/** Icon-only board header control (Plan, play/pause) matching top-bar icon buttons. */
function createBoardHeaderIconButton(
  action: string,
  iconName: IconName,
  labels: { ariaLabel: string; title: string },
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'icon-btn board-header__icon-btn';
  btn.dataset.boardAction = action;
  btn.setAttribute('aria-label', labels.ariaLabel);
  btn.title = labels.title;
  btn.appendChild(createIcon(iconName, { className: 'board-header__icon' }));
  return btn;
}

/** Autonomy stops (least → most autonomous). */
const BOARD_EXECUTION_MODES = ['manual', 'sequential', 'auto', 'afk'] as const;

const BOARD_EXECUTION_MODE_META: ReadonlyArray<{
  id: (typeof BOARD_EXECUTION_MODES)[number];
  label: string;
  title: string;
}> = [
  {
    id: 'manual',
    label: 'Manual',
    title: 'You start each task from the board',
  },
  {
    id: 'sequential',
    label: 'Sequential',
    title: 'Orchestrator runs one task at a time',
  },
  {
    id: 'auto',
    label: 'Auto',
    title: 'Orchestrator runs tasks concurrently',
  },
  {
    id: 'afk',
    label: 'AFK',
    title: 'Fully autonomous until Stop or the board finishes',
  },
] as const;

function boardExecutionModeToIndex(mode: string): number {
  const idx = BOARD_EXECUTION_MODES.indexOf(mode as (typeof BOARD_EXECUTION_MODES)[number]);
  return idx >= 0 ? idx : 0;
}

const BOARD_AFK_CONFIRM_MESSAGE =
  'Enable AFK mode? The orchestrator will run fully hands-off and will not prompt you until you press Stop or the board finishes.';

/**
 * Blur a focused header control so native `<select>` menus (isolation mode, etc.)
 * open on the first click. `window.confirm` and segment buttons keep focus until
 * the user clicks elsewhere — which made the worktree dropdown appear broken after AFK.
 * Deferred one frame so blur runs after the browser restores click focus on the segment.
 */
function releaseBoardHeaderFocus(): void {
  const run = (): void => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('.board-header__controls')) {
      active.blur();
    }
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(run);
  } else {
    setTimeout(run, 0);
  }
}

/** User-selected execution mode — AFK goes through the shared confirm + activate path. */
async function selectBoardExecutionModeFromUi(
  group: ChatGroup,
  mode: (typeof BOARD_EXECUTION_MODES)[number],
  plannerChat: Chat,
): Promise<void> {
  if (mode === 'afk') {
    if (!await appConfirm(BOARD_AFK_CONFIRM_MESSAGE)) return;
    activateAfk(group, plannerChat);
    return;
  }
  setBoardExecutionMode(group, mode, plannerChat);
}

const BOARD_AFK_HINT_VISIBLE_MS = 2500;
/** Must match `.board-header__exec-mode-hint` opacity transition duration. */
const BOARD_AFK_HINT_FADE_MS = 400;

let boardAfkHintDismissTimer: ReturnType<typeof setTimeout> | null = null;
let boardAfkHintFadeTimer: ReturnType<typeof setTimeout> | null = null;
let lastSyncedExecMode: string | null = null;
let boardAfkHintShownForSession = false;

function clearBoardAfkHintTimers(): void {
  if (boardAfkHintDismissTimer !== null) {
    clearTimeout(boardAfkHintDismissTimer);
    boardAfkHintDismissTimer = null;
  }
  if (boardAfkHintFadeTimer !== null) {
    clearTimeout(boardAfkHintFadeTimer);
    boardAfkHintFadeTimer = null;
  }
}

function hideBoardAfkHint(hint: HTMLElement, instant = true): void {
  clearBoardAfkHintTimers();
  hint.classList.remove('is-visible');
  if (instant) {
    hint.hidden = true;
    hint.setAttribute('aria-hidden', 'true');
  }
}

function finishBoardAfkHintFade(hint: HTMLElement): void {
  boardAfkHintFadeTimer = null;
  hint.hidden = true;
  hint.setAttribute('aria-hidden', 'true');
}

/** Fade out, then remove from layout once the opacity transition completes. */
function dismissBoardAfkHint(hint: HTMLElement): void {
  if (boardAfkHintFadeTimer !== null) return;
  hint.classList.remove('is-visible');

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) {
    finishBoardAfkHintFade(hint);
    return;
  }

  const onTransitionEnd = (event: TransitionEvent): void => {
    if (event.target !== hint || event.propertyName !== 'opacity') return;
    hint.removeEventListener('transitionend', onTransitionEnd);
    finishBoardAfkHintFade(hint);
  };
  hint.addEventListener('transitionend', onTransitionEnd);
  boardAfkHintFadeTimer = setTimeout(() => {
    hint.removeEventListener('transitionend', onTransitionEnd);
    finishBoardAfkHintFade(hint);
  }, BOARD_AFK_HINT_FADE_MS + 80);
}

/** Brief AFK callout: visible ~2.5s, then fades out without shifting toolbar layout. */
function showBoardAfkHint(hint: HTMLElement): void {
  clearBoardAfkHintTimers();
  hint.hidden = false;
  hint.setAttribute('aria-hidden', 'false');
  hint.classList.remove('is-visible');
  // Two frames so the browser paints opacity 0 before transitioning to 1.
  const revealHint = (): void => {
    hint.classList.add('is-visible');
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(revealHint));
  } else {
    setTimeout(revealHint, 0);
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const visibleMs = reducedMotion ? 1200 : BOARD_AFK_HINT_VISIBLE_MS;

  boardAfkHintDismissTimer = setTimeout(() => {
    boardAfkHintDismissTimer = null;
    dismissBoardAfkHint(hint);
  }, visibleMs);
}

function syncBoardExecModeUi(root: ParentNode, currentMode: string): void {
  const idx = boardExecutionModeToIndex(currentMode);
  const segments = root.querySelectorAll<HTMLButtonElement>(
    '.board-header__exec-mode-segment',
  );
  segments.forEach((btn, i) => {
    btn.setAttribute('aria-checked', i === idx ? 'true' : 'false');
  });
  const hint = root.querySelector('.board-header__exec-mode-hint') as HTMLElement | null;
  if (!hint) return;

  if (currentMode !== 'afk') {
    hideBoardAfkHint(hint);
    lastSyncedExecMode = currentMode;
    boardAfkHintShownForSession = false;
    return;
  }

  const enteredAfk = lastSyncedExecMode !== 'afk';
  lastSyncedExecMode = 'afk';
  if (enteredAfk || !boardAfkHintShownForSession) {
    boardAfkHintShownForSession = true;
    showBoardAfkHint(hint);
    if (enteredAfk) releaseBoardHeaderFocus();
  }
}

function onBoardExecModeSegmentKeydown(
  event: KeyboardEvent,
  modeId: string,
  group: ChatGroup,
  plannerChat: Chat,
): void {
  const segments = BOARD_EXECUTION_MODES;
  const currentIndex = segments.indexOf(modeId as (typeof BOARD_EXECUTION_MODES)[number]);
  if (currentIndex < 0) return;

  let nextIndex = currentIndex;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    nextIndex = Math.min(currentIndex + 1, segments.length - 1);
    event.preventDefault();
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    nextIndex = Math.max(currentIndex - 1, 0);
    event.preventDefault();
  } else {
    return;
  }

  const nextMode = segments[nextIndex] ?? 'manual';
  void selectBoardExecutionModeFromUi(group, nextMode, plannerChat);
  refreshActiveBoardIfMounted();
  releaseBoardHeaderFocus();
  const root = document.querySelector('.board-root');
  const nextBtn = root?.querySelector<HTMLButtonElement>(
    `.board-header__exec-mode-segment[data-exec-mode="${nextMode}"]`,
  );
  nextBtn?.focus();
}

function wireBoardHeaderControls(
  controls: HTMLElement,
  planPath: string,
  group: ChatGroup,
  board: BoardState,
  plannerChat: Chat,
): void {
  controls.replaceChildren();
  clearBoardAfkHintTimers();
  lastSyncedExecMode = null;
  boardAfkHintShownForSession = false;

  // Execution mode segments (Manual → Sequential → Auto → AFK)
  const currentMode = getBoardExecutionMode(board);
  const modeWrapper = document.createElement('div');
  modeWrapper.className = 'board-header__exec-mode';

  const modeGroup = document.createElement('div');
  modeGroup.className = 'board-header__exec-mode-segments';
  modeGroup.dataset.boardAction = 'auto-pilot';
  modeGroup.setAttribute('role', 'radiogroup');
  modeGroup.setAttribute('aria-label', 'Execution autonomy');

  for (const meta of BOARD_EXECUTION_MODE_META) {
    const segment = document.createElement('button');
    segment.type = 'button';
    segment.className = 'board-header__exec-mode-segment';
    segment.dataset.execMode = meta.id;
    segment.setAttribute('role', 'radio');
    segment.setAttribute(
      'aria-checked',
      meta.id === currentMode ? 'true' : 'false',
    );
    segment.textContent = meta.label;
    segment.title = meta.title;

    segment.addEventListener('click', () => {
      void selectBoardExecutionModeFromUi(group, meta.id, plannerChat);
      refreshActiveBoardIfMounted();
      releaseBoardHeaderFocus();
    });
    segment.addEventListener('keydown', (event) => {
      onBoardExecModeSegmentKeydown(event, meta.id, group, plannerChat);
    });

    modeGroup.appendChild(segment);
  }

  const afkHint = document.createElement('p');
  afkHint.className = 'board-header__exec-mode-hint';
  afkHint.setAttribute('role', 'status');
  afkHint.textContent =
    'Hands-off. Press Start; the orchestrator will not prompt you until Stop or the board finishes.';
  afkHint.hidden = true;
  afkHint.setAttribute('aria-hidden', 'true');

  modeWrapper.appendChild(modeGroup);
  modeWrapper.appendChild(afkHint);
  controls.appendChild(modeWrapper);

  // Max concurrent stepper (editable in Auto and AFK modes)
  const concWrapper = document.createElement('label');
  concWrapper.className = 'board-header__concurrency';
  concWrapper.title = isOomPauseActive()
    ? `Max concurrent tasks (throttled to ${resolveEffectiveMaxConcurrent(board)} after OOM crash)`
    : 'Max concurrent tasks (Auto and AFK modes)';
  const concInput = document.createElement('input');
  concInput.type = 'number';
  concInput.className = 'board-header__concurrency-input';
  concInput.min = '1';
  concInput.max = '20';
  concInput.value = String(
    board.maxConcurrentTasks ?? getAutopilotMetaSync().maxConcurrentTasks ?? 3,
  );
  concInput.disabled = currentMode !== 'auto' && currentMode !== 'afk';
  concInput.setAttribute('aria-label', 'Max concurrent tasks');
  concInput.addEventListener('change', () => {
    const val = Number(concInput.value);
    if (Number.isFinite(val)) {
      setBoardMaxConcurrent(group, val, plannerChat);
      refreshActiveBoardIfMounted();
    }
  });
  concWrapper.appendChild(concInput);
  if (isOomPauseActive()) {
    const oomHint = document.createElement('span');
    oomHint.className = 'board-header__oom-hint';
    oomHint.textContent = 'OOM recovery: concurrency capped';
    oomHint.title =
      'Renderer ran out of memory recently — concurrency is limited until you press Start again';
    concWrapper.appendChild(oomHint);
  }
  controls.appendChild(concWrapper);

  // Isolation mode override (Auto = global default or derive from execution mode)
  const isoWrapper = document.createElement('label');
  isoWrapper.className = 'board-header__isolation';
  isoWrapper.title = 'Worktree isolation (Auto uses Settings default or execution mode)';
  const isoSelect = document.createElement('select');
  isoSelect.className = 'board-header__isolation-select';
  isoSelect.setAttribute('aria-label', 'Isolation mode');
  for (const opt of [
    { value: 'auto', label: 'Auto' },
    { value: 'off', label: 'Off' },
    { value: 'per-task', label: 'Per-task' },
    { value: 'per-wave', label: 'Per-wave' },
  ]) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    isoSelect.appendChild(option);
  }
  isoSelect.value = board.isolationMode ?? 'auto';
  isoSelect.addEventListener('change', () => {
    const val = isoSelect.value as 'auto' | 'off' | 'per-task' | 'per-wave';
    setBoardIsolationMode(group, val, plannerChat);
    refreshActiveBoardIfMounted();
  });
  isoWrapper.appendChild(isoSelect);
  controls.appendChild(isoWrapper);

  // Start / Stop button (shown in sequential, auto, and afk modes)
  if (currentMode !== 'manual') {
    const running = isBoardRunning(group);
    const runBtn = document.createElement('button');
    runBtn.type = 'button';
    runBtn.className = `board-header__run-btn${running ? ' board-header__run-btn--stop' : ''}`;
    runBtn.setAttribute('aria-label', running ? 'Stop orchestrator' : 'Start orchestrator');
    runBtn.title = running ? 'Stop all tasks and chats' : 'Start auto execution';
    runBtn.textContent = running ? 'Stop' : 'Start';
    runBtn.addEventListener('click', () => {
      if (isBoardRunning(group)) {
        stopBoardAutoRun(group, plannerChat);
      } else {
        startBoardAutoRun(group, plannerChat);
      }
      refreshActiveBoardIfMounted();
    });
    controls.appendChild(runBtn);
  }

  const openPlan = createBoardHeaderIconButton(
    'open-plan',
    'fileText',
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

  const timelineBtn = document.createElement('button');
  timelineBtn.type = 'button';
  timelineBtn.className = 'board-btn board-btn--compact board-timeline-btn';
  timelineBtn.textContent = 'Timeline';
  timelineBtn.title = 'Open board event timeline';
  timelineBtn.setAttribute('aria-label', 'Open board timeline');
  const alerts = countBoardLogAlerts(group.id);
  if (alerts.error > 0 || alerts.warn > 0) {
    const badge = document.createElement('span');
    badge.className = 'board-timeline-btn__badge';
    badge.textContent = String(alerts.error + alerts.warn);
    badge.title = `${alerts.error} errors, ${alerts.warn} warnings`;
    timelineBtn.appendChild(badge);
  }
  timelineBtn.addEventListener('click', () => {
    openBoardTimelineDrawer(group.id);
  });

  controls.appendChild(timelineBtn);
  controls.appendChild(openPlan);

  if (isOrchestrateBoardFinished(board)) {
    const dashToggle = document.createElement('button');
    dashToggle.type = 'button';
    dashToggle.className = 'board-btn board-btn--compact board-header__dashboard-toggle';
    dashToggle.dataset.boardAction = 'dashboard-toggle';
    const showingDashboard = shouldShowFinishDashboard(board);
    dashToggle.textContent = showingDashboard ? 'Board' : 'Dashboard';
    dashToggle.title = showingDashboard
      ? 'Return to the kanban board'
      : 'Open the finish dashboard';
    dashToggle.setAttribute(
      'aria-label',
      showingDashboard ? 'Back to board' : 'Open finish dashboard',
    );
    dashToggle.addEventListener('click', () => {
      if (shouldShowFinishDashboard(board)) {
        board.dashboardDismissed = true;
      } else {
        board.dashboardDismissed = false;
      }
      touchChat(plannerChat);
      scheduleSaveSessions();
      emitBoardChange(group.id);
      refreshActiveBoardIfMounted();
    });
    controls.appendChild(dashToggle);
  }
}

/** Banner when the orchestrator requested AFK and awaits user confirmation. */
function buildPendingAfkBanner(
  group: ChatGroup,
  board: BoardState,
  plannerChat: Chat,
): HTMLElement | null {
  if (!board.pendingAfk) return null;

  const wrap = document.createElement('div');
  wrap.className = 'board-header__pending-afk';
  wrap.setAttribute('role', 'status');

  const label = document.createElement('span');
  label.className = 'board-header__pending-afk-label';
  label.textContent =
    'The orchestrator requested AFK mode — fully hands-off execution with no prompts until Stop or board finish.';
  wrap.appendChild(label);

  const enableBtn = document.createElement('button');
  enableBtn.type = 'button';
  enableBtn.className = 'board-btn board-btn--compact board-btn--primary';
  enableBtn.textContent = 'Enable AFK';
  enableBtn.addEventListener('click', () => {
    activateAfk(group, plannerChat);
    refreshActiveBoardIfMounted();
    releaseBoardHeaderFocus();
  });
  wrap.appendChild(enableBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'board-btn board-btn--compact';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    cancelPendingAfk(group);
    refreshActiveBoardIfMounted();
  });
  wrap.appendChild(cancelBtn);

  return wrap;
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
  group: ChatGroup,
  plannerChat: Chat,
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
  wireBoardHeaderControls(controls, planPath, group, board, plannerChat);

  toolbar.appendChild(leading);
  toolbar.appendChild(controls);

  const pendingAfkBanner = buildPendingAfkBanner(group, board, plannerChat);
  if (pendingAfkBanner) toolbar.appendChild(pendingAfkBanner);

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

  const runningStrip = buildBoardRunningTasksStrip(board, group, plannerChat);
  if (runningStrip) meta.appendChild(runningStrip);

  const finalBanner = buildFinalTestBanner(board, group, plannerChat);
  if (finalBanner) meta.appendChild(finalBanner);

  header.appendChild(toolbar);
  header.appendChild(meta);
  return header;
}

/** Final integration test status + manual run action when all tasks are complete. */
function buildFinalTestBanner(
  board: BoardState,
  group: ChatGroup,
  plannerChat: Chat,
): HTMLElement | null {
  if (!isOrchestratePlanComplete(board)) return null;
  const finalTest = board.finalTest;
  if (finalTest?.status === 'passed') return null;

  const wrap = document.createElement('div');
  wrap.className = 'board-header__final-test';
  wrap.setAttribute('role', 'status');

  const label = document.createElement('span');
  label.className = 'board-header__final-test-label';

  if (finalTest?.status === 'in_progress') {
    label.textContent = 'Final integration test running…';
    wrap.appendChild(label);
    return wrap;
  }

  if (finalTest?.status === 'failed') {
    const summary = finalTest.summary?.trim();
    const reopened = finalTest.failingTaskIds?.length
      ? ` Reopened: ${finalTest.failingTaskIds.join(', ')}.`
      : '';
    label.textContent = `Final integration test failed.${reopened}${summary ? ` ${summary}` : ''}`;
    wrap.appendChild(label);
    if ((finalTest.attempts ?? 0) < 3) {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'board-btn board-btn--compact board-btn--primary';
      retryBtn.textContent = 'Re-run final test';
      retryBtn.addEventListener('click', () => {
        void startFinalIntegrationTestForPlannerChat(plannerChat).then(() =>
          refreshActiveBoardIfMounted(),
        );
      });
      wrap.appendChild(retryBtn);
    }
    return wrap;
  }

  label.textContent = 'All tasks complete — run final integration test';
  wrap.appendChild(label);
  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.className = 'board-btn board-btn--compact board-btn--primary';
  runBtn.textContent = 'Run final integration test';
  runBtn.addEventListener('click', () => {
    void startFinalIntegrationTestForPlannerChat(plannerChat).then(() =>
      refreshActiveBoardIfMounted(),
    );
  });
  wrap.appendChild(runBtn);
  return wrap;
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
  const cap = resolveEffectiveMaxConcurrent(board);
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
  const cap = resolveEffectiveMaxConcurrent(board);
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
    boardTimerContextForChat(plannerChat, activeRunCount, board),
  );
  const progress = getBoardProgressPercent(board);
  const wavesComplete = countBoardWavesProgressed(board);
  const done = countBoardTasksProgressed(board);
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

/** Compact token readout for running-task chips (instrumentation family). */
function formatRunningTaskTokens(total: number | null): string {
  if (total == null) return '— tok';
  if (total >= 10_000) return `${Math.round(total / 1000)}k tok`;
  if (total >= 1000) {
    const compact = (total / 1000).toFixed(1).replace(/\.0$/, '');
    return `${compact}k tok`;
  }
  return `${total} tok`;
}

/** Sum assistant usage from a linked task chat transcript. */
function sumChatTotalTokens(chat: Chat | undefined): number | null {
  if (!chat) return null;
  const segments: Usage[] = [];
  for (const msg of chat.history) {
    if (msg.role === 'assistant' && msg.usage) segments.push(msg.usage);
  }
  const ls = chat.lastStats;
  if (
    ls &&
    (ls.prompt_tokens != null || ls.completion_tokens != null || ls.total_tokens != null)
  ) {
    segments.push({
      prompt_tokens: ls.prompt_tokens ?? undefined,
      completion_tokens: ls.completion_tokens ?? undefined,
      total_tokens: ls.total_tokens ?? undefined,
    });
  }
  if (!segments.length) return null;
  return sumUsageSegments(segments).total_tokens ?? null;
}

function resolveRunningSlotElapsedMs(slot: RunningBoardTaskSlot, chat?: Chat): number {
  const chatId = slot.chatId?.trim();
  const mainTurn = chatId ? getMainTurnActivity(chatId) : undefined;
  if (mainTurn?.startedAtMs) return Math.max(0, Date.now() - mainTurn.startedAtMs);
  if (slot.task?.startedAt) return Math.max(0, Date.now() - slot.task.startedAt);
  if (chat?.updatedAt) return Math.max(0, Date.now() - chat.updatedAt);
  return 0;
}

function runningSlotShowsContinue(
  board: BoardState,
  slot: RunningBoardTaskSlot,
): boolean {
  if (slot.isFinalTest || !slot.task || !slot.chatId?.trim()) return false;
  const chatId = slot.chatId.trim();
  if (isChatStreaming(chatId)) return false;
  return (
    isTaskStalledForRestart(board, slot.task, isTaskChatActiveForStallCheck) ||
    isTaskChatActive(chatId)
  );
}

type RunningTaskIconKind = 'build' | 'test' | 'fix' | 'merge' | 'final';

const RUNNING_TASK_ICON_NAMES: Record<RunningTaskIconKind, IconName> = {
  build: 'boardBuild',
  test: 'boardTest',
  fix: 'boardFix',
  merge: 'gitMerge',
  final: 'check',
};

const RUNNING_TASK_CONTROL_ICON_NAMES = {
  stop: 'stop',
  restart: 'loop',
  continue: 'chevronRight',
  move: 'move',
  open: 'expand',
} as const satisfies Record<string, IconName>;

function createRunningTaskIcon(
  kind: RunningTaskIconKind | keyof typeof RUNNING_TASK_CONTROL_ICON_NAMES,
  className: string,
): HTMLElement {
  const name =
    kind in RUNNING_TASK_ICON_NAMES
      ? RUNNING_TASK_ICON_NAMES[kind as RunningTaskIconKind]
      : RUNNING_TASK_CONTROL_ICON_NAMES[kind as keyof typeof RUNNING_TASK_CONTROL_ICON_NAMES];
  return createIcon(name, { className });
}
function createRunningTaskControlButton(
  action: keyof typeof RUNNING_TASK_CONTROL_ICON_NAMES,
  label: string,
  onClick: (e: MouseEvent) => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `board-running-tasks__control board-running-tasks__control--${action}`;
  btn.dataset.boardRunningAction = action;
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.appendChild(createRunningTaskIcon(action, 'icon-svg board-running-tasks__control-icon'));
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(e);
  });
  return btn;
}

function buildRunningTaskChip(
  slot: RunningBoardTaskSlot,
  board: BoardState,
  group: ChatGroup,
  plannerChat: Chat,
): HTMLElement {
  const chatId = slot.chatId?.trim();
  const chat = chatId ? findChatById(chatId) : undefined;
  const chip = document.createElement('article');
  chip.className = `board-running-tasks__chip board-running-tasks__chip--${slot.phase}`;
  if (chatId) chip.dataset.boardRunningChatId = chatId;
  chip.dataset.boardRunningTaskId = slot.taskId;
  chip.dataset.boardRunningSlotKey = chatId || `hold:${slot.taskId}`;
  chip.setAttribute('role', 'listitem');
  const streaming = chatId ? isChatStreaming(chatId) : false;
  if (streaming) chip.classList.add('board-running-tasks__chip--streaming');
  const statusLabel =
    slot.phase === 'merge' ? 'merging' : streaming ? 'running' : 'starting';
  chip.setAttribute('aria-label', `${slot.taskId} ${slot.title}, ${statusLabel}`);

  const icon = document.createElement('span');
  icon.className = `board-running-tasks__phase board-running-tasks__phase--${slot.phase}`;
  icon.appendChild(
    createRunningTaskIcon(slot.phase, 'icon-svg board-running-tasks__phase-icon'),
  );
  icon.title = slot.phase === 'final'
    ? 'Final integration test'
    : slot.phase === 'merge'
      ? 'Merging'
      : slot.phase;
  chip.appendChild(icon);

  const dot = document.createElement('span');
  dot.className = 'board-running-tasks__dot';
  dot.setAttribute('aria-hidden', 'true');
  chip.appendChild(dot);

  const id = document.createElement('span');
  id.className = 'board-running-tasks__id';
  id.textContent = slot.taskId;
  chip.appendChild(id);

  const title = document.createElement('span');
  title.className = 'board-running-tasks__title';
  title.textContent = slot.title;
  title.title = slot.title;
  chip.appendChild(title);

  const stats = document.createElement('span');
  stats.className = 'board-running-tasks__stats';
  const elapsed = document.createElement('span');
  elapsed.className = 'board-running-tasks__elapsed';
  elapsed.dataset.boardRunningElapsed = 'true';
  elapsed.textContent = formatElapsed(resolveRunningSlotElapsedMs(slot, chat));
  const tokens = document.createElement('span');
  tokens.className = 'board-running-tasks__tokens';
  tokens.dataset.boardRunningTokens = 'true';
  tokens.textContent = formatRunningTaskTokens(sumChatTotalTokens(chat));
  stats.appendChild(elapsed);
  stats.appendChild(tokens);
  chip.appendChild(stats);

  if (chatId) {
    const controls = document.createElement('div');
    controls.className = 'board-running-tasks__controls';
    controls.appendChild(
      createRunningTaskControlButton('stop', `Stop ${slot.taskId}`, () => {
        void stopRunningBoardSlot(group, slot, plannerChat).then(() =>
          refreshActiveBoardIfMounted(),
        );
      }),
    );
    const mergingSlot =
      !slot.isFinalTest && slot.task && slot.task.status === 'merging';
    if (!mergingSlot) {
      controls.appendChild(
        createRunningTaskControlButton('restart', `Restart ${slot.taskId}`, () => {
          if (slot.isFinalTest) {
            void stopRunningBoardSlot(group, slot, plannerChat)
              .then(() => startFinalIntegrationTestForPlannerChat(plannerChat))
              .then(() => refreshActiveBoardIfMounted());
            return;
          }
          void restartBoardTask(group, slot.taskId, plannerChat).then(() =>
            refreshActiveBoardIfMounted(),
          );
        }),
      );
    }
    if (!mergingSlot && runningSlotShowsContinue(board, slot)) {
      controls.appendChild(
        createRunningTaskControlButton('continue', `Continue ${slot.taskId}`, () => {
          void continueBoardTask(group, slot.taskId, plannerChat).then(() =>
            refreshActiveBoardIfMounted(),
          );
        }),
      );
    }
    if (!slot.isFinalTest && !mergingSlot) {
      controls.appendChild(
        createRunningTaskControlButton('move', `Move ${slot.taskId} to new chat`, () => {
          void moveTaskToNewChat(group, slot.taskId, plannerChat).then(() =>
            refreshActiveBoardIfMounted(),
          );
        }),
      );
    }
    controls.appendChild(
      createRunningTaskControlButton('open', `Open chat for ${slot.taskId}`, () => {
        if (chat) switchChat(chat.id);
      }),
    );
    chip.appendChild(controls);
  }
  return chip;
}

function buildRunningTasksStripKey(
  board: BoardState,
  slots: RunningBoardTaskSlot[],
): string {
  return slots
    .map((slot) => {
      const chatId = slot.chatId?.trim();
      const chat = chatId ? findChatById(chatId) : undefined;
      const tokens = sumChatTotalTokens(chat);
      const streaming = chatId && isChatStreaming(chatId) ? 1 : 0;
      const continueVisible = runningSlotShowsContinue(board, slot) ? 1 : 0;
      const moveVisible = slot.isFinalTest || !chatId ? 0 : 1;
      return [
        chatId || `hold:${slot.taskId}`,
        slot.taskId,
        slot.phase,
        slot.title,
        streaming,
        continueVisible,
        moveVisible,
        tokens ?? '',
      ].join('|');
    })
    .join(';');
}

/** Thin strip of running task chips below the board progress bar. */
function buildBoardRunningTasksStrip(
  board: BoardState,
  group: ChatGroup,
  plannerChat: Chat,
): HTMLElement | null {
  const slots = listRunningBoardTaskSlots(board);
  if (!slots.length) return null;

  const wrap = document.createElement('div');
  wrap.className = 'board-running-tasks';
  wrap.dataset.boardRunningKey = buildRunningTasksStripKey(board, slots);
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', 'Running tasks');

  const strip = document.createElement('div');
  strip.className = 'board-running-tasks__strip';
  strip.setAttribute('role', 'list');
  for (const slot of slots) {
    strip.appendChild(buildRunningTaskChip(slot, board, group, plannerChat));
  }
  wrap.appendChild(strip);
  return wrap;
}

function syncBoardRunningTasksStrip(
  meta: Element,
  board: BoardState,
  group: ChatGroup,
  plannerChat: Chat,
): void {
  const slots = listRunningBoardTaskSlots(board);
  const existing = meta.querySelector('.board-running-tasks') as HTMLElement | null;
  if (!slots.length) {
    existing?.remove();
    return;
  }

  const nextKey = buildRunningTasksStripKey(board, slots);
  if (!existing) {
    const strip = buildBoardRunningTasksStrip(board, group, plannerChat);
    if (!strip) return;
    const bar = meta.querySelector('.board-header__progress');
    if (bar) {
      bar.insertAdjacentElement('afterend', strip);
    } else {
      meta.appendChild(strip);
    }
    return;
  }

  if (existing.dataset.boardRunningKey !== nextKey) {
    existing.replaceWith(buildBoardRunningTasksStrip(board, group, plannerChat)!);
    return;
  }

  for (const slot of slots) {
    const slotKey = slot.chatId?.trim() || `hold:${slot.taskId}`;
    const chip = existing.querySelector(
      `[data-board-running-slot-key="${slotKey}"]`,
    ) as HTMLElement | null;
    if (!chip) continue;
    const chatId = slot.chatId?.trim();
    const chat = chatId ? findChatById(chatId) : undefined;
    const elapsedEl = chip.querySelector('[data-board-running-elapsed="true"]');
    if (elapsedEl) {
      elapsedEl.textContent = formatElapsed(resolveRunningSlotElapsedMs(slot, chat));
    }
    const tokensEl = chip.querySelector('[data-board-running-tokens="true"]');
    if (tokensEl) {
      tokensEl.textContent = formatRunningTaskTokens(sumChatTotalTokens(chat));
    }
    if (chatId) {
      chip.classList.toggle('board-running-tasks__chip--streaming', isChatStreaming(chatId));
    }
  }
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

const BOARD_ADVANCE_ICON_NAMES: Record<BoardAdvanceIconKind, IconName> = {
  forward: 'chevronRight',
  check: 'check',
  recycle: 'loop',
};

function createBoardAdvanceIcon(kind: BoardAdvanceIconKind): HTMLElement {
  return createIcon(BOARD_ADVANCE_ICON_NAMES[kind], { className: 'board-task-card__advance-icon' });
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
  if (task.status === 'quarantined') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'board-task-card__advance-btn';
    btn.appendChild(createBoardAdvanceIcon('recycle'));
    const text = document.createElement('span');
    text.className = 'board-task-card__advance-label';
    text.textContent = 'Requeue';
    btn.appendChild(text);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      void requeueBoardTask(group, task.id, plannerChat).then(() => {
        refreshActiveBoardIfMounted();
      });
    });
    row.appendChild(btn);
  }
}

/** True when a stopped/failed/blocked task can use recovery controls. */
function taskShowsRecoveryActions(
  task: BoardTask,
  taskActive: boolean,
  testActive: boolean,
  fixerActive: boolean,
): boolean {
  if (taskActive || testActive || fixerActive) return false;
  if (task.status === 'failed' || task.status === 'blocked') return true;
  if (task.status === 'in_progress' || task.status === 'testing') {
    return Boolean(task.chatId?.trim() || task.testChatId?.trim());
  }
  if (task.status === 'merging') return true;
  return false;
}

function buildTaskRecoveryActions(
  task: BoardTask,
  group: ChatGroup,
  plannerChat: Chat,
  row: HTMLElement,
): void {
  const addRecoveryBtn = (
    label: string,
    icon: BoardAdvanceIconKind,
    onClick: () => void,
  ): void => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'board-task-card__advance-btn board-task-card__advance-btn--recovery';
    btn.appendChild(createBoardAdvanceIcon(icon));
    const text = document.createElement('span');
    text.className = 'board-task-card__advance-label';
    text.textContent = label;
    btn.appendChild(text);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
      refreshActiveBoardIfMounted();
    });
    row.appendChild(btn);
  };

  if (task.status === 'merging') {
    addRecoveryBtn('Reconcile merge', 'forward', () => {
      void recoverMergingBoardTask(group, task.id, plannerChat);
    });
    return;
  }

  addRecoveryBtn('Restart', 'recycle', () => {
    void restartBoardTask(group, task.id, plannerChat);
  });
  addRecoveryBtn('Continue', 'forward', () => {
    void continueBoardTask(group, task.id, plannerChat);
  });
  addRecoveryBtn('Move to new chat', 'forward', () => {
    void moveTaskToNewChat(group, task.id, plannerChat);
  });
}

function appendTaskPrevFailureLink(card: HTMLElement, task: BoardTask): void {
  const prev = task.prevFailure;
  if (!prev) return;
  const details = document.createElement('details');
  details.className = 'board-task-card__prev-failure';
  const summary = document.createElement('summary');
  summary.textContent = 'Previous failure';
  details.appendChild(summary);
  const body = document.createElement('div');
  body.className = 'board-task-card__prev-failure-body';
  if (prev.error?.trim()) {
    const err = document.createElement('p');
    err.className = 'board-task-card__prev-failure-line';
    err.textContent = prev.error.trim();
    body.appendChild(err);
  }
  if (prev.testVerdict || prev.testSummary?.trim()) {
    const test = document.createElement('p');
    test.className = 'board-task-card__prev-failure-line';
    const verdict = prev.testVerdict ? ` (${prev.testVerdict})` : '';
    test.textContent = `${prev.testSummary?.trim() || 'Test failure'}${verdict}`;
    body.appendChild(test);
  }
  if (body.childElementCount) {
    details.appendChild(body);
    details.addEventListener('click', (e) => e.stopPropagation());
    card.appendChild(details);
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
): HTMLElement {
  const taskStreaming = Boolean(task.chatId && isChatStreaming(task.chatId));
  const testStreaming = Boolean(task.testChatId && isChatStreaming(task.testChatId));
  const taskActive = Boolean(task.chatId && isTaskChatActive(task.chatId));
  const testActive = Boolean(task.testChatId && isTaskChatActive(task.testChatId));
  const fixerActive = Boolean(task.fixerChatId && isTaskChatActive(task.fixerChatId));
  const primaryRunId = getBoardTaskPrimaryRunId(task);
  const runStatus = primaryRunId
    ? resolveRunStatusForTask(plannerChat, primaryRunId)
    : null;
  const agentBadge = deriveTaskAgentBadge(task, runStatus, taskStreaming, testStreaming);
  const board = group.orchestrateBoard!;
  const cap = resolveEffectiveMaxConcurrent(board);
  const atCap =
    countRunningTaskChats(board) >= cap && !taskActive && !testActive && !fixerActive;

  const card = document.createElement('article');
  card.className = 'board-task-card';
  if (task.status === 'failed' || task.status === 'blocked') {
    card.classList.add('board-task-card--alert');
  }
  if (taskActive || testActive || fixerActive) {
    card.classList.add('board-task-card--running');
  }

  card.setAttribute('data-board-task-id', task.id);

  const opensPlan = taskCardOpensPlanPanel(task.status);
  const opensChat = !opensPlan;
  if (opensPlan || opensChat) {
    card.classList.add('board-task-card--clickable');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.title = opensPlan ? 'View task plan' : 'Open task chat';

    const activateCard = (): void => {
      const main = card.closest('.board-main');
      if (opensPlan) {
        if (main instanceof HTMLElement) {
          for (const selected of main.querySelectorAll('.board-task-card--selected')) {
            selected.classList.remove('board-task-card--selected');
          }
          card.classList.add('board-task-card--selected');
          showBoardTaskPlanPanel(main, task, group);
        }
        return;
      }
      setBoardTaskPlanSelection(null);
      if (main instanceof HTMLElement) {
        syncBoardTaskPlanPanel(main, board, group);
      }
      openBoardTaskChat(task, group, plannerChat);
    };

    card.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest('.board-task-card__footer')) return;
      if (target.closest('.board-task-card__activity')) return;
      if (target.closest('.board-task-card__chats')) return;
      activateCard();
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activateCard();
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
  const categoryBadge = deriveTaskCategoryBadge(task);
  const chip = document.createElement('span');
  chip.className = `board-task-card__cat bt--${categoryBadge.cssVariant}`;
  const icon = createBoardCategoryIcon(categoryBadge.cssVariant, 'board-task-card__cat-icon');
  if (icon) chip.appendChild(icon);
  const labelSpan = document.createElement('span');
  labelSpan.textContent = categoryBadge.label;
  chip.appendChild(labelSpan);
  trail.appendChild(chip);
  if (agentBadge) {
    trail.appendChild(buildTaskAgentBadge(agentBadge));
  }
  const supervision = resolveTaskSupervision(task, plannerChat, taskActive || testActive || fixerActive);
  if (supervision) {
    appendTaskHeartbeatBadge(trail, supervision);
  }
  const runLifecycle = resolveTaskRunLifecycle(task, plannerChat);
  if (runLifecycle) {
    appendTaskLifecycleBadge(trail, runLifecycle, task.status);
  } else if (task.status === 'blocked') {
    appendTaskLifecycleBadge(trail, 'failed', task.status);
  }
  top.appendChild(trail);
  card.appendChild(top);

  const title = document.createElement('h4');
  title.className = 'board-task-card__title';
  title.textContent = task.title;
  title.title = task.title;
  card.appendChild(title);

  const depIds = task.dependsOn;
  if (depIds?.length) {
    const byWave = new Map<string, string[]>();
    for (const id of depIds) {
      const depTask = board.tasks.find((t) => t.id === id);
      const wKey = depTask ? String(depTask.wave) : '?';
      const bucket = byWave.get(wKey) ?? [];
      bucket.push(id);
      byWave.set(wKey, bucket);
    }
    const waveKeys = [...byWave.keys()].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    if (waveKeys.length) {
      const deps = document.createElement('p');
      deps.className = 'board-task-card__deps';
      deps.textContent =
        'Needs: ' +
        waveKeys
          .map((w) => `Wave ${w} (${byWave.get(w)!.join(', ')})`)
          .join(', ');
      deps.title = `Depends on tasks: ${depIds.join(', ')}`;
      card.appendChild(deps);
    }
  }

  const taskChat = task.chatId ? findChatById(task.chatId) : undefined;
  const activity = deriveTaskCardActivity(task, plannerChat, {
    taskChat,
    mainTurn: task.chatId ? getMainTurnActivity(task.chatId) : undefined,
    subAgentHint: resolveTaskCardSubAgentHint(task, plannerChat),
    subAgentRunId: getBoardTaskPrimaryRunId(task),
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

  const toolbar = document.createElement('div');
  toolbar.className = 'board-task-card__toolbar';
  if (taskActive || testActive || fixerActive) {
    const stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.className = 'board-btn board-btn--compact board-btn--mn-danger board-task-card__btn--stop';
    stopBtn.textContent = 'Stop';
    stopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void stopTask(group, task.id, plannerChat).then(() => refreshActiveBoardIfMounted());
    });
    toolbar.appendChild(stopBtn);
  } else if (task.status === 'testing') {
    const runTestsBtn = document.createElement('button');
    runTestsBtn.type = 'button';
    runTestsBtn.className = 'board-btn board-btn--compact board-btn--primary board-task-card__btn--run-tests';
    runTestsBtn.textContent = 'Run tests';
    runTestsBtn.disabled = atCap;
    runTestsBtn.title = atCap ? `Concurrency cap (${cap}) reached` : 'Start Tester for this task';
    runTestsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void startTaskTestingForPlannerChat(plannerChat, task.id).then(() =>
        refreshActiveBoardIfMounted(),
      );
    });
    toolbar.appendChild(runTestsBtn);
  } else {
    const startBtn = document.createElement('button');
    startBtn.type = 'button';
    startBtn.className = 'board-btn board-btn--compact board-btn--primary board-task-card__btn--start';
    startBtn.textContent = 'Start';
    startBtn.disabled = atCap;
    startBtn.title = atCap ? `Concurrency cap (${cap}) reached` : '';
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

  if (taskShowsRecoveryActions(task, taskActive, testActive, fixerActive)) {
    const recoveryRow = document.createElement('div');
    recoveryRow.className = 'board-task-card__advance board-task-card__advance--recovery';
    buildTaskRecoveryActions(task, group, plannerChat, recoveryRow);
    footer.appendChild(recoveryRow);
  }

  card.appendChild(footer);

  if (task.error) {
    const err = document.createElement('p');
    err.className = 'board-task-card__error';
    err.textContent = task.error;
    card.appendChild(err);
  }
  if (task.testVerdict === 'fail' && task.testSummary?.trim()) {
    const testFail = document.createElement('p');
    testFail.className = 'board-task-card__error board-task-card__error--test';
    testFail.textContent = task.testSummary.trim();
    card.appendChild(testFail);
  }
  appendTaskPrevFailureLink(card, task);
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
    case 'quarantined':
      return 'quarantined';
    case 'in_progress':
    case 'testing':
    case 'merging':
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
    case 'merging':
      return 'Merging';
    case 'complete':
      return 'Complete';
    case 'failed':
      return 'Failed';
    case 'quarantined':
      return 'Quarantined';
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
    { label: 'Run', statuses: ['in_progress', 'merging'] },
    { label: 'Test', statuses: ['testing'] },
    { label: 'Done', statuses: ['complete', 'failed', 'quarantined'] },
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
  scrollKeyPrefix = '',
): HTMLElement {
  const grid = document.createElement('div');
  grid.className = 'kanban-grid';
  // Stable key lets us restore horizontal scroll (phone lane swipe) across rebuilds.
  if (scrollKeyPrefix) grid.dataset.boardScrollKey = `grid:${scrollKeyPrefix}`;
  const columns: Array<{ id: string; label: string; statuses: BoardTaskStatus[] }> = [
    { id: 'planned', label: 'Planned', statuses: ['planned', 'blocked'] },
    { id: 'in_progress', label: 'In Progress', statuses: ['in_progress', 'merging'] },
    { id: 'testing', label: 'Testing', statuses: ['testing'] },
    { id: 'complete', label: 'Complete', statuses: ['complete', 'failed', 'quarantined'] },
  ];
  for (const col of columns) {
    const column = document.createElement('section');
    column.className = 'kanban-column';
    column.dataset.kanbanColumn = col.id;
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
    // Stable key (wave + lane) so manual scrollTop survives live-tick rebuilds.
    if (scrollKeyPrefix) list.dataset.boardScrollKey = `list:${scrollKeyPrefix}:${col.label}`;
    let entranceIndex = 0;
    const staggerEntrance =
      isOrchestrateInitSplitChromeActive() && isChatStreaming(plannerChat.id);
    for (const task of colTasks) {
      const card = buildTaskCard(task, group, plannerChat);
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
    body.appendChild(renderKanbanColumns(waveTasks, group, plannerChat, `w${wave.id}`));
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
  // Stable key so the wave stack's vertical scroll survives live-tick rebuilds (MIN-259).
  wrap.dataset.boardScrollKey = 'kanban-waves';
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
  const userStopped = isBoardUserStopped(board, plannerChat);
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

  const headerMeta = root.querySelector('.board-header__meta');
  if (headerMeta) {
    syncBoardRunningTasksStrip(headerMeta, board, group, plannerChat);
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

  const currentMode = getBoardExecutionMode(board);
  syncBoardExecModeUi(root, currentMode);
  const concurrencyInput = root.querySelector(
    '.board-header__concurrency-input',
  ) as HTMLInputElement | null;
  if (concurrencyInput) {
    concurrencyInput.value = String(
      board.maxConcurrentTasks ?? getAutopilotMetaSync().maxConcurrentTasks ?? 3,
    );
    concurrencyInput.disabled = currentMode !== 'auto' && currentMode !== 'afk';
  }

  const isolationSelect = root.querySelector(
    '.board-header__isolation-select',
  ) as HTMLSelectElement | null;
  if (isolationSelect) {
    isolationSelect.value = board.isolationMode ?? 'auto';
  }

  // Sync Start/Stop button: add if needed, remove when mode switches to manual
  const controls = root.querySelector('.board-header__controls') as HTMLElement | null;
  if (controls) {
    let runBtn = controls.querySelector('.board-header__run-btn') as HTMLButtonElement | null;
    if (currentMode !== 'manual') {
      const running = isBoardRunning(group);
      if (!runBtn) {
        runBtn = document.createElement('button');
        runBtn.type = 'button';
        const openPlanAnchor = controls.querySelector('[data-board-action="open-plan"]');
        if (openPlanAnchor) {
          controls.insertBefore(runBtn, openPlanAnchor);
        } else {
          controls.appendChild(runBtn);
        }
        runBtn.addEventListener('click', () => {
          if (isBoardRunning(group)) {
            stopBoardAutoRun(group, plannerChat);
          } else {
            startBoardAutoRun(group, plannerChat);
          }
          refreshActiveBoardIfMounted();
        });
      }
      runBtn.className = `board-header__run-btn${running ? ' board-header__run-btn--stop' : ''}`;
      runBtn.setAttribute('aria-label', running ? 'Stop orchestrator' : 'Start orchestrator');
      runBtn.title = running ? 'Stop all tasks and chats' : 'Start auto execution';
      runBtn.textContent = running ? 'Stop' : 'Start';
    } else if (runBtn) {
      runBtn.remove();
    }
  }

  const send = root.querySelector(
    '[data-board-action="send"]',
  ) as HTMLButtonElement | null;
  if (send) send.disabled = isStreaming;

  syncViewModeToggleFromActiveChat();

  const main = root.querySelector('.board-main');
  if (main instanceof HTMLElement) {
    if (shouldShowFinishDashboard(board)) {
      const dashboard = main.querySelector('.board-finish-dashboard');
      if (dashboard instanceof HTMLElement) {
        syncFinishDashboard(dashboard, group, plannerChat, board);
      } else {
        mountBoardMainSurface(main, board, group, plannerChat);
      }
      syncBoardDashboardToggle(root, board);
    } else {
      ensureKanbanInteractionReleaseListener();
      const kanbanKey = buildKanbanRefreshKey(board, plannerChat, group);
      const kanbanFocused = isKanbanFormControlFocused();
      const surfaceKey = `kanban:${kanbanKey}`;
      if (main.querySelector('.board-finish-dashboard')) {
        mountBoardMainSurface(main, board, group, plannerChat);
        lastKanbanRefreshKey = surfaceKey;
        pendingKanbanRefresh = false;
      } else if (surfaceKey !== lastKanbanRefreshKey) {
        if (kanbanFocused) {
          pendingKanbanRefresh = true;
        } else {
          mountBoardMainSurface(main, board, group, plannerChat);
          lastKanbanRefreshKey = surfaceKey;
          pendingKanbanRefresh = false;
        }
      } else if (pendingKanbanRefresh && !kanbanFocused) {
        mountBoardMainSurface(main, board, group, plannerChat);
        lastKanbanRefreshKey = surfaceKey;
        pendingKanbanRefresh = false;
      }
      const kanban = main.querySelector('.board-kanban-waves');
      if (kanban instanceof HTMLElement) {
        syncKanbanHeartbeatBadges(kanban, board, plannerChat);
      }
      syncBoardDashboardToggle(root, board);
    }
  }

}

export { kickoffOrchestrateBoardBuild, BOARD_ONBOARDING_KICKOFF_MESSAGE } from './orchestrate-board-kickoff';

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
  const kickoffBusy = isBoardKickoffInProgress();
  const path = sel.value.trim();
  const executable = isExecutableOrchestratePlan(path);
  const busy = streaming || kickoffBusy || plansLoading;
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
    getActiveChat(),
  );
}

/**
 * Builds the guided Orchestrate empty board: plan list, Start kickoff, loader, and escape to chat view.
 */
export async function mountBoardOnboardingPanel(
  container: HTMLElement,
  chat: Chat,
  options: MountBoardOnboardingPanelOptions = {},
): Promise<void> {
  disposeBoardOnboardingUiTimers();
  container.replaceChildren();

  const panel = document.createElement('div');
  panel.className = 'board-onboarding__panel';
  container.appendChild(panel);

  const loader = document.createElement('div');
  loader.className = 'board-onboarding__loader hidden';
  loader.dataset.boardOnboardingLoader = '';
  loader.hidden = true;
  loader.setAttribute('role', 'status');
  loader.setAttribute('aria-live', 'polite');

  loader.appendChild(createBoardOnboardingHeroIcon());

  const headline = document.createElement('h2');
  headline.className = 'board-onboarding__headline';
  headline.dataset.boardOnboardingHeadline = '';
  headline.textContent = 'Preparing your board';
  loader.appendChild(headline);

  const statusMessage = document.createElement('p');
  statusMessage.className = 'board-onboarding__status-message';
  statusMessage.dataset.boardOnboardingStatusMessage = '';
  loader.appendChild(statusMessage);

  const planName = document.createElement('p');
  planName.className = 'board-onboarding__plan-name hidden';
  planName.dataset.boardOnboardingPlanName = '';
  loader.appendChild(planName);

  const gitPrompt = createBoardGitSetupPrompt();

  const questionsHost = document.createElement('div');
  questionsHost.id = BOARD_ONBOARDING_QUESTIONS_ID;
  questionsHost.className = 'board-onboarding__questions';
  questionsHost.hidden = true;

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

  const setupActions = document.createElement('div');
  setupActions.className = 'board-onboarding__actions';

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

  setupActions.appendChild(startBtn);
  setupActions.appendChild(openPlanBtn);

  setup.appendChild(title);
  setup.appendChild(desc);
  setup.appendChild(field);
  setup.appendChild(hint);
  setup.appendChild(pickPlanHint);
  setup.appendChild(setupActions);

  const footer = document.createElement('div');
  footer.className = 'board-onboarding__footer hidden';
  footer.dataset.boardOnboardingFooter = '';
  footer.hidden = true;

  const jumpChatBtn = document.createElement('button');
  jumpChatBtn.type = 'button';
  jumpChatBtn.className = 'board-onboarding__jump-chat';
  jumpChatBtn.dataset.boardOnboardingJumpChat = '';
  jumpChatBtn.textContent = 'Jump to chat';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'board-onboarding__cancel';
  cancelBtn.dataset.boardOnboardingCancel = '';
  cancelBtn.textContent = 'Cancel setup';

  footer.appendChild(jumpChatBtn);
  footer.appendChild(cancelBtn);

  panel.appendChild(loader);
  panel.appendChild(gitPrompt);
  panel.appendChild(questionsHost);
  panel.appendChild(setup);
  panel.appendChild(footer);

  container.className = 'board-onboarding';
  wireBoardOnboardingInteractions(container, () => setOrchestrateViewMode('chat'));

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
      chat,
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
    void kickoffOrchestrateBoardBuild();
  });

  openPlanBtn.addEventListener('click', () => {
    const path = sel.value.trim();
    if (!isExecutableOrchestratePlan(path)) return;
    void import('./file-viewer').then((m) => m.openFileInViewer(path));
  });

  await loadPlans();
}

/**
 * Update the mounted board shell from session state (kanban, timer, controls).
 * Falls back to a full render when the DOM is missing or still empty.
 */
export function refreshActiveBoardIfMounted(): void {
  if (isOrchestrateHubMounted()) return;
  if (isMainColumnOverlaySuppressingChatDom()) return;
  if (!isOrchestrateBoardViewActive() && !isOrchestrateInitSplitChromeActive()) return;
  const group = getActiveBoardGroup();
  if (!group) return;
  const plannerChat = plannerForGroup(group);
  const mount = getOrchestrateBoardMountElement();

  const board = group.orchestrateBoard;
  const root = mount.querySelector(':scope > .board-root') as HTMLElement | null;
  if (root && board && root.querySelector('.board-main')) {
    refreshBoardDom(root, group, plannerChat, board);
    refreshMetricsStripForChat(plannerChat);
    return;
  }
  if (root && !board) return;
  renderBoardView(group);
}

/** Render Orchestrate board into the board mount (#chatArea or split top pane). */
export function renderBoardView(group: ChatGroup): void {
  if (isMainColumnOverlaySuppressingChatDom()) return;
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
    Boolean(existingRoot?.querySelector('[data-board-action="open-plan"]'));

  if (canRefreshInPlace && board) {
    refreshBoardDom(existingRoot!, group, plannerChat, board);
    ensureBoardSession(group, plannerChat);
    syncViewModeToggleFromActiveChat();
    return;
  }

  if (board) {
    applyOpenBoardWaveCollapse(group);
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
    isBoardUserStopped(board, plannerChat),
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
    group,
    plannerChat,
  );

  const main = document.createElement('div');
  main.className = 'board-main';
  mountBoardMainSurface(main, board, group, plannerChat);
  seedKanbanRefreshKey(board, plannerChat, group);

  root.appendChild(header);
  root.appendChild(main);
  mount.appendChild(root);

  ensureBoardSession(group, plannerChat);
  syncViewModeToggleFromActiveChat();
  void syncOrchestratePlanStripFromActiveChat();
}

/** Stop board listeners/timers when navigating away from board view. */
export function disposeOrchestrateBoardSession(): void {
  disposeBoardSession();
}

/** Tear down board listeners (test teardown). */
export function disposeBoardViewForTests(): void {
  disposeOrchestrateBoardSession();
  disposeBoardOnboardingUiTimers();
  kanbanInteractionReleaseBound = false;
}
