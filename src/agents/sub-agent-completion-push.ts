/**
 * Event-driven delivery of sub-agent results to the parent chat (non-orchestrate modes).
 * Coalesces completions while the parent is streaming; retries on transport errors.
 *
 * A completion is only ever dropped from the queue once it is *known delivered*
 * (MIN-639). Every other outcome — a guard bailing out, a transport failure, a
 * parent that is still streaming — leaves the run pending and schedules another
 * attempt. When the parent can never accept the resume (chat deleted or
 * switched to orchestrate) the summary is surfaced as a notification and
 * persisted onto the chat instead of vanishing.
 */

import { normalizeModeId } from '../chat/modes/types';
import { buildSubAgentParentResumeMessage } from './sub-agent-resume-message';
import {
  isChatStreaming,
  notifyChatStreamEnded,
  subscribeChatStreamEnd,
} from '../chat/streaming-state';
import { reportBackgroundError } from '../boot/report-background-error';
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
const retryTimerByChat = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Backstop poll for a queue that no event will drain on its own: the parent
 * stream ended before the run settled, or delivery failed mid-flight. Cheap
 * because it only exists while something is actually pending.
 */
const RETRY_DELAY_MS = 5_000;

let pushInitialized = false;

type CompletionDeliverFn = (
  chatId: string,
  message: string,
  runIdsToMark: string[],
) => Promise<void>;

type CompletionNotifyFn = (chatId: string, run: SubAgentRun) => void;

let deliverHook: CompletionDeliverFn | null = null;
let notifyHook: CompletionNotifyFn | null = null;

/** Tests: capture delivery without running the full chat loop. */
export function setSubAgentCompletionDeliverHook(fn: CompletionDeliverFn | null): void {
  deliverHook = fn;
}

/** Tests: capture the undeliverable-completion fallback without the notification stack. */
export function setSubAgentCompletionNotifyHook(fn: CompletionNotifyFn | null): void {
  notifyHook = fn;
}

function isOrchestrateChat(chatId: string): boolean {
  const chat = findChatById(chatId);
  return Boolean(chat && normalizeModeId(chat.modeId) === 'orchestrate');
}

/**
 * Why a resume can never land on this chat, or `null` when it can.
 *
 * Split out from the old boolean so the enqueue path can treat `orchestrate`
 * (the board owns delivery — nothing was lost) differently from a chat that has
 * gone away underneath a queued completion.
 */
type PushSkipReason = 'missing_chat' | 'orchestrate';

function pushSkipReason(chatId: string): PushSkipReason | null {
  const chat = findChatById(chatId);
  if (!chat) return 'missing_chat';
  // Orchestrate / V2 boards own delivery via the journal; leftover V1
  // user-stopped-on-incomplete-board skip is gone (MIN-714).
  if (normalizeModeId(chat.modeId) === 'orchestrate') return 'orchestrate';
  return null;
}

function shouldSkipPushForChat(chatId: string): boolean {
  return pushSkipReason(chatId) !== null;
}

function cancelRetryFlush(chatId: string): void {
  const timer = retryTimerByChat.get(chatId);
  if (timer === undefined) return;
  clearTimeout(timer);
  retryTimerByChat.delete(chatId);
}

/** Re-attempt a queue that still holds work after this pass (idempotent per chat). */
function scheduleRetryFlush(chatId: string): void {
  if (retryTimerByChat.has(chatId)) return;
  const timer = setTimeout(() => {
    retryTimerByChat.delete(chatId);
    void flushPendingCompletions(chatId);
  }, RETRY_DELAY_MS);
  // Never hold a node test run (or an app quit) open on a backstop poll.
  (timer as unknown as { unref?: () => void }).unref?.();
  retryTimerByChat.set(chatId, timer);
}

/**
 * Last resort for a completion the parent chat can never accept: surface it in
 * the inbox and keep the transcript recoverable on the chat blob.
 */
function notifyUndeliverableCompletion(chatId: string, run: SubAgentRun): void {
  if (notifyHook) {
    notifyHook(chatId, run);
    return;
  }
  // `persistSubAgentRunSnapshot` no-ops when the chat is gone, which is exactly
  // the deleted-chat case — the notification is then the only surface left.
  void import('../state/sub-agent-session-sync')
    .then((m) => m.persistSubAgentRunSnapshot(run))
    .catch((err) => reportBackgroundError('sub-agent-completion-persist', err));

  void import('../notifications/push')
    .then(({ pushNotification }) => {
      const summary = run.summary?.trim() || run.error?.trim() || '';
      pushNotification({
        kind: run.status === 'completed' ? 'sub_agent_complete' : 'sub_agent_failed',
        title: `Background ${run.type} ${run.status}`,
        preview: summary.slice(0, 280) || 'Finished with no summary',
        chatId,
        appId: 'code',
        dedupeKey: `sub-agent-completion:${run.runId}`,
      });
    })
    .catch((err) => reportBackgroundError('sub-agent-completion-notify', err));
}

