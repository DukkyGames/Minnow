/**
 * Sub-agent controller: spawn, cancel, execute, settle, and parent-facing status helpers.
 * (Formerly monolithic orchestrator.ts — MIN-140 Phase 0 split.)
 */

import { normalizeModeId } from '../../chat/modes/types';
import { getBoardGroupForChat } from '../../state/chat-groups';
import { appendTaskRunHistory, updateTask } from '../../state/orchestrate-board-store';
import { findChatById } from '../../state/sessions';
import { executeTool, getEnabledToolDefinitionsForMode } from '../../tools/client';
import { loadSubAgentConfig } from '../sub-agent-config';
import { buildSubAgentSystemPrompt } from '../sub-agent-prompt';
import { createSubAgentRunId } from '../sub-agent-run-id';
import { getSubAgentsMaxToolTurns } from '../sub-agent-config';
import {
  isContextBudgetFailure,
  isMaxToolTurnFailure,
  isSubAgentRunTerminal,
  SUB_AGENT_CONTEXT_BUDGET_ERROR,
  SUB_AGENT_MAX_TOOL_TURNS_ERROR,
} from '../sub-agent-outcome';
import {
  legacyOutcomeFromSummary,
  type SubAgentStructuredOutcome,
} from '../sub-agent-structured-outcome';
import {
  agentContextBudgetFromSubAgentType,
  DEFAULT_CONTEXT_ENFORCEMENT_POLICY,
} from '../../chat/context-budget';
import { cloneSubAgentMessages, defaultSubAgentRunner, getSubAgentRunner } from '../sub-agent-runner';
import { resolveSubAgentModelBinding } from '../resolve-sub-agent-binding';
import { resolveSubAgentTools } from '../sub-agent-tools';
import { clearSubAgentRunListeners, emitSubAgentRunUpdated } from '../sub-agent-events';
import type { ApiMessage } from '../../types';
import type {
  AggregateResult,
  CancelSubAgentResult,
  SpawnSubAgentInput,
  SpawnSubAgentResult,
  SubAgentRun,
  SubAgentStatus,
  SubAgentTerminalReason,
} from '../types';
import {
  associateParentChat,
  associateParentTurn,
  clearRegistry,
  clearTimeoutFor,
  deleteParentTurnIndex,
  forEachRunInternals,
  getParentTurnRunIds,
  getRunInternals,
  getSubAgentRun,
  listActiveSubAgentRuns,
  listSubAgentRunsForParentChat,
  listSubAgentRunsForParentTurn,
  registerRun,
} from './registry';
import {
  acquireConcurrencySlot,
  canStart,
  clearScheduler,
  drainQueue,
  enqueueRun,
  releaseConcurrencySlot,
  removeFromQueue,
  setQueueDispatch,
  setQueueFail,
} from './scheduler';
import { observeSubAgentToolCall } from './watchdog';
import type { RunInternals } from './types';

const AGGREGATE_MAX_BYTES = 32 * 1024;
const STATUS_PREVIEW_MAX = 480;

/** Register scheduler callbacks once at module load. */
setQueueDispatch((internals, modeId) => {
  launchExecuteRun(internals, modeId);
});
setQueueFail((internals, message) => {
  settleRun(internals, 'failed', '', message);
});

function nowIso(): string {
  return new Date().toISOString();
}

