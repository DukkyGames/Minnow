/**
 * Client helpers for POST /api/session/commands (Session Engine Phase 1).
 */

import { withSessionToken } from '../api/session-token';
import { findChatById } from './sessions';

/** Bearer token for /api/session/* when MINNOW_TOKEN is set on the server. */
function sessionAuthHeaders(): Record<string, string> {
  // import.meta.env is Vite-injected; optional-chain for tsx/node test hosts.
  const viteToken = import.meta.env?.VITE_MINNOW_TOKEN;
  const token = typeof viteToken === 'string' ? viteToken.trim() : '';
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export interface SessionCommandResult {
  rev: number;
  accepted: boolean;
  detail?: string;
}

export interface SendMessageCommandPayload {
  chatId: string;
  text: string;
  modelId?: string;
  providerId?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  goalDriven?: boolean;
  skillId?: string | null;
  displayText?: string;
  historyContent?: string;
  /**
   * When false, the engine starts a turn without appending a user row
   * (fork/replay and other pushUser:false call sites). Default true.
   */
  pushUser?: boolean;
  /** Serializable Attachment[] for engine multimodal / file rebuild. */
  attachments?: unknown[];
}

/** Payload for resuming a parked engine ask_question. */
export interface AnswerQuestionCommandPayload {
  chatId: string;
  toolCallId?: string;
  result: {
    status: 'answered' | 'cancelled' | 'error';
    answers?: unknown[];
    message?: string;
  };
}

/** Default cap while waiting for an engine-owned main-chat turn to settle. */
const ENGINE_TURN_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const ENGINE_TURN_POLL_MS = 50;
/** If SSE never shows busy, allow idle after this grace (coalesced patches). */
const ENGINE_TURN_MISS_BUSY_GRACE_MS = 3000;

/** POST a typed command; returns 202 `{ rev }` on success. */
export async function dispatchSessionCommand(
  command: Record<string, unknown>,
): Promise<SessionCommandResult> {
  const res = await fetch(withSessionToken('/api/session/commands'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...sessionAuthHeaders(),
    },
    body: JSON.stringify(command),
  });
  const body = (await res.json().catch(() => ({}))) as {
    rev?: number;
    accepted?: boolean;
    detail?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(body.error ?? `Session command failed (HTTP ${res.status})`);
  }
  return {
    rev: typeof body.rev === 'number' ? body.rev : 0,
    accepted: body.accepted !== false,
    detail: body.detail,
  };
}

/** Main-chat send via the server engine. */
export async function dispatchSendMessage(
  payload: SendMessageCommandPayload,
): Promise<SessionCommandResult> {
  return dispatchSessionCommand({ type: 'send_message', ...payload });
}

/**
 * Poll until the chat is no longer engine-busy (`engineTurnActive` / generation id).
 * Use after `send_message` 202 when the caller must wait for turn completion
 * (board git-setup, Super Plan stages, plan-screen phase advance).
 */
export async function waitForEngineTurnIdle(
  chatId: string,
  options: {
    assumeStarted?: boolean;
    timeoutMs?: number;
    /** Override miss-busy grace (tests); default {@link ENGINE_TURN_MISS_BUSY_GRACE_MS}. */
    missBusyGraceMs?: number;
  } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? ENGINE_TURN_IDLE_TIMEOUT_MS;
  const missBusyGraceMs = options.missBusyGraceMs ?? ENGINE_TURN_MISS_BUSY_GRACE_MS;
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();
  // Only flip true when we observe busy (or caller set optimistic busy already).
  let sawBusy = false;

  while (Date.now() < deadline) {
    const chat = findChatById(chatId);
    const busy = Boolean(chat?.engineTurnActive || chat?.currentGenerationId?.trim());
    if (busy) {
      sawBusy = true;
    } else if (sawBusy) {
      return;
    } else if (options.assumeStarted && Date.now() - startedAt >= missBusyGraceMs) {
      // Turn finished before the first busy patch (or SSE coalesced it away).
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ENGINE_TURN_POLL_MS));
  }
  throw new Error(`Timed out waiting for engine turn on chat ${chatId}`);
}

/**
 * `send_message` then wait until the engine turn settles.
 * Wakes client stream-end listeners afterward — engine path never runs
 * renderer `loop.ts`, so plan-screen / Super Plan hooks would otherwise stall.
 */
