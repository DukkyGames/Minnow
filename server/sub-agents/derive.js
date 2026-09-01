/**
 * P8-C — `derive(events) -> AgentsState`.
 *
 * The only way sub-agent state is produced. A renderer reload and a server
 * restart are both this function: replay.
 *
 * ## There are no counters
 *
 * Attempt counts are a filter over the journal — see {@link attemptCount}.
 * Do not add a retry field that is incremented. If the fold is slow, that is
 * a snapshot problem (P0-G's shape), not a reason to cache a count.
 *
 * ## Totality
 *
 * Malformed lines and unknown types are skipped. The fold has no throw path.
 *
 * ## Purity
 *
 * No clock. `ts` and `requestedAt` are stored for display; scheduling never
 * reads them. Replaying a journal twice must produce identical state.
 */

import { validateEvent } from './events.js';

/**
 * Shipped default from `sub-agents.json` *values*. The core never reads the
 * file; tests and `plan()` take caps as arguments instead.
 */
export const DEFAULT_GLOBAL_MAX_CONCURRENT = 3;

/** Shipped per-type default from `sub-agents.json` *values*. */
export const DEFAULT_TYPE_MAX_CONCURRENT = 2;

/**
 * Journal namespace P8-B added. Documented here so the graph and the store
 * agree on the path `~/.minnow/agents/<parentChatId>/` without this module
 * touching the filesystem.
 */
export const AGENTS_NAMESPACE = 'agents';

/**
 * @returns {import('./types').AgentsState}
 */
export function emptyState() {
  return {
    parentChatId: '',
    status: 'idle',
    runs: new Map(),
    runOrder: [],
  };
}

/**
 * Fold events into an existing state, in place, and recompute phases.
 *
 * @param {import('./types').AgentsState} state
 * @param {Iterable<unknown>} events
 * @returns {import('./types').AgentsState} the same object, for chaining
 */
export function foldInto(state, events) {
  if (!events || typeof (/** @type {any} */ (events)[Symbol.iterator]) !== 'function') {
    recompute(state);
    return state;
  }

  for (const raw of events) {
    const checked = validateEvent(raw);
    if (!checked.ok || !checked.known) continue;
    apply(state, /** @type {any} */ (checked.event));
  }

  recompute(state);
  return state;
}

/**
 * Fold a journal into sub-agent state.
 *
 * @param {Iterable<unknown>} events
 * @returns {import('./types').AgentsState}
 */
export function derive(events) {
  return foldInto(emptyState(), events);
}

/**
 * Byte-stable snapshot of derived state, so a test can assert replay identity
 * without depending on Map object identity.
 *
 * @param {import('./types').AgentsState} state
 * @returns {string}
 */
export function serializeState(state) {
  const runs = state.runOrder.map((id) => {
    const run = state.runs.get(id);
    if (!run) return { runId: id };
    return {
      runId: run.runId,
      type: run.type,
      task: run.task,
      parentChatId: run.parentChatId,
      cwd: run.cwd,
      requestedAt: run.requestedAt,
      phase: run.phase,
      abandonedReason: run.abandonedReason,
      abandonedEvidence: run.abandonedEvidence,
      cancelledReason: run.cancelledReason,
      delivered: run.delivered,
      deliveredSkipReason: run.deliveredSkipReason,
      nudged: run.nudged,
      parentTurnId: run.parentTurnId,
      parentToolCallId: run.parentToolCallId,
      model: run.model,
      attempts: run.attempts.map((a) => ({
        attemptId: a.attemptId,
        seedKind: a.seedKind,
        seed: a.seed,
        model: a.model,
        ended: a.ended,
        outcome: a.outcome,
        summary: a.summary,
        evidence: a.evidence,
        usage: a.usage,
      })),
    };
  });
  return JSON.stringify({
    parentChatId: state.parentChatId,
    status: state.status,
    runOrder: state.runOrder,
    runs,
  });
}

