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
  manualStart,
  pendingAbandonments,
  pendingEnqueues,
  pendingSkips,
  plan,
} from './core/plan.js';
import { makeEvent } from './core/events.js';
import { foldInto } from './core/derive.js';
import * as diskJournal from './journal.js';
import { emitError } from './live-events.js';
import {
  integrationBranch,
  liveWorktreePaths,
  reconcileOrphanWorktrees,
  WORKTREE_DISCARDED_TYPE,
  BOARD_GIT_INITIALIZED_TYPE,
} from './worktree-lifecycle.js';
import { detectAttemptOverflow, captureWorktreeDiff } from './touches.js';
import {
  journalHasReport,
  REPORT_EVENT_TYPE,
  formatMechanicalReport,
  writeEndOfRunReport,
  defaultComplete,
} from './report.js';

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
 *   resolved.** This is the contract, and it is the one an implementation is
 *   most likely to break, because the obvious way to write a process runner —
 *   drop the child on `exit`, then deliver its outcome — breaks it by
 *   construction. Read the exit code, deliver the end, *await the handler*, and
 *   only then stop reporting the attempt.
 *
 *   Two things go wrong otherwise. A tick landing in the gap sees the work as
 *   neither running nor finished and starts a second copy of it. Worse, if
 *   `reapVanished` gets there first it journals `crashed` for an attempt that
 *   passed — silently burning that task's attempts towards abandonment — and the
 *   real outcome is unrecoverable, because the fold ignores a second end for an
 *   attempt it has already closed. The engine warns when it detects this
 *   (see `handleAttemptEnd`) but cannot repair it.
 *
 *   An attempt that is genuinely gone — killed, vanished — simply stops
 *   appearing, with no end delivered, and the next tick restarts it. That is a
 *   different case, and it is the supported one.
 * @property {(desired: import('./core/types').Desired) => Promise<{ attemptId: string, worktree?: string, discarded?: Record<string, unknown>[], gitInitialized?: Record<string, unknown> }>} start
 *   Resolves once the process **exists**. That resolution is what licenses the
 *   `task.attempt.started` append.
 * @property {(attemptId: string) => Promise<void>} stop
 * @property {(handler: (end: AttemptEnd) => Promise<void> | void) => void} [onEnd]
 *   Called when an attempt finishes, with its outcome. Without this the engine
 *   would have to poll for completion, and a poller is a watchdog by another name.
 * @property {() => Promise<{ gitInitialized?: Record<string, unknown> } | void>} [preflight]
 *   Check everything `start()` needs that is not per-task — the model binding,
 *   the role prompts, isolated-worktree git init — and **throw** with a readable
 *   message when it is missing.
 *
 *   P9-A. This exists so `POST /start` can refuse before it answers, rather than
 *   returning 200 to a board that will then fail to start every attempt forever.
 *   It is not a substitute for `start()` rejecting: preconditions can also break
 *   on tick 40 of a six-hour run, which is what the error channel is for.
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
 * @property {string} [beforeSha]  merge only — integration tip before this merge
 * @property {string} [runInstructions]  final only
 * @property {Record<string, unknown>} [discarded]  dirty worktree released on this end
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
 *   complete?: import('./report.js').ReportComplete,
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
  // Injected so tests can stub the one LLM call. Omitted `complete` is the
  // mechanical fallback (no model) so scheduler suites stay model-free.
  // Production `getEngine` supplies `defaultComplete`.
  const complete =
    options.complete ?? (async ({ input }) => formatMechanicalReport(input));

  /** @type {import('./core/types').BoardState | null} */
  let state = null;
  /** The journal position `state` is folded through. */
  let highestSeq = 0;
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
   * Bounded by the number of attempts in flight, because the only thing that
   * puts an entry here is a `startAttempt` that has not finished its append yet,
   * and that same call drains it. An end for an attempt the fold has already
   * closed is *not* buffered — see {@link handleAttemptEnd}.
   *
   * @type {Map<string, AttemptEnd>}
   */
  const bufferedEnds = new Map();

  /**
   * How many times each piece of work has failed to *start* in a row — P9-A.
   *
   * Keyed `role:taskId`, cleared the moment that work starts successfully. The
   * count is what turns a permanent failure into one escalating line rather than
   * one toast per tick: the UI shows the latest message and how long it has been
   * going, and a six-hour run that breaks on tick 40 says so.
   *
   * The last message is kept alongside the count so a window that connects
   * *after* the failure can still be told what is wrong — the frames are
   * live-only, and a board reading `running` with nothing happening and no
   * explanation is the exact symptom this exists to abolish.
   *
   * @type {Map<string, { consecutive: number, message: string }>}
   */
  const startFailures = new Map();

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
    // Advanced with the fold, never separately: a reader that sees the new state
    // must see the seq that produced it, or an SSE snapshot can claim to be
    // current as of an event it does not contain.
    highestSeq = Number(stamped[stamped.length - 1].seq) || highestSeq;
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

    // Stop what is running and no longer wanted. In-flight work stays in
    // `desired` even when N is lowered — the cap gates starting, not
    // continuing — so this does not kill those attempts. It stops work the
    // fold no longer wants (board.stopped, a finished attempt, a skip).
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
      // The report is terminal output. It is written after the last merge and
      // the final test, and it never feeds plan()/derive()/policy/merge.
      await maybeWriteEndOfRunReport();
    }
  }

  /**
   * Exactly one report per run, from this function only.
   *
   * Triggered after `run.finished` (success / partial) and after a user stop.
   * Skips when the journal already has `run.report.written`, so a second tick
   * or a restart cannot spend another model call.
   *
   * @returns {Promise<void>}
   */
  async function maybeWriteEndOfRunReport() {
    if (disposed || !state) return;
    const events = await journal.readEvents(boardId);
    if (journalHasReport(events)) return;
    const userStopped = state.stopReason === 'user';
    if (!state.finished && !userStopped) return;
    try {
      const result = await writeEndOfRunReport({
        boardId,
        events,
        state,
        complete,
      });
      await append([
        makeEvent(REPORT_EVENT_TYPE, {
          path: result.relativePath,
          usedFallback: result.usedFallback,
        }),
      ]);
    } catch (err) {
      console.warn(
        `[orchestrator] ${boardId}: end-of-run report failed:`,
        /** @type {Error} */ (err)?.message ?? err,
      );
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
   * Has the fold already closed this attempt?
   *
   * @param {string} attemptId
   * @returns {boolean}
   */
  function isAlreadyEnded(attemptId) {
    if (!state) return false;
    for (const task of state.tasks.values()) {
      for (const attempt of task.attempts) {
        if (attempt.attemptId === attemptId) return attempt.ended;
      }
    }
    return false;
  }

  /**
   * @param {import('./core/types').Desired} want
   * @returns {Promise<void>}
   */
  async function startAttempt(want) {
    const key = `${want.role}:${want.taskId ?? ''}`;

    /** @type {{ attemptId: string, worktree?: string, discarded?: Record<string, unknown>[], gitInitialized?: Record<string, unknown> }} */
    let handle;
    try {
      handle = await effector.start(want);
    } catch (err) {
      // The process does not exist, so nothing is journaled — there is no effect
      // to record, and a journal line for a start that never happened would make
      // replay disagree with reality. But it is not invisible either: P9-A puts
      // it on the live channel, where the board can show it.
      const message = /** @type {Error} */ (err)?.message ?? String(err);
      const consecutive = (startFailures.get(key)?.consecutive ?? 0) + 1;
      startFailures.set(key, { consecutive, message });
      emitError({ boardId, taskId: want.taskId ?? null, role: want.role, message, consecutive });
      if (consecutive === 1) {
        console.warn(
          `[orchestrator] ${boardId}: could not start ${want.role} for ${want.taskId}:`,
          message,
        );
      }
      return;
    }
    // It started, so whatever was wrong is not wrong any more.
    startFailures.delete(key);

    // The process exists. Only now is there a completed side effect to record.
    if (!isAgentRole(want.role)) return;

    /** @type {Record<string, unknown>[]} */
    const events = [];
    // Dirty trees released to make room for a fresh slot are recorded *before*
    // the new start so the discarded path is never mistaken for this attempt.
    if (Array.isArray(handle.discarded)) {
      for (const payload of handle.discarded) {
        events.push(makeEvent(WORKTREE_DISCARDED_TYPE, payload));
      }
    }
    if (handle.gitInitialized) {
      events.push(makeEvent(BOARD_GIT_INITIALIZED_TYPE, handle.gitInitialized));
    }
    events.push(
      makeEvent('task.attempt.started', {
        taskId: want.taskId,
        attemptId: handle.attemptId,
        role: want.role,
        ...(handle.worktree ? { worktree: handle.worktree } : {}),
        ...(want.seedKind ? { seedKind: want.seedKind } : {}),
      }),
    );
    await append(events);
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

    if (isAgentRole(end.role) && !journaledStarts.has(end.attemptId)) {
      // Already closed by `reapVanished`, which only happens when `inspect()`
      // stopped reporting the attempt *before* this end arrived — the one thing
      // the Effector contract forbids. The journal now says `crashed` for work
      // that actually reported `${end.outcome}`, and that cannot be taken back:
      // the fold ignores a second end for an attempt it has already closed. So
      // say so loudly, because the quiet version of this burns a passing task's
      // attempts towards abandonment.
      if (isAlreadyEnded(end.attemptId)) {
        console.warn(
          `[orchestrator] ${boardId}: ${end.role} ${end.attemptId} reported "${end.outcome}" ` +
            'after the engine had already recorded it as crashed. The effector dropped it from ' +
            'inspect() before delivering onEnd, which the Effector contract does not allow.',
        );
        return;
      }
      // Otherwise its start is still being written. Hold it — see `bufferedEnds`.
      bufferedEnds.set(end.attemptId, end);
      return;
    }
    journaledStarts.delete(end.attemptId);

    /** @type {Record<string, unknown>[]} */
    const events = [];
    if (isAgentRole(end.role)) {
      const task = end.taskId ? state.tasks.get(end.taskId) : undefined;
      const attempt = task?.attempts.find((a) => a.attemptId === end.attemptId);
      // Diff capture is I/O. Core never does it; the bundle later copies
      // whatever landed on this attempt's evidence (capped to a patch, not a repo).
      let evidence = end.evidence;
      const worktree = attempt?.worktree;
      if (worktree) {
        try {
          const diff = await captureWorktreeDiff(worktree, integrationBranch(boardId));
          if (diff) evidence = { ...(evidence ?? {}), diff };
        } catch (err) {
          console.warn(
            `[orchestrator] ${boardId}: attempt diff capture failed for ${end.attemptId}:`,
            /** @type {Error} */ (err)?.message ?? err,
          );
        }
      }
      events.push(
        makeEvent('task.attempt.ended', {
          taskId: end.taskId,
          attemptId: end.attemptId,
          role: end.role,
          outcome: end.outcome,
          ...(end.summary === undefined ? {} : { summary: end.summary }),
          ...(evidence === undefined ? {} : { evidence }),
        }),
      );
      // Overflow is evidence, not a failure. Journal it beside the pass so
      // replay still shows a passing attempt with a recorded footprint miss.
      if (end.outcome === 'pass' && end.role === 'builder' && end.taskId) {
        try {
          const overflow = await detectAttemptOverflow({
            worktree: attempt?.worktree,
            declared: task?.touches ?? [],
            baseRef: integrationBranch(boardId),
          });
          if (overflow) {
            events.push(
              makeEvent('touches.overflow', {
                taskId: end.taskId,
                attemptId: end.attemptId,
                declared: overflow.declared,
                actual: overflow.actual,
              }),
            );
          }
        } catch (err) {
          console.warn(
            `[orchestrator] ${boardId}: touches overflow check failed for ${end.attemptId}:`,
            /** @type {Error} */ (err)?.message ?? err,
          );
        }
      }
    } else if (end.role === 'merge') {
      // `beforeSha` is the pre-merge integration tip the queue snapped so a
      // failed verify can restore. Optional on the event (same source of
      // truth as the end — not a second event type).
      /** @type {Record<string, unknown>} */
      const mergeExtra =
        typeof end.beforeSha === 'string' && end.beforeSha ? { beforeSha: end.beforeSha } : {};
      events.push(
        end.outcome === 'pass'
          ? makeEvent('merge.succeeded', {
              taskId: end.taskId,
              sha: end.sha ?? 'unknown',
              ...mergeExtra,
            })
          : makeEvent('merge.conflicted', {
              taskId: end.taskId,
              files: end.files ?? [],
              ...mergeExtra,
            }),
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
    if (end.discarded) {
      events.push(makeEvent(WORKTREE_DISCARDED_TYPE, end.discarded));
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

  /**
   * Is there anything for the safety net to catch?
   *
   * A running board, always. A stopped one only while a hand-started attempt is
   * still open: without a timer, an attempt that vanishes rather than ending
   * would leave the task in flight forever, since nothing else would ever tick.
   *
   * @returns {boolean}
   */
  function wantsTicking() {
    if (!state) return false;
    return state.status === 'running' || plan(state).length > 0;
  }

  function startTimer() {
    if (timer !== null || disposed) return;
    const arm = () => {
      timer = clock.setTimer(() => {
        timer = null;
        // Return the pass so a clock that awaits the callback (tests) does not
        // treat the tick as done until `maybeWriteEndOfRunReport` has finished.
        return tick().then(() => {
          if (wantsTicking()) arm();
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
      highestSeq = await journal.readHighestSeq(boardId);
      // Returned, not fire-and-forget: the effector keeps the attempt visible to
      // `inspect()` until this resolves, which is what stops a tick landing in
      // the gap between "finished" and "recorded as finished".
      effector.onEnd?.((end) => handleAttemptEnd(end));
      // Reclaim orphans *before* the first tick. Live paths come from open
      // journal attempts; a tick that ran first would reap them as crashed and
      // this would then delete the trees a continue retry needs.
      try {
        const result = await reconcileOrphanWorktrees({
          boardId,
          livePaths: liveWorktreePaths(state),
        });
        if (result.discarded.length > 0) {
          await append(result.discarded.map((payload) => makeEvent(WORKTREE_DISCARDED_TYPE, payload)));
        }
      } catch (err) {
        console.warn(
          `[orchestrator] ${boardId}: worktree reconcile failed:`,
          /** @type {Error} */ (err)?.message ?? err,
        );
      }
      if (state.status === 'running') startTimer();
    },

    /**
     * Re-read the journal from disk, discarding the in-memory fold.
     *
     * @returns {Promise<void>}
     */
    async reload() {
      state = await journal.loadState(boardId);
      highestSeq = await journal.readHighestSeq(boardId);
    },

    /** @returns {import('./core/types').BoardState} */
    getState() {
      if (!state) throw new Error('engine not loaded');
      return state;
    },

    /**
     * The journal position {@link getState} is folded through.
     *
     * Read together with `getState()` and never separately — the two are
     * advanced in the same synchronous step, so a caller that reads both without
     * awaiting in between gets a consistent pair. That is what lets an SSE
     * snapshot frame carry a `seq` the state actually contains.
     *
     * @returns {number}
     */
    getHighestSeq() {
      return highestSeq;
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
     * Everything `start()` will need, checked before anything is promised.
     *
     * P9-A. Rejects with the effector's own message, which is what
     * `POST /start` turns into a 400 on the button instead of a 200 followed by
     * a silent retry loop. An effector with no preconditions has no
     * `preflight` and this resolves.
     *
     * @returns {Promise<void>}
     */
    async preflight() {
      const result = await effector.preflight?.();
      if (result?.gitInitialized) {
        await append([makeEvent(BOARD_GIT_INITIALIZED_TYPE, result.gitInitialized)]);
      }
    },

    /**
     * Work that is currently failing to start, and for how long — P9-A.
     *
     * Read by a *newly connected* stream: the error frames are live-only, so a
     * client that opens after the failure would otherwise see a board reading
     * `running` with nothing happening and no explanation.
     *
     * @returns {Array<{ role: string, taskId: string | null, consecutive: number, message: string }>}
     */
    getStartFailures() {
      return [...startFailures.entries()].map(([key, failure]) => {
        const cut = key.indexOf(':');
        const taskId = key.slice(cut + 1);
        return {
          role: key.slice(0, cut),
          taskId: taskId || null,
          consecutive: failure.consecutive,
          message: failure.message,
        };
      });
    },

    /**
     * Bind this board to a model — P9-C.
     *
     * Journaled, so which model an attempt ran against is part of the record
     * rather than whatever Settings happened to say. The effector reads it
     * first; a board with no binding still falls back to Settings → Autopilot.
     *
     * @param {{ providerId: string, id: string, reasoning?: string | null }} model
     * @returns {Promise<void>}
     */
    async setModel(model) {
      await append([
        makeEvent('board.model.set', {
          providerId: model.providerId,
          id: model.id,
          ...(model.reasoning ? { reasoning: model.reasoning } : {}),
        }),
      ]);
      await tick();
    },

    /**
     * Rename the board — P9-E.
     *
     * A command like any other, not a state write: it goes on the journal, so it
     * survives replay and reaches every other open window through the same
     * stream as everything else.
     *
     * @param {string} name
     * @returns {Promise<void>}
     */
    async rename(name) {
      await append([makeEvent('board.renamed', { name })]);
    },

    /**
     * Give up on a task by hand — P9-H.
     *
     * **The open decision, resolved.** A human override has to be a journaled
     * command or it breaks replay, so this appends the same `task.abandoned` the
     * policy table appends, with `reason: 'user'` distinguishing it. There is no
     * separate manual-skip: `task.skipped` means *stranded by a dependency*,
     * which is a fact about the graph that a person cannot assert, and the fold
     * already treats both as terminal-and-unmerged. Downstream tasks are
     * stranded by the next tick's `pendingSkips`, exactly as they would be by an
     * automatic abandonment — the point of routing this through the journal
     * rather than a button that writes state.
     *
     * Nothing is stopped here. `plan()` stops desiring the task the moment the
     * abandonment is folded, and the reconcile diff stops what is running, which
     * is the same path every other stop takes.
     *
     * @param {string} taskId
     * @param {string} [reason]
     * @returns {Promise<boolean>} false when there is no such task, or it is already terminal
     */
    async abandonTask(taskId, reason = 'user') {
      if (!state) throw new Error('engine not loaded');
      const task = state.tasks.get(taskId);
      if (!task) return false;
      if (task.phase === 'merged' || task.phase === 'abandoned' || task.phase === 'skipped') {
        return false;
      }
      await append([
        makeEvent('task.abandoned', {
          taskId,
          reason,
          evidence: { by: 'user', phase: task.phase, attempts: task.attempts.length },
        }),
      ]);
      await tick();
      return true;
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
      // Nothing is being retried any more, so nothing is still failing to start.
      startFailures.clear();
      // Stopping is a reconcile like any other: `plan()` now desires nothing, so
      // the diff stops everything. There is no separate teardown path.
      await tick();
      if (reason === 'user') await maybeWriteEndOfRunReport();
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
     * Works on a stopped board, which is the whole of PRD §6's Manual mode: the
     * fold marks an attempt begun while stopped as `manual`, and `plan()` keeps
     * it desired. Before that, this started a process, journaled it, and had the
     * next tick stop it — leaving the task `building` behind an attempt that no
     * longer existed, with a 200 on the way back.
     *
     * The timer is armed either way. On a stopped board it is the only thing
     * that would notice a hand-started attempt vanishing.
     *
     * @param {string} taskId
     * @returns {Promise<boolean>} whether anything was started
     */
    async startTask(taskId) {
      if (!state) throw new Error('engine not loaded');
      if (state.finished) return false;
      // `manualStart` decides, not the engine: a manual start is outside the
      // concurrency cap and nothing else, and which rules that means is a
      // scheduling question that belongs in the pure core with the rest of them.
      const next = manualStart(state, taskId, effector.inspect());
      if (next.kind !== 'start') return false;
      await startAttempt({
        taskId,
        role: next.role,
        seedKind: next.seedKind,
        sameWorktree: next.sameWorktree,
      });
      startTimer();
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

/**
 * Engines being loaded or already loaded, keyed by board.
 *
 * The **promise** is what is registered, never the engine. Registering the
 * engine and then awaiting `load()` publishes it in the one state it must never
 * be observed in: `state === null`. A second caller arriving during the load got
 * that engine, and `getState()` threw while `startBoard`/`stopBoard`/
 * `setConcurrency` ran `foldInto(null, …)`. Four concurrent `POST /:id/stop`
 * against a cold board failed about half the time, and a cold board is what
 * every first page load after a server restart hits.
 *
 * @type {Map<string, Promise<ReturnType<typeof createEngine>>>}
 */
const engines = new Map();

/**
 * Engines whose `load()` has resolved. Only these are safe to touch
 * synchronously, which is what {@link peekEngine} promises its callers.
 *
 * @type {Map<string, ReturnType<typeof createEngine>>}
 */
const ready = new Map();

/**
 * The live engine for a board, created on first use.
 *
 * @param {string} boardId
 * @param {() => Effector} makeEffector
 * @param {{ clock?: typeof systemClock, tickMs?: number }} [options]
 * @returns {Promise<ReturnType<typeof createEngine>>}
 */
export function getEngine(boardId, makeEffector, options = {}) {
  const existing = engines.get(boardId);
  if (existing) return existing;

  const engine = createEngine({
    boardId,
    effector: makeEffector(),
    complete: defaultComplete,
    ...options,
  });
  const loading = engine.load().then(() => {
    // Only registered as loaded if this entry is still the current one — a
    // `disposeEngines` during the load must not resurrect it.
    if (engines.get(boardId) === loading) ready.set(boardId, engine);
    return engine;
  });
  engines.set(boardId, loading);

  // A failed load must not wedge the board: drop the entry so the next request
  // gets a fresh attempt rather than the same rejection forever.
  loading.catch(() => {
    if (engines.get(boardId) === loading) engines.delete(boardId);
  });

  return loading;
}

/**
 * The engine for a board **if it is already loaded**. Never one mid-load.
 *
 * @param {string} boardId
 * @returns {ReturnType<typeof createEngine> | undefined}
 */
export function peekEngine(boardId) {
  return ready.get(boardId);
}

/**
 * @param {string} [boardId]  all engines when omitted
 * @returns {void}
 */
export function disposeEngines(boardId) {
  if (boardId === undefined) {
    for (const id of [...engines.keys()]) disposeEngines(id);
    engines.clear();
    ready.clear();
    return;
  }
  ready.get(boardId)?.dispose();
  // An engine still loading has no entry in `ready` yet, so it is disposed when
  // its load settles. `dispose()` is idempotent, so doing both is safe.
  const loading = engines.get(boardId);
  if (loading) {
    void loading.then(
      (engine) => engine.dispose(),
      () => {},
    );
  }
  engines.delete(boardId);
  ready.delete(boardId);
}

export { isReadyForFinalTest };