export async function dispatchSendMessageAndAwaitIdle(
  payload: SendMessageCommandPayload,
): Promise<SessionCommandResult> {
  const result = await dispatchSendMessage(payload);
  // Optimistic busy so we cannot resolve idle before the first SSE patch arrives.
  const chat = findChatById(payload.chatId);
  if (chat) {
    chat.engineTurnActive = true;
  }
  try {
    const { syncEngineStreamMirrors } = await import('../chat/engine-stream-mirror');
    syncEngineStreamMirrors();
  } catch {
    /* mirror is best-effort during tests / early boot */
  }
  await waitForEngineTurnIdle(payload.chatId);
  try {
    const { notifyChatStreamEnded } = await import('../chat/streaming-state');
    notifyChatStreamEnded(payload.chatId);
  } catch {
    /* stream-end bus unavailable in non-DOM hosts */
  }
  return result;
}

/** Stop an in-flight engine turn. */
export async function dispatchStopGeneration(chatId: string): Promise<SessionCommandResult> {
  return dispatchSessionCommand({ type: 'stop_generation', chatId });
}

/** Queue a steer correction (push-now). */
export async function dispatchSteerMessage(
  chatId: string,
  text: string,
): Promise<SessionCommandResult> {
  return dispatchSessionCommand({ type: 'steer_message', chatId, text });
}

/** Enqueue a follow-up while a turn is active. */
export async function dispatchEnqueueMessage(
  chatId: string,
  text: string,
): Promise<SessionCommandResult> {
  return dispatchSessionCommand({ type: 'enqueue_message', chatId, text });
}

/** Resume a parked engine ask_question with the user's answers. */
export async function dispatchAnswerQuestion(
  payload: AnswerQuestionCommandPayload,
): Promise<SessionCommandResult> {
  return dispatchSessionCommand({ type: 'answer_question', ...payload });
}

/* ── Board commands (MIN-360 Phase 2) ───────────────────────────────────── */

export async function dispatchBoardStart(groupId: string): Promise<SessionCommandResult> {
  return dispatchSessionCommand({ type: 'board_start', groupId });
}

export async function dispatchBoardStop(
  groupId: string,
  reason: 'user' | 'system' = 'user',
): Promise<SessionCommandResult> {
  return dispatchSessionCommand({ type: 'board_stop', groupId, reason });
}

export async function dispatchBoardStartTask(
  groupId: string,
  taskId: string,
): Promise<SessionCommandResult> {
  return dispatchSessionCommand({ type: 'board_start_task', groupId, taskId });
}

export async function dispatchBoardRequeueTask(
  groupId: string,
  taskId: string,
): Promise<SessionCommandResult> {
  return dispatchSessionCommand({ type: 'board_requeue_task', groupId, taskId });
}

export async function dispatchBoardSetAutonomy(
  groupId: string,
  level: 'manual' | 'sequential' | 'auto' | 'afk',
  start?: boolean,
): Promise<SessionCommandResult> {
  return dispatchSessionCommand({
    type: 'board_set_autonomy',
    groupId,
    level,
    ...(start != null ? { start } : {}),
  });
}

export async function dispatchBoardRunFinalTest(
  groupId: string,
): Promise<SessionCommandResult> {
  return dispatchSessionCommand({ type: 'board_run_final_test', groupId });
}

export async function dispatchBoardRecoverTask(
  groupId: string,
  taskId: string,
  action: 'restart' | 'continue' | 'move_to_new_chat' | 'reconcile_merge',
): Promise<SessionCommandResult> {
  return dispatchSessionCommand({
    type: 'board_recover_task',
    groupId,
    taskId,
    action,
  });
}

export async function dispatchSetModel(payload: {
  chatId?: string;
  groupId?: string;
  providerId?: string;
  modelId: string;
}): Promise<SessionCommandResult> {
  return dispatchSessionCommand({ type: 'set_model', ...payload });
}

/* ── Controller commands (MIN-361 Phase 3) ──────────────────────────────── */

/** Cancel an engine-hosted sub-agent run from a thin client. */
export async function dispatchCancelSubAgent(
  runId: string,
  reason = 'cancelled',
): Promise<SessionCommandResult> {
  return dispatchSessionCommand({ type: 'cancel_sub_agent', runId, reason });
}

/** Spawn a sub-agent into the engine-owned registry (renderer proxy path). */
export async function dispatchSpawnSubAgent(payload: {
  agentType: string;
  task: string;
  wait?: boolean;
  parentChatId?: string | null;
  parentTurnId?: string | null;
  parentToolCallId?: string | null;
  modeId?: string;
  category?: string;
  boardTaskId?: string;
  providerId?: string;
  modelId?: string;
  timeoutMs?: number;
}): Promise<SessionCommandResult> {
  return dispatchSessionCommand({ type: 'spawn_sub_agent', ...payload });
}