/** Mark ids delivered-by-fallback so nothing retries or double-reports them. */
function fallbackDeliverCompletions(chatId: string, runIds: Iterable<string>): void {
  for (const runId of runIds) {
    if (deliveredRunIds.has(runId)) continue;
    const run = getSubAgentRun(runId);
    deliveredRunIds.add(runId);
    if (!run || !isSubAgentRunTerminal(run.status)) continue;
    notifyUndeliverableCompletion(chatId, run);
  }
}

function clearPendingForChat(chatId: string): void {
  pendingCompletionByChat.delete(chatId);
  cancelRetryFlush(chatId);
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

async function attemptDeliver(
  chatId: string,
  message: string,
  runIdsToMark: string[],
): Promise<void> {
  const deliver = deliverHook ?? defaultDeliverResume;
  await deliver(chatId, message, runIdsToMark);
  for (const id of runIdsToMark) {
    deliveredRunIds.add(id);
  }
}

/**
 * Returns true only when the resume actually landed. Every `false` — guard bail
 * or failure — is a signal to the caller to keep the runs queued (MIN-639).
 */
async function deliverResume(
  chatId: string,
  message: string,
  runIdsToMark: string[],
): Promise<boolean> {
  if (resumeInFlightByChat.has(chatId)) return false;
  const chat = findChatById(chatId);
  if (!chat || shouldSkipPushForChat(chatId)) return false;
  if (isChatStreaming(chatId)) return false;

  resumeInFlightByChat.add(chatId);
  try {
    await attemptDeliver(chatId, message, runIdsToMark);
    return true;
  } catch (err) {
    const messageText = err instanceof Error ? err.message : String(err);
    const transient =
      messageText.includes('Failed to fetch') || messageText.includes('NetworkError');
    if (transient) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        await attemptDeliver(chatId, message, runIdsToMark);
        return true;
      } catch (retryErr) {
        reportBackgroundError('sub-agent-completion-push', retryErr);
        return false;
      }
    }
    reportBackgroundError('sub-agent-completion-push', err);
    return false;
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
    // The parent can never take this resume — hand it to the inbox rather than
    // clearing the queue into the void.
    fallbackDeliverCompletions(chatId, [...pending]);
    clearPendingForChat(chatId);
    return;
  }
  if (isChatStreaming(chatId)) {
    // The stream-end listener normally wins the race; the timer covers the case
    // where the stream ended before this run settled and nothing fires again.
    scheduleRetryFlush(chatId);
    return;
  }

  // Anything already delivered by another pass is done, queue or not.
  for (const id of [...pending]) {
    if (deliveredRunIds.has(id)) pending.delete(id);
  }

  const runs = runsForDelivery(chatId, [...pending]);
  if (!runs.length) {
    // Nothing left resolves to a live terminal run; it never will, so stop
    // retrying rather than leaking the ids forever.
    clearPendingForChat(chatId);
    return;
  }

  const runIds = runs.map((r) => r.runId);
  const body = buildSubAgentParentResumeMessage('completion', runs);
  await deliverResume(chatId, body, runIds);

  // Only ids that actually landed leave the queue.
  for (const id of runIds) {
    if (deliveredRunIds.has(id)) pending.delete(id);
  }
  if (pending.size === 0) {
    clearPendingForChat(chatId);
  } else {
    scheduleRetryFlush(chatId);
  }
}

function enqueueCompletion(run: SubAgentRun): void {
  const chatId = run.parentChatId?.trim();
  if (!chatId || !isSubAgentRunTerminal(run.status)) return;
  if (deliveredRunIds.has(run.runId)) return;

  const skip = pushSkipReason(chatId);
  // Orchestrate boards deliver results themselves — staying quiet there is
  // correct. Every other skip reason means this result has no other home.
  if (skip === 'orchestrate') return;
  if (skip) {
    fallbackDeliverCompletions(chatId, [run.runId]);
    return;
  }

  pendingSet(chatId).add(run.runId);
  if (isChatStreaming(chatId)) {
    scheduleRetryFlush(chatId);
    return;
  }
  void flushPendingCompletions(chatId);
}

/**
 * Drain every queued chat — called on chat switch, where a parent that was
 * streaming when its sub-agent settled becomes deliverable again.
 */
export function flushAllPendingSubAgentCompletions(): void {
  for (const chatId of [...pendingCompletionByChat.keys()]) {
    void flushPendingCompletions(chatId);
  }
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
  notifyHook = null;
  for (const timer of retryTimerByChat.values()) clearTimeout(timer);
  retryTimerByChat.clear();
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
