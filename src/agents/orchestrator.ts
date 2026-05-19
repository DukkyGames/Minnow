/**
 * Sub-agent orchestrator: spawn, cancel, queue, aggregate (Step 09).
 */

import { normalizeModeId } from '../chat/modes/types';
import { executeTool, getEnabledToolDefinitionsForMode } from '../tools/client';
import { loadSubAgentConfig } from './sub-agent-config';
import { buildSubAgentSystemPrompt } from './sub-agent-prompt';
import { createSubAgentRunId } from './sub-agent-run-id';
import { getSubAgentRunner } from './sub-agent-runner';
import { resolveSubAgentTools } from './sub-agent-tools';
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
  clearTimeoutFor(internals);
  if (!internals.queued) {
    decActive(run.type);
  }
  internals.queued = false;
  drainQueue();
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

  const parentTools = getEnabledToolDefinitionsForMode(modeId);
  const tools = resolveSubAgentTools(typeConfig, run.type, parentTools);
  const systemPrompt = await buildSubAgentSystemPrompt(run.type, run.task, typeConfig);
  const allowedNames = new Set(tools.map((t) => t.function.name));

  const filteredExecute = async (
    name: string,
    args: Record<string, unknown>,
  ) => {
    if (!allowedNames.has(name)) {
      return {
        content: `Error: tool "${name}" is not allowed for sub-agent type ${run.type}`,
      };
    }
    recordToolCallForRun(run.runId, name, args);
    return executeTool(name, args);
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
    parentTurnId: input.parentTurnId ?? null,
    summary: '',
    error: null,
    startedAt: null,
    endedAt: null,
    toolTurns: 0,
    cancelled: false,
    messages: [],
  };

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
    return { runId, status: 'running' };
  }

  globalQueue.push({ runId, modeId });
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

  const { type, task, parentTurnId } = internals.run;
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

/** Test reset: clear orchestrator state. */
export function resetSubAgentOrchestrator(): void {
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
