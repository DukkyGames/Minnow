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
 * 3. Never two concurrently-running tasks whose footprints overlap, **even
 *    when `dependsOn` permits it**. A footprint is the declared globs plus the
 *    frozen expanded file set journaled at board creation (P3-D). Pattern
 *    overlap still serialises; expansion catches disjoint globs that name the
 *    same files. Empty expansion overlaps nothing extra — that is the same
 *    empty-list rule as {@link touchesOverlap}.
 * 4. Respect the concurrency cap `N` — for *starting* work. Attempts already in
 *    flight keep their slot, so lowering `N` mid-run stops nothing that is
 *    already running; it stops new work being picked up.
 * 5. The merge queue is serialised — at most one merge in flight, regardless of `N`.
 * 6. A board that is not running desires nothing **except attempts the user
 *    started by hand since it stopped** — PRD §6's Manual mode. It picks up
 *    nothing new, advances nothing, and merges nothing; it only lets the work
 *    someone explicitly asked for finish. `board.stopped` clears the flag those
 *    attempts carry, so a Stop stops them too.
 *
 * ## The single policy call site
 *
 * `decide()` is called from exactly one place in the whole engine:
 * {@link nextAction} below. The scheduler asks it what to start; the engine asks
 * it what to journal as abandoned. One application point means live and replay
 * cannot diverge.
 */

import { attemptCount, deadEnded, lastEndedAttempt, readyTasks } from './derive.js';
import { bundleAbandonmentEvidence } from './evidence.js';
import { decide, wantsSameWorktree } from './policy.js';

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
  // Policy names the reason; this call site attaches the full attempt history
  // PRD §11 needs. `decide()` stays last-attempt-only so the table stays a table.
  return {
    kind: 'abandon',
    reason: action.reason,
    evidence: bundleAbandonmentEvidence(task, action),
  };
}

/**
 * What a hand-started task should begin, if anything.
 *
 * A manual start is outside **rule 4 only**. The cap is a throughput preference
 * and the user is entitled to override it; the rest of the rules are correctness
 * constraints and are not overridable by asking louder:
 *
 * - Rule 1, dependencies. Building a task whose prerequisites have not merged
 *   seeds the work off an integration base that is missing them.
 * - Rule 2, one attempt per task.
 * - Rule 3, footprints. Two agents writing the same files is the failure the
 *   `touches` rule exists to prevent, whoever asked for it.
 *
 * `running` is what the effector reports, so the check is against reality rather
 * than against the journal's opinion of it.
 *
 * @param {import('./types').BoardState} state
 * @param {string} taskId
 * @param {ReadonlyArray<{ taskId: string | null, role: string }>} running
 * @returns {import('./types').NextAction}
 */
export function manualStart(state, taskId, running = []) {
  if (!state) return { kind: 'none' };
  const task = state.tasks.get(taskId);
  if (!task) return { kind: 'none' };

  // Rule 1.
  if (!readyTasks(state).includes(taskId)) return { kind: 'none' };
  // Rule 2, against what is actually running as well as against the journal.
  if (running.some((r) => r.taskId === taskId)) return { kind: 'none' };
  // Rule 3.
  for (const other of running) {
    if (other.taskId === null || other.taskId === taskId) continue;
    const against = state.tasks.get(other.taskId);
    if (against && footprintsClash(task, against)) return { kind: 'none' };
  }

  const next = nextAction(state, taskId);
  return next.kind === 'start' ? next : { kind: 'none' };
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
  // Rule 6. A stopped board still wants whatever the user started by hand since
  // it stopped — that *is* Manual mode (PRD §6). It never picks up anything new,
  // and `board.stopped` clears the flag, so a Stop still stops everything.
  if (!state) return [];
  if (state.status !== 'running') return manualDesires(state);

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
  //
  // `sameWorktree` is recomputed from the recorded seed rather than defaulted,
  // so a resumed repair attempt is described the same way the decision that
  // created it described it. Defaulting it to false meant a `repair` attempt
  // came back as a fresh-worktree one, and any effector that diffs on more than
  // `{ taskId, role }` would restart it in the wrong place.
  /** @type {import('./types').Desired[]} */
  const running = [];
  for (const id of ordered) {
    const open = state.tasks.get(id)?.attempts.find((a) => !a.ended && a.role !== 'merge');
    if (open) {
      running.push({
        taskId: id,
        role: open.role,
        seedKind: open.seedKind ?? 'initial',
        sameWorktree: wantsSameWorktree(open.seedKind),
      });
    }
  }

  // Work that already exists keeps its slot, even above the cap.
  //
  // The cap gates *starting*, not *continuing*. Lowering concurrency mid-run
  // therefore stops nothing already in flight — it stops new work being picked
  // up — because killing a builder halfway through an edit throws away real work
  // to enforce a number the user changed after the fact. The same rule is what
  // lets a manual single-task start survive the next reconcile instead of being
  // immediately undone by it.
  desired.push(...running);

  /** @type {string[]} */
  const occupied = running.map((d) => d.taskId);
  const ready = new Set(readyTasks(state));

  for (const id of ordered) {
    if (desired.filter((d) => d.role !== 'merge').length >= cap) break;
    if (!ready.has(id) || occupied.includes(id)) continue;
    const task = state.tasks.get(id);
    if (!task) continue;
    const next = nextAction(state, id);
    if (next.kind !== 'start') continue;
    // Rule 3. Checked against everything already claimed this tick, running or new.
    const clashes = occupied.some((other) => {
      const against = state.tasks.get(other);
      return against ? footprintsClash(task, against) : false;
    });
    if (clashes) continue;
    desired.push({
      taskId: id,
      role: next.role,
      seedKind: next.seedKind,
      sameWorktree: next.sameWorktree,
    });
    occupied.push(id);
  }

  // The Final Tester runs once, after every task has reached a terminal phase
  // and the merge queue has drained. It is board-level, so it carries no task id.
  if (desired.length === 0 && isReadyForFinalTest(state)) {
    desired.push({ taskId: null, role: 'final', seedKind: 'initial', sameWorktree: false });
  }

  return desired;
}

