/**
 * Sub-agent orchestrator: spawn, cancel, queue, aggregate (Step 09).
 */

import { normalizeModeId } from '../chat/modes/types';
import { updateTask } from '../state/orchestrate-board-store';
import { findChatById } from '../state/sessions';
import { executeTool, getEnabledToolDefinitionsForMode } from '../tools/client';
import { loadSubAgentConfig } from './sub-agent-config';
import { buildSubAgentSystemPrompt } from './sub-agent-prompt';
import { createSubAgentRunId } from './sub-agent-run-id';
import { getSubAgentRunner } from './sub-agent-runner';
import { resolveSubAgentTools } from './sub-agent-tools';
import { observeSubAgentToolCall } from './self-healing/controller';
import { clearSubAgentRunListeners, emitSubAgentRunUpdated } from './sub-agent-events';
import type {
  AggregateResult,
  CancelSubAgentResult,
  SpawnSubAgentInput,
  SpawnSubAgentResult,
  SubAgentRun,
  SubAgentStatus,
} from './types';

const AGGREGATE_MAX_BYTES = 32 * 1024;

interface QueuedItem {
  runId: string;
  modeId: string;
}

interface RunInternals {
  run: SubAgentRun;
  abort: AbortController;
  timeoutId: ReturnType<typeof setTimeout> | null;
  toolCallLog: Array<{ name: string; args: string }>;
  queued: boolean;
}

const runs = new Map<string, RunInternals>();
const parentTurnRuns = new Map<string, Set<string>>();
const globalQueue: QueuedItem[] = [];

let activeGlobal = 0;
const activeByType = new Map<string, number>();

function nowIso(): string {
  return new Date().toISOString();
}

function setStatus(run: SubAgentRun, status: SubAgentStatus): void {
  run.status = status;
  if (status === 'cancelled') run.cancelled = true;
}

function decActive(type: string): void {
  activeGlobal = Math.max(0, activeGlobal - 1);
  const n = (activeByType.get(type) ?? 1) - 1;
  if (n <= 0) activeByType.delete(type);
  else activeByType.set(type, n);
}

function incActive(type: string): void {
  activeGlobal += 1;
  activeByType.set(type, (activeByType.get(type) ?? 0) + 1);
}

function canStart(type: string, globalMax: number, typeMax: number): boolean {
  if (activeGlobal >= globalMax) return false;
  if ((activeByType.get(type) ?? 0) >= typeMax) return false;
  return true;
}

function associateParentTurn(parentTurnId: string | null | undefined, runId: string): void {
  if (!parentTurnId) return;
  let set = parentTurnRuns.get(parentTurnId);
  if (!set) {
    set = new Set();
    parentTurnRuns.set(parentTurnId, set);
  }
  set.add(runId);
}

function clearTimeoutFor(internals: RunInternals): void {
  if (internals.timeoutId) {
    clearTimeout(internals.timeoutId);
    internals.timeoutId = null;
  }
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
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
  const out: AggregateResult = {
    runId: run.runId,
    type: run.type,
    status: run.status,
    summary: run.summary,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    toolTurns: run.toolTurns,
    cancelled: run.cancelled,
  };
  if (run.error) out.error = run.error;
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
  clearTimeoutFor(internals);
  if (!internals.queued) {
    decActive(run.type);
  }
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
  if (!chat?.orchestrateBoard) return;

  const endedAt = Date.now();
  if (status === 'completed') {
    updateTask(chat, taskId, {
      status: 'complete',
      endedAt,
      assignedRunId: null,
    });
    return;
  }
  if (status === 'failed' || status === 'cancelled') {
    updateTask(chat, taskId, {
      status: 'failed',
      endedAt,
      error: error || (status === 'cancelled' ? 'cancelled' : 'failed'),
      assignedRunId: null,
    });
  }
}

