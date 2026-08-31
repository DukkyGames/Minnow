/**
 * P0-C — `derive(events) -> BoardState`.
 *
 * The only way board state is ever produced. Boot-resume, display-wake
 * reconcile, and OOM-pause repair all become this one function: replay.
 *
 * ## There are no counters
 *
 * V1 carried `buildAttempts`, `testAttempts`, `fixerAttempts`, `envFixAttempts`,
 * `stopRetries`, and `selfHealRound`, mutated from six call sites. Here an
 * attempt count is a filter over the journal — see {@link attemptCount}. There is
 * no counter to increment, so there is nothing to desynchronise.
 *
 * **Do not add a count field to `TaskState` as an optimisation.** If the fold is
 * slow, that is what the snapshot in `snapshot.js` is for.
 *
 * ## Totality
 *
 * A truncated journal, a corrupt last line, and an event type from a future build
 * must all derive a valid state rather than throw. Every event is routed through
 * `validateEvent()` first and anything malformed or unrecognised is skipped, so
 * the fold has no failure path at all.
 *
 * ## Purity
 *
 * No clock. `ts` is on every event and is display-only; reading it here would make
 * replay depend on when the replay happened.
 */

import { validateEvent } from './events.js';

/**
 * Product default for the first `board.started` when the caller omits N.
 *
 * The fold stays at 1 until that event (a created board is not running yet).
 * Reliability first — do not raise this because a benchmark looked faster.
 */
export const DEFAULT_BOARD_CONCURRENCY = 2;

/**
 * The state of a board with no journal at all.
 *
 * `concurrency` is 1 here on purpose: that is the pre-start placeholder, not
 * the product default. The first start journals `board.started` at
 * {@link DEFAULT_BOARD_CONCURRENCY} unless the caller asked for something else.
 *
 * @returns {import('./types').BoardState}
 */
export function emptyState() {
  return {
    boardId: '',
    name: '',
    planPath: '',
    waves: [],
    status: 'created',
    concurrency: 1,
    tasks: new Map(),
    taskOrder: [],
    mergeQueue: [],
    integrationSha: null,
    /** P9-C: the board's model override, or null to fall back to Settings. */
    model: null,
    finalTest: null,
    finished: false,
    stopReason: null,
    runSummary: null,
    rerun: null,
  };
}

/**
 * Fold events into an existing state, in place, and recompute phases.
 *
 * The resume path for `snapshot.js`. Applying the same event twice is a no-op —
 * every handler is guarded on the fact it records — but callers should still
 * filter by `seq` rather than lean on that.
 *
 * @param {import('./types').BoardState} state
 * @param {Iterable<unknown>} events
 * @returns {import('./types').BoardState} the same object, for chaining
 */
export function foldInto(state, events) {
  // Total means total: a caller handing over a number rather than a journal gets
  // an unchanged state, not a TypeError. The fold is the recovery path, and a
  // recovery path with a throw in it is not one.
  if (!events || typeof (/** @type {any} */ (events)[Symbol.iterator]) !== 'function') {
    for (const task of state.tasks.values()) task.phase = phaseOf(state, task);
    return state;
  }

  for (const raw of events) {
    const checked = validateEvent(raw);
    // Malformed lines and unknown types are both skipped: the first keeps the
    // fold total over a truncated journal, the second keeps it forward-compatible.
    if (!checked.ok || !checked.known) continue;
    apply(state, /** @type {any} */ (checked.event));
  }

  for (const task of state.tasks.values()) task.phase = phaseOf(state, task);
  return state;
}

/**
 * Fold a journal into board state.
 *
 * @param {Iterable<unknown>} events
 * @returns {import('./types').BoardState}
 */
export function derive(events) {
  return foldInto(emptyState(), events);
}

/**
 * @param {import('./types').BoardState} state
 * @param {any} event
 * @returns {void}
 */