/**
 * What a stopped board still wants: the attempts a human started by hand.
 *
 * Only ones already open — a stopped board never picks up new work, never
 * advances a task to its tester, and never merges. When the attempt ends the
 * task sits at whatever it reached and waits for the next manual start, which is
 * what "the user starts individual tasks by hand" means.
 *
 * Without this, `startTask` on a stopped board spawned a process, journaled its
 * start, and had the very next tick stop it again — leaving the task `building`
 * forever behind an attempt that no longer existed.
 *
 * @param {import('./types').BoardState} state
 * @returns {import('./types').Desired[]}
 */
function manualDesires(state) {
  /** @type {import('./types').Desired[]} */
  const desired = [];
  for (const id of orderedTaskIds(state)) {
    const open = state.tasks.get(id)?.attempts.find((a) => !a.ended && a.role !== 'merge');
    if (!open || !open.manual) continue;
    desired.push({
      taskId: id,
      role: open.role,
      seedKind: open.seedKind ?? 'initial',
      sameWorktree: wantsSameWorktree(open.seedKind),
    });
  }
  return desired;
}

/**
 * Has the board finished everything it can, with the final verification still
 * outstanding?
 *
 * @param {import('./types').BoardState} state
 * @returns {boolean}
 */
export function isReadyForFinalTest(state) {
  if (!state || state.tasks.size === 0) return false;
  if (state.finalTest !== null || state.finished) return false;
  if (state.mergeQueue.length > 0) return false;
  // At least one task must have merged: a board where everything was abandoned
  // has nothing to verify.
  let merged = 0;
  for (const task of state.tasks.values()) {
    if (task.phase === 'merged') merged += 1;
    else if (task.phase !== 'abandoned' && task.phase !== 'skipped') return false;
  }
  return merged > 0;
}

/**
 * Has the run finished everything it is ever going to do?
 *
 * True when every task has reached a terminal phase, the merge queue has
 * drained, and either the final test has run or there was nothing to verify.
 *
 * @param {import('./types').BoardState} state
 * @returns {boolean}
 */
export function isRunComplete(state) {
  if (!state || state.finished) return false;
  if (state.tasks.size === 0) return false;
  if (state.mergeQueue.length > 0) return false;

  let merged = 0;
  for (const task of state.tasks.values()) {
    if (task.phase === 'merged') merged += 1;
    else if (task.phase !== 'abandoned' && task.phase !== 'skipped') return false;
  }
  // Something merged, so the integrated result still needs verifying.
  if (merged > 0 && state.finalTest === null) return false;
  return true;
}

/**
 * Tasks that can never run because something upstream was abandoned or skipped,
 * and which are not yet recorded as skipped themselves.
 *
 * The engine journals `task.skipped` for each. `blockedBy` is the abandoned
 * root (MIN-712), not the immediate skipped parent. Sharing a wave or touching
 * adjacent files is not a dependency. This is what stops an abandoned task on
 * minute three from stalling an overnight run: the dead branch is closed out
 * and everything independent of it keeps going.
 *
 * @param {import('./types').BoardState} state
 * @returns {Array<{ taskId: string, blockedBy: string }>}
 */
