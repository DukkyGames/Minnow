/**
 * Pure detectors for Orchestrate supervisor rules (R1–R10).
 */

import type { SubAgentRun } from '../types.ts';
import type { BoardTask, Chat, OrchestrateBoardState } from '../../types.ts';
import { detectRepetition, type ToolCallLogEntry } from '../self-healing/detector.ts';
import { isSubAgentRunSuccessful } from '../sub-agent-outcome.ts';
import { getSupervisorConfigSnapshot } from './config.ts';
import type { SupervisorChatState } from './state.ts';
import { getInProgressNoRunSince, getRunHealth } from './state.ts';

/** Default idle time after last sub-agent terminal event before auto-resume (tests + fallback). */
export const ORCHESTRATE_WATCHDOG_STALL_MS = 30_000;

/** Max watchdog auto-resume injections per board task (matches historical watchdog export). */
export const ORCHESTRATE_WATCHDOG_MAX_RETRIES_PER_TASK = 3;

export interface OrchestrateWatchdogDeps {
  nowMs: () => number;
  isChatStreaming: (chatId: string) => boolean;
  listActiveSubAgentRuns: () => SubAgentRun[];
  getActiveChat: () => Chat;
  /** When set, overrides `getSupervisorConfigSnapshot().stallMs` for R8. */
  stallMs?: number;
}

export interface StallEvaluation {
  stalled: boolean;
  /** First incomplete task that blocks progress (for retry budget). */
  blockingTaskId: string | null;
  retriesExhausted: boolean;
}

