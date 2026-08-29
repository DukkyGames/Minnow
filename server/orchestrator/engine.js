/**
 * P1-B — the reconcile loop.
 *
 * ```
 * tick():
 *   state   = derive(journal)      // pure fold
 *   desired = plan(state)          // pure
 *   actual  = effector.inspect()   // what processes exist
 *   diff(desired, actual) -> start / stop
 * ```
 *
 * Self-healing is not a feature here, it is a consequence. If a process died,
 * `actual` lacks it, so the next tick starts it again. A crashed agent, a hung
 * agent, and an agent that vanished while the display slept are the same case,
 * handled by the same code as starting work normally.
 *
 * ## What must not be written
 *
 * No stall detector. No watchdog. No nudge. No `MISSING_REPORT_NUDGE_CAP`. No
 * deferred continuation, no `runAfterChatRelease`, no `flushChatContinuationIfIdle`,
 * no microtask retry. No display-wake reconciler, no boot-resume, no OOM-pause
 * repair.
 *
 * If a bug seems to need one of these, the bug is in `plan()` or in the tick
 * triggers. Adding a repair mechanism is how V1 reached 26,657 lines.
 *
 * ## Tick triggers, and only these
 *
 * 1. A journal append.
 * 2. An attempt ending.
 * 3. A timer, as a safety net rather than as the mechanism.
 */

import {
  isReadyForFinalTest,
  isRunComplete,
  nextAction,
  pendingAbandonments,
  pendingEnqueues,
  pendingSkips,
  plan,
} from './core/plan.js';
import { makeEvent } from './core/events.js';
import { foldInto } from './core/derive.js';
import * as diskJournal from './journal.js';

/** How often the safety-net tick fires. */
export const DEFAULT_TICK_MS = 5_000;

/**
 * The only place this module reads a clock or schedules anything.
 *
 * Injectable so the conformance suite can drive time directly: a scheduler
 * whose tests wait on real timers is a slow, flaky scheduler.
 */
export const systemClock = {
  now: () => Date.now(),
  /**
   * @param {() => void} fn
   * @param {number} ms
   * @returns {unknown}
   */
  setTimer: (fn, ms) => setTimeout(fn, ms),
  /** @param {unknown} handle */
  clearTimer: (handle) => clearTimeout(/** @type {NodeJS.Timeout} */ (handle)),
};

/**
 * Do a desire and a running attempt refer to the same work?
 *
 * Matched on `{ taskId, role }` rather than on array position or on attempt id,
 * because the engine's question is "is this work happening", not "is this exact
 * process the one I started".
 *
 * @param {{ taskId: string | null, role: string }} a
 * @param {{ taskId: string | null, role: string }} b
 * @returns {boolean}
 */
function sameWork(a, b) {
  return a.role === b.role && (a.taskId ?? null) === (b.taskId ?? null);
}

/**
 * Roles the engine journals as task attempts.
 *
 * `merge` and `final` are engine-driven and have their own vocabulary —
 * `merge.succeeded` / `merge.conflicted` and `final.test.ended` — so they never
 * produce `task.attempt.*` lines. A merge's attempt record is synthesised by the
 * fold from `merge.enqueued`, which is already on the journal before it runs.
 *
 * @param {string} role
 * @returns {boolean}
 */
function isAgentRole(role) {
  return role === 'builder' || role === 'tester';
}

/**
 * @typedef {object} Effector
 * @property {() => Array<{ taskId: string | null, role: string, attemptId: string, handle?: unknown }>} inspect
 *   What is running right now. The engine's only view of reality.
 *
 *   **An attempt must keep appearing here until the `onEnd` handler for it has
 *   resolved.** Dropping it earlier opens a window in which the engine sees the
 *   work as neither running nor finished, and starts a second copy of it. An
 *   attempt that is genuinely gone — killed, vanished — simply stops appearing,
 *   with no end delivered, and the next tick restarts it.
 * @property {(desired: import('./core/types').Desired) => Promise<{ attemptId: string, worktree?: string }>} start
 *   Resolves once the process **exists**. That resolution is what licenses the
 *   `task.attempt.started` append.
 * @property {(attemptId: string) => Promise<void>} stop
 * @property {(handler: (end: AttemptEnd) => Promise<void> | void) => void} [onEnd]
 *   Called when an attempt finishes, with its outcome. Without this the engine
 *   would have to poll for completion, and a poller is a watchdog by another name.
 */

