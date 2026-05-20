/**
 * Shared checkpoint wiring for in-flight assistant turns (feature 22).
 */

import type { Chat, PendingTurn, ToolCall } from '../types';
import type { ThoughtBubbleController } from '../ui/thought-bubbles';
import { buildPendingSnapshot } from '../state/pending-turn-shape';
import {
  clearPendingTurn,
  registerPendingTurnLiveCapture,
  schedulePendingCheckpoint,
  syncPendingTurn,
} from '../state/pending-turn';

/** Mutable state tracked for one assistant send / tool loop. */
export interface TurnCheckpointHandle {
  readonly startedAt: number;
  updateLiveText(text: string): void;
  setToolRound(round: number): void;
  setPhase(phase: PendingTurn['phase']): void;
  setToolCalls(toolCalls: ToolCall[] | undefined): void;
  /** Persist checkpoint when the user stops generation. */
  snapshotStopped(partialText: string, thoughtController: ThoughtBubbleController | null): void;
  /** Remove checkpoint after a normal completion. */
  complete(): void;
  dispose(): void;
}

export function beginTurnCheckpoint(
  chat: Chat,
  opts: {
    startedAt: number;
    modelId: string;
    providerId?: string;
    thoughtController: ThoughtBubbleController | null;
  },
): TurnCheckpointHandle {
  let liveText = '';
  let toolRound = 0;
  let phase: PendingTurn['phase'] = 'streaming';
  let toolCalls: ToolCall[] | undefined;

  const buildSnap = (stopped = false): PendingTurn =>
    buildPendingSnapshot({
      content: liveText,
      thinking: opts.thoughtController?.getSegmentsNormalized(),
      toolCalls,
      startedAt: opts.startedAt,
      modelId: opts.modelId,
      providerId: opts.providerId,
      toolRound,
      phase,
      stopped: stopped || undefined,
    });

  registerPendingTurnLiveCapture(() => buildSnap());

  syncPendingTurn(chat, buildSnap(), { immediate: true });

  return {
    startedAt: opts.startedAt,
    updateLiveText(text: string): void {
      liveText = text;
      schedulePendingCheckpoint(chat, buildSnap());
    },
    setToolRound(round: number): void {
      toolRound = round;
      schedulePendingCheckpoint(chat, buildSnap());
    },
    setPhase(next: PendingTurn['phase']): void {
      phase = next;
      schedulePendingCheckpoint(chat, buildSnap());
    },
    setToolCalls(calls: ToolCall[] | undefined): void {
      toolCalls = calls?.length ? calls : undefined;
      schedulePendingCheckpoint(chat, buildSnap());
    },
    snapshotStopped(
      partialText: string,
      thoughtController: ThoughtBubbleController | null,
    ): void {
      liveText = partialText;
      const snap = buildPendingSnapshot({
        content: partialText,
        thinking: thoughtController?.getSegmentsNormalized(),
        toolCalls,
        startedAt: opts.startedAt,
        modelId: opts.modelId,
        providerId: opts.providerId,
        toolRound,
        phase,
        stopped: true,
      });
      syncPendingTurn(chat, snap, { immediate: true });
    },
    complete(): void {
      clearPendingTurn(chat);
    },
    dispose(): void {
      registerPendingTurnLiveCapture(null);
    },
  };
}