/**
 * Wire form of derived state. Maps do not survive `JSON.stringify`; this is
 * the same canonical shape {@link serializeState} uses, as an object.
 *
 * @param {import('./types').AgentsState} state
 * @returns {Record<string, unknown>}
 */
export function stateToJSON(state) {
  return JSON.parse(serializeState(state));
}

/**
 * @param {import('./types').AgentsState} state
 * @param {any} event
 * @returns {void}
 */
function apply(state, event) {
  switch (event.type) {
    case 'run.requested': {
      if (state.runs.has(event.runId)) return;
      if (!state.parentChatId && typeof event.parentChatId === 'string') {
        state.parentChatId = event.parentChatId;
      }
      state.runs.set(event.runId, newRun(event));
      state.runOrder.push(event.runId);
      return;
    }

    case 'attempt.started': {
      const run = state.runs.get(event.runId);
      if (!run) return;
      if (run.attempts.some((a) => a.attemptId === event.attemptId)) return;
      const seed =
        event.seed && typeof event.seed === 'object' && !Array.isArray(event.seed)
          ? event.seed
          : null;
      const seedKind =
        typeof event.seedKind === 'string'
          ? event.seedKind
          : typeof seed?.kind === 'string'
            ? seed.kind
            : 'initial';
      run.attempts.push({
        attemptId: event.attemptId,
        seedKind,
        seed,
        model: readModel(event.model),
        ended: false,
        outcome: null,
        summary: null,
        evidence: null,
        usage: null,
      });
      return;
    }

    case 'attempt.ended': {
      const run = state.runs.get(event.runId);
      if (!run) return;
      let attempt = run.attempts.find((a) => a.attemptId === event.attemptId);
      if (!attempt) {
        // Missing `started` would undercount, and the count is what policy runs on.
        attempt = {
          attemptId: event.attemptId,
          seedKind: null,
          seed: null,
          model: null,
          ended: false,
          outcome: null,
          summary: null,
          evidence: null,
          usage: null,
        };
        run.attempts.push(attempt);
      }
      if (attempt.ended) return;
      attempt.ended = true;
      attempt.outcome = event.outcome;
      attempt.summary = event.summary ?? null;
      attempt.evidence = event.evidence ?? null;
      attempt.usage = event.usage ?? null;
      return;
    }

    case 'run.abandoned': {
      const run = state.runs.get(event.runId);
      if (!run) return;
      run.abandonedReason = event.reason;
      run.abandonedEvidence = event.evidence ?? null;
      closeOpenAttempts(run);
      return;
    }

    case 'run.cancelled': {
      const run = state.runs.get(event.runId);
      if (!run) return;
      run.cancelledReason = 'user';
      closeOpenAttempts(run);
      return;
    }

    case 'result.delivered': {
      const run = state.runs.get(event.runId);
      if (!run) return;
      run.delivered = true;
      if (event.skipReason === 'missing_chat' || event.skipReason === 'orchestrate') {
        run.deliveredSkipReason = event.skipReason;
      }
      if (!state.parentChatId && typeof event.parentChatId === 'string') {
        state.parentChatId = event.parentChatId;
      }
      return;
    }

    case 'run.nudged': {
      const run = state.runs.get(event.runId);
      if (!run) return;
      run.nudged = true;
      return;
    }

    // No default. Unknown types never reach here.
  }
}

/**
 * A user cancel (and an abandon, if one ever races an open attempt) must close
 * the in-flight attempt in the fold. Leaving it open would make `reapVanished`
 * journal `crashed` for work the user stopped — a cancel is not a failure.
 *
 * @param {import('./types').RunState} run
 * @returns {void}
 */
function closeOpenAttempts(run) {
  for (const attempt of run.attempts) {
    if (!attempt.ended) attempt.ended = true;
  }
}

/**
 * @param {any} event
 * @returns {import('./types').RunState}
 */
