/**
 * P8-C — `plan(state, caps) -> Desired[]`. Three rules, and nothing else.
 *
 * 1. A non-terminal run with nothing in flight should be running.
 * 2. Respect TWO caps: `globalMaxConcurrent` (default 3) and per-type
 *    `maxConcurrent` (default 2). Caps are arguments — this module never
 *    reads `sub-agents.json`.
 * 3. Never two attempts on one run.
 *
 * There is no `dependsOn`, no wave, no `touches`, no merge queue. Adding any
 * of those here is a copy of the board scheduler, not a derivation.
 *
 * ## Caps gate starting, not continuing
 *
 * Attempts already in flight keep their slot. Lowering a cap mid-run stops
 * nothing that is already running; it stops new work being picked up. The
 * invariant is therefore:
 *
 *   no tick starts work that would push in-flight attempts above the global
 *   cap OR the per-type cap
 *
 * not "at no tick do more than N attempts exist" — that wording is false
 * once a cap can move (P1-F invariant 1).
 */

import { attemptCount, DEFAULT_GLOBAL_MAX_CONCURRENT, DEFAULT_TYPE_MAX_CONCURRENT, isTerminal, lastEndedAttempt } from './derive.js';
import { bundleAbandonmentEvidence } from './evidence.js';
import { SUB_AGENT_ROLE } from './events.js';
import { decide } from './policy.js';

/**
 * Shipped defaults, as a fresh object so tests can mutate their own copy.
 *
 * @returns {import('./types').Caps}
 */
export function defaultCaps() {
  return {
    globalMaxConcurrent: DEFAULT_GLOBAL_MAX_CONCURRENT,
    maxConcurrentByType: {},
  };
}

/**
 * What should happen to a run that has nothing in flight.
 *
 * The only caller of `decide()`. Returns a `start` the scheduler can act on,
 * an `abandon` the engine must journal, or `none` (pass waits for P8-E;
 * cancel is already terminal in the fold).
 *
 * @param {import('./types').AgentsState} state
 * @param {string} runId
 * @returns {import('./types').NextAction}
 */
export function nextAction(state, runId) {
  const run = state.runs.get(runId);
  if (!run) return { kind: 'none' };
  if (isTerminal(run)) return { kind: 'none' };
  if (run.attempts.some((a) => !a.ended)) return { kind: 'none' };

  const last = lastEndedAttempt(run);
  if (!last) {
    return { kind: 'start', role: SUB_AGENT_ROLE, seedKind: 'initial' };
  }

  const action = decide({
    outcome: last.outcome ?? 'no_report',
    attemptCount: attemptCount(state, runId) - 1,
    summary: last.summary,
    evidence: last.evidence,
  });

  if (action.kind === 'retry') {
    return { kind: 'start', role: SUB_AGENT_ROLE, seedKind: action.seedKind };
  }
  if (action.kind === 'abandon') {
    return {
      kind: 'abandon',
      reason: action.reason,
      evidence: bundleAbandonmentEvidence(run, action),
    };
  }
  // `deliver` and `done`: the fold already treats pass/cancel as terminal
  // once those events exist. `result.delivered` is appended by delivery.js
  // after the parent resume is known delivered (P8-E).
  return { kind: 'none' };
}

/**
 * Runs the policy table has given up on. The engine journals `run.abandoned`
 * for each, carrying the evidence the decision was made on.
 *
 * @param {import('./types').AgentsState} state
 * @returns {Array<{ runId: string, reason: string, evidence: Record<string, unknown> }>}
 */
export function pendingAbandonments(state) {
  /** @type {Array<{ runId: string, reason: string, evidence: Record<string, unknown> }>} */
  const out = [];
  if (!state) return out;
  for (const runId of state.runOrder) {
    const next = nextAction(state, runId);
    if (next.kind === 'abandon') out.push({ runId, reason: next.reason, evidence: next.evidence });
  }
  return out;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function capOf(value, fallback) {
  if (!Number.isSafeInteger(value)) return fallback;
  return Math.max(0, /** @type {number} */ (value));
}

/**
 * Per-type cap for this run. Missing keys use the shipped default of 2.
 *
 * @param {import('./types').Caps | null | undefined} caps
 * @param {string} agentType
 * @returns {number}
 */
export function typeCap(caps, agentType) {
  const byType = caps?.maxConcurrentByType;
  if (byType && Number.isSafeInteger(byType[agentType])) {
    return capOf(byType[agentType], DEFAULT_TYPE_MAX_CONCURRENT);
  }
  return DEFAULT_TYPE_MAX_CONCURRENT;
}

/**
 * Which attempts should be running right now.
 *
 * @param {import('./types').AgentsState} state
 * @param {import('./types').Caps} [caps]
 * @returns {import('./types').Desired[]}
 */
export function plan(state, caps = defaultCaps()) {
  if (!state) return [];

  const globalCap = capOf(caps.globalMaxConcurrent, DEFAULT_GLOBAL_MAX_CONCURRENT);

  /** @type {import('./types').Desired[]} */
  const inFlight = [];
  for (const id of state.runOrder) {
    const run = state.runs.get(id);
    if (!run || isTerminal(run)) continue;
    const open = run.attempts.find((a) => !a.ended);
    if (!open) continue;
    inFlight.push({
      taskId: id,
      role: SUB_AGENT_ROLE,
      seedKind: /** @type {import('./types').SeedKind} */ (open.seedKind ?? 'initial'),
    });
  }

  // Work that already exists keeps its slot, even above either cap.
  /** @type {import('./types').Desired[]} */
  const desired = [...inFlight];

  /** @type {Set<string>} */
  const occupied = new Set(inFlight.map((d) => d.taskId));
  /** @type {Map<string, number>} */
  const typeLive = new Map();
  for (const d of inFlight) {
    const agentType = state.runs.get(d.taskId)?.type ?? '';
    typeLive.set(agentType, (typeLive.get(agentType) ?? 0) + 1);
  }

  let globalStarted = 0;
  /** @type {Map<string, number>} */
  const typeStarted = new Map();

  for (const id of state.runOrder) {
    if (occupied.has(id)) continue;
    const run = state.runs.get(id);
    if (!run || isTerminal(run)) continue;
    // Rule 3: never two attempts on one run.
    if (run.attempts.some((a) => !a.ended)) continue;

    const next = nextAction(state, id);
    if (next.kind !== 'start') continue;

    const liveGlobal = inFlight.length + globalStarted;
    if (liveGlobal >= globalCap) continue;

    const liveType = (typeLive.get(run.type) ?? 0) + (typeStarted.get(run.type) ?? 0);
    if (liveType >= typeCap(caps, run.type)) continue;

    desired.push({ taskId: id, role: SUB_AGENT_ROLE, seedKind: next.seedKind });
    occupied.add(id);
    globalStarted += 1;
    typeStarted.set(run.type, (typeStarted.get(run.type) ?? 0) + 1);
  }

  return desired;
}