function setStatus(run: SubAgentRun, status: SubAgentStatus): void {
  run.status = status;
  if (status === 'cancelled') run.cancelled = true;
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Classify terminal run outcome for parent orchestration tools. */
export function deriveSubAgentTerminalReason(
  run: SubAgentRun,
): SubAgentTerminalReason | undefined {
  if (
    run.status !== 'completed' &&
    run.status !== 'failed' &&
    run.status !== 'cancelled'
  ) {
    return undefined;
  }
  if (run.status === 'cancelled') return 'cancelled';
  if (isMaxToolTurnFailure(run.summary, run.error)) return 'max_tool_turns';
  if (isContextBudgetFailure(run.error)) return 'context_budget';
  if (run.status === 'failed') return 'failed';
  return 'success';
}

/** Parent-facing outcome (structured or legacy prose fallback on settled runs only). */
function outcomeForRun(run: SubAgentRun): SubAgentStructuredOutcome | null {
  if (run.structuredOutcome) return run.structuredOutcome;
  if (!isSubAgentRunTerminal(run.status)) return null;
  return legacyOutcomeFromSummary(run.summary);
}

/** Cap finding detail and counts before serializing to parent JSON (~32 KB). */
function trimOutcomeForAggregate(outcome: SubAgentStructuredOutcome): SubAgentStructuredOutcome {
  const maxDetail = 500;
  const summary =
    outcome.summary.length > 2000
      ? `${outcome.summary.slice(0, 2000)}…`
      : outcome.summary;
  return {
    summary,
    findings: outcome.findings.slice(0, 20).map((f) => ({
      ...f,
      detail:
        f.detail.length > maxDetail ? `${f.detail.slice(0, maxDetail)}…` : f.detail,
    })),
    artifacts: outcome.artifacts.slice(0, 20),
  };
}

/** Serialize aggregate JSON for parent tool result (32 KB cap). */
export function formatAggregateResult(result: AggregateResult): string {
  let json = JSON.stringify(result, null, 2);
  if (utf8ByteLength(json) <= AGGREGATE_MAX_BYTES) {
    return json;
  }
  const suffix = '\n…[truncated]';
  while (utf8ByteLength(json + suffix) > AGGREGATE_MAX_BYTES && json.length > 0) {
    json = json.slice(0, Math.floor(json.length * 0.9));
  }
  return json + suffix;
}

/** Build aggregate payload from a settled run. */
export function buildAggregateResult(run: SubAgentRun): AggregateResult {
  const outcome = trimOutcomeForAggregate(
    outcomeForRun(run) ?? legacyOutcomeFromSummary(run.summary),
  );
  const out: AggregateResult = {
    runId: run.runId,
    type: run.type,
    status: run.status,
    summary: outcome.summary,
    outcome,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    toolTurns: run.toolTurns,
    cancelled: run.cancelled,
  };
  if (run.error) out.error = run.error;
  const terminalReason = deriveSubAgentTerminalReason(run);
  if (terminalReason) out.terminalReason = terminalReason;
  if (run.budgetEvents?.length) {
    const lastEstimate = run.budgetEvents[run.budgetEvents.length - 1]?.estimatedTokens;
    out.contextBudget = {
      maxInputTokens: run.contextBudgetMaxInputTokens ?? 0,
      estimatedInputTokens: lastEstimate ?? 0,
      policy: run.contextBudgetPolicy ?? DEFAULT_CONTEXT_ENFORCEMENT_POLICY,
      events: run.budgetEvents.map((e) => e.label),
    };
  }
  return out;
}

function settleRun(
  internals: RunInternals,
  status: SubAgentStatus,
  summary: string,
  error: string | null,
): void {
  const { run } = internals;
  setStatus(run, status);
  run.summary = summary;
  run.error = error;
  run.endedAt = nowIso();
  run.liveNestedToolCalls = undefined;
  run.liveCurrentToolName = undefined;
  clearTimeoutFor(internals);
  releaseConcurrencySlot(internals);
  internals.queued = false;
  drainQueue();
  emitSubAgentRunUpdated(run);
  syncBoardTaskOnSettle(run, status, error);
}

/** Map terminal sub-agent status onto linked board task. */
function syncBoardTaskOnSettle(
  run: SubAgentRun,
  status: SubAgentStatus,
  error: string | null,
): void {
  const taskId = run.boardTaskId;
  const chatId = run.parentChatId;
  if (!taskId || !chatId) return;
  const chat = findChatById(chatId);
  const group = chat ? getBoardGroupForChat(chat) : undefined;
  if (!chat || !group?.orchestrateBoard) return;

  const endedAt = Date.now();
  const maxTurnFailure =
    status === 'completed' && isMaxToolTurnFailure(run.summary, error);

  const settlePatch = {
    lastRunId: run.runId,
    assignedRunId: null as string | null,
  };

  if (status === 'completed' && !maxTurnFailure) {
    updateTask(group, taskId, {
      endedAt,
      ...settlePatch,
    }, chat);
    return;
  }
  if (status === 'failed' || status === 'cancelled' || maxTurnFailure) {
    updateTask(group, taskId, {
      status: 'failed',
      endedAt,
      error:
        error ||
        (maxTurnFailure
          ? SUB_AGENT_MAX_TOOL_TURNS_ERROR
          : status === 'cancelled'
            ? 'cancelled'
            : 'failed'),
      ...settlePatch,
    }, chat);
  }
}

/** Push a transcript snapshot to the run row and notify UI subscribers. */
function publishRunMessages(run: SubAgentRun, messages: ApiMessage[]): void {
  run.messages = cloneSubAgentMessages(messages);
  emitSubAgentRunUpdated(run);
}

function launchExecuteRun(internals: RunInternals, modeId: string): void {
  void executeRun(internals, modeId).catch((err) => {
    const { run } = internals;
    if (
      run.status === 'completed' ||
      run.status === 'failed' ||
      run.status === 'cancelled'
    ) {
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    settleRun(internals, 'failed', '', message);
  });
}

async function executeRun(internals: RunInternals, modeId: string): Promise<void> {
  const { run, abort } = internals;

  try {
    const config = await loadSubAgentConfig();
    const typeConfig = config.types[run.type];
    if (!typeConfig) {
      settleRun(internals, 'failed', '', `Unknown sub-agent type: ${run.type}`);
      return;
    }

    setStatus(run, 'running');
    if (!run.startedAt) run.startedAt = nowIso();
    emitSubAgentRunUpdated(run);

    const parentChat = run.parentChatId ? findChatById(run.parentChatId) : undefined;
    const { providerId, modelId } = resolveSubAgentModelBinding(typeConfig, parentChat);
    if (
      !modelId.trim() &&
      getSubAgentRunner() === defaultSubAgentRunner
    ) {
      settleRun(
        internals,
        'failed',
        '',
        'No model selected for sub-agent (configure type or parent chat model)',
      );
      return;
    }
    run.providerId = providerId;
    run.modelId = modelId;
    emitSubAgentRunUpdated(run);

    const parentTools = getEnabledToolDefinitionsForMode(modeId);
    const tools = resolveSubAgentTools(typeConfig, run.type, parentTools);
    const allowedNames = new Set(tools.map((t) => t.function.name));
    const systemPrompt = await buildSubAgentSystemPrompt(
      run.type,
      run.task,
      typeConfig,
      [...allowedNames],
      parentChat ?? null,
    );

    const filteredExecute = async (
      name: string,
      args: Record<string, unknown>,
      ctx?: import('../../tools/client').ExecuteToolContext,
    ) => {
      if (!allowedNames.has(name)) {
        return {
          content: `Error: tool "${name}" is not allowed for sub-agent type ${run.type}`,
        };
      }
      recordToolCallForRun(run.runId, name, args);
      return executeTool(name, args, {
        ...ctx,
        chatId: run.parentChatId ?? undefined,
        modeId,
        subAgentType: run.type,
      });
    };

    publishRunMessages(run, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: run.task },
    ]);

    run.contextBudgetMaxInputTokens = typeConfig.maxInputTokens ?? null;
    run.contextBudgetPolicy =
      typeConfig.contextEnforcementPolicy ?? DEFAULT_CONTEXT_ENFORCEMENT_POLICY;

    const output = await getSubAgentRunner().run({
      runId: run.runId,
      type: run.type,
      task: run.task,
      systemPrompt,
      tools,
      providerId,
      modelId,
      parentChatId: run.parentChatId,
      maxToolTurns: run.maxToolTurns,
      contextBudget: agentContextBudgetFromSubAgentType(typeConfig),
      summarySchema: typeConfig.summarySchema,
      signal: abort.signal,
      toolExecuteContext: {
        chatId: run.parentChatId ?? undefined,
        subAgentType: run.type,
      },
      executeTool: filteredExecute,
      onMessagesChange: (messages) => publishRunMessages(run, messages),
    });

    if (run.status === 'cancelled') return;

    run.messages = output.messages;
    run.toolTurns = output.toolTurns;
    if (output.usage) run.usage = output.usage;
    if (output.stats) run.stats = output.stats;

    if (output.budgetEvents?.length) {
      run.budgetEvents = output.budgetEvents;
    }

    if (output.contextBudgetExhausted) {
      settleRun(
        internals,
        'failed',
        output.summary,
        SUB_AGENT_CONTEXT_BUDGET_ERROR,
      );
      return;
    }

    if (output.toolTurnLimitExhausted) {
      settleRun(
        internals,
        'failed',
        output.summary,
        SUB_AGENT_MAX_TOOL_TURNS_ERROR,
      );
      return;
    }

    if (output.structuredOutcomeParseError) {
      settleRun(internals, 'failed', output.summary, output.structuredOutcomeParseError);
      return;
    }

    if (output.structuredOutcome) {
      run.structuredOutcome = output.structuredOutcome;
    }

    settleRun(internals, 'completed', output.summary, null);
  } catch (err) {
    if (run.status === 'cancelled') return;
    const message = err instanceof Error ? err.message : String(err);
    if (abort.signal.aborted) {
      settleRun(internals, 'cancelled', run.summary || '', 'cancelled');
      return;
    }
    settleRun(internals, 'failed', '', message);
  }
}