async function executeRun(internals: RunInternals, modeId: string): Promise<void> {
  const { run, abort } = internals;
  const config = await loadSubAgentConfig();
  const typeConfig = config.types[run.type];
  if (!typeConfig) {
    settleRun(internals, 'failed', '', `Unknown sub-agent type: ${run.type}`);
    return;
  }

  setStatus(run, 'running');
  if (!run.startedAt) run.startedAt = nowIso();
  emitSubAgentRunUpdated(run);

  const parentTools = getEnabledToolDefinitionsForMode(modeId);
  const tools = resolveSubAgentTools(typeConfig, run.type, parentTools);
  const systemPrompt = await buildSubAgentSystemPrompt(run.type, run.task, typeConfig);
  const allowedNames = new Set(tools.map((t) => t.function.name));

  const filteredExecute = async (
    name: string,
    args: Record<string, unknown>,
    ctx?: import('../tools/client').ExecuteToolContext,
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
      subAgentType: run.type,
    });
  };

  try {
    const output = await getSubAgentRunner().run({
      runId: run.runId,
      type: run.type,
      task: run.task,
      systemPrompt,
      tools,
      providerId: typeConfig.providerId,
      modelId: typeConfig.modelId,
      signal: abort.signal,
      toolExecuteContext: {
        chatId: run.parentChatId ?? undefined,
        subAgentType: run.type,
      },
      executeTool: filteredExecute,
    });

    if (run.status === 'cancelled') return;

    run.messages = output.messages;
    run.toolTurns = output.toolTurns;
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

function tryStartRun(internals: RunInternals, modeId: string): boolean {
  const { run } = internals;
  void loadSubAgentConfig().then((config) => {
    const typeCfg = config.types[run.type];
    if (!typeCfg) return;
    const typeMax = typeCfg.maxConcurrent ?? 1;
    if (!canStart(run.type, config.globalMaxConcurrent, typeMax)) return;

    internals.queued = false;
    incActive(run.type);
    void executeRun(internals, modeId);
  });
  return true;
}

function drainQueue(): void {
  void loadSubAgentConfig().then((config) => {
    while (globalQueue.length > 0) {
      const item = globalQueue[0];
      const internals = runs.get(item.runId);
      if (!internals || internals.run.status !== 'queued') {
        globalQueue.shift();
        continue;
      }

      const typeCfg = config.types[internals.run.type];
      if (!typeCfg) {
        globalQueue.shift();
        settleRun(internals, 'failed', '', `Unknown type ${internals.run.type}`);
        continue;
      }

      const typeMax = typeCfg.maxConcurrent ?? 1;
      if (!canStart(internals.run.type, config.globalMaxConcurrent, typeMax)) {
        break;
      }

      globalQueue.shift();
      internals.queued = false;
      incActive(internals.run.type);
      void executeRun(internals, item.modeId);
    }
  });
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
    cancelled: false,
    messages: [],
    ...(input.category ? { category: input.category } : {}),
    ...(input.boardTaskId ? { boardTaskId: input.boardTaskId } : {}),
  };

  if (input.boardTaskId && input.parentChatId) {
    const parentChat = findChatById(input.parentChatId);
    if (parentChat?.orchestrateBoard) {
      updateTask(parentChat, input.boardTaskId, {
        status: 'in_progress',
        assignedRunId: runId,
        startedAt: Date.now(),
      });
    }
  }

  const abort = new AbortController();
  const internals: RunInternals = {
    run,
    abort,
    timeoutId: null,
    toolCallLog: [],
    queued: true,
  };

  runs.set(runId, internals);
  associateParentTurn(input.parentTurnId, runId);

  const timeoutMs = typeConfig.timeoutMs || config.defaultTimeoutMs;
  internals.timeoutId = setTimeout(() => {
    cancelSubAgent(runId, 'timeout');
  }, timeoutMs);

  const typeMax = typeConfig.maxConcurrent ?? 1;
  if (canStart(input.type, config.globalMaxConcurrent, typeMax)) {
    internals.queued = false;
    incActive(input.type);
    setStatus(run, 'running');
    run.startedAt = nowIso();
    void executeRun(internals, modeId);
    emitSubAgentRunUpdated(run);
    return { runId, status: 'running' };
  }

  globalQueue.push({ runId, modeId });
  emitSubAgentRunUpdated(run);
  return { runId, status: 'queued' };
}

