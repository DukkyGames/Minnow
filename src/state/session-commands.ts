/**
 * Client helpers for POST /api/session/commands (Session Engine Phase 1).
 */

import { withSessionToken } from '../api/session-token';

/** Bearer token for /api/session/* when MINNOW_TOKEN is set on the server. */
function sessionAuthHeaders(): Record<string, string> {
  const token =
    typeof import.meta.env.VITE_MINNOW_TOKEN === 'string'
      ? import.meta.env.VITE_MINNOW_TOKEN.trim()
      : '';
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
}

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

