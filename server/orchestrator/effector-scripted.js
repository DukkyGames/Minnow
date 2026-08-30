/**
 * P1-D — the scripted effector.
 *
 * Returns canned outcomes on a script, so the scheduler can be exercised
 * exhaustively without a model, a repo, or a process. **The scheduler must be
 * fully testable with zero model calls** (PRD §8) — in V1 scripted boards were a
 * dev affordance; here they are how correctness is established.
 *
 * ## Script format
 *
 * ```js
 * [{ match: { taskId?, role?, nth? },
 *    emit: { outcome, summary?, evidence?, sha?, files?, delayMs?, vanish? } }]
 * ```
 *
 * Deliberately close to `src/dev/orchestrate-scenarios/schema.ts` so its catalog
 * can be ported rather than reinvented. Rules are matched in order and the first
 * one that matches wins, so a general rule can be written last as a default.
 *
 * `nth` counts matches of *that rule*, 1-based, so `{ role: 'builder', nth: 1 }`
 * means "the first builder attempt this rule sees".
 *
 * ## `vanish`
 *
 * The entry disappears from `inspect()` with no end event at all, simulating a
 * killed process or a suspended display. The engine must restart it with no
 * special code — that is the property the whole architecture rests on.
 */

/**
 * @typedef {object} ScriptRule
 * @property {{ taskId?: string, role?: string, nth?: number }} [match]
 * @property {{
 *   outcome?: string,
 *   summary?: string,
 *   evidence?: Record<string, unknown>,
 *   sha?: string,
 *   files?: string[],
 *   delayMs?: number,
 *   vanish?: boolean,
 *   worktree?: string,
 * }} emit
 */

/**
 * Create a scripted effector.
 *
 * @param {{
 *   script?: ScriptRule[],
 *   clock?: { now: () => number, setTimer: (fn: () => void, ms: number) => unknown,
 *             clearTimer: (handle: unknown) => void },
 *   defaultOutcome?: string,
 * }} [options]
 */
export function createScriptedEffector(options = {}) {
  const script = options.script ?? [];
  const clock = options.clock ?? {
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(/** @type {NodeJS.Timeout} */ (handle)),
  };
  const defaultOutcome = options.defaultOutcome ?? 'pass';

  /** @type {Map<string, { taskId: string | null, role: string, attemptId: string, timer: unknown }>} */
  const running = new Map();
  /** @type {Array<(end: import('./engine.js').AttemptEnd) => void>} */
  const listeners = [];
  /** Per-rule match counts, for `nth`. @type {number[]} */
  const ruleHits = script.map(() => 0);

  /** Every attempt ever started, in order — the record a test asserts against. */
  /** @type {Array<{ taskId: string | null, role: string, attemptId: string, seedKind?: string }>} */
  const startLog = [];

  let nextId = 0;

  /**
   * @param {import('./core/types').Desired} desired
   * @returns {ScriptRule['emit']}
   */
  function resolveRule(desired) {
    for (let i = 0; i < script.length; i += 1) {
      const rule = script[i];
      const match = rule.match ?? {};
      if (match.taskId !== undefined && match.taskId !== desired.taskId) continue;
      if (match.role !== undefined && match.role !== desired.role) continue;
      ruleHits[i] += 1;
      if (match.nth !== undefined && match.nth !== ruleHits[i]) continue;
      return rule.emit;
    }
    return { outcome: defaultOutcome };
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
     * @param {import('./core/types').Desired} desired
     * @returns {Promise<{ attemptId: string }>}
     */
    async start(desired) {
      const attemptId = `s${(nextId += 1)}`;
      const emit = resolveRule(desired);
      startLog.push({
        taskId: desired.taskId,
        role: desired.role,
        attemptId,
        seedKind: desired.seedKind,
      });

      const entry = { taskId: desired.taskId, role: desired.role, attemptId, timer: null };
      running.set(attemptId, entry);

      if (emit.vanish) {
        // Gone without a trace: no end event, no exit code, nothing to observe
        // except its absence from `inspect()` on the next tick.
        running.delete(attemptId);
        return { attemptId };
      }

      const fire = async () => {
        if (!running.has(attemptId)) return;
        /** @type {import('./engine.js').AttemptEnd} */
        const end = {
          attemptId,
          taskId: desired.taskId,
          role: desired.role,
          outcome: emit.outcome ?? defaultOutcome,
          ...(emit.summary === undefined ? {} : { summary: emit.summary }),
          ...(emit.evidence === undefined ? {} : { evidence: emit.evidence }),
          ...(emit.sha === undefined ? {} : { sha: emit.sha }),
          ...(emit.files === undefined ? {} : { files: emit.files }),
        };
        if (desired.role === 'merge' && end.outcome === 'pass' && end.sha === undefined) {
          end.sha = `sha-${attemptId}`;
        }
        // The attempt stays visible to `inspect()` until the engine has finished
        // recording the end. Dropping it first would leave a window where the
        // work is neither running nor finished, and the next tick would start a
        // second copy of it.
        try {
          for (const listener of listeners) await listener(end);
        } finally {
          running.delete(attemptId);
        }
      };

      if (emit.delayMs) entry.timer = clock.setTimer(fire, emit.delayMs);
      // Fire on the next microtask rather than synchronously: `start()` must
      // resolve, and the engine must journal `task.attempt.started`, before the
      // end arrives. A synchronous end would let the engine journal an ending
      // for an attempt it has not yet recorded as started.
      else void Promise.resolve().then(fire);

      return {
        attemptId,
        ...(typeof emit.worktree === 'string' && emit.worktree ? { worktree: emit.worktree } : {}),
      };
    },

    /**
     * @param {string} attemptId
     * @returns {Promise<void>}
     */
    async stop(attemptId) {
      const entry = running.get(attemptId);
      if (!entry) return;
      if (entry.timer !== null) clock.clearTimer(entry.timer);
      running.delete(attemptId);
    },

    /**
     * @param {(end: import('./engine.js').AttemptEnd) => void} handler
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
     * Make everything currently running disappear with no end events — the
     * display-sleep analogue, and the OOM analogue.
     *
     * @returns {void}
     */
    vanishAll() {
      for (const entry of running.values()) {
        if (entry.timer !== null) clock.clearTimer(entry.timer);
      }
      running.clear();
    },
  };
}