/** Spawn a sub-agent; optionally wait until completion. */
export async function spawnSubAgent(
  input: SpawnSubAgentInput,
): Promise<SpawnSubAgentResult | AggregateResult> {
  const wait = input.wait !== false;
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
  const queueIdx = globalQueue.findIndex((q) => q.runId === runId);
  if (queueIdx >= 0) {
    globalQueue.splice(queueIdx, 1);
  }

  const internals = runs.get(runId);
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

/** Step 19: cancel and respawn with fresh context. */
export async function restartSubAgent(
  runId: string,
  options?: { note?: string; preserveType?: boolean },
): Promise<SpawnSubAgentResult> {
  const internals = runs.get(runId);
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

export function getSubAgentRun(runId: string): SubAgentRun | undefined {
  return runs.get(runId)?.run;
}

export function listActiveSubAgentRuns(): SubAgentRun[] {
  return [...runs.values()]
    .map((i) => i.run)
    .filter((r) => r.status === 'queued' || r.status === 'running');
}

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
      const internals = runs.get(runId);
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
  const set = parentTurnRuns.get(parentTurnId);
  if (!set) return;
  for (const runId of [...set]) {
    cancelSubAgent(runId, 'parent_turn_abort');
  }
  parentTurnRuns.delete(parentTurnId);
}

/** Append-only tool log for Step 19 heuristics. */
export function recordToolCallForRun(
  runId: string,
  name: string,
  args: Record<string, unknown>,
): void {
  const internals = runs.get(runId);
  if (!internals) return;
  internals.toolCallLog.push({
    name,
    args: JSON.stringify(args),
  });
  observeSubAgentToolCall(
    runId,
    internals.run.type,
    internals.toolCallLog.map((e) => ({ name: e.name, argsJson: e.args })),
  );
  internals.run.liveNestedToolCalls = (internals.run.liveNestedToolCalls ?? 0) + 1;
  emitSubAgentRunUpdated(internals.run);
}

/** Stable fingerprint hash for repetition detection (Step 19). */
export function getRunToolCallFingerprint(runId: string): string {
  const internals = runs.get(runId);
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

const STATUS_PREVIEW_MAX = 480;

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

/** Active or settled runs registered for a parent user-send turn. */
export function listSubAgentRunsForParentTurn(
  parentTurnId: string | null | undefined,
): SubAgentRun[] {
  if (!parentTurnId) return [];
  const set = parentTurnRuns.get(parentTurnId);
  if (!set || set.size === 0) return [];
  const out: SubAgentRun[] = [];
  for (const id of set) {
    const row = runs.get(id)?.run;
    if (row) out.push(row);
  }
  return out.sort((a, b) =>
    String(a.startedAt ?? '').localeCompare(String(b.startedAt ?? '')),
  );
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
    liveNestedToolCalls: r.liveNestedToolCalls,
  }));
  return JSON.stringify({ runs: rows }, null, 2);
}

/** Serializable snapshot for `get_sub_agent_status`. */
export function buildSubAgentStatusPayload(run: SubAgentRun): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    runId: run.runId,
    type: run.type,
    status: run.status,
    summary: run.summary,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    toolTurns: run.toolTurns,
    cancelled: run.cancelled,
    lastMessagePreview: lastNonSystemPreview(run.messages),
  };
  if (run.error) payload.error = run.error;
  if (run.liveNestedToolCalls != null) payload.liveNestedToolCalls = run.liveNestedToolCalls;
  return payload;
}

/**
 * Ensures a run id is tied to the current parent tool context (turn + optional chat),
 * then returns the live run row.
 */
export function assertSubAgentRunReadableByParent(
  run: SubAgentRun | undefined,
  ctx: { parentTurnId: string; parentChatId?: string },
): SubAgentRun {
  if (!run) {
    throw new Error('Error: unknown sub-agent run');
  }
  if (run.parentTurnId !== ctx.parentTurnId) {
    throw new Error('Error: sub-agent run is not visible from this parent turn');
  }
  if (ctx.parentChatId && run.parentChatId && run.parentChatId !== ctx.parentChatId) {
    throw new Error('Error: sub-agent run is not visible from this chat');
  }
  return run;
}

/** Test reset: clear orchestrator state. */
export function resetSubAgentOrchestrator(): void {
  clearSubAgentRunListeners();
  for (const internals of runs.values()) {
    clearTimeoutFor(internals);
    internals.abort.abort();
  }
  runs.clear();
  parentTurnRuns.clear();
  globalQueue.length = 0;
  activeGlobal = 0;
  activeByType.clear();
}
