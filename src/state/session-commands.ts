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