function newRun(event) {
  return {
    runId: event.runId,
    type: String(event.agentType ?? ''),
    task: String(event.task ?? ''),
    parentChatId: String(event.parentChatId ?? ''),
    cwd: String(event.cwd ?? ''),
    requestedAt: Number.isSafeInteger(event.requestedAt) ? event.requestedAt : null,
    phase: 'idle',
    attempts: [],
    abandonedReason: null,
    abandonedEvidence: null,
    cancelledReason: null,
    delivered: false,
    deliveredSkipReason: null,
    nudged: false,
    parentTurnId: typeof event.parentTurnId === 'string' && event.parentTurnId ? event.parentTurnId : null,
    parentToolCallId:
      typeof event.parentToolCallId === 'string' && event.parentToolCallId
        ? event.parentToolCallId
        : null,
    model: readModel(event.model),
  };
}

/**
 * @param {unknown} raw
 * @returns {{ providerId: string, id: string } | null}
 */
function readModel(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = /** @type {Record<string, unknown>} */ (raw);
  if (typeof rec.providerId !== 'string' || rec.providerId.length === 0) return null;
  if (typeof rec.id !== 'string' || rec.id.length === 0) return null;
  return { providerId: rec.providerId, id: rec.id };
}

/**
 * @param {import('./types').AgentsState} state
 * @returns {void}
 */
function recompute(state) {
  let live = false;
  for (const run of state.runs.values()) {
    run.phase = phaseOf(run);
    if (!isTerminal(run)) live = true;
  }
  state.status = live ? 'running' : 'idle';
}

/**
 * Phase is computed from the record, not maintained incrementally — so there
 * is no transition table to get wrong.
 *
 * @param {import('./types').RunState} run
 * @returns {import('./types').RunPhase}
 */
function phaseOf(run) {
  if (run.cancelledReason !== null) return 'cancelled';
  if (run.abandonedReason !== null) return 'abandoned';
  const open = run.attempts.find((a) => !a.ended);
  if (open) return 'running';
  const last = lastEndedAttempt(run);
  if (last?.outcome === 'pass') return 'passed';
  return 'idle';
}

/**
 * A run that should never receive another attempt.
 *
 * Passed is terminal for scheduling even before `result.delivered` — delivery
 * is P8-E, and starting a second attempt after a pass would duplicate work.
 *
 * @param {import('./types').RunState} run
 * @returns {boolean}
 */
export function isTerminal(run) {
  return run.phase === 'passed' || run.phase === 'abandoned' || run.phase === 'cancelled';
}

/**
 * @param {import('./types').RunState} run
 * @returns {import('./types').Attempt | undefined}
 */
export function lastEndedAttempt(run) {
  for (let i = run.attempts.length - 1; i >= 0; i -= 1) {
    const attempt = run.attempts[i];
    if (attempt.ended) return attempt;
  }
  return undefined;
}

/**
 * How many attempts have finished for a run. The single accessor — there is
 * no stored counter to read instead.
 *
 * @param {import('./types').AgentsState} state
 * @param {string} runId
 * @returns {number}
 */
export function attemptCount(state, runId) {
  const run = state.runs.get(runId);
  if (!run) return 0;
  let n = 0;
  for (const attempt of run.attempts) {
    if (attempt.ended) n += 1;
  }
  return n;
}

/**
 * Runs whose terminal event has no matching `result.delivered`.
 *
 * This is the durable queue MIN-639 asked for: a completion stays pending
 * until the journal records that it was known delivered. A process-lifetime
 * Set cannot survive reload; this list can.
 *
 * @param {import('./types').AgentsState} state
 * @returns {import('./types').RunState[]}
 */
export function pendingDeliveries(state) {
  if (!state) return [];
  /** @type {import('./types').RunState[]} */
  const out = [];
  for (const id of state.runOrder) {
    const run = state.runs.get(id);
    if (!run) continue;
    if (!isTerminal(run)) continue;
    if (run.delivered) continue;
    out.push(run);
  }
  return out;
}
