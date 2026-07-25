/**
 * Deterministic self-pacing for auto /loop runs (no extra LLM calls).
 * Changed output → halve delay; unchanged → double; clamp to [1m, 60m].
 */

import type { ActiveLoopState, Chat } from '../../types';
import { updateActiveLoop } from '../../state/sessions';
import {
  INITIAL_LOOP_AUTO_DELAY_MS,
  MAX_LOOP_AUTO_DELAY_MS,
  MIN_LOOP_INTERVAL_MS,
} from './parse-command';

/** Chat id → loop id awaiting post-turn pacing adjustment. */
const pendingPaceByChat = new Map<string, number>();

/** Normalize assistant text before digesting (collapse whitespace). */
export function normalizeLoopOutputForDigest(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Simple stable digest of normalized text for change detection.
 * Not cryptographic — only needs deterministic equality across runs.
 */
export function digestLoopOutput(text: string): string {
  const normalized = normalizeLoopOutputForDigest(text);
  let hash = 2166136261;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${normalized.length.toString(16)}:${(hash >>> 0).toString(16)}`;
}

/** Mark that this auto-loop should be paced after the next turn settles. */
export function markLoopAwaitingPace(chatId: string, loopId: number): void {
  pendingPaceByChat.set(chatId, loopId);
}

/** Clear pending pace marker (e.g. fire failed before turn started). */
export function clearLoopAwaitingPace(chatId: string): void {
  pendingPaceByChat.delete(chatId);
}

/** Clamp auto delay into the allowed band. */
export function clampLoopAutoDelayMs(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return INITIAL_LOOP_AUTO_DELAY_MS;
  return Math.min(MAX_LOOP_AUTO_DELAY_MS, Math.max(MIN_LOOP_INTERVAL_MS, Math.floor(ms)));
}

/**
 * Compute next delay from whether the digest changed.
 * Changed → max(1m, current/2); unchanged → min(60m, current*2).
 */
export function nextAutoDelayMs(currentDelayMs: number, outputChanged: boolean): number {
  const current = clampLoopAutoDelayMs(currentDelayMs);
  if (outputChanged) {
    return clampLoopAutoDelayMs(current / 2);
  }
  return clampLoopAutoDelayMs(current * 2);
}

/** Pull the last assistant message content from chat history. */
export function lastAssistantText(chat: Chat): string {
  for (let i = chat.history.length - 1; i >= 0; i -= 1) {
    const msg = chat.history[i];
    if (msg?.role === 'assistant' && typeof msg.content === 'string') {
      return msg.content;
    }
  }
  return '';
}

/**
 * After a loop-fired turn settles, adjust the auto-loop delay from output digest.
 * Interval loops are left alone (dueAt already advanced by intervalMs).
 */
export function maybeRescheduleLoopsAfterTurn(chat: Chat, now = Date.now()): void {
  const loopId = pendingPaceByChat.get(chat.id);
  if (loopId == null) return;
  pendingPaceByChat.delete(chat.id);

  const loops = chat.activeLoops;
  if (!loops?.length) return;
  const loop = loops.find((row) => row.id === loopId);
  if (!loop || loop.kind !== 'auto') return;

  const digest = digestLoopOutput(lastAssistantText(chat));
  const previous = loop.lastOutputDigest;
  const outputChanged = previous == null || previous !== digest;
  const currentDelay = clampLoopAutoDelayMs(
    loop.currentDelayMs ?? INITIAL_LOOP_AUTO_DELAY_MS,
  );
  const nextDelay = nextAutoDelayMs(currentDelay, outputChanged);

  const patch: Partial<ActiveLoopState> = {
    currentDelayMs: nextDelay,
    lastOutputDigest: digest,
    dueAt: now + nextDelay,
  };
  updateActiveLoop(chat, loopId, patch);
}