async function spawnSubAgentInternal(
  input: SpawnSubAgentInput,
): Promise<SpawnSubAgentResult> {
  const config = await loadSubAgentConfig();
  if (!config.enabled) {
    throw new Error('Error: sub-agents disabled');
  }

  const typeConfig = config.types[input.type];
  if (!typeConfig || !typeConfig.enabled) {
    throw new Error(`Error: unknown or disabled sub-agent type "${input.type}"`);
  }

  const runId = createSubAgentRunId();
  const modeId = normalizeModeId(input.modeId);

  const run: SubAgentRun = {
    runId,
    type: input.type,
    task: input.task,
    status: 'queued',
    parentChatId: input.parentChatId ?? null,
    parentToolCallId: input.parentToolCallId ?? null,
    parentTurnId: input.parentTurnId ?? null,
    summary: '',
    error: null,
    startedAt: null,
    endedAt: null,
    toolTurns: 0,
    maxToolTurns: getSubAgentsMaxToolTurns(config),
    cancelled: false,
    messages: [],
    ...(input.category ? { category: input.category } : {}),
    ...(input.boardTaskId ? { boardTaskId: input.boardTaskId } : {}),
  };

  if (input.boardTaskId && input.parentChatId) {
    const parentChat = findChatById(input.parentChatId);
    const boardGroup = parentChat ? getBoardGroupForChat(parentChat) : undefined;
    if (parentChat && boardGroup?.orchestrateBoard) {
      updateTask(
        boardGroup,
        input.boardTaskId,
        {
          status: 'in_progress',
          assignedRunId: runId,
          startedAt: Date.now(),
        },
        parentChat,
      );
      appendTaskRunHistory(boardGroup, input.boardTaskId, runId, parentChat);
    }
  }

  const abort = new AbortController();
  const internals: RunInternals = {
    run,
    abort,
    timeoutId: null,
    nudgeTimeoutId: null,
    toolCallLog: [],
    queued: true,
    holdsConcurrencySlot: false,
  };

  registerRun(runId, internals);
  associateParentTurn(input.parentTurnId, runId);
  associateParentChat(input.parentChatId, runId);

  const timeoutMs = typeConfig.timeoutMs || config.defaultTimeoutMs;
  internals.timeoutId = setTimeout(() => {
    cancelSubAgent(runId, 'timeout');
  }, timeoutMs);

  const checkInMs = config.checkInNudgeMs ?? 0;
  if (checkInMs > 0) {
    internals.nudgeTimeoutId = setTimeout(() => {
      void import('../sub-agent-completion-push.js').then((mod) => {
        mod.fireSubAgentCheckInNudge(runId);
      });
    }, checkInMs);
  }

  const typeMax = typeConfig.maxConcurrent ?? 1;
  if (canStart(input.type, config.globalMaxConcurrent, typeMax)) {
    internals.queued = false;
    acquireConcurrencySlot(internals, input.type);
    setStatus(run, 'running');
    run.startedAt = nowIso();
    launchExecuteRun(internals, modeId);
    emitSubAgentRunUpdated(run);
    return { runId, status: 'running' };
  }

  enqueueRun(runId, modeId);
  emitSubAgentRunUpdated(run);
  drainQueue();
  return { runId, status: 'queued' };
}

