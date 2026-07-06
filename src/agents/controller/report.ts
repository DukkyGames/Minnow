/**
 * Auto-pilot orchestrator reports — task lifecycle messages to the planner chat (MIN-140 Phase 4).
 * Reports append silently to planner history (no LLM turn); plan-complete fires one wrap-up turn.
 */

import type { RunLifecycle } from '../types';
import {
  isChatStreaming,
  subscribeChatStreamEnd,
} from '../../chat/streaming-state';
import { reportBackgroundError } from '../../boot/report-background-error.ts';
import { isDomAvailable } from '../../lib/dom-available.ts';
import { getPlannerChatForGroup } from '../../state/chat-groups';
import { isBoardAutoMode, isBoardRunning } from '../../state/orchestrate-board-store';
import {
  findChatById,
  scheduleSaveSessions,
  sessionState,
  touchChat,
} from '../../state/sessions';
import type { BoardTask, BoardTaskStatus, Chat, ChatGroup } from '../../types';

export type OrchestratorTaskReportKind = 'completed' | 'failed' | 'stalled' | 'quarantined';

type DeliverFn = (chatId: string, message: string, reportKey: string) => Promise<void>;

const deliveredReportKeys = new Set<string>();
const pendingPlannerReports = new Map<string, Array<{ message: string; key: string }>>();

let reportInitialized = false;
let deliverHook: DeliverFn | null = null;
let unsubscribeStreamEnd: (() => void) | null = null;

/** Tests: capture delivery without touching planner history. */
export function setOrchestratorReportDeliverHook(fn: DeliverFn | null): void {
  deliverHook = fn;
}

/** Clear dedupe keys for a task so requeue can re-emit lifecycle reports. */
export function clearOrchestratorReportDedupeForTask(taskId: string): void {
  const prefix = `${taskId}:`;
  for (const key of deliveredReportKeys) {
    if (key.startsWith(prefix)) {
      deliveredReportKeys.delete(key);
    }
  }
}

function reportKey(
  taskId: string,
  kind: OrchestratorTaskReportKind,
  round: number,
): string {
  return `${taskId}:${kind}:${round}`;
}

function summarizeTaskChat(task: BoardTask): string {
  const chatId = task.chatId?.trim();
  if (!chatId) return task.notes?.trim() || '(no task chat yet)';
  const chat = findChatById(chatId);
  if (!chat) return task.notes?.trim() || '(task chat missing)';
  const lastAssistant = [...chat.history]
    .reverse()
    .find((m) => m.role === 'assistant');
  if (lastAssistant && typeof lastAssistant.content === 'string') {
    const text = lastAssistant.content.trim();
    if (text) {
      return text.length > 600 ? `${text.slice(0, 600)}…` : text;
    }
  }
  return task.notes?.trim() || task.error?.trim() || '(no summary)';
}

/** Build planner-facing report copy for a board task lifecycle event. */
export function buildOrchestratorTaskReportMessage(
  task: BoardTask,
  kind: OrchestratorTaskReportKind,
  lifecycle?: RunLifecycle | BoardTaskStatus,
): string {
  const summary = summarizeTaskChat(task);
  const lifecycleLabel = lifecycle ?? task.status;
  const header =
    kind === 'completed'
      ? `[Orchestrate task completed] \`${task.id}\` — ${task.title}`
      : kind === 'failed'
        ? `[Orchestrate task failed] \`${task.id}\` — ${task.title}`
        : kind === 'quarantined'
          ? `[Orchestrate task quarantined] \`${task.id}\` — ${task.title}`
          : `[Orchestrate task stalled] \`${task.id}\` — ${task.title}`;

  const lines = [
    header,
    `Lifecycle: ${lifecycleLabel}`,
    `Wave: ${task.wave}`,
    '',
    'Summary:',
    summary,
  ];
  if (task.error?.trim()) {
    lines.push('', 'Error:', task.error.trim());
  }
  if (kind === 'quarantined') {
    const q = task.quarantine;
    if (q) {
      lines.push('', `Quarantine category: ${q.category}`, `Reason: ${q.summary}`);
      if (q.resolutionSteps.length > 0) {
        lines.push('', 'Resolution steps:', ...q.resolutionSteps.map((s) => `  - ${s}`));
      }
    }
    lines.push(
      '',
      'Self-heal is exhausted for this task; its transitive dependents are also quarantined.',
      'For infra failures an env-fixer sub-agent already attempted a repair and could not unblock it.',
      'Independent siblings continue running. Requeue from the board after addressing the resolution steps.',
    );
  } else if (kind === 'stalled') {
    lines.push(
      '',
      'This task is blocked after exhausting its automatic retries.',
      'The auto-pilot already retried programmatically (and, for env failures, ran an env-fixer).',
      'Auto-pilot continues starting other ready tasks where possible.',
    );
  } else {
    lines.push(
      '',
      'Auto-pilot starts the next ready planned tasks automatically.',
    );
  }
  return lines.join('\n');
}

