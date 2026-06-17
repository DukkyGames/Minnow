/**
 * Auto-pilot orchestrator reports — task lifecycle messages to the planner chat (MIN-140 Phase 4).
 */

import type { RunLifecycle } from '../types';
import {
  isChatStreaming,
  subscribeChatStreamEnd,
} from '../../chat/streaming-state';
import { getPlannerChatForGroup } from '../../state/chat-groups';
import { isBoardAutoMode } from '../../state/orchestrate-board-store';
import { findChatById, sessionState } from '../../state/sessions';
import type { BoardTask, BoardTaskStatus, Chat, ChatGroup } from '../../types';

export type OrchestratorTaskReportKind = 'completed' | 'stalled' | 'failed';

type DeliverFn = (chatId: string, message: string, reportKey: string) => Promise<void>;

const deliveredReportKeys = new Set<string>();
const resumeInFlightByChat = new Set<string>();

let reportInitialized = false;
let deliverHook: DeliverFn | null = null;
let unsubscribeStreamEnd: (() => void) | null = null;

/** Tests: capture delivery without running the full chat loop. */
export function setOrchestratorReportDeliverHook(fn: DeliverFn | null): void {
  deliverHook = fn;
}

function reportKey(taskId: string, kind: OrchestratorTaskReportKind): string {
  return `${taskId}:${kind}`;
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
  lines.push(
    '',
    'Use `board_get_state` for the full board. Auto-pilot starts the next ready planned tasks automatically.',
  );
  return lines.join('\n');
}

async function defaultDeliver(
  chatId: string,
  message: string,
  _reportKey: string,
): Promise<void> {
  const chat = findChatById(chatId);
  if (!chat) return;
  const { resumeParentChatWithMessage } = await import('../../tools/loop');
  await resumeParentChatWithMessage(chat, message, { suppressUserEcho: true });
}

async function deliverReport(
  plannerChat: Chat,
  message: string,
  key: string,
): Promise<void> {
  if (deliveredReportKeys.has(key)) return;
  if (resumeInFlightByChat.has(plannerChat.id)) return;
  if (isChatStreaming(plannerChat.id)) return;

  resumeInFlightByChat.add(plannerChat.id);
  try {
    const deliver = deliverHook ?? defaultDeliver;
    await deliver(plannerChat.id, message, key);
    deliveredReportKeys.add(key);
  } catch (err) {
    const messageText = err instanceof Error ? err.message : String(err);
    const transient =
      messageText.includes('Failed to fetch') || messageText.includes('NetworkError');
    if (transient) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const deliver = deliverHook ?? defaultDeliver;
        await deliver(plannerChat.id, message, key);
        deliveredReportKeys.add(key);
      } catch {
        /* next event may retry */
      }
    }
  } finally {
    resumeInFlightByChat.delete(plannerChat.id);
  }
}

function mapStatusToReportKind(
  status: BoardTaskStatus,
): OrchestratorTaskReportKind | null {
  if (status === 'complete') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'blocked') return 'stalled';
  return null;
}

/** Deliver a task lifecycle report to the planner when auto-pilot is on. */
export async function deliverOrchestratorTaskReport(
  group: ChatGroup,
  plannerChat: Chat,
  task: BoardTask,
  status: BoardTaskStatus,
): Promise<void> {
  if (!isBoardAutoMode(group)) return;
  const kind = mapStatusToReportKind(status);
  if (!kind) return;
  const key = reportKey(task.id, kind);
  if (deliveredReportKeys.has(key)) return;

  const message = buildOrchestratorTaskReportMessage(task, kind, status);
  await deliverReport(plannerChat, message, key);

  if (kind === 'completed') {
    const { autoDelegateNext } = await import('../../state/orchestrate-board-actions');
    await autoDelegateNext(group, plannerChat);
  }
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

/** Subscribe once for stream-end flush hooks (planner idle reports). */
export function initOrchestratorAutoReports(): void {
  if (reportInitialized) return;
  reportInitialized = true;

  unsubscribeStreamEnd?.();
  unsubscribeStreamEnd = subscribeChatStreamEnd((endedChatId) => {
    const ctx = resolveBoardContextFromTaskChat(endedChatId);
    if (!ctx) return;
    const { group, planner, task } = ctx;
    if (task.status === 'complete' || task.status === 'failed' || task.status === 'blocked') {
      void deliverOrchestratorTaskReport(group, planner, task, task.status);
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
  resumeInFlightByChat.clear();
}
