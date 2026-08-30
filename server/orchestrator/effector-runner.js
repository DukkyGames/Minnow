/**
 * P2-F — the runner effector.
 *
 * Same `inspect` / `start` / `stop` / `onEnd` contract as the scripted
 * effector (`effector-scripted.js`). The engine does not change: it still
 * journals `task.attempt.started` off `start()` resolving, and it still
 * requires the attempt to stay in `inspect()` until the `onEnd` handler
 * has resolved (see `engine.js` lines 99–120).
 *
 * Builder and Tester run through `runTurn`. Merge and Final are
 * engine-driven mechanical roles (P3); until then they complete as an
 * instant pass so a board is not stranded after tester — the same default
 * the scripted effector already uses.
 */

import { randomUUID } from 'node:crypto';

import {
  createInProcessToolDispatch,
  createMemoryTranscriptStore,
  DEFAULT_HEADLESS_TOOL_IDS,
  postChatCompletionsInProcess,
  runTurn as defaultRunTurn,
} from '../runner/node.js';
import { cancel as cancelGeneration, listGenerationStates } from '../generations/store.js';
import { getProvider } from '../providers/store.js';
import { getWorkspaceRoot } from '../workspace/root.js';
import { peekEngine } from './engine.js';
import * as diskJournal from './journal.js';
import { attemptLimits } from './attempt-limits.js';
import { emitLive } from './live-events.js';
import { resolveAttemptModel } from './model-binding.js';
import { recordTranscriptEnd, recordTranscriptEvent } from './transcripts.js';
import { interpolatePrompt, loadRolePrompt } from './prompts.js';
import { parseReportFor, reportToolFor, REPORT_TOOL_NAME } from './report-tool.js';
import { buildSeed } from './seeds.js';

/**
 * Attempt ids currently visible to some runner effector's `inspect()`.
 *
 * Used to decide which persist:false generations are orphans on boot.
 * Module-scoped so two boards in one process do not cancel each other.
 *
 * @type {Set<string>}
 */
const liveAttemptIds = new Set();

/**
 * Cancel persist:false generations that no live attempt still owns.
 *
 * A previous process has an empty store, so this is a no-op on a real
 * restart. In-process restart tests leave streaming gens behind; this is
 * what reaps them. User-facing chat uses `persist: true` and is left alone.
 *
 * @returns {number} how many generations were cancelled
 */
export function cancelOrphanedRunnerGenerations() {
  let n = 0;
  for (const state of listGenerationStates()) {
    if (state.status !== 'pending' && state.status !== 'streaming') continue;
    if (state.persist !== false) continue;
    const owner = typeof state.chatId === 'string' ? state.chatId : '';
    if (owner && liveAttemptIds.has(owner)) continue;
    // Untagged persist:false streams (P2-C does not yet pass chatId) are
    // orphans iff nothing this process still inspects.
    if (!owner && liveAttemptIds.size > 0) continue;
    cancelGeneration(state);
    n += 1;
  }
  return n;
}

/**
 * Server-side `RunnerDeps` for in-process completions. Sampler / thinking /
 * context policy are no-ops: the attempt's `TurnModel` already carries what
 * `runTurn` forwards, and a missing capability probe must not block a turn.
 *
 * @param {import('../runner/adapters').PostChatCompletions} postChatCompletions
 * @returns {import('../runner/adapters').RunnerDeps}
 */
function createServerRunnerDeps(postChatCompletions) {
  return {
    transcriptStore: createMemoryTranscriptStore(),
    postChatCompletions,
    runHeadlessToolBatch: async () => [],
    resolveProvider: async (providerId) => {
      const row = await getProvider(providerId);
      return {
        id: row.id,
        label: row.label,
        baseUrl: row.baseUrl,
        apiKind: row.apiKind,
        chatCompletionsPath: row.chatCompletionsPath,
      };
    },
    getSubAgentTypeConfig: async () => ({}),
    resolveSamplerPreset: () => ({ preset: {}, maxTokens: 2048 }),
    resolveThinkingMode: () => ({ mode: 'off' }),
    resolveThinkingBudgetTokens: () => ({ budgetTokens: null }),
    loadToolCallsMeta: async () => {},
    getToolCallsMetaSync: () => ({ useConstrainedDecoding: false }),
    isConstrainedDecodingEnabledForProvider: () => false,
    readProviderCapabilities: async () => null,
    isStructuredOutcomeResponseFormatAvailable: () => false,
    resolveSendCapabilities: () => ({}),
    resolveModelContextLimit: () => null,
    applyContextPolicy: async (input) => ({
      applied: false,
      messages: input.messages,
    }),
  };
}