/** Spawn a sub-agent; optionally wait until completion. */
export async function spawnSubAgent(
  input: SpawnSubAgentInput,
): Promise<SpawnSubAgentResult | AggregateResult> {
  const wait = input.wait === true;
  const result = await spawnSubAgentInternal(input);

  if (!wait) return result;

  const aggregate = await waitForSubAgent(result.runId);
  return aggregate;
}

/** Cancel an active or queued sub-agent run. */
export function cancelSubAgent(
  runId: string,
  reason = 'cancelled',
): CancelSubAgentResult {
  removeFromQueue(runId);

  const internals = getRunInternals(runId);
  if (!internals) {
    return { ok: false, runId, status: 'failed' };
  }

  const { run, abort } = internals;
  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
    return { ok: true, runId, status: run.status };
  }

  abort.abort();
  run.error = reason;
  if (internals.queued) {
    internals.queued = false;
    settleRun(internals, 'cancelled', '', reason);
  } else {
    settleRun(internals, 'cancelled', run.summary || '', reason);
  }
  return { ok: true, runId, status: 'cancelled' };
}

/** Cancel and respawn with fresh context. */
export async function restartSubAgent(
  runId: string,
  options?: { note?: string; preserveType?: boolean },
): Promise<SpawnSubAgentResult> {
  const internals = getRunInternals(runId);
  if (!internals) {
    throw new Error(`Error: unknown sub-agent run ${runId}`);
  }

  const { type, task, parentTurnId, parentChatId } = internals.run;
  cancelSubAgent(runId, 'restart');

  let nextTask = task;
  if (options?.note?.trim()) {
    nextTask = `${options.note.trim()}\n\n${task}`;
  }

  return spawnSubAgentInternal({
    type: options?.preserveType === false ? 'generalPurpose' : type,
    task: nextTask,
    wait: false,
    parentTurnId,
    parentChatId,
    parentToolCallId: internals.run.parentToolCallId,
    modeId: undefined,
  });
}

