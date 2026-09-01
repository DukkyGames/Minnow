/**
 * P2-F — the runner effector.
 *
 * Same `inspect` / `start` / `stop` / `onEnd` contract as the scripted
 * effector (`effector-scripted.js`). The engine does not change: it still
 * journals `task.attempt.started` off `start()` resolving, and it still
 * requires the attempt to stay in `inspect()` until the `onEnd` handler
 * has resolved (see `engine.js` lines 99–120).
 *
 * Builder and Tester run through `runTurn`. Merge is the P3-C queue
 * (`merge-queue.js`) when worktrees are isolated. Final is the P3-F
 * static ladder in the integration worktree (`final-test.js`), unless
 * tests inject `runTurn` or `runFinalLadder`, or an explicit `cwd`
 * sandbox is in play (P2-G / scripted stay instant-pass).
 *
 * P3-A: builder/tester attempts run in an isolated worktree allocated
 * here and recorded only on `task.attempt.started`. The runner still
 * receives `cwd` as an argument and does not know what a board is.
 */

import { randomUUID } from 'node:crypto';

import {
  createInProcessToolDispatch,
  createMemoryTranscriptStore,
  headlessToolIdsForRole,
  postChatCompletionsInProcess,
  runTurn as defaultRunTurn,
} from '../runner/node.js';
import { BROWSER_DRIVER_TOOL_DEFINITIONS_BY_NAME } from '../tools/browser-driver-tool-defs.js';
import { cancel as cancelGeneration, listGenerationStates } from '../generations/store.js';
import { resolveLibraryAttemptBinding } from '../models/library-binding.js';
import { getProvider } from '../providers/store.js';
import { getWorkspaceRoot } from '../workspace/root.js';
import { peekEngine } from './engine.js';
import * as diskJournal from './journal.js';
import { attemptLimits } from './attempt-limits.js';
import { emitLive } from './live-events.js';
import { resolveAttemptModel } from './model-binding.js';
import { recordTranscriptEnd, recordTranscriptEvent } from './transcripts.js';
import { isHighFrequencyTurnEvent } from '../runner/turn-event.js';
import { interpolatePrompt, loadRolePrompt } from './prompts.js';
import {
  extractJsonTextFromAssistantBody,
  tryParseStructuredOutcomeFromAssistantProse,
} from '../runner/sub-agent-structured-outcome.js';
import { parseReportFor, reportToolFor, REPORT_TOOL_NAME } from './report-tool.js';
import { buildSeed } from './seeds.js';
import { runMerge } from './merge-queue.js';
import { finalAttemptEnd, formatRunInstructions, runFinalLadder } from './final-test.js';
import {
  allocateAttemptWorktree,
  commitAttemptWorktree,
  ensureBoardWorkspaceGit,
  INTEGRATION_SLOT,
  previousWorktreeForTask,
  releaseWorktree,
  shouldKeepWorktree,
  slotIdFromWorktreePath,
} from './worktree-lifecycle.js';
import { getWorktreeSlotPath } from '../worktree/paths.js';

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
 * OpenAI function stubs for a role's tool subset. Full parameter schemas live
 * in the renderer catalog (`src/tools/definitions.ts`); the server must not
 * import that TS module. Names are what the allow-list and dispatch key on.
 *
 * P5-B: the ids come from `headlessToolIdsForRole`, which is where "browser
 * tools are Final-Tester-only" is decided. Browser tools carry real schemas
 * because they have no renderer catalog entry to fall back on.
 *
 * @param {string} role
 * @returns {import('../runner/run-turn').TurnToolDefinition[]}
 */
