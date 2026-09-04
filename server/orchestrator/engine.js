/**
 * Reconcile loop: start and stop attempts so running work matches the plan.
 */

import { makeEvent } from './core/events.js';
import { boardGraph, defaultComplete, isReadyForFinalTest } from './board-graph.js';
import * as diskJournal from './journal.js';
import { emitError } from './live-events.js';
import { holdBoardResume, shouldHoldBoardResume } from './resume-gate.js';

// ── Clock ────────────────────────────────────────────────────────────────────

/** How often the safety-net tick fires. */
export const DEFAULT_TICK_MS = 5_000;

/** Clock used by the engine. Tests can replace it. */
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
 * True when two attempts share the same task and role.
 * @param {{ taskId: string | null, role: string }} a
 * @param {{ taskId: string | null, role: string }} b
 * @returns {boolean}
 */
function sameWork(a, b) {
  return a.role === b.role && (a.taskId ?? null) === (b.taskId ?? null);
}

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Start, stop, and inspect running attempts.
 * @typedef {object} Effector
 * @property {() => Array<{ taskId: string | null, role: string, attemptId: string, handle?: unknown }>} inspect
 * @property {(desired: import('./core/types').Desired) => Promise<{ attemptId: string, worktree?: string, discarded?: Record<string, unknown>[], gitInitialized?: Record<string, unknown> }>} start
 * @property {(attemptId: string) => Promise<void>} stop
 * @property {(handler: (end: AttemptEnd) => Promise<void> | void) => void} [onEnd]
 * @property {() => Promise<{ gitInitialized?: Record<string, unknown> } | void>} [preflight]
 */

/**
 * Fold, scheduler, and tick predicates for one kind of run.
 * @typedef {object} Graph
 * @property {(state: any, events: Iterable<unknown>) => any} foldInto
 * @property {(state: any) => Array<{ taskId: string | null, role: string, seedKind?: string, sameWorktree?: boolean }>} plan
 * @property {(state: any) => Record<string, unknown>[]} [impliedEvents]
 * @property {(state: any) => boolean} [isRunComplete]
 * @property {(state: any) => Record<string, unknown>[]} [eventsForRunComplete]
 * @property {(role: string) => boolean} [isAgentRole]
 * @property {(state: any, attemptId: string) => boolean} [isAlreadyEnded]
 * @property {(state: any, live: Set<string>, buffered: Set<string>) => Record<string, unknown>[]} [reapVanished]
 * @property {(want: import('./core/types').Desired, handle: { attemptId: string, worktree?: string, discarded?: Record<string, unknown>[], gitInitialized?: Record<string, unknown> }) => Record<string, unknown>[]} [eventsForStart]
 * @property {(result: { gitInitialized?: Record<string, unknown> } | void) => Record<string, unknown>[]} [eventsForPreflight]
 * @property {(end: AttemptEnd, ctx: { id: string, state: any }) => Promise<Record<string, unknown>[]> | Record<string, unknown>[]} [eventsForAttemptEnd]
 * @property {(ctx: { id: string, state: any }) => Promise<Record<string, unknown>[]>} [onLoad]
 * @property {(ctx: { id: string, state: any, events: Record<string, unknown>[], complete: Function }) => Promise<{ relativePath: string, usedFallback: boolean } | null>} [writeReport]
 * @property {string} [reportEventType]
 * @property {(events: Record<string, unknown>[]) => boolean} [hasReport]
 * @property {import('./report.js').ReportComplete} [complete]
 * @property {(input: Record<string, unknown>) => string | Promise<string>} [formatReport]
 * @property {(state: any, taskId: string, running?: ReadonlyArray<{ taskId: string | null, role: string }>) => { kind: string, role?: string, seedKind?: string, sameWorktree?: boolean }} [manualStart]
 * @property {(state: any, requested?: readonly string[]) => Iterable<string>} [reopenTargets]
 * @property {(state: any) => { task: unknown, wave?: unknown }} [buildIntegrationFixTask]
 * @property {number} [defaultConcurrency]
 */

/**
 * @typedef {object} AttemptEnd
 * @property {string} attemptId
 * @property {string | null} taskId
 * @property {string} role
 * @property {string} outcome
 * @property {string} [summary]
 * @property {Record<string, unknown>} [evidence]
 * @property {string} [sha]
 * @property {string[]} [files]
 * @property {string} [beforeSha]
 * @property {string} [runInstructions]
 * @property {Record<string, unknown>} [discarded]
 * @property {Record<string, number>} [usage]
 */