function apply(state, event) {
  switch (event.type) {
    case 'board.created': {
      state.boardId = event.boardId;
      state.planPath = event.planPath;
      if (typeof event.name === 'string') state.name = event.name;
      state.waves = event.waves.map((w) => ({ n: Number(w.n), name: String(w.name ?? '') }));
      // Additive: a later board.created may append tasks, never rewrite the
      // history of one already in flight.
      for (const declared of event.tasks) {
        const id = String(declared.id ?? '');
        if (!id || state.tasks.has(id)) continue;
        state.tasks.set(id, newTask(id, declared));
        state.taskOrder.push(id);
      }
      return;
    }

    case 'board.started': {
      state.status = 'running';
      state.concurrency = event.concurrency;
      state.stopReason = null;
      return;
    }

    case 'board.stopped': {
      state.status = 'stopped';
      state.stopReason = event.reason;
      // Stopping stops work of every kind, hand-started included, so nothing
      // stays marked as manually desired across it. `plan()` reads this flag to
      // decide what a stopped board still wants; clearing it here is what makes
      // Stop mean stop rather than "stop, except the ones I started myself".
      for (const task of state.tasks.values()) {
        for (const attempt of task.attempts) {
          if (!attempt.ended) attempt.manual = false;
        }
      }
      return;
    }

    case 'task.attempt.started': {
      const task = state.tasks.get(event.taskId);
      if (!task) return;
      if (task.attempts.some((a) => a.attemptId === event.attemptId)) return;
      task.attempts.push({
        attemptId: event.attemptId,
        role: event.role,
        worktree: event.worktree ?? null,
        seedKind: event.seedKind ?? null,
        ended: false,
        outcome: null,
        summary: null,
        evidence: null,
        // An attempt that began while the board was not running was started by
        // hand — there is no other way for one to exist. Read from the status
        // the fold has already reached, so replay reproduces it.
        manual: state.status !== 'running',
        retired: false,
      });
      return;
    }

    case 'task.attempt.ended': {
      const task = state.tasks.get(event.taskId);
      if (!task) return;
      let attempt = task.attempts.find((a) => a.attemptId === event.attemptId);
      if (!attempt) {
        // The `started` line is missing — a journal older than this schema, or a
        // hand-edited one. Record the attempt anyway; dropping it would
        // undercount, and the count is what the policy table runs on.
        attempt = {
          attemptId: event.attemptId,
          role: event.role,
          worktree: null,
          seedKind: null,
          ended: false,
          outcome: null,
          summary: null,
          evidence: null,
          manual: false,
          retired: false,
        };
        task.attempts.push(attempt);
      }
      if (attempt.ended) return;
      attempt.ended = true;
      attempt.outcome = event.outcome;
      attempt.summary = event.summary ?? null;
      attempt.evidence = event.evidence ?? null;
      return;
    }

    // Merges are recorded as attempts of role `merge`, not as a separate shape.
    // That is what lets `attemptCount(state, id, 'merge')` be the same filter as
    // for builder and tester, so the policy table needs no special case for the
    // `merge | conflicted` row.
    case 'merge.enqueued': {
      const task = state.tasks.get(event.taskId);
      if (!task) return;
      if (!state.mergeQueue.includes(event.taskId)) state.mergeQueue.push(event.taskId);
      if (!task.attempts.some((a) => a.role === 'merge' && !a.ended)) {
        task.attempts.push(mergeAttempt(task));
      }
      return;
    }

    case 'merge.succeeded': {
      const task = state.tasks.get(event.taskId);
      if (!task) return;
      state.mergeQueue = state.mergeQueue.filter((id) => id !== event.taskId);
      closeMergeAttempt(task, 'pass');
      task.mergedSha = event.sha;
      task.mergeConflicts = null;
      state.integrationSha = event.sha;
      return;
    }

    case 'merge.conflicted': {
      const task = state.tasks.get(event.taskId);
      if (!task) return;
      state.mergeQueue = state.mergeQueue.filter((id) => id !== event.taskId);
      closeMergeAttempt(task, 'conflicted');
      task.mergeConflicts = [...event.files];
      return;
    }

    case 'task.abandoned': {
      const task = state.tasks.get(event.taskId);
      if (!task) return;
      state.mergeQueue = state.mergeQueue.filter((id) => id !== event.taskId);
      task.abandonedReason = event.reason;
      task.abandonedEvidence = event.evidence ?? null;
      return;
    }

    case 'task.skipped': {
      const task = state.tasks.get(event.taskId);
      if (!task) return;
      state.mergeQueue = state.mergeQueue.filter((id) => id !== event.taskId);
      task.skippedBy = event.blockedBy;
      return;
    }

    case 'touches.overflow': {
      const task = state.tasks.get(event.taskId);
      if (!task) return;
      task.touchesOverflow.push({
        attemptId: event.attemptId,
        declared: [...event.declared],
        actual: [...event.actual],
      });
      return;
    }

    case 'final.test.ended': {
      state.finalTest = {
        outcome: event.outcome,
        runInstructions: event.runInstructions ?? null,
        evidence: event.evidence ?? null,
      };
      return;
    }

    case 'run.finished': {
      state.finished = true;
      state.runSummary = event.summary;
      return;
    }

    // P9-C. The board's own model override, journaled so that replay reproduces
    // which model an attempt was started against rather than re-reading whatever
    // Settings happens to say at replay time.
    case 'board.model.set': {
      state.model = {
        providerId: event.providerId,
        id: event.id,
        reasoning: typeof event.reasoning === 'string' && event.reasoning ? event.reasoning : null,
      };
      return;
    }

    // P9-E. Renaming is a command, not a state write: the name lives on the
    // journal like everything else, so a rename survives replay and shows up on
    // every other window through the same stream as any other event.
    case 'board.renamed': {
      state.name = event.name;
      return;
    }

    case 'task.added': {
      const declared = event.task && typeof event.task === 'object' ? event.task : null;
      const id = declared ? String(declared.id ?? '') : '';
      if (!id || state.tasks.has(id)) return;
      state.tasks.set(id, newTask(id, declared));
      state.taskOrder.push(id);
      const wave = event.wave;
      if (wave && typeof wave === 'object') {
        const n = Number(wave.n);
        if (Number.isFinite(n) && !state.waves.some((w) => w.n === n)) {
          state.waves = [...state.waves, { n, name: String(wave.name ?? '') }];
        }
      }
      return;
    }

    case 'board.reopened': {
      const n = (state.rerun?.n ?? 0) + 1;
      const taskIds = Array.isArray(event.taskIds) ? event.taskIds.map(String) : [];
      // Captured from the fold, not journaled: the seed needs the failure it is
      // fixing, and `finalTest` is about to be cleared so the ladder re-runs.
      state.rerun = {
        n,
        reason: String(event.reason ?? ''),
        taskIds: [...taskIds],
        previousFinalTest: state.finalTest,
      };
      state.finalTest = null;
      state.finished = false;
      state.runSummary = null;
      for (const id of taskIds) {
        const task = state.tasks.get(id);
        if (!task || task.mergedSha !== null) continue;
        task.reopened = {
          n,
          from:
            task.abandonedReason ??
            (task.skippedBy ? `stranded by ${task.skippedBy}` : null),
        };
        task.abandonedReason = null;
        task.abandonedEvidence = null;
        task.skippedBy = null;
        task.mergeConflicts = null;
        for (const attempt of task.attempts) {
          if (attempt.ended) attempt.retired = true;
        }
      }
      return;
    }

    // No default. An unrecognised type never reaches here — `derive` filters on
    // `known` — and adding a default that mutates would break P0-B's tolerance
    // requirement.
  }
}