export function pendingSkips(state) {
  /** @type {Array<{ taskId: string, blockedBy: string }>} */
  const out = [];
  if (!state) return out;
  const dead = deadEnded(state);
  for (const taskId of orderedTaskIds(state)) {
    const task = state.tasks.get(taskId);
    if (!task || !dead.has(taskId)) continue;
    if (task.phase === 'skipped' || task.phase === 'abandoned') continue;
    // A task with work in flight is skipped only once that work has ended, so a
    // running attempt is never orphaned mid-flight.
    if (task.attempts.some((a) => !a.ended)) continue;
    out.push({ taskId, blockedBy: /** @type {string} */ (dead.get(taskId)) });
  }
  return out;
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
 * Do two tasks' scheduling footprints clash?
 *
 * Declared glob overlap still serialises (overlapping patterns never run
 * together, even if expansion is empty). Frozen expanded file sets serialise
 * when they intersect, even if the declared globs look disjoint. Expansion
 * that was never journaled (`null`) is ignored so pre-P3-D journals keep the
 * glob-only gate. An empty expansion overlaps nothing extra.
 *
 * @param {{ touches?: readonly string[] | null, touchesExpanded?: readonly string[] | null }} a
 * @param {{ touches?: readonly string[] | null, touchesExpanded?: readonly string[] | null }} b
 * @returns {boolean}
 */
export function footprintsClash(a, b) {
  if (touchesOverlap(a?.touches ?? [], b?.touches ?? [])) return true;
  return expandedFilesOverlap(a?.touchesExpanded, b?.touchesExpanded);
}

/**
 * @param {readonly string[] | null | undefined} a
 * @param {readonly string[] | null | undefined} b
 * @returns {boolean}
 */
export function expandedFilesOverlap(a, b) {
  if (!a?.length || !b?.length) return false;
  const right = new Set(b.map(normalizeRepoPath));
  for (const file of a) {
    if (right.has(normalizeRepoPath(file))) return true;
  }
  return false;
}

/**
 * Match declared globs against a frozen file list. Pure: the I/O that produced
 * `repoFiles` lives outside the core so replay does not re-walk the disk.
 *
 * @param {readonly string[]} globs
 * @param {readonly string[]} repoFiles
 * @returns {{ expanded: string[], emptyGlobs: string[] }}
 */
export function expandTouches(globs, repoFiles) {
  const files = (repoFiles ?? []).map(normalizeRepoPath).filter(Boolean);
  /** @type {string[]} */
  const emptyGlobs = [];
  /** @type {Set<string>} */
  const expanded = new Set();
  for (const glob of globs ?? []) {
    const pattern = String(glob);
    let hits = 0;
    for (const file of files) {
      if (pathMatchesGlob(file, pattern)) {
        expanded.add(file);
        hits += 1;
      }
    }
    if (hits === 0) emptyGlobs.push(pattern);
  }
  return { expanded: [...expanded].sort(), emptyGlobs };
}

/**
 * Paths from a worktree diff that sit outside the declared globs.
 *
 * @param {readonly string[]} declared
 * @param {readonly string[]} actual
 * @returns {string[]}
 */
export function overflowPaths(declared, actual) {
  const globs = declared ?? [];
  /** @type {string[]} */
  const extra = [];
  for (const file of actual ?? []) {
    const path = normalizeRepoPath(file);
    if (!path) continue;
    if (!globs.some((glob) => pathMatchesGlob(path, glob))) extra.push(path);
  }
  return extra.sort();
}

/**
 * Does this repo-relative path match a declared glob?
 *
 * Reuses {@link globsIntersect} so expansion, overflow, and the scheduling
 * gate share one matcher — a file the gate treats as inside the footprint
 * must not also count as overflow.
 *
 * @param {string} file
 * @param {string} glob
 * @returns {boolean}
 */
export function pathMatchesGlob(file, glob) {
  return globsIntersect(normalizeRepoPath(file), String(glob));
}

/**
 * Repo-relative paths are compared with `/` so Windows worktrees and the
 * journal agree.
 *
 * @param {string} value
 * @returns {string}
 */
export function normalizeRepoPath(value) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

/**
 * Do two declared footprints overlap?
 *
 * Pure set intersection over glob strings. Matching globs against real files
 * is journaled at board creation (P3-D) and folded onto `touchesExpanded`;
 * this function decides only whether two *patterns* could name the same path.
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
 * One atom of a segment pattern: a literal char, a wildcard, or a character
 * class. Splitting the pattern up front keeps the DP below indexing atoms rather
 * than raw characters, which is what makes `[ab]` a single position.
 *
 * @typedef {{ kind: 'star' } | { kind: 'any' } | { kind: 'char', ch: string }
 *          | { kind: 'class', negated: boolean, ranges: Array<[string, string]> }} Atom
 */

/**
 * @param {string} pattern
 * @returns {Atom[]}
 */
function atomsOf(pattern) {
  /** @type {Atom[]} */
  const atoms = [];
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '*') {
      atoms.push({ kind: 'star' });
      continue;
    }
    if (ch === '?') {
      atoms.push({ kind: 'any' });
      continue;
    }
    if (ch === '[') {
      const close = pattern.indexOf(']', i + 1);
      if (close === -1) {
        // Unbalanced. `parsePlan` rejects this, so treat it as a literal rather
        // than inventing a meaning for it.
        atoms.push({ kind: 'char', ch });
        continue;
      }
      let body = pattern.slice(i + 1, close);
      const negated = body.startsWith('!') || body.startsWith('^');
      if (negated) body = body.slice(1);
      /** @type {Array<[string, string]>} */
      const ranges = [];
      for (let k = 0; k < body.length; k += 1) {
        if (body[k + 1] === '-' && k + 2 < body.length) {
          ranges.push([body[k], body[k + 2]]);
          k += 2;
        } else {
          ranges.push([body[k], body[k]]);
        }
      }
      atoms.push({ kind: 'class', negated, ranges });
      i = close;
      continue;
    }
    atoms.push({ kind: 'char', ch });
  }
  return atoms;
}

