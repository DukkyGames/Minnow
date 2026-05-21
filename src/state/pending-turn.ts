/**
 * Checkpoint in-flight assistant turns to session storage (feature 22).
 */

import { streaming } from '../app-state';
import { getStreamingChatId } from '../chat/streaming-state';
import type { Chat, PendingTurn } from '../types';
import {
  buildPendingSnapshot,
  clearStalePendingTurn,
  clearStalePendingTurnsOnLoad,
  CONTINUE_INTERRUPTED_INSTRUCTION,
  ensurePendingTurn,
  isPendingTurnObsolete,
  isUserStoppedPendingCheckpoint,
  shouldOfferRecovery,
} from './pending-turn-shape';
import {
  findChatById,
  getActiveChat,
  saveSessionsNow,
  scheduleSaveSessions,
  sessionState,
  touchChat,
} from './sessions';

export {
  buildPendingSnapshot,
  clearStalePendingTurn,
  clearStalePendingTurnsOnLoad,
  CONTINUE_INTERRUPTED_INSTRUCTION,
  ensurePendingTurn,
  isPendingTurnObsolete,
  isUserStoppedPendingCheckpoint,
  shouldOfferRecovery,
};

/** Debounce interval for mid-stream checkpoints (faster than session SAVE_DEBOUNCE_MS). */
const PENDING_CHECKPOINT_DEBOUNCE_MS = 150;

let checkpointTimer: ReturnType<typeof setTimeout> | null = null;
let liveCapture: (() => PendingTurn | null) | null = null;

/** Loop registers a snapshot builder while streaming; cleared in finally. */
export function registerPendingTurnLiveCapture(
  fn: (() => PendingTurn | null) | null,
): void {
  liveCapture = fn;
}

export interface SyncPendingTurnOptions {
  /** Persist immediately (pagehide flush). */
  immediate?: boolean;
}

/** Assign pendingTurn on the chat and schedule or run persistence. */
export function syncPendingTurn(
  chat: Chat,
  snapshot: PendingTurn,
  options?: SyncPendingTurnOptions,
): void {
  chat.pendingTurn = snapshot;
  if (!sessionState) return;
  touchChat(chat);
  if (options?.immediate) {
    if (checkpointTimer) {
      clearTimeout(checkpointTimer);
      checkpointTimer = null;
    }
    saveSessionsNow();
    return;
  }
  scheduleSaveSessions();
}

/** Remove pending turn and persist. */
export function clearPendingTurn(chat: Chat): void {
  if (chat.pendingTurn == null) return;
  chat.pendingTurn = undefined;
  touchChat(chat);
  scheduleSaveSessions();
}

/** Debounced checkpoint during streaming (coalesces into one session save). */
export function schedulePendingCheckpoint(chat: Chat, snapshot: PendingTurn): void {
  if (checkpointTimer) clearTimeout(checkpointTimer);
  checkpointTimer = setTimeout(() => {
    checkpointTimer = null;
    syncPendingTurn(chat, snapshot);
  }, PENDING_CHECKPOINT_DEBOUNCE_MS);
}

/** Flush live capture + synchronous session write (pagehide / visibility). */
export function flushPendingTurnNow(): void {
  if (streaming && liveCapture) {
    const snap = liveCapture();
    const streamChatId = getStreamingChatId();
    const streamChat = streamChatId ? findChatById(streamChatId) : undefined;
    if (snap && streamChat) {
      syncPendingTurn(streamChat, snap, { immediate: true });
      return;
    }
  }
  saveSessionsNow();
}

/** Active chat id while recovery UI blocks composer send. */
let recoveryBlockedChatId: string | null = null;

export function setRecoveryBlockedChatId(chatId: string | null): void {
  recoveryBlockedChatId = chatId;
}

export function isComposerBlockedForRecovery(): boolean {
  if (!recoveryBlockedChatId) return false;
  return getActiveChat().id === recoveryBlockedChatId;
}

/** Module-level Continue instruction for buildApiMessages (one shot). */
let continueInstructionForNextSend: string | null = null;

export function setContinueInstructionForNextSend(text: string | null): void {
  continueInstructionForNextSend = text;
}

export function consumeContinueInstructionForNextSend(): string | null {
  const v = continueInstructionForNextSend;
  continueInstructionForNextSend = null;
  return v;
}

let armPendingContinueSend = false;

/** Next send resumes from pendingTurn instead of composer input. */
export function requestContinueFromPendingTurn(): void {
  armPendingContinueSend = true;
  setContinueInstructionForNextSend(CONTINUE_INTERRUPTED_INSTRUCTION);
}

export function consumePendingContinueSend(): boolean {
  const v = armPendingContinueSend;
  armPendingContinueSend = false;
  return v;
}

export function findChatWithPendingTurn(chatId: string): Chat | undefined {
  return findChatById(chatId);
}
