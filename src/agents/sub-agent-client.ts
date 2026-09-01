/**
 * P8-F — one sub-agent run as a view of the server journal.
 *
 * Locked decision 2 applied to sub-agents: the renderer subscribes, derives,
 * and POSTs commands. It never mutates a run. Reconnection is the browser's
 * (`EventSource` retries with `Last-Event-ID`); a dropped stream costs the
 * tail, not a re-fold from event zero. Live tokens have no `seq` and are
 * never replayed — a reload of a completed run must not paint old tokens.
 */

import { foldInto, emptyState } from '../../server/sub-agents/derive.js';
import type { RunState } from '../../server/sub-agents/types';

/** The bit of EventSource this client uses. Tests inject a fake; Node has none. */
export interface EventStream {
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  close(): void;
}

export interface SubAgentRunClientOptions {
  openStream?: (url: string) => EventStream;
}

export interface EngineError {
  taskId: string | null;
  role: string;
  message: string;
  consecutive: number;
}

export interface DeliverFrame {
  kind: 'completion' | 'check_in_nudge';
  runIds: string[];
  message: string;
}

export interface SubAgentRunClient {
  readonly runId: string;
  getRun(): Record<string, unknown> | null;
  getSeq(): number;
  getEngineError(): EngineError | null;
  getLive(): { phase: string | null; toolName: string | null; thinking: string };
  subscribe(listener: () => void): () => void;
  /** Parent-inject frames. Not journaled; the fold records `result.delivered` after they land. */
  subscribeDeliver(listener: (frame: DeliverFrame) => void): () => void;
  connect(): void;
  close(): void;
}

/**
 * Open a live view of one run. Resume-from-seq matches the board client:
 * `Last-Event-ID` is the last journal `seq`, live frames carry none.
 */
export function createSubAgentRunClient(
  runId: string,
  options: SubAgentRunClientOptions = {},
): SubAgentRunClient {
  const openStream =
    options.openStream ?? ((url: string) => new EventSource(url) as EventStream);

  let raw: Record<string, unknown> | null = null;
  let seq = 0;
  let engineError: EngineError | null = null;
  let livePhase: string | null = null;
  let liveTool: string | null = null;
  let liveThinking = '';
  let source: EventStream | null = null;
  let pending: Record<string, unknown>[] = [];
  const listeners = new Set<() => void>();
  const deliverListeners = new Set<(frame: DeliverFrame) => void>();

  const isTerminalPhase = (phase: unknown): boolean =>
    phase === 'passed' || phase === 'cancelled' || phase === 'abandoned';

  const emit = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch (err) {
        console.error('[agents] run subscriber threw', err);
      }
    }
  };

  const applyEvent = (event: Record<string, unknown>): boolean => {
    const eventSeq = Number(event.seq);
    if (Number.isSafeInteger(eventSeq) && eventSeq <= seq) return false;
    if (event.type === 'attempt.started') engineError = null;
    const state = emptyState();
    if (raw) {
      const existing = foldRun(raw);
      if (existing) {
        state.runs.set(existing.runId, existing);
        state.runOrder = [existing.runId];
        state.parentChatId = existing.parentChatId;
      }
    }
    foldInto(state, [event]);
    const next = state.runs.get(runId);
    if (next) raw = runToRaw(next);
    if (Number.isSafeInteger(eventSeq)) seq = eventSeq;
    return true;
  };

  const drainPending = (): boolean => {
    if (pending.length === 0) return false;
    const queued = pending;
    pending = [];
    let changed = false;
    for (const event of queued) changed = applyEvent(event) || changed;
    return changed;
  };

  const onSnapshot = (event: { data: string }) => {
    try {
      const payload = JSON.parse(event.data);
      const at = Number(payload.seq) || 0;
      if (raw !== null && at < seq) return;
      raw = payload.run && typeof payload.run === 'object' ? payload.run : null;
      seq = at;
      drainPending();
      emit();
    } catch (err) {
      console.error('[agents] could not read the run snapshot', err);
    }
  };

  const onEvent = (event: { data: string }) => {
    try {
      const journalEvent = JSON.parse(event.data);
      if (!raw) {
        pending.push(journalEvent);
        return;
      }
      if (applyEvent(journalEvent)) emit();
    } catch (err) {
      console.error('[agents] could not fold a run event', err);
    }
  };

  const onLive = (event: { data: string }) => {
    try {
      // A reload of a completed run must not paint old tokens — live frames
      // are never journaled, and a terminal fold is proof the attempt is over.
      if (isTerminalPhase(raw?.phase)) return;
      const payload = JSON.parse(event.data) as {
        event?: { type?: string; name?: string; text?: string };
      };
      const inner = payload.event;
      if (!inner?.type) return;
      // Tokens are unbounded; a reconnect must not replay them. Keep only the
      // "what is it doing" signal the cards already show.
      if (inner.type === 'tool_call' || inner.type === 'tool_streaming') {
        livePhase = 'tools';
        liveTool = typeof inner.name === 'string' ? inner.name : liveTool;
        emit();
        return;
      }
      if (inner.type === 'tool_result') {
        liveTool = null;
        livePhase = 'generating';
        emit();
        return;
      }
      if (inner.type === 'thinking') {
        livePhase = 'thinking';
        if (typeof inner.text === 'string') liveThinking = inner.text.slice(-400);
        emit();
      }
    } catch (err) {
      console.error('[agents] could not read a live frame', err);
    }
  };

  const onError = (event: { data: string }) => {
    // Named `event: error` frames carry JSON. A dropped connection also
    // fires `error` with empty data — EventSource reconnects with Last-Event-ID.
    if (typeof event?.data !== 'string' || event.data.length === 0) return;
    try {
      const payload = JSON.parse(event.data) as Partial<EngineError> & { error?: string };
      if (typeof payload.message !== 'string') return;
      engineError = {
        taskId: typeof payload.taskId === 'string' ? payload.taskId : runId,
        role: String(payload.role ?? 'sub-agent'),
        message: payload.message,
        consecutive: Number(payload.consecutive) || 1,
      };
      emit();
    } catch (err) {
      console.error('[agents] could not read an engine error frame', err);
    }
  };

  return {
    runId,
    getRun: () => raw,
    getSeq: () => seq,
    getEngineError: () => engineError,
    getLive: () => ({ phase: livePhase, toolName: liveTool, thinking: liveThinking }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeDeliver(listener) {
      deliverListeners.add(listener);
      return () => deliverListeners.delete(listener);
    },
    connect() {
      if (source) return;
      try {
        source = openStream(`/api/agents/${encodeURIComponent(runId)}/events`);
      } catch (err) {
        // Node / happy-dom have no EventSource. Tests inject `openStream`.
        console.error('[agents] EventSource unavailable', err);
        return;
      }
      source.addEventListener('snapshot', onSnapshot);
      source.addEventListener('event', onEvent);
      source.addEventListener('live', onLive);
      source.addEventListener('error', onError);
      source.addEventListener('deliver', (event: { data: string }) => {
        try {
          const payload = JSON.parse(event.data) as DeliverFrame;
          if (!payload?.message || !Array.isArray(payload.runIds)) return;
          for (const listener of deliverListeners) {
            try {
              listener(payload);
            } catch (err) {
              console.error('[agents] deliver subscriber threw', err);
            }
          }
        } catch (err) {
          console.error('[agents] could not read a deliver frame', err);
        }
      });
      source.addEventListener('error', (event: { data: string }) => {
        if (typeof event?.data === 'string' && event.data.length > 0) return;
        // EventSource reconnects by itself, carrying Last-Event-ID.
      });
    },
    close() {
      source?.close();
      source = null;
    },
  };
}

