/**
 * P0-D — the pure scheduler.
 *
 * Table-driven rather than example-driven: the matrix over cap, ready-count,
 * touches overlap, and merge-in-flight is the point. The one named example is
 * the sequential deadlock that froze V1, kept as a regression.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { derive } from '../../server/orchestrator/core/derive.js';
import { makeEvent } from '../../server/orchestrator/core/events.js';
import {
  globsIntersect,
  nextAction,
  orderedTaskIds,
  pendingAbandonments,
  pendingEnqueues,
  pendingSkips,
  plan,
  touchesOverlap,
} from '../../server/orchestrator/core/plan.js';

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

let seq = 0;
const stamp = (e) => ({ ...e, seq: (seq += 1), ts: seq });

/**
 * Build a board state from a task spec list plus a tail of events.
 *
 * @param {{ tasks: Array<object>, concurrency?: number, running?: boolean }} setup
 * @param {...object} tail
 */
function boardOf(setup, ...tail) {
  seq = 0;
  const events = [
    stamp(makeEvent('board.created', {
      boardId: 'b',
      planPath: 'p.md',
      tasks: setup.tasks,
      waves: [],
    })),
  ];
  if (setup.running !== false) {
    events.push(stamp(makeEvent('board.started', { concurrency: setup.concurrency ?? 1 })));
  }
  for (const e of tail) events.push(stamp(e));
  return derive(events);
}

const task = (id, extra = {}) => ({
  id,
  title: id,
  wave: 1,
  dependsOn: [],
  touches: [`src/${id}/**`],
  build: 'b',
  test: 't',
  accept: 'a',
  ...extra,
});

const started = (taskId, attemptId, role, extra = {}) =>
  makeEvent('task.attempt.started', { taskId, attemptId, role, ...extra });
const ended = (taskId, attemptId, role, outcome) =>
  makeEvent('task.attempt.ended', { taskId, attemptId, role, outcome });
const attempt = (taskId, attemptId, role, outcome) => [
  started(taskId, attemptId, role),
  ended(taskId, attemptId, role, outcome),
];
const merged = (taskId, sha) => [
  ...attempt(taskId, `${taskId}-b`, 'builder', 'pass'),
  ...attempt(taskId, `${taskId}-t`, 'tester', 'pass'),
  makeEvent('merge.enqueued', { taskId }),
  makeEvent('merge.succeeded', { taskId, sha }),
];

const nonMerge = (desires) => desires.filter((d) => d.role !== 'merge');

// ---------------------------------------------------------------------------

