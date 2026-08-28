/**
 * P0-D — `plan(state) -> Desired[]`. The pure scheduler.
 *
 * This one function replaces `reserveLaunchSlot`, `PipelineHold`,
 * `drainTaskQueue`, `taskQueueByGroupId`, `drainInFlightByGroupId`,
 * `autoDelegateNext`, `runAfterChatRelease`, `flushChatContinuationIfIdle`, and
 * `stallRecoveryScheduled` — three independent leak-prone concurrency mechanisms
 * and every band-aid layered on them.
 *
 * ## Why V1's version leaked and this one cannot
 *
 * V1 tracked *reservations*: a `chatId` Map, a `WeakMap` keyed on board object
 * identity (with the documented caveat "if the board object is ever swapped,
 * holds vanish"), and a live count derived from `isChatStreaming()` UI flags.
 * Each needed a TTL sweep and expiry logging, and they could disagree — the
 * confirmed sequential deadlock came from the env-fixer pre-reserving the
 * tester's slot while the concurrency check counted that reservation.
 *
 * `plan()` holds no state at all. It answers a question about a snapshot. There
 * is nothing to leak, expire, or sweep.
 *
 * ## The rules, in order
 *
 * 1. A task is ready when every `dependsOn` id has `phase === 'merged'`.
 * 2. Never two concurrent attempts on one task.
 * 3. Never two concurrently-running tasks whose `touches` globs overlap, **even
 *    when `dependsOn` permits it**.
 * 4. Respect the concurrency cap `N`.
 * 5. The merge queue is serialised — at most one merge in flight, regardless of `N`.
 * 6. A board that is not running desires nothing.
 *
 * ## The single policy call site
 *
 * `decide()` is called from exactly one place in the whole engine:
 * {@link nextAction} below. The scheduler asks it what to start; the engine asks
 * it what to journal as abandoned. One application point means live and replay
 * cannot diverge.
 */

import { attemptCount, lastEndedAttempt, readyTasks } from './derive.js';
import { decide } from './policy.js';

/**
 * What should happen to a task that has nothing in flight.
 *
 * The only caller of `decide()`. Returns a `start` the scheduler can act on, an
 * `enqueue` or `abandon` the engine must journal, or `none`.
 *
 * @param {import('./types').BoardState} state
 * @param {string} taskId
 * @returns {import('./types').NextAction}
 */
export function nextAction(state, taskId) {
  const task = state.tasks.get(taskId);
  if (!task) return { kind: 'none' };
  if (task.phase === 'merged' || task.phase === 'abandoned' || task.phase === 'skipped') {
    return { kind: 'none' };
  }
  // Rule 2: something is already in flight for this task, including a merge.
  if (task.attempts.some((a) => !a.ended)) return { kind: 'none' };

  const last = lastEndedAttempt(task);
  if (!last) return { kind: 'start', role: 'builder', seedKind: 'initial', sameWorktree: false };

  const action = decide({
    role: last.role,
    outcome: last.outcome ?? 'no_report',
    // The policy table's `attempts` column counts tries that finished *before*
    // this one, so the just-ended attempt is subtracted. Counting it would make
    // the `blocked | < 1` and `no_report | < 1` rows unreachable and silently
    // delete the repair path — see the header of policy.js.
    attemptCount: attemptCount(state, taskId, last.role) - 1,
    summary: last.summary,
    evidence: last.evidence,
  });

  if (action.kind === 'retry') {
    return {
      kind: 'start',
      role: action.role,
      seedKind: action.seedKind,
      sameWorktree: action.sameWorktree,
    };
  }
  if (action.kind === 'advance') {
    if (action.to === 'tester') {
      return { kind: 'start', role: 'tester', seedKind: 'initial', sameWorktree: false };
    }
    if (action.to === 'merge') return { kind: 'enqueue' };
    return { kind: 'none' };
  }
  return { kind: 'abandon', reason: action.reason, evidence: action.evidence };
}

