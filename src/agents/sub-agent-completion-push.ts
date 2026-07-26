/**
 * Event-driven delivery of sub-agent results to the parent chat (non-orchestrate modes).
 * Coalesces completions while the parent is streaming; retries once on transport errors.
 */

import { normalizeModeId } from '../chat/modes/types';
import { buildSubAgentParentResumeMessage } from '../chat/orchestrate/sub-agent-resume-message';
import { isUserStoppedChat } from '../chat/orchestrate/user-stopped';
import {
  isChatStreaming,
  notifyChatStreamEnded,
  subscribeChatStreamEnd,
} from '../chat/streaming-state';
import { findChatById } from '../state/sessions';
import type { PersistedSubAgentRun } from '../types';
import { getSubAgentRun, listSubAgentRunsForParentChat } from './orchestrator';
import { isSubAgentRunTerminal } from './sub-agent-outcome';
import { subscribeSubAgentRuns } from './sub-agent-events';
import type { SubAgentRun } from './types';

const pendingCompletionByChat = new Map<string, Set<string>>();
const deliveredRunIds = new Set<string>();
const nudgedRunIds = new Set<string>();
const resumeInFlightByChat = new Set<string>();

let pushInitialized = false;

type CompletionDeliverFn = (
  chatId: string,
  message: string,
  runIdsToMark: string[],
) => Promise<void>;

let deliverHook: CompletionDeliverFn | null = null;

/** Tests: capture delivery without running the full chat loop. */
export function setSubAgentCompletionDeliverHook(fn: CompletionDeliverFn | null): void {
  deliverHook = fn;
}

function isOrchestrateChat(chatId: string): boolean {
  const chat = findChatById(chatId);
  return Boolean(chat && normalizeModeId(chat.modeId) === 'orchestrate');
}

function shouldSkipPushForChat(chatId: string): boolean {
  const chat = findChatById(chatId);
  if (!chat) return true;
  if (normalizeModeId(chat.modeId) === 'orchestrate') return true;
  if (isUserStoppedChat(chat)) return true;
  return false;
}

function pendingSet(chatId: string): Set<string> {
  let set = pendingCompletionByChat.get(chatId);
  if (!set) {
    set = new Set();
    pendingCompletionByChat.set(chatId, set);
  }
  return set;
}

function runsForDelivery(chatId: string, runIds: Iterable<string>): SubAgentRun[] {
  const out: SubAgentRun[] = [];
  for (const runId of runIds) {
    if (deliveredRunIds.has(runId)) continue;
    const live = getSubAgentRun(runId);
    if (live && live.parentChatId === chatId && isSubAgentRunTerminal(live.status)) {
      out.push(live);
    }
  }
  return out;
}

function elapsedSeconds(run: SubAgentRun): number {
  if (!run.startedAt) return 0;
  const start = Date.parse(run.startedAt);
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.round((Date.now() - start) / 1000));
}

async function deliverResume(
  chatId: string,
  message: string,
  runIdsToMark: string[],
): Promise<void> {
  if (resumeInFlightByChat.has(chatId)) return;
  const chat = findChatById(chatId);
  if (!chat || shouldSkipPushForChat(chatId)) return;
  if (isChatStreaming(chatId)) return;

  resumeInFlightByChat.add(chatId);
  try {
    const deliver = deliverHook ?? defaultDeliverResume;
    await deliver(chatId, message, runIdsToMark);
    for (const id of runIdsToMark) {
      deliveredRunIds.add(id);
    }
  } catch (err) {
    const messageText = err instanceof Error ? err.message : String(err);
    const transient =
      messageText.includes('Failed to fetch') || messageText.includes('NetworkError');
    if (transient) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const deliver = deliverHook ?? defaultDeliverResume;
        await deliver(chatId, message, runIdsToMark);
        for (const id of runIdsToMark) {
          deliveredRunIds.add(id);
        }
      } catch {
        /* next completion or nudge may retry */
      }
    }
  } finally {
    resumeInFlightByChat.delete(chatId);
  }
}

async function defaultDeliverResume(
  chatId: string,
  message: string,
  _runIdsToMark: string[],
): Promise<void> {
  const chat = findChatById(chatId);
  if (!chat) return;
  // Category-3: hydrate before resume mutates history (runChatTurn also awaits).
  const { ensureChatHistoryLoaded } = await import('../state/sessions');
  await ensureChatHistoryLoaded(chatId);
  const { resumeParentChatWithMessage } = await import('../tools/loop');
  await resumeParentChatWithMessage(chat, message, { suppressUserEcho: true });
}