export { getSubAgentRun, listActiveSubAgentRuns, listSubAgentRunsForParentChat, listSubAgentRunsForParentTurn };

/** Block until run reaches a terminal state. */
export async function waitForSubAgent(
  runId: string,
  signal?: AbortSignal,
): Promise<AggregateResult> {
  const pollMs = 50;

  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      cancelSubAgent(runId, 'parent_abort');
      reject(new DOMException('Aborted', 'AbortError'));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });

    const tick = (): void => {
      const internals = getRunInternals(runId);
      if (!internals) {
        signal?.removeEventListener('abort', onAbort);
        reject(new Error(`Error: unknown sub-agent run ${runId}`));
        return;
      }

      const { run } = internals;
      if (
        run.status === 'completed' ||
        run.status === 'failed' ||
        run.status === 'cancelled'
      ) {
        signal?.removeEventListener('abort', onAbort);
        resolve(buildAggregateResult(run));
        return;
      }

      setTimeout(tick, pollMs);
    };

    tick();
  });
}

/** Cancel all sub-agents tied to a parent send turn. */
export function cancelAllForParentTurn(parentTurnId: string): void {
  const set = getParentTurnRunIds(parentTurnId);
  if (!set) return;
  for (const runId of [...set]) {
    cancelSubAgent(runId, 'parent_turn_abort');
  }
  deleteParentTurnIndex(parentTurnId);
}

/** Append-only tool log for repetition heuristics and live progress. */
export function recordToolCallForRun(
  runId: string,
  name: string,
  args: Record<string, unknown>,
): void {
  const internals = getRunInternals(runId);
  if (!internals) return;
  internals.toolCallLog.push({
    name,
    args: JSON.stringify(args),
  });
  internals.run.liveCurrentToolName = name;
  observeSubAgentToolCall(
    runId,
    internals.run.type,
    internals.toolCallLog.map((e) => ({ name: e.name, argsJson: e.args })),
    internals.run.parentChatId,
  );
  internals.run.liveNestedToolCalls = (internals.run.liveNestedToolCalls ?? 0) + 1;
  emitSubAgentRunUpdated(internals.run);
}

/** Stable fingerprint hash for repetition detection. */
export function getRunToolCallFingerprint(runId: string): string {
  const internals = getRunInternals(runId);
  if (!internals) return '';
  const payload = internals.toolCallLog
    .map((e) => `${e.name}:${e.args}`)
    .join('|');
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (hash * 31 + payload.charCodeAt(i)) | 0;
  }
  return `fp_${runId.slice(0, 8)}_${hash}`;
}

/** Last non-system message text for parent status tools (capped). */
function lastNonSystemPreview(messages: SubAgentRun['messages']): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as {
      role?: string;
      content?: unknown;
    };
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