function headlessToolDefs(role) {
  return headlessToolIdsForRole(role).map(
    (name) =>
      BROWSER_DRIVER_TOOL_DEFINITIONS_BY_NAME[name] ?? {
        type: 'function',
        function: {
          name,
          description: name,
          parameters: { type: 'object', additionalProperties: true },
        },
      },
  );
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
  // What this attempt cost. Carried on every outcome, including `crashed` and
  // `timeout` — an attempt that burned tokens and produced nothing is the one
  // most worth costing. P5-D sums these across a run; without them "what did
  // the run cost in tokens" has no answer.
  if (result.usage && typeof result.usage === 'object') {
    const usage = {};
    for (const [key, value] of Object.entries(result.usage)) {
      if (typeof value === 'number' && Number.isFinite(value)) usage[key] = value;
    }
    if (Object.keys(usage).length > 0) end.usage = usage;
  }
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
 * Last committed assistant prose on a memory transcript.
 * Tool-call-only rows are skipped — those are not a dumped report.
 *
 * @param {unknown} messages
 * @returns {string}
 */
function lastAssistantProse(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const row = messages[i];
    if (!row || typeof row !== 'object') continue;
    if (/** @type {{ role?: string }} */ (row).role !== 'assistant') continue;
    const toolCalls = /** @type {{ tool_calls?: unknown }} */ (row).tool_calls;
    if (Array.isArray(toolCalls) && toolCalls.length > 0) continue;
    const text =
      typeof /** @type {{ content?: unknown }} */ (row).content === 'string'
        ? /** @type {{ content: string }} */ (row).content.trim()
        : '';
    if (text) return text;
  }
  return '';
}

/**
 * Map a sub-agent findings dump onto a board TurnResult.
 * Blocker findings are fail (tester/final) or blocked (builder); warn is fail;
 * info-only or empty findings is pass so a clean dump is not abandoned.
 *
 * @param {{ summary: string, findings?: Array<{ title?: string, detail?: string, severity?: string, paths?: string[] }>, artifacts?: Array<{ ref?: string }> }} structured
 * @param {'builder' | 'tester' | 'final'} role
 * @returns {import('../runner/run-turn').TurnResult}
 */
function turnResultFromFindingsDump(structured, role) {
  const findings = Array.isArray(structured.findings) ? structured.findings : [];
  const artifacts = Array.isArray(structured.artifacts) ? structured.artifacts : [];
  const summary = structured.summary;
  const details = findings
    .map((finding) => {
      const title = typeof finding.title === 'string' ? finding.title : '';
      const detail = typeof finding.detail === 'string' ? finding.detail : '';
      return [title, detail].filter(Boolean).join(': ');
    })
    .filter(Boolean);
  const evidence = [
    ...findings.flatMap((finding) =>
      Array.isArray(finding.paths)
        ? finding.paths.filter((path) => typeof path === 'string')
        : [],
    ),
    ...artifacts
      .map((artifact) => (typeof artifact.ref === 'string' ? artifact.ref : ''))
      .filter(Boolean),
  ];
  const hasBlocker = findings.some((finding) => finding.severity === 'blocker');
  const hasWarn = findings.some((finding) => finding.severity === 'warn');
  const testerLike = role === 'tester' || role === 'final';
  if (hasBlocker) {
    if (testerLike) {
      return { outcome: 'fail', summary, blockers: details.length ? details : evidence };
    }
    return { outcome: 'blocked', summary, needs: details.length ? details : evidence };
  }
  if (hasWarn) {
    return { outcome: 'fail', summary, blockers: details.length ? details : evidence };
  }
  return { outcome: 'pass', summary, evidence };
}

/**
 * Boards require `report_outcome`. The inner loop used to ask for sub-agent
 * JSON instead, so agents dump `{ summary, findings, artifacts }` and
 * `runTurn` returns `no_report`. Accept that blob here (effector, not runner)
 * the same way sub-agents degrade prose — only when it parses.
 *
 * @param {import('../runner/run-turn').TurnResult} result
 * @param {unknown} messages
 * @param {'builder' | 'tester' | 'final'} role
 * @returns {import('../runner/run-turn').TurnResult}
 */
export function recoverBoardReportIfDumped(result, messages, role) {
  if (!result || result.outcome !== 'no_report') return result;
  if (role !== 'builder' && role !== 'tester' && role !== 'final') return result;
  const prose = lastAssistantProse(messages);
  if (!prose) return result;
  const parsed = parseReportFor(role)(extractJsonTextFromAssistantBody(prose));
  if (parsed.ok) return { ...result, ...parsed.result };
  const structured = tryParseStructuredOutcomeFromAssistantProse(prose);
  if (!structured) return result;
  return { ...result, ...turnResultFromFindingsDump(structured, role) };
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
 *   runFinalLadder?: typeof runFinalLadder,
 *   deps?: import('../runner/adapters').RunnerDeps,
 *   postChatCompletions?: import('../runner/adapters').PostChatCompletions,
 *   reapOrphans?: boolean,
 *   worktrees?: boolean,
 * }} [options]
 */