/**
 * Tasks whose tester has passed but which are not yet on the merge queue.
 * The engine journals `merge.enqueued` for each.
 *
 * @param {import('./types').BoardState} state
 * @returns {string[]} in scheduling order
 */
export function pendingEnqueues(state) {
  return orderedTaskIds(state).filter((id) => nextAction(state, id).kind === 'enqueue');
}

/**
 * Tasks the policy table has given up on. The engine journals `task.abandoned`
 * for each, carrying the evidence the decision was made on.
 *
 * @param {import('./types').BoardState} state
 * @returns {Array<{ taskId: string, reason: string, evidence: import('./types').Evidence }>}
 */
export function pendingAbandonments(state) {
  /** @type {Array<{ taskId: string, reason: string, evidence: import('./types').Evidence }>} */
  const out = [];
  for (const taskId of orderedTaskIds(state)) {
    const next = nextAction(state, taskId);
    if (next.kind === 'abandon') out.push({ taskId, reason: next.reason, evidence: next.evidence });
  }
  return out;
}

/**
 * Which attempts should be running right now.
 *
 * Total: no throw path. An impossible state — a `dependsOn` pointing at an
 * unknown id — yields no desire for that task rather than an exception. Cycles
 * are rejected at parse time and cannot reach here.
 *
 * @param {import('./types').BoardState} state
 * @returns {import('./types').Desired[]}
 */
export function plan(state) {
  // Rule 6.
  if (!state || state.status !== 'running') return [];

  /** @type {import('./types').Desired[]} */
  const desired = [];

  // Rule 5: the merge queue is serialised, and its head is desired regardless of
  // the cap. Integration is the bottleneck the whole run funnels through; letting
  // the cap starve it would deadlock a full board.
  const head = state.mergeQueue[0];
  if (head !== undefined && state.tasks.has(head)) {
    desired.push({ taskId: head, role: 'merge', seedKind: 'rebase', sameWorktree: false });
  }

  const cap = Number.isSafeInteger(state.concurrency) ? Math.max(0, state.concurrency) : 1;
  const ordered = orderedTaskIds(state);

  // Attempts that already exist keep their slot. Their `task.attempt.started` is
  // already on the journal, so re-deciding them would risk stopping work the
  // engine has no reason to stop.
  /** @type {import('./types').Desired[]} */
  const running = [];
  for (const id of ordered) {
    const open = state.tasks.get(id)?.attempts.find((a) => !a.ended && a.role !== 'merge');
    if (open) {
      running.push({
        taskId: id,
        role: open.role,
        seedKind: open.seedKind ?? 'initial',
        sameWorktree: false,
      });
    }
  }

  // Rule 4.
  const held = running.slice(0, cap);
  desired.push(...held);

  /** @type {string[]} */
  const occupied = held.map((d) => d.taskId);
  const ready = new Set(readyTasks(state));

  for (const id of ordered) {
    if (occupied.length >= cap) break;
    if (!ready.has(id) || occupied.includes(id)) continue;
    const task = state.tasks.get(id);
    if (!task) continue;
    const next = nextAction(state, id);
    if (next.kind !== 'start') continue;
    // Rule 3. Checked against everything already claimed this tick, running or new.
    const clashes = occupied.some((other) =>
      touchesOverlap(task.touches, state.tasks.get(other)?.touches ?? []),
    );
    if (clashes) continue;
    desired.push({
      taskId: id,
      role: next.role,
      seedKind: next.seedKind,
      sameWorktree: next.sameWorktree,
    });
    occupied.push(id);
  }

  return desired;
}

/**
 * Declared task order, stably keyed on wave first.
 *
 * Two calls on the same state must return the same array, not merely the same
 * set — replay depends on it.
 *
 * @param {import('./types').BoardState} state
 * @returns {string[]}
 */
