/**
 * Orchestrate stall watchdog: detect idle board + incomplete work and auto-resume.
 */

import { listActiveSubAgentRuns } from '../../agents/orchestrator';
import { subscribeSubAgentRuns } from '../../agents/sub-agent-events';
import type { SubAgentRun } from '../../agents/types';
import { normalizeModeId } from '../modes/types';
import { isActiveChatStreaming, isChatStreaming } from '../streaming-state';
import { ORCHESTRATE_RESUME_MESSAGE } from './resume-message';
import { updateTask } from '../../state/orchestrate-board-store';
import { emitBoardChange } from '../../state/orchestrate-board-events';
import { getActiveChat } from '../../state/sessions';
import type { BoardTask, Chat, OrchestrateBoardState } from '../../types';

/** Default idle time after last sub-agent terminal event before auto-resume. */
export const ORCHESTRATE_WATCHDOG_STALL_MS = 30_000;

/** Max watchdog auto-resume injections per board task. */
export const ORCHESTRATE_WATCHDOG_MAX_RETRIES_PER_TASK = 3;

/** Poll interval for stall evaluation. */
const WATCHDOG_TICK_MS = 5_000;

export interface OrchestrateWatchdogDeps {
  nowMs: () => number;
  isChatStreaming: (chatId: string) => boolean;
  listActiveSubAgentRuns: () => SubAgentRun[];
  getActiveChat: () => Chat;
}

export interface StallEvaluation {
  stalled: boolean;
  /** First incomplete task that blocks progress (for retry budget). */
  blockingTaskId: string | null;
  retriesExhausted: boolean;
}

const lastSubAgentTerminalAt = new Map<string, number>();
const stalledChatIds = new Set<string>();
let resumeInFlight = false;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let unsubAgents: (() => void) | null = null;

function isTerminalStatus(status: SubAgentRun['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function activeRunsForChat(chatId: string, runs: SubAgentRun[]): SubAgentRun[] {
  return runs.filter(
    (r) =>
      r.parentChatId === chatId &&
      (r.status === 'queued' || r.status === 'running'),
  );
}

function hasIncompleteTasks(board: OrchestrateBoardState): boolean {
  return board.tasks.some((t) => t.status !== 'complete');
}

function findBlockingTask(board: OrchestrateBoardState): BoardTask | null {
  const order = ['failed', 'blocked', 'in_progress', 'testing', 'planned'] as const;
  for (const status of order) {
    const hit = board.tasks.find((t) => t.status === status);
    if (hit) return hit;
  }
  return null;
}

/** Pure stall detector for tests and the live tick loop. */
export function evaluateOrchestrateStall(
  board: OrchestrateBoardState,
  chatId: string,
  lastTerminalAt: number | undefined,
  deps: OrchestrateWatchdogDeps,
): StallEvaluation {
  const empty: StallEvaluation = {
    stalled: false,
    blockingTaskId: null,
    retriesExhausted: false,
  };

  if (!hasIncompleteTasks(board)) return empty;

  const active = activeRunsForChat(chatId, deps.listActiveSubAgentRuns());
  if (active.length > 0) return empty;

  if (deps.isChatStreaming(chatId)) return empty;

  if (lastTerminalAt == null || lastTerminalAt <= 0) return empty;

  const blocking = findBlockingTask(board);
  if (!blocking) return empty;

  const retryCount = blocking.retryCount ?? 0;
  const retriesExhausted = retryCount >= ORCHESTRATE_WATCHDOG_MAX_RETRIES_PER_TASK;
  const idleMs = deps.nowMs() - lastTerminalAt;
  if (idleMs < ORCHESTRATE_WATCHDOG_STALL_MS) {
    return { stalled: false, blockingTaskId: blocking.id, retriesExhausted };
  }

  return {
    stalled: true,
    blockingTaskId: blocking.id,
    retriesExhausted,
  };
}

/** Whether the UI should show an explicit stalled chip (retries exhausted). */
export function isOrchestrateWatchdogStalled(chatId: string): boolean {
  return stalledChatIds.has(chatId);
}

function markStalled(chatId: string, stalled: boolean): void {
  if (stalled) stalledChatIds.add(chatId);
  else stalledChatIds.delete(chatId);
}

function recordSubAgentTerminal(run: SubAgentRun): void {
  if (!isTerminalStatus(run.status)) return;
  const chatId = run.parentChatId?.trim();
  if (!chatId) return;
  lastSubAgentTerminalAt.set(chatId, Date.now());
  markStalled(chatId, false);
}

async function injectResumeMessage(): Promise<void> {
  if (resumeInFlight) return;
  resumeInFlight = true;
  try {
    const input = document.getElementById('msgInput') as HTMLTextAreaElement | null;
    if (!input) return;
    input.value = ORCHESTRATE_RESUME_MESSAGE;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const { sendMessage } = await import('../messaging');
    await sendMessage();
  } finally {
    resumeInFlight = false;
  }
}

function showWatchdogToast(message: string): void {
  const el = document.createElement('div');
  el.className = 'orchestrate-watchdog-toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('orchestrate-watchdog-toast--visible'));
  window.setTimeout(() => {
    el.classList.remove('orchestrate-watchdog-toast--visible');
    window.setTimeout(() => el.remove(), 300);
  }, 5000);
}

function defaultDeps(): OrchestrateWatchdogDeps {
  return {
    nowMs: () => Date.now(),
    isChatStreaming: (chatId) => isChatStreaming(chatId),
    listActiveSubAgentRuns,
    getActiveChat,
  };
}

function tickWatchdog(): void {
  const chat = getActiveChat();
  if (normalizeModeId(chat.modeId) !== 'orchestrate') return;
  const board = chat.orchestrateBoard;
  if (!board) {
    markStalled(chat.id, false);
    return;
  }

  const evaluation = evaluateOrchestrateStall(
    board,
    chat.id,
    lastSubAgentTerminalAt.get(chat.id),
    defaultDeps(),
  );

  if (!evaluation.stalled) {
    markStalled(chat.id, false);
    return;
  }

  if (evaluation.retriesExhausted) {
    markStalled(chat.id, true);
    emitBoardChange(chat.id);
    return;
  }

  if (isActiveChatStreaming() || resumeInFlight) return;

  const taskId = evaluation.blockingTaskId;
  if (taskId) {
    const task = board.tasks.find((t) => t.id === taskId);
    updateTask(chat, taskId, {
      retryCount: (task?.retryCount ?? 0) + 1,
    });
  }

  markStalled(chat.id, false);
  showWatchdogToast('Orchestrator stalled — resuming plan…');
  emitBoardChange(chat.id);
  void injectResumeMessage();
}

/** Start global stall monitoring (idempotent). */
export function startOrchestrateWatchdog(): void {
  if (tickTimer) return;
  unsubAgents = subscribeSubAgentRuns(recordSubAgentTerminal);
  tickTimer = setInterval(tickWatchdog, WATCHDOG_TICK_MS);
}

/** Stop monitoring (tests). */
export function stopOrchestrateWatchdog(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  unsubAgents?.();
  unsubAgents = null;
  lastSubAgentTerminalAt.clear();
  stalledChatIds.clear();
  resumeInFlight = false;
}

/** Test hook: seed last terminal timestamp for a chat. */
export function setWatchdogLastTerminalForTests(
  chatId: string,
  atMs: number | null,
): void {
  if (atMs == null) lastSubAgentTerminalAt.delete(chatId);
  else lastSubAgentTerminalAt.set(chatId, atMs);
}