async function defaultDeliver(
  chatId: string,
  message: string,
  _reportKey: string,
): Promise<void> {
  const chat = findChatById(chatId);
  if (!chat) return;
  chat.history.push({ role: 'assistant', content: message });
  touchChat(chat);
  scheduleSaveSessions();

  if (!isDomAvailable()) return;
  const activeId = sessionState?.activeId;
  const active = activeId ? findChatById(activeId) : undefined;
  if (active && (active.id === chat.id || active.boardGroupId === chat.boardGroupId)) {
    try {
      const { renderChatFromHistory } = await import('../../ui/messages.ts');
      renderChatFromHistory(active);
    } catch (err) {
      reportBackgroundError('orchestrator-report-render', err);
    }
  }
}

async function flushDeliverReport(
  plannerChat: Chat,
  message: string,
  key: string,
): Promise<void> {
  if (deliveredReportKeys.has(key)) return;
  const deliver = deliverHook ?? defaultDeliver;
  try {
    await deliver(plannerChat.id, message, key);
  } finally {
    deliveredReportKeys.add(key);
  }
}

async function deliverReport(
  plannerChat: Chat,
  message: string,
  key: string,
): Promise<void> {
  if (deliveredReportKeys.has(key)) return;

  if (isChatStreaming(plannerChat.id)) {
    let queue = pendingPlannerReports.get(plannerChat.id);
    if (!queue) {
      queue = [];
      pendingPlannerReports.set(plannerChat.id, queue);
    }
    queue.push({ message, key });
    return;
  }

  await flushDeliverReport(plannerChat, message, key);
}

function flushPendingPlannerReports(plannerId: string): void {
  const queue = pendingPlannerReports.get(plannerId);
  if (!queue?.length) return;
  pendingPlannerReports.delete(plannerId);
  const planner = findChatById(plannerId);
  if (!planner) return;
  void (async () => {
    for (const item of queue) {
      await flushDeliverReport(planner, item.message, item.key);
    }
  })();
}

function mapStatusToReportKind(
  status: BoardTaskStatus,
): OrchestratorTaskReportKind | null {
  if (status === 'complete') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'blocked') return 'stalled';
  if (status === 'quarantined') return 'quarantined';
  return null;
}

/** Deliver a task lifecycle report to the planner when auto-pilot is on and running. */
export async function deliverOrchestratorTaskReport(
  group: ChatGroup,
  plannerChat: Chat,
  task: BoardTask,
  status: BoardTaskStatus,
): Promise<void> {
  if (!isBoardRunning(group)) return;
  const kind = mapStatusToReportKind(status);
  if (!kind) return;

  const key = reportKey(task.id, kind, task.selfHealRound ?? 0);
  const message = buildOrchestratorTaskReportMessage(task, kind, status);
  await deliverReport(plannerChat, message, key);

  // Re-drive on every settled outcome, even when the message copy was already deduped.
  // autoDelegateNext is idempotent — no-op when nothing is ready.
  const { autoDelegateNext } = await import('../../state/orchestrate-board-actions');
  await autoDelegateNext(group, plannerChat);
}

function resolveBoardContextFromTaskChat(
  endedChatId: string,
): { group: ChatGroup; planner: Chat; task: BoardTask } | null {
  if (!sessionState) return null;
  for (const group of sessionState.groups ?? []) {
    const board = group.orchestrateBoard;
    if (!board || !isBoardAutoMode(group)) continue;
    const task = board.tasks.find((t) => t.chatId === endedChatId);
    if (!task) continue;
    const planner = getPlannerChatForGroup(group);
    if (!planner) continue;
    return { group, planner, task };
  }
  return null;
}

/** Subscribe once for stream-end delivery when a task chat settles. */
export function initOrchestratorAutoReports(): void {
  if (reportInitialized) return;
  reportInitialized = true;

  unsubscribeStreamEnd?.();
  unsubscribeStreamEnd = subscribeChatStreamEnd((endedChatId) => {
    if (pendingPlannerReports.has(endedChatId)) {
      flushPendingPlannerReports(endedChatId);
    }

    const ctx = resolveBoardContextFromTaskChat(endedChatId);
    if (ctx) {
      const { group, planner, task } = ctx;
      if (isBoardRunning(group) && (task.status === 'complete' || task.status === 'failed' || task.status === 'blocked' || task.status === 'quarantined')) {
        void deliverOrchestratorTaskReport(group, planner, task, task.status);
      }
    }
  });
}

/** Test reset. */
export function resetOrchestratorAutoReportsForTests(): void {
  unsubscribeStreamEnd?.();
  unsubscribeStreamEnd = null;
  reportInitialized = false;
  deliverHook = null;
  deliveredReportKeys.clear();
  pendingPlannerReports.clear();
}