/**
 * @typedef {object} AttemptEnd
 * @property {string} attemptId
 * @property {string | null} taskId
 * @property {string} role
 * @property {string} outcome
 * @property {string} [summary]
 * @property {Record<string, unknown>} [evidence]
 * @property {string} [sha]      merge only
 * @property {string[]} [files]  merge conflict only
 * @property {string} [runInstructions]  final only
 */

/**
 * Create the engine for one board.
 *
 * @param {{
 *   boardId: string,
 *   effector: Effector,
 *   clock?: typeof systemClock,
 *   tickMs?: number,
 *   journal?: typeof diskJournal,
 * }} options
 */
export function createEngine(options) {
  const { boardId, effector } = options;
  const clock = options.clock ?? systemClock;
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS;
  // The store is a seam so the conformance suite can run the scheduler against
  // an in-memory journal. Durability is P1-A's property and is tested there; a
  // scheduler suite that pays for a filesystem write on every tick is a
  // scheduler suite nobody runs.
  const journal = options.journal ?? diskJournal;

  /** @type {import('./core/types').BoardState | null} */
  let state = null;
  /** @type {unknown} */
  let timer = null;
  let ticking = false;
  let dirty = false;
  let disposed = false;

  /** @type {Set<(event: Record<string, unknown>) => void>} */
  const subscribers = new Set();

  /**
   * Attempts whose `task.attempt.started` is on the journal.
   *
   * @type {Set<string>}
   */
  const journaledStarts = new Set();

  /**
   * Ends that arrived before their start was journaled.
   *
   * A process can exit before the engine has finished writing the line that says
   * it began — the effector resolves `start()`, and the exit can land in the very
   * next microtask, while the append is still in flight. Journaling the ending
   * first would put a `task.attempt.ended` on the journal ahead of its
   * `task.attempt.started`, which the fold reads as an attempt nobody started.
   *
   * Bounded by the number of attempts in flight.
   *
   * @type {Map<string, AttemptEnd>}
   */
  const bufferedEnds = new Map();

  /**
   * Append and advance the in-memory state.
   *
   * The state is kept incrementally rather than re-folded per tick — `foldInto`
   * is proven equivalent to a full fold, and re-reading the journal on every
   * tick of a six-hour run is the one avoidable cost in the loop. The engine is
   * the board's only writer, so nothing else can move the journal underneath it;
   * `reload()` is there for the cases where that stops being true.
   *
   * @param {Record<string, unknown>[]} events
   * @returns {Promise<Record<string, unknown>[]>}
   */
  async function append(events) {
    if (events.length === 0) return [];
    const stamped =
      events.length === 1
        ? [await journal.appendEvent(boardId, events[0], { now: clock.now })]
        : await journal.appendEvents(boardId, events, { now: clock.now });
    foldInto(/** @type {import('./core/types').BoardState} */ (state), stamped);
    for (const event of stamped) {
      for (const subscriber of subscribers) {
        try {
          subscriber(event);
        } catch {
          // A broken subscriber must not break the engine.
        }
      }
    }
    return stamped;
  }

  /**
   * Journal every decision the current state already implies.
   *
   * Loops because one decision can imply the next: abandoning a task strands
   * everything downstream, and those skips are only visible once the
   * abandonment is on the journal. Bounded — each round moves at least one task
   * to a terminal phase, and there are finitely many tasks.
   *
   * @returns {Promise<boolean>} whether anything was written
   */
  async function journalImpliedDecisions() {
    let wroteAnything = false;
    for (let round = 0; round < 1000; round += 1) {
      const current = /** @type {import('./core/types').BoardState} */ (state);
      /** @type {Record<string, unknown>[]} */
      const decisions = [];

      for (const { taskId, reason, evidence } of pendingAbandonments(current)) {
        decisions.push(makeEvent('task.abandoned', { taskId, reason, evidence }));
      }
      for (const { taskId, blockedBy } of pendingSkips(current)) {
        decisions.push(makeEvent('task.skipped', { taskId, blockedBy }));
      }
      for (const taskId of pendingEnqueues(current)) {
        decisions.push(makeEvent('merge.enqueued', { taskId }));
      }

      if (decisions.length === 0) return wroteAnything;
      await append(decisions);
      wroteAnything = true;
    }
    return wroteAnything;
  }

  /**
   * One pass of the loop.
   *
   * @returns {Promise<void>}
   */
  async function runOnce() {
    if (disposed || !state) return;

    if (state.status === 'running') await journalImpliedDecisions();

    if (await reapVanished(effector.inspect())) {
      // Reaping changed the state, so re-decide against what it now says rather
      // than acting on the state we read before it.
      dirty = true;
      return;
    }

    const desired = plan(/** @type {import('./core/types').BoardState} */ (state));
    const actual = effector.inspect();

    // Stop what is running and no longer wanted. Stopping comes first so a
    // concurrency reduction frees its slot before anything tries to fill it.
    for (const running of actual) {
      if (!desired.some((d) => sameWork(d, running))) {
        await effector.stop(running.attemptId);
      }
    }

    // Start what is wanted and not running.
    for (const want of desired) {
      if (actual.some((r) => sameWork(want, r))) continue;
      await startAttempt(want);
    }

    if (state.status === 'running' && isRunComplete(state)) {
      await append([
        makeEvent('run.finished', { summary: runSummary(state) }),
        makeEvent('board.stopped', { reason: 'complete' }),
      ]);
      stopTimer();
    }
  }

  /**
   * Record attempts the journal says are open but that no longer exist.
   *
   * This is not a watchdog and not a repair path — it is the same
   * `desired`-versus-`actual` diff as everything else, applied to the one case
   * where reality is *behind* the journal rather than ahead of it. The process
   * is gone, so it ended; `crashed` is exactly the outcome the six-way union
   * carries for "the runner produced this, the agent never reported".
   *
   * Without it a vanished attempt stays open in the fold forever, the task reads
   * as permanently in flight, and `nextAction` never advances it — a silent,
   * permanent stall, which is the precise failure this engine exists to abolish.
   *
   * Merge and final attempts are left alone: they have no `task.attempt.started`
   * line, and the merge queue already re-desires its head on the next tick.
   *
   * @param {Array<{ attemptId: string }>} actual
   * @returns {Promise<boolean>} whether anything was recorded
   */
  async function reapVanished(actual) {
    if (!state) return false;
    const live = new Set(actual.map((r) => r.attemptId));

    /** @type {Record<string, unknown>[]} */
    const ended = [];
    for (const task of state.tasks.values()) {
      for (const attempt of task.attempts) {
        if (attempt.ended) continue;
        if (!isAgentRole(attempt.role)) continue;
        if (live.has(attempt.attemptId)) continue;
        // Its real outcome is already in hand and about to be journaled.
        if (bufferedEnds.has(attempt.attemptId)) continue;
        ended.push(
          makeEvent('task.attempt.ended', {
            taskId: task.id,
            attemptId: attempt.attemptId,
            role: attempt.role,
            outcome: 'crashed',
            summary: 'the process was no longer running',
          }),
        );
        journaledStarts.delete(attempt.attemptId);
      }
    }

    if (ended.length === 0) return false;
    await append(ended);
    return true;
  }

  /**
   * @param {import('./core/types').Desired} want
   * @returns {Promise<void>}
   */
  async function startAttempt(want) {
    /** @type {{ attemptId: string, worktree?: string }} */
    let handle;
    try {
      handle = await effector.start(want);
    } catch (err) {
      // The process does not exist, so nothing is journaled — there is no effect
      // to record. The next tick tries again, which is the whole recovery story.
      console.warn(
        `[orchestrator] ${boardId}: could not start ${want.role} for ${want.taskId}:`,
        /** @type {Error} */ (err)?.message ?? err,
      );
      return;
    }

    // The process exists. Only now is there a completed side effect to record.
    if (!isAgentRole(want.role)) return;

    await append([
      makeEvent('task.attempt.started', {
        taskId: want.taskId,
        attemptId: handle.attemptId,
        role: want.role,
        ...(handle.worktree ? { worktree: handle.worktree } : {}),
        ...(want.seedKind ? { seedKind: want.seedKind } : {}),
      }),
    ]);
    journaledStarts.add(handle.attemptId);

    // If it already finished while that write was in flight, deal with it now,
    // in the right order.
    const early = bufferedEnds.get(handle.attemptId);
    if (early) {
      bufferedEnds.delete(handle.attemptId);
      await handleAttemptEnd(early);
    }
  }

  /**
   * An attempt finished. Journal what it did, then let the next tick decide what
   * follows — the policy lives in `plan()`, not here.
   *
   * @param {AttemptEnd} end
   * @returns {Promise<void>}
   */
  async function handleAttemptEnd(end) {
    if (disposed || !state) return;

    // Hold it until its start is on the journal — see `bufferedEnds`.
    if (isAgentRole(end.role) && !journaledStarts.has(end.attemptId)) {
      bufferedEnds.set(end.attemptId, end);
      return;
    }
    journaledStarts.delete(end.attemptId);

    /** @type {Record<string, unknown>[]} */
    const events = [];
    if (isAgentRole(end.role)) {
      events.push(
        makeEvent('task.attempt.ended', {
          taskId: end.taskId,
          attemptId: end.attemptId,
          role: end.role,
          outcome: end.outcome,
          ...(end.summary === undefined ? {} : { summary: end.summary }),
          ...(end.evidence === undefined ? {} : { evidence: end.evidence }),
        }),
      );
    } else if (end.role === 'merge') {
      events.push(
        end.outcome === 'pass'
          ? makeEvent('merge.succeeded', { taskId: end.taskId, sha: end.sha ?? 'unknown' })
          : makeEvent('merge.conflicted', { taskId: end.taskId, files: end.files ?? [] }),
      );
    } else if (end.role === 'final') {
      events.push(
        makeEvent('final.test.ended', {
          outcome: end.outcome === 'pass' ? 'pass' : 'fail',
          ...(end.runInstructions === undefined ? {} : { runInstructions: end.runInstructions }),
          ...(end.evidence === undefined ? {} : { evidence: end.evidence }),
        }),
      );
    }

    if (events.length > 0) await append(events);
    await tick();
  }

  /**
   * The tick.
   *
   * Idempotent and re-entrant-safe: a tick that fires during a tick sets a dirty
   * bit and the running pass re-runs once, rather than queueing an unbounded
   * chain of passes that all observe the same state.
   *
   * @returns {Promise<void>}
   */
  async function tick() {
    if (disposed) return;
    if (ticking) {
      dirty = true;
      return;
    }
    ticking = true;
    try {
      do {
        dirty = false;
        await runOnce();
      } while (dirty && !disposed);
    } finally {
      ticking = false;
    }
  }

  function startTimer() {
    if (timer !== null || disposed) return;
    const arm = () => {
      timer = clock.setTimer(() => {
        timer = null;
        void tick().then(() => {
          if (state?.status === 'running') arm();
        });
      }, tickMs);
    };
    arm();
  }

  function stopTimer() {
    if (timer === null) return;
    clock.clearTimer(timer);
    timer = null;
  }

  return {
    /**
     * Read the board from the journal and wire up the effector.
     *
     * @returns {Promise<void>}
     */
    async load() {
      state = await journal.loadState(boardId);
      // Returned, not fire-and-forget: the effector keeps the attempt visible to
      // `inspect()` until this resolves, which is what stops a tick landing in
      // the gap between "finished" and "recorded as finished".
      effector.onEnd?.((end) => handleAttemptEnd(end));
      if (state.status === 'running') startTimer();
    },

    /**
     * Re-read the journal from disk, discarding the in-memory fold.
     *
     * @returns {Promise<void>}
     */
    async reload() {
      state = await journal.loadState(boardId);
    },

    /** @returns {import('./core/types').BoardState} */
    getState() {
      if (!state) throw new Error('engine not loaded');
      return state;
    },

    /** @returns {Promise<Record<string, unknown>[]>} */
    getEvents() {
      return journal.readEvents(boardId);
    },

    /**
     * @param {Record<string, unknown>[]} events
     * @returns {Promise<Record<string, unknown>[]>}
     */
    append(events) {
      return append(events);
    },

    /**
     * @param {number} concurrency
     * @returns {Promise<void>}
     */
    async startBoard(concurrency) {
      await append([makeEvent('board.started', { concurrency })]);
      startTimer();
      await tick();
    },

    /**
     * @param {import('./core/types').StopReason} [reason]
     * @returns {Promise<void>}
     */
    async stopBoard(reason = 'user') {
      await append([makeEvent('board.stopped', { reason })]);
      stopTimer();
      // Stopping is a reconcile like any other: `plan()` now desires nothing, so
      // the diff stops everything. There is no separate teardown path.
      await tick();
    },

    /**
     * `board.started` is the only carrier of concurrency, so changing it is
     * simply starting the board again at a different number.
     *
     * @param {number} concurrency
     * @returns {Promise<void>}
     */
    async setConcurrency(concurrency) {
      await append([makeEvent('board.started', { concurrency })]);
      startTimer();
      await tick();
    },

    /**
     * Start one task now, outside the concurrency cap.
     *
     * A human asking for a specific task is an external input like any other
     * command. What it produces is an ordinary `task.attempt.started`, so replay
     * is unaffected — the journal records that the attempt happened, not that a
     * person asked for it.
     *
     * @param {string} taskId
     * @returns {Promise<boolean>} whether anything was started
     */
    async startTask(taskId) {
      if (!state) throw new Error('engine not loaded');
      const next = nextAction(state, taskId);
      if (next.kind !== 'start') return false;
      if (effector.inspect().some((r) => r.taskId === taskId)) return false;
      await startAttempt({
        taskId,
        role: next.role,
        seedKind: next.seedKind,
        sameWorktree: next.sameWorktree,
      });
      await tick();
      return true;
    },

    tick,

    /**
     * @param {(event: Record<string, unknown>) => void} handler
     * @returns {() => void} unsubscribe
     */
    subscribe(handler) {
      subscribers.add(handler);
      return () => subscribers.delete(handler);
    },

    /** @returns {void} */
    dispose() {
      disposed = true;
      stopTimer();
      subscribers.clear();
    },
  };
}

