/**
 * Publish compact live sub-agent run snapshots onto SessionState for Phase 0 SSE
 * (MIN-361 Phase 3). Engine host only — renderers read the slice as a read-model.
 */

import type { LiveSubAgentRunSnapshot, SessionState } from '../../types.ts';
import type { SubAgentRun } from '../types.ts';
import { listActiveSubAgentRuns, getSubAgentRun } from './registry.ts';
import { subscribeSubAgentRuns } from '../sub-agent-events.ts';

const STATUS_PREVIEW_MAX = 480;
/** Coalesce rapid heartbeat/tool ticks into one soft SSE publish. */
const PUBLISH_COALESCE_MS = 120;

let publishHook: ((soft: boolean) => Promise<void>) | null = null;
let unsubscribe: (() => void) | null = null;
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
let publishQueued = false;

/** Last non-system message preview for remote card/status UIs. */
function lastNonSystemPreview(messages: SubAgentRun['messages']): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; content?: unknown };
    if (!m || m.role === 'system') continue;
    let text = '';
    if (m.role === 'user' || m.role === 'assistant') {
      const c = m.content;
      if (typeof c === 'string') text = c;
      else if (c != null) text = JSON.stringify(c);
    } else if (m.role === 'tool') {
      text = typeof m.content === 'string' ? String(m.content) : '';
    }
    const t = text.trim();
    if (!t) continue;
    return t.length > STATUS_PREVIEW_MAX ? `${t.slice(0, STATUS_PREVIEW_MAX)}…` : t;
  }
  return '';
}

/** Compact wire snapshot (no full transcript — keeps SSE payloads bounded). */
export function toLiveSubAgentRunSnapshot(run: SubAgentRun): LiveSubAgentRunSnapshot {
  return {
    runId: run.runId,
    type: run.type,
    task: run.task,
    status: run.status,
    ...(run.lifecycle ? { lifecycle: run.lifecycle } : {}),
    parentChatId: run.parentChatId,
    parentTurnId: run.parentTurnId,
    parentToolCallId: run.parentToolCallId,
    summary: run.summary,
    ...(run.error != null ? { error: run.error } : {}),
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    toolTurns: run.toolTurns,
    cancelled: run.cancelled,
    ...(run.liveNestedToolCalls != null
      ? { liveNestedToolCalls: run.liveNestedToolCalls }
      : {}),
    ...(run.liveCurrentToolName
      ? { liveCurrentToolName: run.liveCurrentToolName }
      : {}),
    ...(run.progressSeq != null ? { progressSeq: run.progressSeq } : {}),
    ...(run.lastHeartbeatAt != null ? { lastHeartbeatAt: run.lastHeartbeatAt } : {}),
    ...(run.lastProgressAt != null ? { lastProgressAt: run.lastProgressAt } : {}),
    ...(run.attempt != null ? { attempt: run.attempt } : {}),
    ...(run.modelId ? { modelId: run.modelId } : {}),
    ...(run.providerId ? { providerId: run.providerId } : {}),
    ...(run.category ? { category: run.category } : {}),
    ...(run.boardTaskId !== undefined ? { boardTaskId: run.boardTaskId } : {}),
    ...(run.supersededByRunId ? { supersededByRunId: run.supersededByRunId } : {}),
    lastMessagePreview: lastNonSystemPreview(run.messages),
  };
}

/** Rebuild SessionState.liveSubAgentRuns from the in-process registry. */
export function rebuildLiveSubAgentRunsOnState(state: SessionState): void {
  const active = listActiveSubAgentRuns();
  // Keep recently settled rows briefly so remote UIs see terminal transitions.
  const byId = new Map<string, LiveSubAgentRunSnapshot>();
  for (const run of active) {
    byId.set(run.runId, toLiveSubAgentRunSnapshot(run));
  }
  for (const prev of state.liveSubAgentRuns ?? []) {
    if (byId.has(prev.runId)) continue;
    if (prev.status === 'queued' || prev.status === 'running') continue;
    // Drop terminals after they land on chat.subAgentRuns (or after a short window).
    const endedMs = prev.endedAt ? Date.parse(prev.endedAt) : NaN;
    if (Number.isFinite(endedMs) && Date.now() - endedMs > 60_000) continue;
    const live = getSubAgentRun(prev.runId);
    byId.set(prev.runId, live ? toLiveSubAgentRunSnapshot(live) : prev);
  }
  state.liveSubAgentRuns = [...byId.values()].sort((a, b) =>
    String(a.startedAt ?? '').localeCompare(String(b.startedAt ?? '')),
  );
}

/** Wire the engine soft-publish path (board/controller host). */
export function setLiveSubAgentPublishHook(
  hook: ((soft: boolean) => Promise<void>) | null,
): void {
  publishHook = hook;
}

function scheduleLivePublish(): void {
  publishQueued = true;
  if (coalesceTimer) return;
  coalesceTimer = setTimeout(() => {
    coalesceTimer = null;
    if (!publishQueued) return;
    publishQueued = false;
    void flushLivePublish();
  }, PUBLISH_COALESCE_MS);
}

async function flushLivePublish(): Promise<void> {
  if (!publishHook) return;
  try {
    const { getEngineSessionState } = await import(
      '../../../server/session/engine-api.js'
    );
    const state = getEngineSessionState() as SessionState | null;
    if (!state || typeof state !== 'object') return;
    rebuildLiveSubAgentRunsOnState(state);
    await publishHook(true);
  } catch (err) {
    console.warn('[controller:live-publish] soft publish failed', err);
  }
}

/** Subscribe once: mirror registry updates onto SessionState + SSE. */
export function startLiveSubAgentPublish(): void {
  if (unsubscribe) return;
  unsubscribe = subscribeSubAgentRuns(() => {
    scheduleLivePublish();
  });
  // Initial snapshot so reconnecting clients see in-flight runs.
  scheduleLivePublish();
}

/** Tear down live publish (tests / host deactivate). */
export function stopLiveSubAgentPublish(): void {
  unsubscribe?.();
  unsubscribe = null;
  if (coalesceTimer) {
    clearTimeout(coalesceTimer);
    coalesceTimer = null;
  }
  publishQueued = false;
  publishHook = null;
}

/** Test helper: force an immediate live publish flush. */
export async function flushLiveSubAgentPublishForTests(): Promise<void> {
  if (coalesceTimer) {
    clearTimeout(coalesceTimer);
    coalesceTimer = null;
  }
  publishQueued = false;
  await flushLivePublish();
}