export function createRunnerEffector(options = {}) {
  const boardId = options.boardId;
  const journal = options.journal ?? diskJournal;
  const runTurnFn = options.runTurn ?? defaultRunTurn;
  const limits = attemptLimits(options.limits);
  const promptVariant = options.promptVariant === 'lite' ? 'lite' : 'full';
  // An explicit `cwd` is the P2-F test seam (sandbox / tmp). Production
  // (`createRunnerEffector({ boardId })`) allocates a worktree per attempt.
  const isolateWorktrees = options.worktrees ?? !(typeof options.cwd === 'string' && options.cwd.trim());
  const fallbackCwd = typeof options.cwd === 'string' && options.cwd.trim()
    ? options.cwd.trim()
    : getWorkspaceRoot();
  const ladderFn = typeof options.runFinalLadder === 'function' ? options.runFinalLadder : runFinalLadder;
  // Tests inject `runTurn` to fake builders. That is the "fake path" that
  // must not suddenly exec tsc against a throwaway repo at final.
  const usingFakeTurn = typeof options.runTurn === 'function';
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
   * @property {string} [worktree]
   * @property {string} [slotId]
   * @property {import('./core/types').Desired} [desired]
   */

  /** @type {Map<string, LiveAttempt>} */
  const running = new Map();
  /** @type {Array<(end: import('./engine.js').AttemptEnd) => Promise<void> | void>} */
  const listeners = [];
  /** @type {Array<{ taskId: string | null, role: string, attemptId: string, seedKind?: string, worktree?: string }>} */
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
   * Merge-without-worktrees (P2-G / explicit cwd) and Final under a fake
   * `runTurn` / scripted path. Instant pass so those boards close without git
   * or a typechecker.
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
   * P3-F: run the fixed ladder in the integration worktree. Mechanical —
   * no model. Stays in `inspect()` until the AttemptEnd is delivered.
   *
   * @param {import('./core/types').Desired} desired
   * @returns {Promise<{ attemptId: string, worktree?: string }>}
   */
  async function startFinal(desired) {
    const attemptId = `r-${randomUUID()}`;
    const integrationCwd = boardId
      ? getWorktreeSlotPath(boardId, INTEGRATION_SLOT)
      : fallbackCwd;
    const entry = {
      taskId: desired.taskId,
      role: desired.role,
      attemptId,
      controller: new AbortController(),
      stopped: false,
      worktree: integrationCwd,
    };
    running.set(attemptId, entry);
    liveAttemptIds.add(attemptId);
    startLog.push({
      taskId: desired.taskId,
      role: desired.role,
      attemptId,
      seedKind: desired.seedKind,
      worktree: integrationCwd,
    });

    void (async () => {
      /** @type {import('./engine.js').AttemptEnd} */
      let end;
      try {
        const state = await currentState();
        const result = await ladderFn({
          cwd: integrationCwd,
          planPath: state.planPath || null,
          signal: entry.controller.signal,
        });
        end = finalAttemptEnd(attemptId, result);
      } catch (err) {
        // A throw must not take the engine down. Journal the failure with
        // a cwd the human can still open; do not reopen tasks from here.
        end = {
          attemptId,
          taskId: null,
          role: 'final',
          outcome: 'fail',
          summary: errorMessage(err),
          runInstructions: formatRunInstructions({
            command: '(ladder threw)',
            cwd: integrationCwd,
          }),
          evidence: {
            failedRung: null,
            output: errorMessage(err),
            cwd: integrationCwd,
          },
        };
      }
      if (entry.stopped) return;
      await deliverEnd(entry, end);
    })();

    return { attemptId, worktree: integrationCwd };
  }

  /**
   * P3-C: rebase-then-merge in the task worktree. Stays in `inspect()` until
   * the AttemptEnd is delivered, same contract as a builder turn.
   *
   * @param {import('./core/types').Desired} desired
   * @returns {Promise<{ attemptId: string }>}
   */
  async function startMerge(desired) {
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

    void (async () => {
      /** @type {import('./engine.js').AttemptEnd} */
      let end;
      /** @type {string | null} */
      let mergeWorktree = null;
      /** @type {string | null} */
      let mergeSlotId = null;
      try {
        const state = await currentState();
        mergeWorktree = desired.taskId ? previousWorktreeForTask(state, desired.taskId) : null;
        mergeSlotId =
          mergeWorktree && boardId ? slotIdFromWorktreePath(boardId, mergeWorktree) : null;
        end = await runMerge({
          boardId: /** @type {string} */ (boardId),
          taskId: desired.taskId,
          attemptId,
          state,
        });
      } catch (err) {
        // A throw must not take the engine down. Conflict the owner so
        // policy retries with a rebase seed rather than stalling the queue.
        end = {
          attemptId,
          taskId: desired.taskId,
          role: 'merge',
          outcome: 'conflicted',
          files: [],
          summary: errorMessage(err),
        };
      }
      // The tester kept this tree so rebase could see the committed work.
      // Success is on integration — release. A conflict must not: policy
      // retries the owning builder with a rebase seed in the same worktree
      // (MIN-707). P3-B abort left the tree at shaBefore, so the unique
      // commits are still checked out here for the owner to resolve.
      if (boardId && mergeSlotId && end.outcome === 'pass') {
        const released = await releaseWorktree({
          boardId,
          slotId: mergeSlotId,
          taskId: desired.taskId,
          worktree: mergeWorktree || undefined,
        });
        if (released.discarded && !end.discarded) end.discarded = released.discarded;
      }
      if (entry.stopped) return;
      await deliverEnd(entry, end);
    })();

    return { attemptId };
  }

  /**
   * Commit on pass (an uncommitted tree cannot merge) then release unless the
   * next start will reuse this path. Dirty removals travel on `end.discarded`
   * so the engine can journal them rather than dropping the work.
   *
   * @param {LiveAttempt} entry
   * @param {import('./core/types').Desired} desired
   * @param {import('../runner/run-turn').TurnResult} result
   */
  async function finishAgent(entry, desired, result) {
    if (entry.slotId && boardId && result.outcome === 'pass') {
      try {
        await commitAttemptWorktree({
          boardId,
          slotId: entry.slotId,
          message: `${desired.role} ${desired.taskId} pass`,
        });
      } catch (err) {
        console.warn(
          `[orchestrator] ${boardId}: commitWorktree failed for ${entry.attemptId}:`,
          errorMessage(err),
        );
      }
    }

    /** @type {Record<string, unknown> | null} */
    let discarded = null;
    if (entry.slotId && boardId) {
      let keep = false;
      try {
        const state = await currentState();
        keep = shouldKeepWorktree(state, desired, result.outcome);
      } catch {
        keep = false;
      }
      if (!keep) {
        const released = await releaseWorktree({
          boardId,
          slotId: entry.slotId,
          taskId: desired.taskId,
          attemptId: entry.attemptId,
          worktree: entry.worktree,
        });
        discarded = released.discarded;
      }
    }

    const end = toAttemptEnd(entry.attemptId, desired, result);
    if (discarded) end.discarded = discarded;
    await deliverEnd(entry, end);
  }

  return {
    /** @returns {Array<{ taskId: string | null, role: string, attemptId: string }>} */
    inspect() {
      return [...running.values()].map(({ taskId, role, attemptId, worktree }) => ({
        taskId,
        role,
        attemptId,
        ...(worktree ? { worktree } : {}),
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
     * Isolated-worktree boards also run MIN-615 git init here so a non-git
     * workspace fails on the Start button (400) instead of after parse.
     * Explicit `cwd` sandboxes stay git-free.
     *
     * My Models picker ids (`minnow-library` + `gguf:`/`mlx:`) are remapped
     * (and auto-loaded) here so a missing serve is a 400 on Start, not an
     * ENOENT after `task.attempt.started`. Remapped ids are not journaled.
     *
     * @returns {Promise<{ gitInitialized?: Record<string, unknown> } | void>}
     */
    async preflight() {
      const state = boardId || options.getState ? await currentState() : null;
      const model = await resolveAttemptModel(options.model ?? state?.model ?? null);
      await resolveLibraryAttemptBinding(model);
      await loadRolePrompt('builder', promptVariant);
      await loadRolePrompt('tester', promptVariant);
      if (!isolateWorktrees) return;
      const git = await ensureBoardWorkspaceGit();
      if (!git.ok) {
        throw new Error(git.error || 'Workspace is not a git repository');
      }
      if (git.event) return { gitInitialized: git.event };
    },

    /**
     * @param {import('./core/types').Desired} desired
     * @returns {Promise<{ attemptId: string, worktree?: string, discarded?: Record<string, unknown>[] }>}
     */
    async start(desired) {
      if (desired.role === 'final') {
        const hasLadderHook = typeof options.runFinalLadder === 'function';
        if (hasLadderHook || (isolateWorktrees && boardId && !usingFakeTurn)) {
          return startFinal(desired);
        }
        return startEngineDriven(desired);
      }
      if (desired.role === 'merge') {
        // Real merge when this board owns worktrees. Explicit `cwd` sandboxes
        // (P2-G, P2-F) have nothing to rebase — keep the instant pass.
        if (isolateWorktrees && boardId) return startMerge(desired);
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
      // option (tests) wins over both. My Models picker ids stay on the
      // journal; remap (and auto-load) only for this attempt's completions.
      const model = await resolveLibraryAttemptBinding(
        await resolveAttemptModel(options.model ?? state.model),
      );
      // P9-C: the board's reasoning control, the other half of binding a model
      // — a thinking model bound with thinking off is a different model in every
      // way that matters. Carried on the `TurnModel`, which is where `runTurn`
      // already looks before it falls back to the deps.
      const reasoning = options.model ? null : state.model?.reasoning ?? null;
      const thinkingOn =
        reasoning === 'on' ||
        reasoning === 'low' ||
        reasoning === 'medium' ||
        reasoning === 'high';
      const turnModel =
        reasoning === 'off'
          ? { ...model, thinking: { mode: 'off' } }
          : thinkingOn
            ? { ...model, thinking: { mode: 'on' } }
            : model;

      const attemptId = `r-${randomUUID()}`;
      /** @type {string} */
      let attemptCwd = fallbackCwd;
      /** @type {string | undefined} */
      let slotId;
      /** @type {Record<string, unknown>[]} */
      const discarded = [];
      /** @type {Record<string, unknown> | undefined} */
      let gitInitialized;

      if (isolateWorktrees) {
        if (!boardId) {
          throw new Error('runner effector: boardId is required to allocate a worktree');
        }
        const allocated = await allocateAttemptWorktree({
          boardId,
          taskId: desired.taskId,
          attemptId,
          desired,
          state,
        });
        if (!allocated.ok || !allocated.path || !allocated.slotId) {
          throw new Error(`runner effector: worktree allocate failed: ${allocated.error || 'unknown'}`);
        }
        attemptCwd = allocated.path;
        slotId = allocated.slotId;
        discarded.push(...allocated.discarded);
        if (allocated.gitInitialized) gitInitialized = allocated.gitInitialized;
      }

      const prompt = interpolatePrompt(
        await loadRolePrompt(desired.role, promptVariant),
        { cwd: attemptCwd },
      );
      const tools = [...headlessToolDefs(desired.role), reportToolFor(desired.role)];
      const dispatch = createInProcessToolDispatch({
        cwd: attemptCwd,
        allowedToolNames: headlessToolIdsForRole(desired.role),
      });

      const controller = new AbortController();
      const entry = {
        taskId: desired.taskId,
        role: desired.role,
        attemptId,
        controller,
        stopped: false,
        worktree: isolateWorktrees ? attemptCwd : undefined,
        slotId,
        desired,
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
        worktree: entry.worktree,
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
            cwd: attemptCwd,
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
            // Do not run the sub-agent JSON-only finalization. That prompt
            // forbids tools and asks for summary/findings/artifacts, which
            // this binding cannot accept as a report.
            finalizeStructuredOutcome: false,
            // Unattended: no human. Fabricated ask_question must fail immediately.
            ask: null,
            onEvent: (event) => {
              if (!boardId) return;
              // High-frequency types (stream_meta, phase, delta, …) would
              // flood live SSE across concurrent attempts. The recorder
              // also drops them — one predicate, both sinks (P10-B).
              if (!isHighFrequencyTurnEvent(event?.type)) {
                emitLive({
                  boardId,
                  attemptId,
                  taskId: desired.taskId,
                  role: desired.role,
                  event,
                });
              }
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
        result = recoverBoardReportIfDumped(
          result,
          deps.transcriptStore?.load?.(attemptId)?.messages,
          desired.role,
        );
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

      return {
        attemptId,
        ...(entry.worktree ? { worktree: entry.worktree } : {}),
        ...(discarded.length > 0 ? { discarded } : {}),
        ...(gitInitialized ? { gitInitialized } : {}),
      };
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
