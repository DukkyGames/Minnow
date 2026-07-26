/**
 * Renderer-side mirror of engine-published liveSubAgentRuns (MIN-361 Phase 3).
 *
 * When MINNOW_SERVER_ENGINE is on, the local controller registry is empty —
 * UI cards / drawers read this slice (hydrated via Phase 0 session SSE) and
 * subscribeSubAgentRuns is fed from remote patches.
 */

import { emitSubAgentRunUpdated } from '../sub-agent-events.ts';
import type { SubAgentRun } from '../types.ts';
import type { LiveSubAgentRunSnapshot, SessionState } from '../../types.ts';
import { isServerEngineEnabled } from '../../state/server-engine-flag.ts';

let lastFingerprints = new Map<string, string>();

/** Convert a compact SSE snapshot into a SubAgentRun-shaped read model. */
export function liveSnapshotToSubAgentRun(
  snap: LiveSubAgentRunSnapshot,
): SubAgentRun {
  const preview = snap.lastMessagePreview?.trim();
  return {
    runId: snap.runId,
    type: snap.type,
    task: snap.task,
    status: snap.status as SubAgentRun['status'],
    lifecycle: snap.lifecycle as SubAgentRun['lifecycle'],
    parentChatId: snap.parentChatId ?? null,
    parentToolCallId: snap.parentToolCallId ?? null,
    parentTurnId: snap.parentTurnId ?? null,
    summary: snap.summary ?? '',
    error: snap.error ?? null,
    startedAt: snap.startedAt ?? null,
    endedAt: snap.endedAt ?? null,
    toolTurns: snap.toolTurns ?? 0,
    cancelled: snap.cancelled === true || snap.status === 'cancelled',
    // Full transcripts stay engine-local until terminal persist onto chat.subAgentRuns.
    messages: preview
      ? [{ role: 'assistant', content: preview }]
      : [],
    ...(snap.liveNestedToolCalls != null
      ? { liveNestedToolCalls: snap.liveNestedToolCalls }
      : {}),
    ...(snap.liveCurrentToolName
      ? { liveCurrentToolName: snap.liveCurrentToolName }
      : {}),
    ...(snap.progressSeq != null ? { progressSeq: snap.progressSeq } : {}),
    ...(snap.lastHeartbeatAt != null
      ? { lastHeartbeatAt: snap.lastHeartbeatAt }
      : {}),
    ...(snap.lastProgressAt != null
      ? { lastProgressAt: snap.lastProgressAt }
      : {}),
    ...(snap.attempt != null ? { attempt: snap.attempt } : {}),
    ...(snap.modelId ? { modelId: snap.modelId } : {}),
    ...(snap.providerId ? { providerId: snap.providerId } : {}),
    ...(snap.category ? { category: snap.category } : {}),
    ...(snap.boardTaskId !== undefined ? { boardTaskId: snap.boardTaskId } : {}),
    ...(snap.supersededByRunId
      ? { supersededByRunId: snap.supersededByRunId }
      : {}),
  };
}

function fingerprint(snap: LiveSubAgentRunSnapshot): string {
  return [
    snap.status,
    snap.lifecycle ?? '',
    snap.toolTurns,
    snap.progressSeq ?? 0,
    snap.liveNestedToolCalls ?? 0,
    snap.liveCurrentToolName ?? '',
    snap.summary ?? '',
    snap.error ?? '',
    snap.lastMessagePreview ?? '',
    snap.endedAt ?? '',
  ].join('|');
}

/**
 * After a remote SessionState apply, notify UI subscribers of changed live runs.
 * No-op when the engine flag is off (local registry remains authoritative).
 */
export function mirrorRemoteLiveSubAgentRuns(state: SessionState | null): void {
  if (!isServerEngineEnabled()) return;
  if (!state) return;

  const next = state.liveSubAgentRuns ?? [];
  const nextIds = new Set(next.map((r) => r.runId));
  const nextFingerprints = new Map<string, string>();

  for (const snap of next) {
    const fp = fingerprint(snap);
    nextFingerprints.set(snap.runId, fp);
    if (lastFingerprints.get(snap.runId) === fp) continue;
    emitSubAgentRunUpdated(liveSnapshotToSubAgentRun(snap));
  }

  // Emit a cancelled stub when a live row disappears without a terminal fingerprint.
  for (const [runId, fp] of lastFingerprints) {
    if (nextIds.has(runId)) continue;
    if (fp.includes('completed') || fp.includes('failed') || fp.includes('cancelled')) {
      continue;
    }
    emitSubAgentRunUpdated({
      runId,
      type: 'generalPurpose',
      task: '',
      status: 'cancelled',
      parentChatId: null,
      parentToolCallId: null,
      parentTurnId: null,
      summary: '',
      error: 'evicted',
      startedAt: null,
      endedAt: new Date().toISOString(),
      toolTurns: 0,
      cancelled: true,
      messages: [],
    });
  }

  lastFingerprints = nextFingerprints;
}

/** @internal */
export function resetClientLiveMirrorForTests(): void {
  lastFingerprints = new Map();
}