describe('plan — the six rules', () => {
  it('rule 6: a board that is not running desires nothing', () => {
    const created = boardOf({ tasks: [task('A'), task('B')], running: false });
    assert.deepEqual(plan(created), []);

    const stopped = boardOf(
      { tasks: [task('A')], concurrency: 4 },
      makeEvent('board.stopped', { reason: 'user' }),
    );
    assert.deepEqual(plan(stopped), []);

    // Even mid-flight, and even with a merge queued.
    const stoppedMidRun = boardOf(
      { tasks: [task('A'), task('B')], concurrency: 4 },
      started('A', 'a1', 'builder'),
      makeEvent('merge.enqueued', { taskId: 'B' }),
      makeEvent('board.stopped', { reason: 'user' }),
    );
    assert.deepEqual(plan(stoppedMidRun), []);
  });

  it('rule 1: holds a task until every dependency has merged', () => {
    const tasks = [task('A'), task('B'), task('C', { wave: 2, dependsOn: ['A', 'B'] })];
    const none = boardOf({ tasks, concurrency: 4 });
    assert.deepEqual(nonMerge(plan(none)).map((d) => d.taskId), ['A', 'B']);

    const one = boardOf({ tasks, concurrency: 4 }, ...merged('A', 's1'));
    assert.deepEqual(nonMerge(plan(one)).map((d) => d.taskId), ['B']);

    const both = boardOf({ tasks, concurrency: 4 }, ...merged('A', 's1'), ...merged('B', 's2'));
    assert.deepEqual(nonMerge(plan(both)).map((d) => d.taskId), ['C']);
  });

  it('rule 2: never two concurrent attempts on one task', () => {
    const state = boardOf({ tasks: [task('A')], concurrency: 4 }, started('A', 'a1', 'builder'));
    const desires = nonMerge(plan(state));
    assert.equal(desires.length, 1);
    assert.deepEqual(desires[0], { taskId: 'A', role: 'builder', seedKind: 'initial', sameWorktree: false });
  });

  it('rule 3: excludes overlapping touches even when dependsOn permits', () => {
    const overlapping = [
      task('A', { touches: ['src/shared/**'] }),
      task('B', { touches: ['src/shared/thing.ts'] }),
    ];
    const state = boardOf({ tasks: overlapping, concurrency: 4 });
    assert.deepEqual(nonMerge(plan(state)).map((d) => d.taskId), ['A']);

    const disjoint = [
      task('A', { touches: ['src/a/**'] }),
      task('B', { touches: ['src/b/**'] }),
    ];
    const free = boardOf({ tasks: disjoint, concurrency: 2 });
    assert.deepEqual(nonMerge(plan(free)).map((d) => d.taskId), ['A', 'B']);
  });

  it('rule 4: respects the concurrency cap', () => {
    const tasks = [task('A'), task('B'), task('C'), task('D')];
    for (const cap of [0, 1, 2, 3, 4, 8]) {
      const state = boardOf({ tasks, concurrency: Math.max(1, cap) });
      state.concurrency = cap;
      assert.ok(nonMerge(plan(state)).length <= cap, `cap ${cap} exceeded`);
      assert.equal(nonMerge(plan(state)).length, Math.min(cap, 4));
    }
  });

  it('rule 5: at most one merge is ever desired, whatever the cap', () => {
    const tasks = [task('A'), task('B'), task('C')];
    const state = boardOf(
      { tasks, concurrency: 4 },
      makeEvent('merge.enqueued', { taskId: 'A' }),
      makeEvent('merge.enqueued', { taskId: 'B' }),
      makeEvent('merge.enqueued', { taskId: 'C' }),
    );
    const merges = plan(state).filter((d) => d.role === 'merge');
    assert.equal(merges.length, 1);
    assert.equal(merges[0].taskId, 'A', 'the queue head, in enqueue order');
  });

  it('rule 5: the merge head is desired even when the cap is full', () => {
    // Integration is the bottleneck the whole run funnels through. Letting the
    // cap starve it would deadlock a full board.
    const state = boardOf(
      { tasks: [task('A'), task('B')], concurrency: 1 },
      makeEvent('merge.enqueued', { taskId: 'A' }),
      started('B', 'b1', 'builder'),
    );
    const desires = plan(state);
    assert.equal(desires.filter((d) => d.role === 'merge').length, 1);
    assert.equal(nonMerge(desires).length, 1);
  });
});

// ---------------------------------------------------------------------------