async function flushPendingCompletions(chatId: string): Promise<void> {
  const pending = pendingCompletionByChat.get(chatId);
  if (!pending?.size) return;
  if (shouldSkipPushForChat(chatId)) {
    pending.clear();
    return;
  }
  if (isChatStreaming(chatId)) return;

  const ids = [...pending].filter((id) => !deliveredRunIds.has(id));
  const runs = runsForDelivery(chatId, ids);
  if (!runs.length) return;

  const body = buildSubAgentParentResumeMessage('completion', runs);
  await deliverResume(
    chatId,
    body,
    runs.map((r) => r.runId),
  );
  for (const id of runs.map((r) => r.runId)) {
    pending.delete(id);
  }
  if (pending.size === 0) {
    pendingCompletionByChat.delete(chatId);
  }
}

function enqueueCompletion(run: SubAgentRun): void {
  const chatId = run.parentChatId?.trim();
  if (!chatId || !isSubAgentRunTerminal(run.status)) return;
  if (shouldSkipPushForChat(chatId)) return;
  if (deliveredRunIds.has(run.runId)) return;

  pendingSet(chatId).add(run.runId);
  if (isChatStreaming(chatId)) return;
  void flushPendingCompletions(chatId);
}

/** Fire a single check-in nudge for a long-running sub-agent (orchestrator timer). */
export function fireSubAgentCheckInNudge(runId: string): void {
  const run = getSubAgentRun(runId);
  if (!run?.parentChatId) return;
  if (run.status !== 'running' && run.status !== 'queued') return;
  if (nudgedRunIds.has(runId)) return;
  if (shouldSkipPushForChat(run.parentChatId)) return;
  if (isChatStreaming(run.parentChatId)) return;

  nudgedRunIds.add(runId);
  const body = buildSubAgentParentResumeMessage('check_in_nudge', [run], {
    run,
    elapsedSec: elapsedSeconds(run),
  });
  void deliverResume(run.parentChatId, body, []);
}

function onSubAgentRunUpdated(run: SubAgentRun): void {
  if (!run.parentChatId) return;
  if (isSubAgentRunTerminal(run.status)) {
    enqueueCompletion(run);
    return;
  }
}

/** Subscribe once: push completions and listen for parent stream end to flush batches. */
export function initSubAgentCompletionPush(): void {
  if (pushInitialized) return;
  pushInitialized = true;

  subscribeSubAgentRuns((run) => {
    onSubAgentRunUpdated(run);
  });

  subscribeChatStreamEnd((chatId) => {
    void flushPendingCompletions(chatId);
  });
}

/** Test reset. */
export function resetSubAgentCompletionPushForTests(): void {
  pushInitialized = false;
  deliverHook = null;
  pendingCompletionByChat.clear();
  deliveredRunIds.clear();
  nudgedRunIds.clear();
  resumeInFlightByChat.clear();
}

/** Tests: flush pending completions for a chat (after mocking streaming idle). */
export async function flushSubAgentCompletionPushForChat(chatId: string): Promise<void> {
  await flushPendingCompletions(chatId);
}

/** Resolve a run for parent tools: live orchestrator row or persisted session snapshot. */
export function resolveSubAgentRunForParentSession(
  runId: string,
  parentChatId: string,
): SubAgentRun | undefined {
  const live = getSubAgentRun(runId);
  if (live) return live;
  const chat = findChatById(parentChatId);
  const row = chat?.subAgentRuns?.find((r) => r.runId === runId);
  if (!row) return undefined;
  return persistedRowToSubAgentRun(row, parentChatId);
}

function persistedRowToSubAgentRun(
  row: PersistedSubAgentRun,
  parentChatId: string,
): SubAgentRun {
  return {
    runId: row.runId,
    type: row.type,
    task: row.task,
    status: row.status,
    parentChatId,
    parentToolCallId: row.parentToolCallId ?? null,
    parentTurnId: row.parentTurnId ?? null,
    summary: row.summary,
    structuredOutcome: row.structuredOutcome,
    budgetEvents: row.budgetEvents,
    error: row.error ?? null,
    startedAt: row.startedAt ?? null,
    endedAt: row.endedAt ?? null,
    toolTurns: row.toolTurns,
    cancelled: row.status === 'cancelled',
    messages: row.messages as SubAgentRun['messages'],
    category: row.category,
    boardTaskId: row.boardTaskId,
  };
}