/**
 * Could these two single-character atoms match the same character?
 *
 * @param {Atom} a
 * @param {Atom} b
 * @returns {boolean}
 */
function atomsOverlap(a, b) {
  if (a.kind === 'any' || b.kind === 'any') return true;
  if (a.kind === 'char' && b.kind === 'char') return a.ch === b.ch;
  if (a.kind === 'char' && b.kind === 'class') return classMatches(b, a.ch);
  if (a.kind === 'class' && b.kind === 'char') return classMatches(a, b.ch);
  if (a.kind === 'class' && b.kind === 'class') {
    // Two negated classes always share something, since the alphabet is far
    // larger than any listed set.
    if (a.negated && b.negated) return true;
    const positive = a.negated ? b : a;
    const other = a.negated ? a : b;
    for (const [lo, hi] of positive.ranges) {
      for (let code = lo.charCodeAt(0); code <= hi.charCodeAt(0); code += 1) {
        if (classMatches(other, String.fromCharCode(code))) return true;
      }
    }
    return false;
  }
  return false;
}

/**
 * @param {Extract<Atom, { kind: 'class' }>} atom
 * @param {string} ch
 * @returns {boolean}
 */
function classMatches(atom, ch) {
  let inside = false;
  for (const [lo, hi] of atom.ranges) {
    if (ch >= lo && ch <= hi) {
      inside = true;
      break;
    }
  }
  return atom.negated ? !inside : inside;
}

/**
 * Can these two single-segment patterns match a common component?
 *
 * `*` matches any run of characters within a segment, `?` matches exactly one,
 * and `[abc]` / `[a-z]` / `[!abc]` match one from a set. Brace expansion and
 * negated globs are rejected by `parsePlan` precisely because this function
 * cannot reason about them, and a pattern it cannot interpret would read as
 * "overlaps nothing" — opening the concurrency gate on two tasks writing the
 * same file.
 *
 * @param {string} p
 * @param {string} q
 * @returns {boolean}
 */
function segmentsIntersect(p, q) {
  const left = atomsOf(p);
  const right = atomsOf(q);
  /** @type {Map<number, boolean>} */
  const seen = new Map();

  /**
   * @param {number} i
   * @param {number} j
   * @returns {boolean}
   */
  const walk = (i, j) => {
    const key = i * (right.length + 1) + j;
    const cached = seen.get(key);
    if (cached !== undefined) return cached;
    let result;
    if (i === left.length && j === right.length) {
      result = true;
    } else if (i < left.length && left[i].kind === 'star') {
      result = walk(i + 1, j) || (j < right.length && walk(i, j + 1));
    } else if (j < right.length && right[j].kind === 'star') {
      result = walk(i, j + 1) || (i < left.length && walk(i + 1, j));
    } else if (i < left.length && j < right.length) {
      result = atomsOverlap(left[i], right[j]) && walk(i + 1, j + 1);
    } else {
      result = false;
    }
    seen.set(key, result);
    return result;
  };

  return walk(0, 0);
}