export function orderedTaskIds(state) {
  return state.taskOrder
    .map((id, index) => ({ id, index, wave: state.tasks.get(id)?.wave ?? 0 }))
    .sort((a, b) => a.wave - b.wave || a.index - b.index || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((entry) => entry.id);
}

// ---------------------------------------------------------------------------
// Glob-set intersection
// ---------------------------------------------------------------------------

/**
 * Do two declared footprints overlap?
 *
 * Pure set intersection over already-expanded glob strings. Matching globs
 * against real files needs I/O and belongs in P3-D; this decides only whether
 * two *patterns* could ever name the same path.
 *
 * An empty footprint overlaps nothing. `parsePlan()` requires at least one glob
 * per task, so an empty list is a deliberate statement rather than a gap.
 *
 * @param {readonly string[]} a
 * @param {readonly string[]} b
 * @returns {boolean}
 */
export function touchesOverlap(a, b) {
  if (!a?.length || !b?.length) return false;
  for (const left of a) {
    for (const right of b) {
      if (globsIntersect(left, right)) return true;
    }
  }
  return false;
}

/**
 * Could these two globs match a common path?
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function globsIntersect(a, b) {
  const left = segmentsOf(a);
  const right = segmentsOf(b);
  /** @type {Map<string, boolean>} */
  const seen = new Map();

  /**
   * @param {number} i
   * @param {number} j
   * @returns {boolean}
   */
  const walk = (i, j) => {
    const key = `${i}:${j}`;
    const cached = seen.get(key);
    if (cached !== undefined) return cached;
    let result;
    if (i === left.length && j === right.length) {
      result = true;
    } else if (i < left.length && left[i] === '**') {
      // `**` matches zero or more whole segments.
      result = walk(i + 1, j) || (j < right.length && walk(i, j + 1));
    } else if (j < right.length && right[j] === '**') {
      result = walk(i, j + 1) || (i < left.length && walk(i + 1, j));
    } else if (i < left.length && j < right.length) {
      result = segmentsIntersect(left[i], right[j]) && walk(i + 1, j + 1);
    } else {
      result = false;
    }
    seen.set(key, result);
    return result;
  };

  return walk(0, 0);
}

/**
 * Normalise a glob to path segments. A trailing slash means "everything under
 * here", which is what a planner writing `src/ui/` means.
 *
 * @param {string} glob
 * @returns {string[]}
 */
function segmentsOf(glob) {
  let normalised = String(glob).trim().replace(/\\/g, '/');
  while (normalised.startsWith('./')) normalised = normalised.slice(2);
  if (normalised.endsWith('/')) normalised += '**';
  return normalised.split('/').filter((segment) => segment.length > 0 && segment !== '.');
}

/**
 * Can these two single-segment patterns match a common component?
 *
 * `*` matches any run of characters within a segment; `?` matches exactly one.
 *
 * @param {string} p
 * @param {string} q
 * @returns {boolean}
 */
function segmentsIntersect(p, q) {
  /** @type {Map<number, boolean>} */
  const seen = new Map();

  /**
   * @param {number} i
   * @param {number} j
   * @returns {boolean}
   */
  const walk = (i, j) => {
    const key = i * (q.length + 1) + j;
    const cached = seen.get(key);
    if (cached !== undefined) return cached;
    let result;
    if (i === p.length && j === q.length) {
      result = true;
    } else if (i < p.length && p[i] === '*') {
      result = walk(i + 1, j) || (j < q.length && walk(i, j + 1));
    } else if (j < q.length && q[j] === '*') {
      result = walk(i, j + 1) || (i < p.length && walk(i + 1, j));
    } else if (i < p.length && j < q.length) {
      const compatible = p[i] === '?' || q[j] === '?' || p[i] === q[j];
      result = compatible && walk(i + 1, j + 1);
    } else {
      result = false;
    }
    seen.set(key, result);
    return result;
  };

  return walk(0, 0);
}