function isTerminalStatus(status: SubAgentRun['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function activeRunsForChat(chatId: string, runs: SubAgentRun[]): SubAgentRun[] {
  return runs.filter(
    (r) =>
      r.parentChatId === chatId &&
      (r.status === 'queued' || r.status === 'running'),
  );
}

function hasIncompleteTasks(board: OrchestrateBoardState): boolean {
  return board.tasks.some((t) => t.status !== 'complete');
}

function findBlockingTask(board: OrchestrateBoardState): BoardTask | null {
  const order = ['failed', 'blocked', 'in_progress', 'testing', 'planned'] as const;
  for (const status of order) {
    const hit = board.tasks.find((t) => t.status === status);
    if (hit) return hit;
  }
  return null;
}

/**
 * Pure stall detector for tests and the live tick loop (R8).
 * Uses `deps.stallMs` or the loaded supervisor `stallMs` (defaults to 30s).
 */
export function evaluateOrchestrateStall(
  board: OrchestrateBoardState,
  chatId: string,
  lastTerminalAt: number | undefined,
  deps: OrchestrateWatchdogDeps,
): StallEvaluation {
  const empty: StallEvaluation = {
    stalled: false,
    blockingTaskId: null,
    retriesExhausted: false,
  };

  if (!hasIncompleteTasks(board)) return empty;

  const active = activeRunsForChat(chatId, deps.listActiveSubAgentRuns());
  if (active.length > 0) return empty;

  if (deps.isChatStreaming(chatId)) return empty;

  if (lastTerminalAt == null || lastTerminalAt <= 0) return empty;

  const blocking = findBlockingTask(board);
  if (!blocking) return empty;

  const maxRetries = getSupervisorConfigSnapshot().maxRetriesPerTask;

  const retryCount = blocking.retryCount ?? 0;
  const retriesExhausted = retryCount >= maxRetries;
  const idleMs = deps.nowMs() - lastTerminalAt;
  const stallWindow =
    typeof deps.stallMs === 'number'
      ? deps.stallMs
      : getSupervisorConfigSnapshot().stallMs ?? ORCHESTRATE_WATCHDOG_STALL_MS;
  if (idleMs < stallWindow) {
    return { stalled: false, blockingTaskId: blocking.id, retriesExhausted };
  }

  return {
    stalled: true,
    blockingTaskId: blocking.id,
    retriesExhausted,
  };
}

export type SupervisorRuleId =
  | 'R1'
  | 'R2'
  | 'R3'
  | 'R4'
  | 'R5'
  | 'R6'
  | 'R7'
  | 'R8'
  | 'R9'
  | 'R10';

export interface DetectorHit {
  rule: SupervisorRuleId;
  /** Rule-specific payload for actions / escalation. */
  payload?: Record<string, unknown>;
}

export { detectRepetition, type ToolCallLogEntry };

export interface DetectorContext {
  nowMs: number;
  cfg: import('./defaults.ts').SupervisorConfig;
  chat: Chat;
  board: OrchestrateBoardState;
  sup: SupervisorChatState;
  listRuns: () => SubAgentRun[];
  isStreaming: (chatId: string) => boolean;
}

/** R9: any configured cap exhausted (budgets). */
export function detectBudgetExhausted(ctx: DetectorContext): DetectorHit | null {
  const { board, cfg, chat, sup, listRuns } = ctx;
  const blocking = findBlockingTask(board);
  if (!blocking) return null;

  if ((blocking.retryCount ?? 0) >= cfg.maxRetriesPerTask) {
    return { rule: 'R9', payload: { reason: 'task_retries', taskId: blocking.id } };
  }

  if (sup.llmEscalationsThisSession >= cfg.llmEscalationsPerSession) {
    return { rule: 'R9', payload: { reason: 'llm_escalations_cap' } };
  }

  for (const t of board.tasks) {
    const spawns = sup.spawnCountByTaskId.get(t.id) ?? 0;
    if (spawns >= cfg.spawnCapPerTask) {
      return { rule: 'R9', payload: { reason: 'spawn_cap', taskId: t.id } };
    }
  }

  for (const r of listRuns()) {
    if (r.parentChatId !== chat.id) continue;
    if (r.status !== 'running' && r.status !== 'queued') continue;
    const h = getRunHealth(r.runId);
    const restartCap = Math.max(cfg.runRestartCap, cfg.repetition.maxRestartsPerRun);
    if (h.restartCount >= restartCap) {
      return { rule: 'R9', payload: { reason: 'run_restart_cap', runId: r.runId } };
    }
  }

  return null;
}

/** R6: task in progress with no assigned run for too long. */
export function detectInProgressWithoutRun(ctx: DetectorContext): DetectorHit | null {
  const { board, cfg, chat, nowMs } = ctx;
  for (const t of board.tasks) {
    if (t.status !== 'in_progress') continue;
    if (t.assignedRunId?.trim()) continue;
    const since = getInProgressNoRunSince(chat.id, t.id);
    if (since == null) continue;
    if (nowMs - since >= cfg.inProgressNoRunMs) {
      return { rule: 'R6', payload: { taskId: t.id } };
    }
  }
  return null;
}

/** R5: spawn failed or run stuck queued. */
export function detectSpawnStuck(ctx: DetectorContext): DetectorHit | null {
  const { cfg, chat, nowMs, listRuns } = ctx;
  for (const r of listRuns()) {
    if (r.parentChatId !== chat.id) continue;
    if (r.status === 'failed') {
      return { rule: 'R5', payload: { runId: r.runId, kind: 'failed' } };
    }
    if (r.status === 'queued') {
      const h = getRunHealth(r.runId);
      const since = h.queuedSinceAt ?? nowMs;
      if (nowMs - since >= cfg.spawnStuckMs) {
        return { rule: 'R5', payload: { runId: r.runId, kind: 'queued' } };
      }
    }
  }
  return null;
}

/** R7: no status report and no orchestrator progress within heartbeat window. */
export function detectMissedOrchestratorHeartbeat(ctx: DetectorContext): DetectorHit | null {
  const { board, cfg, nowMs, sup } = ctx;
  const reportRef = sup.lastReportAt ?? board.startedAt;
  const progressRef = Math.max(
    sup.lastOrchestratorProgressAt ?? board.startedAt,
    reportRef,
  );
  if (nowMs - reportRef < cfg.orchestratorHeartbeatMs) return null;
  if (nowMs - progressRef < cfg.orchestratorHeartbeatMs) return null;
  return { rule: 'R7' };
}

/** R4: stream ended after a parent tool result, still silent. */
export function detectParentSilenceAfterTool(ctx: DetectorContext): DetectorHit | null {
  const { cfg, chat, nowMs, sup, isStreaming } = ctx;
  if (isStreaming(chat.id)) return null;
  const end = sup.lastParentStreamEndedAt;
  const toolAt = sup.lastParentToolResultAt;
  if (end == null || toolAt == null) return null;
  if (toolAt > end) return null;
  if (nowMs - end < cfg.parentSilenceAfterToolMs) return null;
  return { rule: 'R4' };
}

/** R1: running sub-agent with no tool calls for too long. */
export function detectSubAgentToolSilence(ctx: DetectorContext): DetectorHit | null {
  const { cfg, chat, nowMs, listRuns } = ctx;
  for (const r of listRuns()) {
    if (r.parentChatId !== chat.id) continue;
    if (r.status !== 'running') continue;
    const h = getRunHealth(r.runId);
    const startedMs = Date.parse(r.startedAt ?? '');
    const lastTool =
      h.lastToolCallAt ??
      (Number.isFinite(startedMs) && startedMs > 0 ? startedMs : nowMs);
    if (nowMs - lastTool >= cfg.subAgentToolSilenceMs) {
      return { rule: 'R1', payload: { runId: r.runId } };
    }
  }
  return null;
}

/** R3: repetition in nested tool log (delegates to self-healing heuristic). */
export function detectSubAgentRepetition(
  log: ToolCallLogEntry[],
  thresholds: { duplicateToolCallThreshold: number; sameErrorThreshold: number },
): ReturnType<typeof detectRepetition> {
  return detectRepetition(log, thresholds);
}

/** R2: completed successful run with empty summary (immediate on terminal). */
export function detectEmptyCompletedSummary(run: SubAgentRun): DetectorHit | null {
  if (run.status !== 'completed') return null;
  if (!isSubAgentRunSuccessful(run)) return null;
  if (run.summary != null && String(run.summary).trim().length > 0) return null;
  return { rule: 'R2', payload: { runId: run.runId, boardTaskId: run.boardTaskId } };
}

/** R10: ambiguous / low-confidence orchestrator report. */
export function detectAmbiguousReport(ctx: DetectorContext): DetectorHit | null {
  const last = ctx.sup.lastReport;
  if (!last) return null;
  if (typeof last.confidence === 'number' && last.confidence < 0.5) {
    return { rule: 'R10', payload: { confidence: last.confidence } };
  }
  return null;
}