/**
 * A merge has no agent and so no `task.attempt.started` line. Its attempt id is
 * synthesised from the fold position, which is deterministic under replay.
 *
 * @param {import('./types').TaskState} task
 * @returns {import('./types').Attempt}
 */
function mergeAttempt(task) {
  const n = task.attempts.filter((a) => a.role === 'merge').length;
  return {
    attemptId: `merge#${task.id}#${n + 1}`,
    role: 'merge',
    worktree: null,
    seedKind: null,
    ended: false,
    outcome: null,
    summary: null,
    evidence: null,
    // Merges are engine-driven and only ever run on a running board.
    manual: false,
    retired: false,
  };
}

/**
 * @param {import('./types').TaskState} task
 * @param {'pass' | 'conflicted'} outcome
 * @returns {void}
 */
function closeMergeAttempt(task, outcome) {
  let attempt = task.attempts.find((a) => a.role === 'merge' && !a.ended);
  if (!attempt) {
    // A merge result with no enqueue line: record it anyway, or the merge
    // attempt count the policy table runs on would be short by one.
    attempt = mergeAttempt(task);
    task.attempts.push(attempt);
  }
  attempt.ended = true;
  attempt.outcome = outcome;
}

/**
 * @param {string} id
 * @param {any} declared
 * @returns {import('./types').TaskState}
 */