/** JSON body for the `list_sub_agents` parent tool. */
export function formatSubAgentListToolResult(parentTurnId: string | null | undefined): string {
  const rows = listSubAgentRunsForParentTurn(parentTurnId).map((r) => ({
    runId: r.runId,
    type: r.type,
    status: r.status,
    taskPreview: r.task.length > 120 ? `${r.task.slice(0, 120)}…` : r.task,
    startedAt: r.startedAt,
    toolTurns: r.toolTurns,
    maxToolTurns: r.maxToolTurns,
    liveNestedToolCalls: r.liveNestedToolCalls,
  }));
  return JSON.stringify({ runs: rows }, null, 2);
}

/** JSON body for session-scoped `list_sub_agents` (live + optional persisted rows). */
export function formatSubAgentListToolResultForChat(
  parentChatId: string,
  persisted: import('../../types').PersistedSubAgentRun[] | undefined,
): string {
  const live = listSubAgentRunsForParentChat(parentChatId);
  const liveIds = new Set(live.map((r) => r.runId));
  const rows = live.map((r) => ({
    runId: r.runId,
    type: r.type,
    status: r.status,
    taskPreview: r.task.length > 120 ? `${r.task.slice(0, 120)}…` : r.task,
    startedAt: r.startedAt,
    toolTurns: r.toolTurns,
    maxToolTurns: r.maxToolTurns,
    liveNestedToolCalls: r.liveNestedToolCalls,
  }));
  for (const p of persisted ?? []) {
    if (liveIds.has(p.runId)) continue;
    rows.push({
      runId: p.runId,
      type: p.type,
      status: p.status,
      taskPreview: p.task.length > 120 ? `${p.task.slice(0, 120)}…` : p.task,
      startedAt: p.startedAt ?? null,
      toolTurns: p.toolTurns,
      maxToolTurns: 0,
      liveNestedToolCalls: undefined,
    });
  }
  rows.sort((a, b) => String(a.startedAt ?? '').localeCompare(String(b.startedAt ?? '')));
  return JSON.stringify({ runs: rows }, null, 2);
}

/** Serializable snapshot for `get_sub_agent_status`. */
export function buildSubAgentStatusPayload(run: SubAgentRun): Record<string, unknown> {
  const success =
    run.status === 'completed' && !isMaxToolTurnFailure(run.summary, run.error);
  const outcome = outcomeForRun(run);
  const preview = lastNonSystemPreview(run.messages);
  const payload: Record<string, unknown> = {
    runId: run.runId,
    type: run.type,
    status: run.status,
    success,
    summary: outcome?.summary ?? preview,
    ...(outcome ? { outcome } : {}),
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    toolTurns: run.toolTurns,
    maxToolTurns: run.maxToolTurns,
    cancelled: run.cancelled,
    lastMessagePreview: lastNonSystemPreview(run.messages),
  };
  if (run.error) payload.error = run.error;
  if (run.liveNestedToolCalls != null) payload.liveNestedToolCalls = run.liveNestedToolCalls;
  if (run.liveCurrentToolName) payload.liveCurrentToolName = run.liveCurrentToolName;
  if (run.modelId) payload.modelId = run.modelId;
  if (run.providerId) payload.providerId = run.providerId;
  if (run.budgetEvents?.length) {
    payload.budgetEvents = run.budgetEvents;
  }
  const terminalReason = deriveSubAgentTerminalReason(run);
  if (terminalReason) payload.terminalReason = terminalReason;
  return payload;
}

/**
 * Ensures a run id belongs to the parent chat session, then returns the run row.
 */
export function assertSubAgentRunReadableByParent(
  run: SubAgentRun | undefined,
  ctx: { parentChatId: string; parentTurnId?: string },
): SubAgentRun {
  if (!run) {
    throw new Error('Error: unknown sub-agent run');
  }
  if (!run.parentChatId || run.parentChatId !== ctx.parentChatId) {
    throw new Error('Error: sub-agent run is not visible from this chat');
  }
  return run;
}

/** Test reset: clear controller state. */
export function resetSubAgentOrchestrator(): void {
  clearSubAgentRunListeners();
  forEachRunInternals((internals) => {
    clearTimeoutFor(internals);
    internals.abort.abort();
  });
  clearRegistry();
  clearScheduler();
  setQueueDispatch((internals, modeId) => {
    launchExecuteRun(internals, modeId);
  });
  setQueueFail((internals, message) => {
    settleRun(internals, 'failed', '', message);
  });
}

export { resetSubAgentOrchestrator as resetSubAgentController };