// ── Engine ───────────────────────────────────────────────────────────────────

/**
 * Create the engine for one journaled run.
 * @param {{
 *   boardId: string,
 *   effector: Effector,
 *   graph?: Graph,
 *   clock?: typeof systemClock,
 *   tickMs?: number,
 *   journal?: typeof diskJournal,
 *   complete?: import('./report.js').ReportComplete,
 * }} options
 */
export function createEngine(options) {
  const { boardId, effector } = options;
  const graph = options.graph ?? boardGraph;
  const clock = options.clock ?? systemClock;
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS;
  const journal = options.journal ?? diskJournal;
  const complete =
    options.complete ??
    graph.complete ??
    (async ({ input }) =>
      graph.formatReport ? graph.formatReport(input) : '');

  /**
   * @param {string} role
   * @returns {boolean}
   */
  function isAgentRole(role) {
    return graph.isAgentRole ? graph.isAgentRole(role) : role === 'builder' || role === 'tester';
  }

  /** @type {any} */
  let state = null;
  let highestSeq = 0;
  /** @type {unknown} */
  let timer = null;
  let ticking = false;
  let dirty = false;
  let disposed = false;
  let heldAtLoad = false;

  /** @type {Set<(event: Record<string, unknown>) => void>} */
  const subscribers = new Set();

  /** @type {Set<string>} */
  const journaledStarts = new Set();

  /** @type {Map<string, AttemptEnd>} */
  const bufferedEnds = new Map();

  /** @type {Map<string, { consecutive: number, message: string }>} */
  const startFailures = new Map();

  /**
   * @param {Record<string, unknown>[]} events
   * @returns {Promise<Record<string, unknown>[]>}
   */
  async function append(events) {
    if (events.length === 0) return [];
    const stamped =
      events.length === 1
        ? [await journal.appendEvent(boardId, events[0], { now: clock.now })]
        : await journal.appendEvents(boardId, events, { now: clock.now });
    graph.foldInto(state, stamped);
    highestSeq = Number(stamped[stamped.length - 1].seq) || highestSeq;
    for (const event of stamped) {
      for (const subscriber of subscribers) {
        try {
          subscriber(event);
        } catch {
        }
      }
    }
    if (wantsTicking()) startTimer();
    return stamped;
  }

  /**
   * Journal decisions the current state already implies.
   * @returns {Promise<boolean>}
   */
  async function journalImpliedDecisions() {
    const implied = graph.impliedEvents;
    if (!implied) return false;
    let wroteAnything = false;
    for (let round = 0; round < 1000; round += 1) {
      const decisions = implied(state) ?? [];
      if (decisions.length === 0) return wroteAnything;
      await append(decisions);
      wroteAnything = true;
    }
    return wroteAnything;
  }

  /** @returns {Promise<void>} */
  async function runOnce() {
    if (disposed || !state) return;

    // A finished run is quiescent: extra ticks must not journal more events
    // (conformance: "extra ticks appended"). Retry a missing report only.
    if (state.finished) {
      const extra = await collectEndOfRunReport();
      if (extra.length > 0) await append(extra);
      return;
    }

    if (state.status === 'running') await journalImpliedDecisions();

    if (await reapVanished(effector.inspect())) {
      dirty = true;
      return;
    }

    const desired = graph.plan(state);
    const actual = effector.inspect();

    for (const running of actual) {
      if (!desired.some((d) => sameWork(d, running))) {
        await effector.stop(running.attemptId);
      }
    }

    for (const want of desired) {
      if (actual.some((r) => sameWork(want, r))) continue;
      await startAttempt(want);
    }

    if (state.status === 'running' && graph.isRunComplete?.(state)) {
      const finish = graph.eventsForRunComplete?.(state) ?? [];
      stopTimer();
      // Persist the report before publishing run.finished so observers never
      // see finished=true with a still-in-flight report write (that late
      // event is "extra ticks appended 1 events" in the scheduler suite).
      const reportEvents = await collectEndOfRunReport(finish);
      await append([...finish, ...reportEvents]);
    }
  }

  /**
   * Build the end-of-run report event without journaling it.
   * `pendingFinish` is folded into the writer input so the markdown can
   * describe a complete run before `run.finished` is published.
   *
   * @param {Record<string, unknown>[]} [pendingFinish]
   * @returns {Promise<Record<string, unknown>[]>}
   */
  async function collectEndOfRunReport(pendingFinish = []) {
    if (disposed || !state || !graph.writeReport) return [];
    const events = [...await journal.readEvents(boardId), ...pendingFinish];
    if (graph.hasReport?.(events)) return [];

    // writeReport refuses unless the board looks finished or user-stopped.
    const prevFinished = state.finished;
    const prevStatus = state.status;
    const prevReason = state.stopReason;
    if (!prevFinished && prevStatus !== 'stopped') {
      state.finished = true;
      state.status = 'stopped';
      state.stopReason = prevReason ?? 'complete';
    }
    try {
      const result = await graph.writeReport({
        id: boardId,
        events,
        state,
        complete,
      });
      if (!result) return [];
      const type = graph.reportEventType ?? 'run.report.written';
      return [
        makeEvent(type, {
          path: result.relativePath,
          usedFallback: result.usedFallback,
        }),
      ];
    } catch (err) {
      console.warn(
        `[orchestrator] ${boardId}: end-of-run report failed:`,
        /** @type {Error} */ (err)?.message ?? err,
      );
      return [];
    } finally {
      state.finished = prevFinished;
      state.status = prevStatus;
      state.stopReason = prevReason;
    }
  }

  /** @returns {Promise<void>} */
  async function maybeWriteEndOfRunReport() {
    const extra = await collectEndOfRunReport();
    if (extra.length > 0) await append(extra);
  }

  /**
   * Journal crashed for attempts the journal still has open but inspect() no longer sees.
   * @param {Array<{ attemptId: string }>} actual
   * @returns {Promise<boolean>}
   */
  async function reapVanished(actual) {
    if (!state || !graph.reapVanished) return false;
    const live = new Set(actual.map((r) => r.attemptId));
    const ended = graph.reapVanished(state, live, new Set(bufferedEnds.keys()));
    if (!ended || ended.length === 0) return false;
    for (const event of ended) {
      const attemptId = typeof event.attemptId === 'string' ? event.attemptId : '';
      if (attemptId) journaledStarts.delete(attemptId);
    }
    await append(ended);
    return true;
  }

  /**
   * @param {string} attemptId
   * @returns {boolean}
   */
  function isAlreadyEnded(attemptId) {
    if (!state) return false;
    if (graph.isAlreadyEnded) return graph.isAlreadyEnded(state, attemptId);
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
    startFailures.delete(key);

    if (!isAgentRole(want.role)) return;

    const events = graph.eventsForStart
      ? graph.eventsForStart(want, handle)
      : [
          makeEvent('task.attempt.started', {
            taskId: want.taskId,
            attemptId: handle.attemptId,
            role: want.role,
            ...(handle.worktree ? { worktree: handle.worktree } : {}),
            ...(want.seedKind ? { seedKind: want.seedKind } : {}),
          }),
        ];
    if (events.length > 0) await append(events);
    journaledStarts.add(handle.attemptId);

    const early = bufferedEnds.get(handle.attemptId);
    if (early) {
      bufferedEnds.delete(handle.attemptId);
      await handleAttemptEnd(early);
    }
  }

  /**
   * @param {AttemptEnd} end
   * @returns {Promise<void>}
   */
  async function handleAttemptEnd(end) {
    if (disposed || !state) return;

    if (isAgentRole(end.role) && !journaledStarts.has(end.attemptId)) {
      if (isAlreadyEnded(end.attemptId)) {
        console.warn(
          `[orchestrator] ${boardId}: ${end.role} ${end.attemptId} reported "${end.outcome}" ` +
            'after the engine had already recorded it as crashed. The effector dropped it from ' +
            'inspect() before delivering onEnd, which the Effector contract does not allow.',
        );
        return;
      }
      bufferedEnds.set(end.attemptId, end);
      return;
    }
    journaledStarts.delete(end.attemptId);

    const events = graph.eventsForAttemptEnd
      ? await graph.eventsForAttemptEnd(end, { id: boardId, state })
      : [];
    if (events.length > 0) await append(events);
    await tick();
  }

  /** @returns {Promise<void>} */
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

  /** @returns {boolean} */
  function wantsTicking() {
    if (!state) return false;
    return state.status === 'running' || graph.plan(state).length > 0;
  }

  function startTimer() {
    if (timer !== null || disposed) return;
    const arm = () => {
      timer = clock.setTimer(() => {
        timer = null;
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
    /** @returns {Promise<void>} */
    async load() {
      state = await journal.loadState(boardId);
      highestSeq = await journal.readHighestSeq(boardId);
      effector.onEnd?.((end) => handleAttemptEnd(end));
      if (graph.onLoad) {
        try {
          const extra = await graph.onLoad({ id: boardId, state });
          if (extra.length > 0) await append(extra);
        } catch (err) {
          console.warn(
            `[orchestrator] ${boardId}: graph onLoad failed:`,
            /** @type {Error} */ (err)?.message ?? err,
          );
        }
      }
      if (state.status === 'running') {
        if (shouldHoldBoardResume(boardId)) heldAtLoad = true;
        else startTimer();
      }
    },

    /** @returns {Promise<void>} */
    async reload() {
      state = await journal.loadState(boardId);
      highestSeq = await journal.readHighestSeq(boardId);
    },

    /** @returns {import('./core/types').BoardState} */
    getState() {
      if (!state) throw new Error('engine not loaded');
      return state;
    },

    /** @returns {number} */
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

    /** @returns {Promise<void>} */
    async preflight() {
      const result = await effector.preflight?.();
      const extra = graph.eventsForPreflight?.(result) ?? [];
      if (extra.length > 0) await append(extra);
    },

    /**
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
     * @param {string} name
     * @returns {Promise<void>}
     */
    async rename(name) {
      await append([makeEvent('board.renamed', { name })]);
    },

    /**
     * @param {string} taskId
     * @param {string} [reason]
     * @returns {Promise<boolean>}
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
      if (!state) throw new Error('engine not loaded');
      if (state.finished) return false;
      await append([makeEvent('board.started', { concurrency })]);
      startTimer();
      await tick();
      return true;
    },

    /**
     * @param {import('./core/types').StopReason} [reason]
     * @returns {Promise<void>}
     */
    async stopBoard(reason = 'user') {
      await append([makeEvent('board.stopped', { reason })]);
      stopTimer();
      startFailures.clear();
      await tick();
      if (reason === 'user') await maybeWriteEndOfRunReport();
    },

    /**
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
     * @param {string} taskId
     * @returns {Promise<boolean>}
     */
    async startTask(taskId) {
      if (!state) throw new Error('engine not loaded');
      if (state.finished) return false;
      const next = graph.manualStart
        ? graph.manualStart(state, taskId, effector.inspect())
        : { kind: 'none' };
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

    /**
     * Reopen failed work after a finished run.
     * @param {{ taskIds?: string[], concurrency?: number }} [opts]
     * @param {string} [reason]
     * @returns {Promise<{ ok: boolean, taskIds: string[], reason?: string }>}
     */
    async reopen(opts = {}, reason = 'user') {
      if (!state) throw new Error('engine not loaded');
      const pick = graph.reopenTargets;
      const targets = pick ? [...pick(state, opts.taskIds)] : [];
      const events = [];
      if (targets.length === 0) {
        if (state.finalTest?.outcome !== 'fail') {
          return { ok: false, taskIds: [], reason: 'nothing-to-rerun' };
        }
        const fix = graph.buildIntegrationFixTask?.(state);
        if (!fix) return { ok: false, taskIds: [], reason: 'nothing-to-rerun' };
        events.push(
          makeEvent('task.added', {
            task: fix.task,
            ...(fix.wave ? { wave: fix.wave } : {}),
          }),
        );
        targets.push(/** @type {{ id: string }} */ (fix.task).id);
      }
      const fallbackN = graph.defaultConcurrency ?? 2;
      const concurrency =
        Number.isSafeInteger(opts.concurrency) && opts.concurrency >= 1
          ? opts.concurrency
          : Number.isSafeInteger(state.concurrency) && state.concurrency >= 1
            ? state.concurrency
            : fallbackN;
      events.push(
        makeEvent('board.reopened', { taskIds: targets, reason: String(reason ?? 'user') }),
        makeEvent('board.started', { concurrency }),
      );
      await append(events);
      startTimer();
      await tick();
      return { ok: true, taskIds: targets };
    },

    tick,

    /**
     * @param {(event: Record<string, unknown>) => void} handler
     * @returns {() => void}
     */
    subscribe(handler) {
      subscribers.add(handler);
      return () => subscribers.delete(handler);
    },

    /** @returns {boolean} */
    wasHeldAtLoad() {
      return heldAtLoad;
    },

    /** @returns {void} */
    resumeAfterGate() {
      if (!heldAtLoad) return;
      heldAtLoad = false;
      if (state?.status === 'running') startTimer();
    },

    /** @returns {void} */
    dispose() {
      disposed = true;
      stopTimer();
      subscribers.clear();
    },
  };
}

// ── Registry ─────────────────────────────────────────────────────────────────

/** Default namespace for board engines. */
export const DEFAULT_ENGINE_NAMESPACE = 'boards';

/**
 * @param {string} namespace
 * @param {string} id
 * @returns {string}
 */
function engineKey(namespace, id) {
  return `${namespace}\t${id}`;
}

/**
 * @param {string} key
 * @returns {{ namespace: string, id: string }}
 */
function parseEngineKey(key) {
  const cut = key.indexOf('\t');
  if (cut === -1) return { namespace: DEFAULT_ENGINE_NAMESPACE, id: key };
  return { namespace: key.slice(0, cut), id: key.slice(cut + 1) };
}

/** @type {Map<string, Promise<ReturnType<typeof createEngine>>>} */
const engines = new Map();

/** @type {Map<string, ReturnType<typeof createEngine>>} */
const ready = new Map();

/**
 * Live engine for a board, created on first use.
 * @param {string} boardId
 * @param {() => Effector} makeEffector
 * @param {{
 *   clock?: typeof systemClock,
 *   tickMs?: number,
 *   namespace?: string,
 *   graph?: Graph,
 *   journal?: typeof diskJournal,
 *   complete?: import('./report.js').ReportComplete,
 * }} [options]
 * @returns {Promise<ReturnType<typeof createEngine>>}
 */
export function getEngine(boardId, makeEffector, options = {}) {
  const namespace = options.namespace ?? DEFAULT_ENGINE_NAMESPACE;
  const key = engineKey(namespace, boardId);
  const existing = engines.get(key);
  if (existing) return existing;

  const engine = createEngine({
    boardId,
    effector: makeEffector(),
    clock: options.clock,
    tickMs: options.tickMs,
    journal: options.journal,
    graph: options.graph ?? boardGraph,
    complete: options.complete ?? defaultComplete,
  });
  const loading = engine.load().then(() => {
    if (engines.get(key) === loading) ready.set(key, engine);
    if (engine.wasHeldAtLoad()) {
      holdBoardResume({
        boardId,
        resume: () => engine.resumeAfterGate(),
        decline: () => engine.stopBoard('user'),
        peek: () => engine.getState(),
      });
    }
    return engine;
  });
  engines.set(key, loading);

  loading.catch(() => {
    if (engines.get(key) === loading) engines.delete(key);
  });

  return loading;
}

/**
 * Engine for an id if it is already loaded. Never one mid-load.
 * @param {string} boardId
 * @param {string} [namespace]
 * @returns {ReturnType<typeof createEngine> | undefined}
 */
export function peekEngine(boardId, namespace = DEFAULT_ENGINE_NAMESPACE) {
  return ready.get(engineKey(namespace, boardId));
}

/**
 * @param {string} [boardId]
 * @param {string} [namespace]
 * @returns {void}
 */
export function disposeEngines(boardId, namespace) {
  if (boardId === undefined) {
    for (const key of [...engines.keys()]) {
      const parsed = parseEngineKey(key);
      disposeEngines(parsed.id, parsed.namespace);
    }
    engines.clear();
    ready.clear();
    return;
  }
  const ns = namespace ?? DEFAULT_ENGINE_NAMESPACE;
  const key = engineKey(ns, boardId);
  ready.get(key)?.dispose();
  const loading = engines.get(key);
  if (loading) {
    void loading.then(
      (engine) => engine.dispose(),
      () => {},
    );
  }
  engines.delete(key);
  ready.delete(key);
}

export { isReadyForFinalTest };