function newTask(id, declared) {
  return {
    id,
    title: String(declared.title ?? id),
    wave: Number.isFinite(declared.wave) ? Number(declared.wave) : 1,
    dependsOn: Array.isArray(declared.dependsOn) ? declared.dependsOn.map(String) : [],
    touches: Array.isArray(declared.touches) ? declared.touches.map(String) : [],
    // Frozen at board.created. Missing means a pre-P3-D journal — do not
    // re-expand; `plan()` falls back to declared globs.
    touchesExpanded: Array.isArray(declared.touchesExpanded)
      ? [...new Set(declared.touchesExpanded.map(String))].sort()
      : null,
    emptyTouchesGlobs: Array.isArray(declared.emptyTouchesGlobs)
      ? declared.emptyTouchesGlobs.map(String)
      : [],
    buildSpec: declared.build == null ? null : String(declared.build),
    testSpec: declared.test == null ? null : String(declared.test),
    accept: declared.accept == null ? null : String(declared.accept),
    phase: 'idle',
    attempts: [],
    outcome: null,
    abandonedReason: null,
    abandonedEvidence: null,
    skippedBy: null,
    mergedSha: null,
    mergeConflicts: null,
    touchesOverflow: [],
    reopened: null,
  };
}

/**
 * A task's phase, computed from the accumulated record rather than maintained
 * incrementally — so there is no transition table to get wrong.
 *
 * @param {import('./types').BoardState} state
 * @param {import('./types').TaskState} task
 * @returns {import('./types').TaskPhase}
 */
function phaseOf(state, task) {
  task.outcome = lastEndedAttempt(task)?.outcome ?? null;
  if (task.abandonedReason !== null) return 'abandoned';
  if (task.skippedBy !== null) return 'skipped';
  if (task.mergedSha !== null) return 'merged';
  if (state.mergeQueue.includes(task.id)) return 'merging';
  const open = task.attempts.find((a) => !a.ended);
  if (open) {
    if (open.role === 'builder') return 'building';
    if (open.role === 'tester') return 'testing';
    return 'merging';
  }
  return 'idle';
}

/**
 * The most recent attempt that finished, or undefined if none has.
 *
 * @param {import('./types').TaskState} task
 * @returns {import('./types').Attempt | undefined}
 */
export function lastEndedAttempt(task) {
  for (let i = task.attempts.length - 1; i >= 0; i -= 1) {
    const attempt = task.attempts[i];
    if (attempt.ended && !attempt.retired) return attempt;
  }
  return undefined;
}

/**
 * How many attempts of a role have *finished* for a task.
 *
 * The single accessor, so no caller re-implements the filter and no caller is
 * tempted to cache the number.
 *
 * @param {import('./types').BoardState} state
 * @param {string} taskId
 * @param {import('./types').Role} role
 * @returns {number}
 */
export function attemptCount(state, taskId, role) {
  const task = state.tasks.get(taskId);
  if (!task) return 0;
  let n = 0;
  for (const attempt of task.attempts) {
    if (attempt.ended && !attempt.retired && attempt.role === role) n += 1;
  }
  return n;
}

/**
 * Tasks whose every dependency has merged and which are not themselves finished.
 *
 * Deliberately **not** capped by concurrency — that is `plan()`'s job. Keeping
 * the fold free of policy is what lets the same state answer a question about
 * `N = 1` and `N = 4`.
 *
 * @param {import('./types').BoardState} state
 * @returns {string[]} in declared task order
 */