/**
 * OpenAI function stubs for the headless subset. Full parameter schemas live
 * in the renderer catalog (`src/tools/definitions.ts`); the server must not
 * import that TS module. Names are what the allow-list and dispatch key on.
 *
 * @returns {import('../runner/run-turn').TurnToolDefinition[]}
 */
function headlessToolDefs() {
  return DEFAULT_HEADLESS_TOOL_IDS.map((name) => ({
    type: 'function',
    function: {
      name,
      description: name,
      parameters: { type: 'object', additionalProperties: true },
    },
  }));
}

/**
 * Map a `TurnResult` object onto the engine's `AttemptEnd`.
 *
 * Core `AttemptResult` is the outcome *string*. `needs` / `blockers` /
 * `evidence` / `testOutput` go on `evidence` so P2-E seeds can quote them
 * on the next attempt (`repair` reads `needs`, `fix` reads `testOutput`).
 *
 * @param {string} attemptId
 * @param {import('./core/types').Desired} desired
 * @param {import('../runner/run-turn').TurnResult} result
 * @returns {import('./engine.js').AttemptEnd}
 */
function toAttemptEnd(attemptId, desired, result) {
  /** @type {Record<string, unknown>} */
  const evidence = {};
  if (result.outcome === 'pass' && Array.isArray(result.evidence)) {
    evidence.evidence = result.evidence;
  }
  if (result.outcome === 'fail' && Array.isArray(result.blockers)) {
    evidence.blockers = result.blockers;
    // Tester fail surfaces testOutput as the first blocker (report-tool.js).
    if (desired.role === 'tester' && result.blockers[0]) {
      evidence.testOutput = result.blockers[0];
    }
  }
  if (result.outcome === 'blocked' && Array.isArray(result.needs)) {
    evidence.needs = result.needs;
  }
  if (result.outcome === 'crashed' && typeof result.error === 'string') {
    evidence.error = result.error;
  }

  /** @type {import('./engine.js').AttemptEnd} */
  const end = {
    attemptId,
    taskId: desired.taskId,
    role: desired.role,
    outcome: result.outcome,
  };
  if (result.outcome === 'pass' || result.outcome === 'fail' || result.outcome === 'blocked') {
    end.summary = result.summary;
  } else if (result.outcome === 'crashed') {
    end.summary = result.error;
  }
  if (Object.keys(evidence).length > 0) end.evidence = evidence;
  return end;
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function errorMessage(err) {
  if (err instanceof Error && err.message) return err.message;
  return String(err ?? 'unknown error');
}

/**
 * Create the production effector for one board.
 *
 * @param {{
 *   boardId?: string,
 *   journal?: typeof diskJournal,
 *   getState?: () => import('./core/types').BoardState | Promise<import('./core/types').BoardState>,
 *   model?: { providerId: string, id: string },
 *   cwd?: string,
 *   limits?: { maxTurns?: number, wallClockMs?: number },
 *   promptVariant?: 'full' | 'lite',
 *   runTurn?: typeof defaultRunTurn,
 *   deps?: import('../runner/adapters').RunnerDeps,
 *   postChatCompletions?: import('../runner/adapters').PostChatCompletions,
 *   reapOrphans?: boolean,
 * }} [options]
 */
export function createRunnerEffector(options = {}) {
  const boardId = options.boardId;
  const journal = options.journal ?? diskJournal;
  const runTurnFn = options.runTurn ?? defaultRunTurn;
  const limits = attemptLimits(options.limits);
  const promptVariant = options.promptVariant === 'lite' ? 'lite' : 'full';
  const cwd = typeof options.cwd === 'string' && options.cwd.trim()
    ? options.cwd.trim()
    : getWorkspaceRoot();
  const deps = options.deps ?? createServerRunnerDeps(
    options.postChatCompletions ?? postChatCompletionsInProcess,
  );

  if (options.reapOrphans) cancelOrphanedRunnerGenerations();

  /**
   * @typedef {object} LiveAttempt
   * @property {string | null} taskId
   * @property {string} role
   * @property {string} attemptId
   * @property {AbortController} controller
   * @property {boolean} stopped
   */

  /** @type {Map<string, LiveAttempt>} */
  const running = new Map();
  /** @type {Array<(end: import('./engine.js').AttemptEnd) => Promise<void> | void>} */
  const listeners = [];
  /** @type {Array<{ taskId: string | null, role: string, attemptId: string, seedKind?: string }>} */
  const startLog = [];

  /**
   * @returns {Promise<import('./core/types').BoardState>}
   */
  async function currentState() {
    if (typeof options.getState === 'function') return options.getState();
    if (boardId) {
      const engine = peekEngine(boardId);
      if (engine) return engine.getState();
      return journal.loadState(boardId);
    }
    throw new Error('createRunnerEffector: boardId or getState is required to build a seed');
  }

  /**
   * Keep the attempt in `inspect()` until every onEnd handler has settled.
   * Dropping it first is the contract violation `engine.js` warns about.
   *
   * @param {LiveAttempt} entry
   * @param {import('./engine.js').AttemptEnd} end
   */
  async function deliverEnd(entry, end) {
    if (entry.stopped) return;
    try {
      for (const listener of listeners) await listener(end);
    } finally {
      running.delete(entry.attemptId);
      liveAttemptIds.delete(entry.attemptId);
    }
  }

  /**
   * Merge and Final are not LLM roles. Instant pass matches the scripted
   * default so a board can close the queue until P3 owns a real merge.
   *
   * @param {import('./core/types').Desired} desired
   * @returns {Promise<{ attemptId: string }>}
   */
  async function startEngineDriven(desired) {
    const attemptId = `r-${randomUUID()}`;
    const entry = {
      taskId: desired.taskId,
      role: desired.role,
      attemptId,
      controller: new AbortController(),
      stopped: false,
    };
    running.set(attemptId, entry);
    liveAttemptIds.add(attemptId);
    startLog.push({
      taskId: desired.taskId,
      role: desired.role,
      attemptId,
      seedKind: desired.seedKind,
    });

    /** @type {import('./engine.js').AttemptEnd} */
    const end = {
      attemptId,
      taskId: desired.taskId,
      role: desired.role,
      outcome: 'pass',
    };
    if (desired.role === 'merge') end.sha = 'workspace-head';
    if (desired.role === 'final') end.runInstructions = '';

    // Next microtask: `start()` must resolve (and the engine journal the
    // side effect it can journal) before the end arrives.
    void Promise.resolve().then(() => deliverEnd(entry, end));
    return { attemptId };
  }

  /**
   * @param {LiveAttempt} entry
   * @param {import('./core/types').Desired} desired
   * @param {import('../runner/run-turn').TurnResult} result
   */
  async function finishAgent(entry, desired, result) {
    await deliverEnd(entry, toAttemptEnd(entry.attemptId, desired, result));
  }

  return {
    /** @returns {Array<{ taskId: string | null, role: string, attemptId: string }>} */
    inspect() {
      return [...running.values()].map(({ taskId, role, attemptId }) => ({
        taskId,
        role,
        attemptId,
      }));
    },

    /**
     * P9-A — everything an attempt needs that is not per-task.
     *
     * The engine calls this from `POST /start` *before* it answers, so a board
     * with no model bound is refused at the button with the binding error's own
     * wording. Without it, `resolveAttemptModel` throwing presented as "Start
     * does nothing": the board read `running`, every tick retried, and the only
     * evidence was a server log.
     *
     * Deliberately the same calls `start()` makes, in the same order, so this
     * cannot pass while `start()` fails on the thing it claims to have checked.
     * Per-task work (the seed) is not checked here — it needs a task.
     *
     * @returns {Promise<void>}
     */
    async preflight() {
      const state = boardId || options.getState ? await currentState() : null;
      await resolveAttemptModel(options.model ?? state?.model ?? null);
      await loadRolePrompt('builder', promptVariant);
      await loadRolePrompt('tester', promptVariant);
    },

    /**
     * @param {import('./core/types').Desired} desired
     * @returns {Promise<{ attemptId: string }>}
     */
    async start(desired) {
      if (desired.role === 'merge' || desired.role === 'final') {
        return startEngineDriven(desired);
      }
      if (desired.role !== 'builder' && desired.role !== 'tester') {
        throw new Error(`runner effector: unsupported role ${String(desired.role)}`);
      }
      if (!desired.taskId) {
        throw new Error(`runner effector: ${desired.role} requires a taskId`);
      }

      // Prep *before* the attempt is live. A throw here rejects `start()` and
      // the engine journals nothing — there is no process yet.
      const state = await currentState();
      const seed = buildSeed(desired.seedKind ?? 'initial', {
        state,
        taskId: desired.taskId,
      });
      // P9-C: the board's own binding wins over Settings, and an explicit
      // option (tests) wins over both.
      const model = await resolveAttemptModel(options.model ?? state.model);
      // P9-C: the board's reasoning control, the other half of binding a model
      // — a thinking model bound with thinking off is a different model in every
      // way that matters. Carried on the `TurnModel`, which is where `runTurn`
      // already looks before it falls back to the deps.
      const reasoning = options.model ? null : state.model?.reasoning ?? null;
      const turnModel = reasoning === 'on' || reasoning === 'off'
        ? { ...model, thinking: { mode: reasoning } }
        : model;
      const prompt = interpolatePrompt(
        await loadRolePrompt(desired.role, promptVariant),
        { cwd },
      );
      const tools = [...headlessToolDefs(), reportToolFor(desired.role)];
      const dispatch = createInProcessToolDispatch({
        cwd,
        allowedToolNames: DEFAULT_HEADLESS_TOOL_IDS,
      });

      const attemptId = `r-${randomUUID()}`;
      const controller = new AbortController();
      const entry = {
        taskId: desired.taskId,
        role: desired.role,
        attemptId,
        controller,
        stopped: false,
      };

      // The process exists. Only now is `start()` allowed to resolve — that
      // resolution licenses `task.attempt.started`.
      running.set(attemptId, entry);
      liveAttemptIds.add(attemptId);
      startLog.push({
        taskId: desired.taskId,
        role: desired.role,
        attemptId,
        seedKind: desired.seedKind,
      });

      void (async () => {
        /** @type {import('../runner/run-turn').TurnResult} */
        let result;
        try {
          result = await runTurnFn({
            chatId: attemptId,
            seed,
            tools,
            model: turnModel,
            cwd,
            signal: controller.signal,
            limits,
            deps: {
              ...deps,
              runHeadlessToolBatch: dispatch.runHeadlessToolBatch,
            },
            execute: dispatch.execute,
            reportToolName: REPORT_TOOL_NAME,
            parseReport: parseReportFor(desired.role),
            systemPrompt: prompt,
            onEvent: (event) => {
              if (!boardId) return;
              emitLive({
                boardId,
                attemptId,
                taskId: desired.taskId,
                role: desired.role,
                event,
              });
              // P9-D. Beside the journal, never on it: the live bus is
              // ephemeral and a finished attempt's `summary` is one line, so
              // without this there is no way to read what an agent actually
              // did — the first thing anyone asks when a task fails.
              recordTranscriptEvent({
                boardId,
                attemptId,
                taskId: desired.taskId,
                role: desired.role,
                event: /** @type {Record<string, unknown>} */ (
                  /** @type {unknown} */ (event)
                ),
              });
            },
          });
        } catch (err) {
          // An uncaught throw must become `crashed`, never take the engine down.
          result = { outcome: 'crashed', error: errorMessage(err) };
        }
        if (entry.stopped) return;
        if (boardId) {
          recordTranscriptEnd({
            boardId,
            attemptId,
            outcome: result.outcome,
            ...(typeof (/** @type {any} */ (result).summary) === 'string'
              ? { summary: /** @type {any} */ (result).summary }
              : {}),
          });
        }
        await finishAgent(entry, desired, result);
      })();

      return { attemptId };
    },

    /**
     * @param {string} attemptId
     * @returns {Promise<void>}
     */
    async stop(attemptId) {
      const entry = running.get(attemptId);
      if (!entry) return;
      // Abort first so P2-C cancels the generation and P2-D cancels in-flight
      // tools. Then drop from inspect without delivering onEnd — the engine
      // asked us to stop because the work is no longer desired, not because
      // it finished. Same as the scripted effector.
      entry.stopped = true;
      entry.controller.abort();
      running.delete(attemptId);
      liveAttemptIds.delete(attemptId);
    },

    /**
     * @param {(end: import('./engine.js').AttemptEnd) => Promise<void> | void} handler
     * @returns {void}
     */
    onEnd(handler) {
      listeners.push(handler);
    },

    // ---- test affordances -------------------------------------------------

    /** Every attempt ever started, in order. */
    get started() {
      return startLog;
    },

    /**
     * Drop every attempt from `inspect()` without aborting and without
     * `onEnd` — the crash / display-sleep analogue. Generations may keep
     * streaming; {@link cancelOrphanedRunnerGenerations} reaps them.
     *
     * @returns {void}
     */
    vanishAll() {
      for (const entry of running.values()) {
        entry.stopped = true;
        liveAttemptIds.delete(entry.attemptId);
      }
      running.clear();
    },
  };
}