describe('plan — the matrix', () => {
  const CAPS = [1, 2, 4];
  const READY = [0, 1, 3, 10];
  const OVERLAP = ['none', 'partial', 'total'];
  const MERGE = [true, false];

  /** Touch globs for `n` tasks under an overlap regime. */
  const touchesFor = (n, overlap) =>
    Array.from({ length: n }, (_, i) => {
      if (overlap === 'total') return ['src/shared/**'];
      if (overlap === 'partial') return i % 2 === 0 ? ['src/shared/**'] : [`src/t${i}/**`];
      return [`src/t${i}/**`];
    });

  for (const cap of CAPS) {
    for (const readyCount of READY) {
      for (const overlap of OVERLAP) {
        for (const mergeInFlight of MERGE) {
          const label = `cap=${cap} ready=${readyCount} overlap=${overlap} merge=${mergeInFlight}`;
          it(`holds every rule at ${label}`, () => {
            const globs = touchesFor(readyCount, overlap);
            const tasks = Array.from({ length: readyCount }, (_, i) =>
              task(`T${i}`, { touches: globs[i] }),
            );
            // A merge in flight needs a task of its own that is already past testing.
            const tail = [];
            if (mergeInFlight) {
              tasks.push(task('M', { touches: ['src/m/**'] }));
              tail.push(...attempt('M', 'm-b', 'builder', 'pass'));
              tail.push(...attempt('M', 'm-t', 'tester', 'pass'));
              tail.push(makeEvent('merge.enqueued', { taskId: 'M' }));
            }
            const state = boardOf({ tasks, concurrency: cap }, ...tail);
            const desires = plan(state);

            // Rule 4.
            assert.ok(nonMerge(desires).length <= cap, `${label}: cap exceeded`);
            // Rule 5.
            assert.ok(
              desires.filter((d) => d.role === 'merge').length <= 1,
              `${label}: more than one merge`,
            );
            assert.equal(
              desires.filter((d) => d.role === 'merge').length,
              mergeInFlight ? 1 : 0,
              `${label}: merge desire mismatch`,
            );
            // Rule 2.
            const ids = nonMerge(desires).map((d) => d.taskId);
            assert.equal(new Set(ids).size, ids.length, `${label}: duplicate task`);
            // Rule 3.
            for (let i = 0; i < ids.length; i += 1) {
              for (let j = i + 1; j < ids.length; j += 1) {
                assert.equal(
                  touchesOverlap(state.tasks.get(ids[i]).touches, state.tasks.get(ids[j]).touches),
                  false,
                  `${label}: ${ids[i]} and ${ids[j]} overlap`,
                );
              }
            }
            // Idempotency.
            assert.deepEqual(plan(state), desires, `${label}: not idempotent`);

            // And the expected count, which the rules above only bound.
            if (overlap === 'total' && readyCount > 0) {
              assert.equal(ids.length, 1, `${label}: total overlap must serialise`);
            } else if (overlap === 'none') {
              assert.equal(ids.length, Math.min(cap, readyCount), `${label}: under-scheduled`);
            }
          });
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------

describe('plan — the sequential deadlock regression', () => {
  it('yields the tester desire on the very next call at N = 1', () => {
    // V1's confirmed failure: the env-fixer pre-reserved the tester's slot while
    // the concurrency check counted that reservation, and the board froze
    // permanently. `plan()` holds no reservations, so there is nothing to leak.
    const state = boardOf(
      { tasks: [task('A')], concurrency: 1 },
      ...attempt('A', 'a1', 'builder', 'pass'),
    );
    assert.deepEqual(plan(state), [
      { taskId: 'A', role: 'tester', seedKind: 'initial', sameWorktree: false },
    ]);
  });

  it('never freezes across a full single-task lifecycle at N = 1', () => {
    const tail = [];
    const push = (...events) => tail.push(...events);
    const at = () => plan(boardOf({ tasks: [task('A')], concurrency: 1 }, ...tail));

    assert.deepEqual(at().map((d) => d.role), ['builder']);
    push(started('A', 'a1', 'builder'));
    assert.deepEqual(at().map((d) => d.role), ['builder'], 'builder in flight');
    push(ended('A', 'a1', 'builder', 'pass'));
    assert.deepEqual(at().map((d) => d.role), ['tester'], 'the frozen step');
    push(started('A', 't1', 'tester'));
    assert.deepEqual(at().map((d) => d.role), ['tester']);
    push(ended('A', 't1', 'tester', 'pass'));
    assert.deepEqual(at(), [], 'nothing to start — the engine must enqueue the merge');
    assert.deepEqual(pendingEnqueues(boardOf({ tasks: [task('A')], concurrency: 1 }, ...tail)), ['A']);
    push(makeEvent('merge.enqueued', { taskId: 'A' }));
    assert.deepEqual(at().map((d) => d.role), ['merge']);
    push(makeEvent('merge.succeeded', { taskId: 'A', sha: 's' }));
    assert.deepEqual(at().map((d) => d.role), ['final'], 'everything merged — verify the whole');
    push(makeEvent('final.test.ended', { outcome: 'pass' }));
    assert.deepEqual(at(), [], 'the run is done');
  });

  it('recovers a slot the moment a blocked builder is retried, with the same worktree', () => {
    // The env-fixer's replacement. Same agent, same worktree, repair seed.
    const state = boardOf(
      { tasks: [task('A'), task('B', { touches: ['src/b/**'] })], concurrency: 1 },
      ...attempt('A', 'a1', 'builder', 'blocked'),
    );
    assert.deepEqual(plan(state), [
      { taskId: 'A', role: 'builder', seedKind: 'repair', sameWorktree: true },
    ]);
  });
});

// ---------------------------------------------------------------------------

describe('plan — determinism and totality', () => {
  const tasks = [
    task('C', { wave: 2, dependsOn: [] }),
    task('A', { wave: 1 }),
    task('B', { wave: 1 }),
  ];

  it('orders output by wave, then declared order, then id', () => {
    const state = boardOf({ tasks, concurrency: 4 });
    assert.deepEqual(orderedTaskIds(state), ['A', 'B', 'C']);
    assert.deepEqual(nonMerge(plan(state)).map((d) => d.taskId), ['A', 'B', 'C']);
  });

  it('returns deep-equal arrays on repeated calls', () => {
    const state = boardOf({ tasks, concurrency: 2 });
    const first = plan(state);
    for (let i = 0; i < 10; i += 1) assert.deepEqual(plan(state), first);
    // Same order, not merely the same set.
    assert.deepEqual(first.map((d) => d.taskId), plan(state).map((d) => d.taskId));
  });

  it('yields no desire for a task depending on an unknown id, rather than throwing', () => {
    const state = boardOf({
      tasks: [task('A'), task('B', { dependsOn: ['ghost'] })],
      concurrency: 4,
    });
    assert.deepEqual(nonMerge(plan(state)).map((d) => d.taskId), ['A']);
  });

  it('is total over degenerate states', () => {
    assert.deepEqual(plan(derive([])), []);
    assert.deepEqual(plan(null), []);
    assert.deepEqual(plan(undefined), []);
    const noTasks = boardOf({ tasks: [], concurrency: 4 });
    assert.deepEqual(plan(noTasks), []);
  });

  it('survives a nonsense concurrency value', () => {
    const state = boardOf({ tasks: [task('A'), task('B')], concurrency: 2 });
    for (const bad of [Number.NaN, -3, 1.5, 'two', null, undefined]) {
      state.concurrency = bad;
      assert.doesNotThrow(() => plan(state), `concurrency ${String(bad)}`);
      assert.ok(nonMerge(plan(state)).length <= 2);
    }
  });

  it('desires no task work once every task is terminal', () => {
    const state = boardOf(
      { tasks: [task('A'), task('B'), task('C')], concurrency: 4 },
      makeEvent('task.abandoned', { taskId: 'A', reason: 'builder-failed' }),
      makeEvent('task.skipped', { taskId: 'B', blockedBy: 'A' }),
      ...merged('C', 's'),
    );
    // What is left is the board-level verification of what did merge.
    assert.deepEqual(plan(state), [
      { taskId: null, role: 'final', seedKind: 'initial', sameWorktree: false },
    ]);

    const verified = boardOf(
      { tasks: [task('A'), task('B'), task('C')], concurrency: 4 },
      makeEvent('task.abandoned', { taskId: 'A', reason: 'builder-failed' }),
      makeEvent('task.skipped', { taskId: 'B', blockedBy: 'A' }),
      ...merged('C', 's'),
      makeEvent('final.test.ended', { outcome: 'pass' }),
    );
    assert.deepEqual(plan(verified), []);
  });

  it('does not desire a final test when there is nothing to verify', () => {
    const allAbandoned = boardOf(
      { tasks: [task('A'), task('B')], concurrency: 4 },
      makeEvent('task.abandoned', { taskId: 'A', reason: 'builder-failed' }),
      makeEvent('task.abandoned', { taskId: 'B', reason: 'builder-failed' }),
    );
    assert.deepEqual(plan(allAbandoned), []);
  });

  it('does not desire a final test while any task is still live', () => {
    const state = boardOf(
      { tasks: [task('A'), task('B')], concurrency: 4 },
      ...merged('A', 's'),
    );
    assert.equal(plan(state).some((d) => d.role === 'final'), false);
  });

  it('does not desire a final test while a merge is queued', () => {
    const state = boardOf(
      { tasks: [task('A'), task('B')], concurrency: 4 },
      ...merged('A', 's'),
      makeEvent('task.abandoned', { taskId: 'B', reason: 'builder-failed' }),
      makeEvent('merge.enqueued', { taskId: 'A' }),
    );
    assert.equal(plan(state).some((d) => d.role === 'final'), false);
  });
});

// ---------------------------------------------------------------------------

describe('plan — in-flight attempts', () => {
  it('describes a resumed repair attempt the way the decision that made it did', () => {
    // Defaulting `sameWorktree` to false meant a repair attempt came back as a
    // fresh-worktree one, so an effector diffing on more than { taskId, role }
    // would restart it in the wrong place — the env-fixer bug class the
    // `blocked` row exists to kill.
    const state = boardOf(
      { tasks: [task('A')], concurrency: 1 },
      ...attempt('A', 'a1', 'builder', 'blocked'),
      started('A', 'a2', 'builder', { seedKind: 'repair' }),
    );
    assert.deepEqual(plan(state), [
      { taskId: 'A', role: 'builder', seedKind: 'repair', sameWorktree: true },
    ]);
  });

  it('keeps the footprint of a running task the cap excluded', () => {
    // Lowering concurrency does not stop those attempts instantly, so anything
    // overlapping them must stay unscheduled during the handover.
    const state = boardOf(
      { tasks: [task('A', { touches: ['src/shared/**'] }), task('B', { touches: ['src/shared/x.ts'] })], concurrency: 2 },
      started('A', 'a1', 'builder'),
      started('B', 'b1', 'builder'),
    );
    state.concurrency = 1;
    const desires = nonMerge(plan(state));
    assert.deepEqual(desires.map((d) => d.taskId), ['A'], 'cap must be respected');
    // B is dropped from `desired` and so will be stopped — but nothing new is
    // started into its footprint either.
    assert.equal(desires.length, 1);
  });
});

describe('pendingSkips — dead ends never stall the run', () => {
  const chain = [
    task('A'),
    task('B', { wave: 2, dependsOn: ['A'] }),
    task('C', { wave: 3, dependsOn: ['B'] }),
    task('D'),
  ];

  it('closes out a branch behind an abandoned task, transitively', () => {
    const state = boardOf(
      { tasks: chain, concurrency: 4 },
      makeEvent('task.abandoned', { taskId: 'A', reason: 'builder-failed' }),
    );
    assert.deepEqual(pendingSkips(state), [
      { taskId: 'B', blockedBy: 'A' },
      { taskId: 'C', blockedBy: 'B' },
    ]);
    // And the independent task keeps going — the whole point.
    assert.deepEqual(nonMerge(plan(state)).map((d) => d.taskId), ['D']);
  });

  it('stops proposing a skip once it is journaled', () => {
    const state = boardOf(
      { tasks: chain, concurrency: 4 },
      makeEvent('task.abandoned', { taskId: 'A', reason: 'builder-failed' }),
      makeEvent('task.skipped', { taskId: 'B', blockedBy: 'A' }),
      makeEvent('task.skipped', { taskId: 'C', blockedBy: 'B' }),
    );
    assert.deepEqual(pendingSkips(state), []);
  });

  it('never skips a task with work still in flight', () => {
    const state = boardOf(
      { tasks: chain, concurrency: 4 },
      started('B', 'b1', 'builder'),
      makeEvent('task.abandoned', { taskId: 'A', reason: 'builder-failed' }),
    );
    assert.deepEqual(pendingSkips(state).map((s) => s.taskId), ['C']);
  });

  it('proposes nothing on a healthy board', () => {
    assert.deepEqual(pendingSkips(boardOf({ tasks: chain, concurrency: 4 })), []);
  });

  it('closes out a dependency cycle rather than stalling forever', () => {
    // parsePlan rejects cycles, so this can only reach the journal by hand — but
    // the failure mode is the worst kind: plan() returns nothing and the board
    // sits idle with work outstanding and no explanation.
    const cyclic = [
      task('A', { dependsOn: ['B'] }),
      task('B', { dependsOn: ['A'] }),
      task('E'),
    ];
    const state = boardOf({ tasks: cyclic, concurrency: 4 });
    assert.deepEqual(nonMerge(plan(state)).map((d) => d.taskId), ['E']);
    assert.deepEqual(pendingSkips(state).map((s) => s.taskId), ['A', 'B']);
  });
});

describe('nextAction — the single policy call site', () => {
  it('starts a builder on a task with no history', () => {
    const state = boardOf({ tasks: [task('A')], concurrency: 1 });
    assert.deepEqual(nextAction(state, 'A'), {
      kind: 'start', role: 'builder', seedKind: 'initial', sameWorktree: false,
    });
  });

  it('routes each outcome through the policy table', () => {
    const cases = [
      [['fail'], { kind: 'start', role: 'builder', seedKind: 'failure-aware', sameWorktree: false }],
      [['blocked'], { kind: 'start', role: 'builder', seedKind: 'repair', sameWorktree: true }],
      [['crashed'], { kind: 'start', role: 'builder', seedKind: 'continue', sameWorktree: false }],
      [['timeout'], { kind: 'start', role: 'builder', seedKind: 'continue', sameWorktree: false }],
      [['no_report'], { kind: 'start', role: 'builder', seedKind: 'continue', sameWorktree: false }],
      [['pass'], { kind: 'start', role: 'tester', seedKind: 'initial', sameWorktree: false }],
    ];
    for (const [outcomes, expected] of cases) {
      const tail = outcomes.flatMap((o, i) => attempt('A', `a${i}`, 'builder', o));
      const state = boardOf({ tasks: [task('A')], concurrency: 1 }, ...tail);
      assert.deepEqual(nextAction(state, 'A'), expected, outcomes.join(','));
    }
  });

  it('gives fail two more tries and blocked one, then abandons', () => {
    // The `attempts` column counts tries finished *before* the one being
    // decided, so `fail | < 2` is two retries and `blocked | < 1` is one.
    const fails = (n) =>
      boardOf(
        { tasks: [task('A')], concurrency: 1 },
        ...Array.from({ length: n }, (_, i) => attempt('A', `a${i}`, 'builder', 'fail')).flat(),
      );
    assert.equal(nextAction(fails(1), 'A').kind, 'start');
    assert.equal(nextAction(fails(2), 'A').kind, 'start');
    assert.equal(nextAction(fails(3), 'A').kind, 'abandon');

    const blocks = (n) =>
      boardOf(
        { tasks: [task('A')], concurrency: 1 },
        ...Array.from({ length: n }, (_, i) => attempt('A', `a${i}`, 'builder', 'blocked')).flat(),
      );
    assert.equal(nextAction(blocks(1), 'A').kind, 'start');
    assert.equal(nextAction(blocks(2), 'A').kind, 'abandon');
  });

  it('abandons once the bound is reached, carrying evidence', () => {
    const state = boardOf(
      { tasks: [task('A')], concurrency: 1 },
      ...attempt('A', 'a1', 'builder', 'fail'),
      ...attempt('A', 'a2', 'builder', 'fail'),
      ...attempt('A', 'a3', 'builder', 'fail'),
    );
    const next = nextAction(state, 'A');
    assert.equal(next.kind, 'abandon');
    assert.equal(next.reason, 'builder-failed');
    assert.deepEqual(next.evidence, { role: 'builder', outcome: 'fail', attemptCount: 2 });
    assert.deepEqual(pendingAbandonments(state), [
      { taskId: 'A', reason: 'builder-failed', evidence: next.evidence },
    ]);
    // And the scheduler starts nothing for it.
    assert.deepEqual(plan(state), []);
  });

  it('enqueues a merge after the tester passes, rather than starting one', () => {
    const state = boardOf(
      { tasks: [task('A')], concurrency: 1 },
      ...attempt('A', 'a1', 'builder', 'pass'),
      ...attempt('A', 't1', 'tester', 'pass'),
    );
    assert.deepEqual(nextAction(state, 'A'), { kind: 'enqueue' });
    assert.deepEqual(pendingEnqueues(state), ['A']);
    assert.deepEqual(plan(state), []);
  });

  it('re-opens the owning task with a rebase seed on a merge conflict', () => {
    // No merge-fixer agent. The agent that wrote the code has the context.
    const state = boardOf(
      { tasks: [task('A')], concurrency: 1 },
      ...attempt('A', 'a1', 'builder', 'pass'),
      ...attempt('A', 't1', 'tester', 'pass'),
      makeEvent('merge.enqueued', { taskId: 'A' }),
      makeEvent('merge.conflicted', { taskId: 'A', files: ['src/a.ts'] }),
    );
    assert.deepEqual(nextAction(state, 'A'), {
      kind: 'start', role: 'builder', seedKind: 'rebase', sameWorktree: false,
    });
    assert.deepEqual(plan(state).map((d) => d.seedKind), ['rebase']);
  });

  it('abandons after a third merge conflict', () => {
    const conflictOnce = [
      makeEvent('merge.enqueued', { taskId: 'A' }),
      makeEvent('merge.conflicted', { taskId: 'A', files: ['src/a.ts'] }),
    ];
    const state = boardOf(
      { tasks: [task('A')], concurrency: 1 },
      ...attempt('A', 'a1', 'builder', 'pass'),
      ...attempt('A', 't1', 'tester', 'pass'),
      ...conflictOnce,
      ...conflictOnce,
      ...conflictOnce,
    );
    assert.equal(nextAction(state, 'A').kind, 'abandon');
    assert.equal(nextAction(state, 'A').reason, 'merge-conflicted');
  });

  it('says nothing about a task that has work in flight', () => {
    const state = boardOf({ tasks: [task('A')], concurrency: 1 }, started('A', 'a1', 'builder'));
    assert.deepEqual(nextAction(state, 'A'), { kind: 'none' });
    assert.deepEqual(nextAction(state, 'ghost'), { kind: 'none' });
  });
});

// ---------------------------------------------------------------------------

describe('touchesOverlap — pure glob-set intersection', () => {
  const overlaps = [
    ['src/a.ts', 'src/a.ts'],
    ['src/**', 'src/a/b.ts'],
    ['src/**', 'src/**'],
    ['src/**/*.ts', 'src/a/**'],
    ['src/**/*.ts', 'src/a/b.ts'],
    ['src/ui/*.ts', 'src/ui/panel.ts'],
    ['src/ui/', 'src/ui/panel.ts'],
    ['./src/a/**', 'src/a/b.ts'],
    ['src/a?.ts', 'src/ab.ts'],
    ['**', 'anything/at/all.ts'],
    ['server/**/*.js', 'server/orchestrator/core/plan.js'],
    ['src/*/index.ts', 'src/ui/index.ts'],
  ];
  const disjoint = [
    ['src/a/**', 'src/b/**'],
    ['src/a.ts', 'src/b.ts'],
    ['src/**/*.ts', 'src/**/*.css'],
    ['src/ui/*.ts', 'src/ui/nested/panel.ts'],
    ['src/a?.ts', 'src/abc.ts'],
    ['server/**', 'src/**'],
    ['src/*/index.ts', 'src/ui/deep/index.ts'],
  ];

  for (const [a, b] of overlaps) {
    it(`${a} overlaps ${b}`, () => {
      assert.equal(globsIntersect(a, b), true);
      assert.equal(globsIntersect(b, a), true, 'must be symmetric');
      assert.equal(touchesOverlap([a], [b]), true);
    });
  }

  for (const [a, b] of disjoint) {
    it(`${a} does not overlap ${b}`, () => {
      assert.equal(globsIntersect(a, b), false);
      assert.equal(globsIntersect(b, a), false, 'must be symmetric');
      assert.equal(touchesOverlap([a], [b]), false);
    });
  }

  it('understands character classes, which parsePlan admits', () => {
    // Treating `[ab]` as three literal characters made `src/[ab]x.ts` and
    // `src/ax.ts` read as disjoint — two tasks writing one file, scheduled
    // concurrently, from a plan the parser accepted.
    assert.equal(globsIntersect('src/[ab]x.ts', 'src/ax.ts'), true);
    assert.equal(globsIntersect('src/[ab]x.ts', 'src/bx.ts'), true);
    assert.equal(globsIntersect('src/[ab]x.ts', 'src/cx.ts'), false);
    assert.equal(globsIntersect('src/[a-z]x.ts', 'src/qx.ts'), true);
    assert.equal(globsIntersect('src/[a-c]x.ts', 'src/zx.ts'), false);
    assert.equal(globsIntersect('src/[ab]x.ts', 'src/[bc]x.ts'), true);
    assert.equal(globsIntersect('src/[ab]x.ts', 'src/[cd]x.ts'), false);
    assert.equal(globsIntersect('src/[!ab]x.ts', 'src/cx.ts'), true);
    assert.equal(globsIntersect('src/[!ab]x.ts', 'src/ax.ts'), false);
    assert.equal(globsIntersect('src/[ab]*.ts', 'src/along.ts'), true);
  });

  it('is symmetric and self-intersecting across a generated sweep', () => {
    const parts = ['a', 'b', '*', '**', '?', 'x?', '[ab]', '[a-c]', '*.ts', 'a*'];
    let checked = 0;
    for (const p1 of parts) {
      for (const p2 of parts) {
        const a = `src/${p1}/${p2}`;
        assert.equal(globsIntersect(a, a), true, `${a} does not intersect itself`);
        for (const p3 of parts) {
          const b = `src/${p3}`;
          assert.equal(globsIntersect(a, b), globsIntersect(b, a), `${a} vs ${b} is asymmetric`);
          checked += 1;
        }
      }
    }
    assert.ok(checked >= 1000, `only ${checked} pairs checked`);
  });

  it('overlaps when any pair in the sets overlaps', () => {
    assert.equal(touchesOverlap(['src/a/**', 'src/z/**'], ['src/q/**', 'src/z/x.ts']), true);
    assert.equal(touchesOverlap(['src/a/**'], ['src/q/**', 'src/z/x.ts']), false);
  });

  it('treats an empty footprint as overlapping nothing', () => {
    assert.equal(touchesOverlap([], ['src/**']), false);
    assert.equal(touchesOverlap(['src/**'], []), false);
    assert.equal(touchesOverlap([], []), false);
  });

  it('needs no filesystem and terminates on pathological globs', () => {
    const nasty = '**/*/**/*/**/*/**/*/**/*.ts';
    assert.doesNotThrow(() => globsIntersect(nasty, nasty));
    assert.equal(globsIntersect(nasty, 'a/b/c/d/e/f.ts'), true);
  });
});