export function readyTasks(state) {
  /** @type {string[]} */
  const ready = [];
  for (const id of state.taskOrder) {
    const task = state.tasks.get(id);
    if (!task) continue;
    if (task.phase === 'merged' || task.phase === 'abandoned' || task.phase === 'skipped') continue;
    const blocked = task.dependsOn.some((dep) => state.tasks.get(dep)?.phase !== 'merged');
    if (!blocked) ready.push(id);
  }
  return ready;
}

/**
 * Walk an immediate broken dependency to the abandoned root (MIN-712).
 *
 * `task.skipped.blockedBy` names the task that actually failed, not the
 * skipped parent in between — so a diamond DAG A→B, A→C, B→D, C→D with A
 * abandoned reports B, C, and D all blocked by A.
 *
 * Sharing a wave is not a walk; only `dependsOn` / `skippedBy` edges count.
 *
 * @param {import('./types').BoardState} state
 * @param {string} startId
 * @param {Map<string, string>} immediate
 * @returns {string}
 */
function abandonedRootOf(state, startId, immediate) {
  const seen = new Set();
  let current = startId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const task = state.tasks.get(current);
    if (!task) return current;
    if (task.phase === 'abandoned') return current;
    if (task.phase === 'skipped' && task.skippedBy) {
      current = task.skippedBy;
      continue;
    }
    const next = immediate.get(current);
    if (next && next !== current) {
      current = next;
      continue;
    }
    return current;
  }
  return current;
}

/**
 * Tasks that can never run because something they depend on is abandoned,
 * skipped, or missing. Transitive over `dependsOn` only.
 *
 * @param {import('./types').BoardState} state
 * @returns {Map<string, string>} taskId -> the abandoned root that blocks it
 */
export function deadEnded(state) {
  /** @type {Map<string, string>} */
  const immediate = new Map();
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of state.taskOrder) {
      const task = state.tasks.get(id);
      if (!task || immediate.has(id)) continue;
      if (task.phase === 'abandoned' || task.phase === 'skipped') continue;
      for (const dep of task.dependsOn) {
        const upstream = state.tasks.get(dep);
        const broken =
          !upstream ||
          upstream.phase === 'abandoned' ||
          upstream.phase === 'skipped' ||
          immediate.has(dep);
        if (broken) {
          immediate.set(id, dep);
          changed = true;
          break;
        }
      }
    }
  }

  // A dependency cycle is a dead end too. `parsePlan` rejects cycles, so a board
  // built the normal way cannot contain one — but a hand-edited or externally
  // written journal can, and the failure mode is the worst kind: every task in
  // the cycle waits forever, `plan()` returns nothing, and the board sits idle
  // with work outstanding. Naming them here turns a silent permanent stall into
  // a skip the run can report.
  for (const id of cyclicTasks(state, immediate)) {
    if (!immediate.has(id)) immediate.set(id, id);
  }

  /** @type {Map<string, string>} */
  const dead = new Map();
  for (const [id, blocker] of immediate) {
    dead.set(id, abandonedRootOf(state, blocker, immediate));
  }
  return dead;
}

/**
 * Task ids that can never become ready because they sit on, or behind, a
 * dependency cycle among tasks that are still live.
 *
 * @param {import('./types').BoardState} state
 * @param {Map<string, string>} dead  already-known dead ends, excluded
 * @returns {string[]} in declared order
 */
function cyclicTasks(state, dead) {
  /** @type {Set<string>} */
  const settled = new Set();
  for (const id of state.taskOrder) {
    const task = state.tasks.get(id);
    if (!task) continue;
    if (task.phase === 'merged' || task.phase === 'abandoned' || task.phase === 'skipped') {
      settled.add(id);
    }
  }

  // A task is reachable if every dependency is settled or itself reachable.
  // Whatever the fixpoint cannot reach is on or behind a cycle.
  /** @type {Set<string>} */
  const reachable = new Set(settled);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of state.taskOrder) {
      if (reachable.has(id) || dead.has(id)) continue;
      const task = state.tasks.get(id);
      if (!task) continue;
      if (task.dependsOn.every((dep) => reachable.has(dep))) {
        reachable.add(id);
        changed = true;
      }
    }
  }

  return state.taskOrder.filter(
    (id) => !reachable.has(id) && !dead.has(id) && state.tasks.has(id),
  );
}
