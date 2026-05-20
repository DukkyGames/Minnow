/**
 * Pure pendingTurn validation (no session / UI imports — safe for unit tests).
 */

import type { Chat, PendingTurn, ToolCall } from '../types';

/** Ephemeral user line appended to API context on Continue (not stored in history). */
export const CONTINUE_INTERRUPTED_INSTRUCTION =
  'Continue your previous reply from where you left off.';

/** Normalize and validate a persisted pending turn; returns undefined when invalid. */
export function ensurePendingTurn(raw: unknown): PendingTurn | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const row = raw as Record<string, unknown>;
  if (row.role !== 'assistant') return undefined;
  const startedAt = row.startedAt;
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) {
    return undefined;
  }

  const content = typeof row.content === 'string' ? row.content : '';
  const thinking = normalizeThinking(row.thinking);
  const toolCalls = normalizeToolCalls(row.toolCalls);
  const phase = normalizePhase(row.phase);
  const toolRound = normalizeToolRound(row.toolRound);

  const out: PendingTurn = {
    role: 'assistant',
    content,
    startedAt,
  };
  if (thinking?.length) out.thinking = thinking;
  if (toolCalls?.length) out.toolCalls = toolCalls;
  if (typeof row.modelId === 'string' && row.modelId) out.modelId = row.modelId;
  if (typeof row.providerId === 'string' && row.providerId) {
    out.providerId = row.providerId;
  }
  if (phase) out.phase = phase;
  if (toolRound != null) out.toolRound = toolRound;
  if (row.stopped === true) out.stopped = true;
  if (
    typeof row.thinkingDurationMs === 'number' &&
    Number.isFinite(row.thinkingDurationMs) &&
    row.thinkingDurationMs >= 0
  ) {
    out.thinkingDurationMs = row.thinkingDurationMs;
  }
  return out;
}

function normalizeThinking(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const parts = raw
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim());
  return parts.length ? parts : undefined;
}

function normalizeToolCalls(raw: unknown): ToolCall[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ToolCall[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : '';
    const fn = row.function;
    if (!id || !fn || typeof fn !== 'object') continue;
    const func = fn as Record<string, unknown>;
    const name = typeof func.name === 'string' ? func.name : '';
    if (!name) continue;
    const args = typeof func.arguments === 'string' ? func.arguments : '';
    out.push({ id, type: 'function', function: { name, arguments: args } });
  }
  return out.length ? out : undefined;
}

function normalizePhase(raw: unknown): PendingTurn['phase'] | undefined {
  if (raw === 'streaming' || raw === 'tools' || raw === 'thinking') return raw;
  return undefined;
}

function normalizeToolRound(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) return undefined;
  return raw;
}

/** Build a checkpoint object from live stream state. */
export function buildPendingSnapshot(input: {
  content: string;
  thinking?: string[];
  toolCalls?: ToolCall[];
  startedAt: number;
  modelId?: string;
  providerId?: string;
  toolRound?: number;
  phase?: PendingTurn['phase'];
  stopped?: boolean;
  thinkingDurationMs?: number;
}): PendingTurn {
  const snap: PendingTurn = {
    role: 'assistant',
    content: input.content,
    startedAt: input.startedAt,
  };
  if (input.thinking?.length) snap.thinking = input.thinking;
  if (input.toolCalls?.length) snap.toolCalls = input.toolCalls;
  if (input.modelId) snap.modelId = input.modelId;
  if (input.providerId) snap.providerId = input.providerId;
  if (input.toolRound != null) snap.toolRound = input.toolRound;
  if (input.phase) snap.phase = input.phase;
  if (input.stopped) snap.stopped = true;
  if (input.thinkingDurationMs != null) {
    snap.thinkingDurationMs = input.thinkingDurationMs;
  }
  return snap;
}

/** True when the chat has a recoverable interrupted turn. */
export function shouldOfferRecovery(chat: Chat): boolean {
  return ensurePendingTurn(chat.pendingTurn) != null;
}

/**
 * True when the checkpoint was created by the user pressing Stop (not a tab crash /
 * mid-stream refresh). Those turns must not auto-resume on reload or Continue.
 */
export function isUserStoppedPendingCheckpoint(chat: Chat): boolean {
  return ensurePendingTurn(chat.pendingTurn)?.stopped === true;
}

/** Drop pending turn when history no longer has a user message for that turn. */
export function clearStalePendingTurn(chat: Chat): void {
  const pending = ensurePendingTurn(chat.pendingTurn);
  if (!pending) {
    if (chat.pendingTurn != null) chat.pendingTurn = undefined;
    return;
  }
  const hasUser = chat.history.some((m) => m.role === 'user');
  if (!hasUser) {
    chat.pendingTurn = undefined;
  }
}

/** Run stale cleanup on every chat after session load. */
export function clearStalePendingTurnsOnLoad(chats: Chat[]): void {
  for (const chat of chats) {
    clearStalePendingTurn(chat);
  }
}