/**
 * A one-line description of how the run went, for `run.finished`.
 *
 * Deliberately mechanical. The narrative report is P3-G's stateless LLM call
 * over the finished journal; nothing in the control plane writes prose.
 *
 * @param {import('./core/types').BoardState} state
 * @returns {string}
 */
function runSummary(state) {
  let merged = 0;
  let abandoned = 0;
  let skipped = 0;
  for (const task of state.tasks.values()) {
    if (task.phase === 'merged') merged += 1;
    else if (task.phase === 'abandoned') abandoned += 1;
    else if (task.phase === 'skipped') skipped += 1;
  }
  const parts = [`${merged} merged`];
  if (abandoned > 0) parts.push(`${abandoned} abandoned`);
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (state.finalTest) parts.push(`final test ${state.finalTest.outcome}`);
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** @type {Map<string, ReturnType<typeof createEngine>>} */
const engines = new Map();

/**
 * The live engine for a board, created on first use.
 *
 * @param {string} boardId
 * @param {() => Effector} makeEffector
 * @param {{ clock?: typeof systemClock, tickMs?: number }} [options]
 * @returns {Promise<ReturnType<typeof createEngine>>}
 */
export async function getEngine(boardId, makeEffector, options = {}) {
  const existing = engines.get(boardId);
  if (existing) return existing;
  const engine = createEngine({ boardId, effector: makeEffector(), ...options });
  engines.set(boardId, engine);
  await engine.load();
  return engine;
}

/**
 * @param {string} boardId
 * @returns {ReturnType<typeof createEngine> | undefined}
 */
export function peekEngine(boardId) {
  return engines.get(boardId);
}

/**
 * @param {string} [boardId]  all engines when omitted
 * @returns {void}
 */
export function disposeEngines(boardId) {
  if (boardId === undefined) {
    for (const engine of engines.values()) engine.dispose();
    engines.clear();
    return;
  }
  engines.get(boardId)?.dispose();
  engines.delete(boardId);
}

export { isReadyForFinalTest };