function foldRun(raw: Record<string, unknown>): RunState | null {
  const runId = typeof raw.runId === 'string' ? raw.runId : '';
  if (!runId) return null;
  return {
    runId,
    type: String(raw.type ?? ''),
    task: String(raw.task ?? ''),
    parentChatId: String(raw.parentChatId ?? ''),
    cwd: String(raw.cwd ?? ''),
    requestedAt: Number.isSafeInteger(raw.requestedAt) ? Number(raw.requestedAt) : null,
    phase: (raw.phase as RunState['phase']) ?? 'idle',
    attempts: Array.isArray(raw.attempts) ? (raw.attempts as RunState['attempts']) : [],
    abandonedReason: typeof raw.abandonedReason === 'string' ? raw.abandonedReason : null,
    abandonedEvidence:
      raw.abandonedEvidence && typeof raw.abandonedEvidence === 'object'
        ? (raw.abandonedEvidence as Record<string, unknown>)
        : null,
    cancelledReason: raw.cancelledReason === 'user' ? 'user' : null,
    delivered: raw.delivered === true,
    deliveredSkipReason:
      raw.deliveredSkipReason === 'missing_chat' || raw.deliveredSkipReason === 'orchestrate'
        ? raw.deliveredSkipReason
        : null,
    nudged: raw.nudged === true,
    parentTurnId: typeof raw.parentTurnId === 'string' ? raw.parentTurnId : null,
    parentToolCallId: typeof raw.parentToolCallId === 'string' ? raw.parentToolCallId : null,
    model:
      raw.model && typeof raw.model === 'object' && !Array.isArray(raw.model)
        ? (raw.model as { providerId: string; id: string })
        : null,
  };
}

function runToRaw(run: RunState): Record<string, unknown> {
  return {
    runId: run.runId,
    type: run.type,
    task: run.task,
    parentChatId: run.parentChatId,
    cwd: run.cwd,
    requestedAt: run.requestedAt,
    phase: run.phase,
    attempts: run.attempts,
    abandonedReason: run.abandonedReason,
    abandonedEvidence: run.abandonedEvidence,
    cancelledReason: run.cancelledReason,
    delivered: run.delivered,
    deliveredSkipReason: run.deliveredSkipReason,
    nudged: run.nudged,
    parentTurnId: run.parentTurnId,
    parentToolCallId: run.parentToolCallId,
    model: run.model,
  };
}
