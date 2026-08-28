/**
 * P0-C — the pure fold from journal to board state.
 *
 * The properties here are the ones that license deleting V1's recovery
 * subsystem: replay is deterministic, prefixes are consistent, a truncated or
 * partially-unknown journal still derives, and attempt counts exist without a
 * counter anywhere in the state.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeEvent } from '../../server/orchestrator/core/events.js';
import {
  attemptCount,
  deadEnded,
  derive,
  lastEndedAttempt,
  readyTasks,
} from '../../server/orchestrator/core/derive.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Stamp a list of payload events with gapless seq and a fixed ts. */
function journal(...events) {
  return events.map((e, i) => ({ ...e, seq: i + 1, ts: 1_700_000_000_000 + i }));
}

const TASKS = [
  { id: 'W1-A', title: 'A', wave: 1, dependsOn: [], touches: ['src/a/**'], build: 'b', test: 't', accept: 'x' },
  { id: 'W1-B', title: 'B', wave: 1, dependsOn: [], touches: ['src/b/**'], build: 'b', test: 't', accept: 'x' },
  { id: 'W2-C', title: 'C', wave: 2, dependsOn: ['W1-A', 'W1-B'], touches: ['src/c/**'], build: 'b', test: 't', accept: 'x' },
];

const created = () =>
  makeEvent('board.created', {
    boardId: 'b1',
    planPath: 'plan.md',
    name: 'demo',
    tasks: TASKS,
    waves: [{ n: 1, name: 'One' }, { n: 2, name: 'Two' }],
  });

const started = (taskId, attemptId, role, extra = {}) =>
  makeEvent('task.attempt.started', { taskId, attemptId, role, ...extra });
const ended = (taskId, attemptId, role, outcome, extra = {}) =>
  makeEvent('task.attempt.ended', { taskId, attemptId, role, outcome, ...extra });

/** A task taken all the way through builder, tester, and merge. */
const throughMerge = (taskId, n, sha) => [
  started(taskId, `${taskId}-b${n}`, 'builder'),
  ended(taskId, `${taskId}-b${n}`, 'builder', 'pass'),
  started(taskId, `${taskId}-t${n}`, 'tester'),
  ended(taskId, `${taskId}-t${n}`, 'tester', 'pass'),
  makeEvent('merge.enqueued', { taskId }),
  makeEvent('merge.succeeded', { taskId, sha }),
];

// ---------------------------------------------------------------------------

describe('derive — shape', () => {
  it('builds tasks from board.created in declared order', () => {
    const state = derive(journal(created()));
    assert.equal(state.boardId, 'b1');
    assert.equal(state.planPath, 'plan.md');
    assert.equal(state.name, 'demo');
    assert.deepEqual(state.taskOrder, ['W1-A', 'W1-B', 'W2-C']);
    assert.deepEqual([...state.tasks.keys()], ['W1-A', 'W1-B', 'W2-C']);
    assert.deepEqual(state.waves, [{ n: 1, name: 'One' }, { n: 2, name: 'Two' }]);
    assert.equal(state.status, 'created');
    assert.equal(state.tasks.get('W2-C').dependsOn.join(','), 'W1-A,W1-B');
    assert.deepEqual(state.tasks.get('W1-A').touches, ['src/a/**']);
    assert.equal(state.tasks.get('W1-A').buildSpec, 'b');
  });

  it('tracks board status and concurrency', () => {
    const running = derive(journal(created(), makeEvent('board.started', { concurrency: 3 })));
    assert.equal(running.status, 'running');
    assert.equal(running.concurrency, 3);

    const stopped = derive(
      journal(created(), makeEvent('board.started', { concurrency: 3 }), makeEvent('board.stopped', { reason: 'user' })),
    );
    assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.stopReason, 'user');
    // Concurrency survives a stop — restarting must not silently reset it.
    assert.equal(stopped.concurrency, 3);
  });

  it('derives every phase', () => {
    const events = journal(
      created(),
      started('W1-A', 'a1', 'builder'),
    );
    assert.equal(derive(events).tasks.get('W1-A').phase, 'building');
    assert.equal(derive(events).tasks.get('W1-B').phase, 'idle');

    const testing = journal(created(), ...throughMerge('W1-A', 1, 'sha1').slice(0, 3));
    assert.equal(derive(testing).tasks.get('W1-A').phase, 'testing');

    const merging = journal(created(), ...throughMerge('W1-A', 1, 'sha1').slice(0, 5));
    assert.equal(derive(merging).tasks.get('W1-A').phase, 'merging');

    const merged = journal(created(), ...throughMerge('W1-A', 1, 'sha1'));
    assert.equal(derive(merged).tasks.get('W1-A').phase, 'merged');
    assert.equal(derive(merged).tasks.get('W1-A').mergedSha, 'sha1');
    assert.equal(derive(merged).integrationSha, 'sha1');
    assert.deepEqual(derive(merged).mergeQueue, []);

    const abandoned = derive(journal(created(), makeEvent('task.abandoned', { taskId: 'W1-A', reason: 'builder-failed-twice' })));
    assert.equal(abandoned.tasks.get('W1-A').phase, 'abandoned');
    assert.equal(abandoned.tasks.get('W1-A').abandonedReason, 'builder-failed-twice');

    const skipped = derive(journal(created(), makeEvent('task.skipped', { taskId: 'W2-C', blockedBy: 'W1-A' })));
    assert.equal(skipped.tasks.get('W2-C').phase, 'skipped');
    assert.equal(skipped.tasks.get('W2-C').skippedBy, 'W1-A');
  });

  it('abandonment outranks every other phase', () => {
    const state = derive(
      journal(
        created(),
        started('W1-A', 'a1', 'builder'),
        makeEvent('merge.enqueued', { taskId: 'W1-A' }),
        makeEvent('task.abandoned', { taskId: 'W1-A', reason: 'blocked-twice' }),
      ),
    );
    assert.equal(state.tasks.get('W1-A').phase, 'abandoned');
    assert.deepEqual(state.mergeQueue, []);
  });

  it('records merge conflicts and drops the task from the queue', () => {
    const state = derive(
      journal(
        created(),
        makeEvent('merge.enqueued', { taskId: 'W1-A' }),
        makeEvent('merge.conflicted', { taskId: 'W1-A', files: ['src/a.ts', 'src/b.ts'] }),
      ),
    );
    assert.deepEqual(state.mergeQueue, []);
    assert.deepEqual(state.tasks.get('W1-A').mergeConflicts, ['src/a.ts', 'src/b.ts']);
    assert.equal(state.tasks.get('W1-A').phase, 'idle');
  });

  it('keeps the merge queue in enqueue order', () => {
    const state = derive(
      journal(
        created(),
        makeEvent('merge.enqueued', { taskId: 'W1-B' }),
        makeEvent('merge.enqueued', { taskId: 'W1-A' }),
        makeEvent('merge.enqueued', { taskId: 'W1-B' }),
      ),
    );
    assert.deepEqual(state.mergeQueue, ['W1-B', 'W1-A']);
  });

  it('journals touches overflow without changing the phase', () => {
    const state = derive(
      journal(
        created(),
        started('W1-A', 'a1', 'builder'),
        makeEvent('touches.overflow', {
          taskId: 'W1-A',
          attemptId: 'a1',
          declared: ['src/a/**'],
          actual: ['src/a/x.ts', 'package-lock.json'],
        }),
      ),
    );
    // Overflow is a scheduling signal, not a failure. Rebase-before-merge is the
    // real conflict authority.
    assert.equal(state.tasks.get('W1-A').phase, 'building');
    assert.equal(state.tasks.get('W1-A').touchesOverflow.length, 1);
    assert.deepEqual(state.tasks.get('W1-A').touchesOverflow[0].actual, ['src/a/x.ts', 'package-lock.json']);
  });

  it('records the final test and the run summary', () => {
    const state = derive(
      journal(
        created(),
        makeEvent('final.test.ended', { outcome: 'pass', runInstructions: 'npm start' }),
        makeEvent('run.finished', { summary: 'all good' }),
      ),
    );
    assert.deepEqual(state.finalTest, { outcome: 'pass', runInstructions: 'npm start', evidence: null });
    assert.equal(state.finished, true);
    assert.equal(state.runSummary, 'all good');
  });

  it('appends new tasks on a later board.created without rewriting existing ones', () => {
    const state = derive(
      journal(
        created(),
        started('W1-A', 'a1', 'builder'),
        makeEvent('board.created', {
          boardId: 'b1',
          planPath: 'plan.md',
          tasks: [...TASKS, { id: 'W3-D', title: 'D', wave: 3, dependsOn: ['W2-C'], touches: [] }],
          waves: [{ n: 3, name: 'Three' }],
        }),
      ),
    );
    assert.deepEqual(state.taskOrder, ['W1-A', 'W1-B', 'W2-C', 'W3-D']);
    assert.equal(state.tasks.get('W1-A').attempts.length, 1, 'in-flight task was rewritten');
  });
});

// ---------------------------------------------------------------------------

describe('derive — attempt counts without counters', () => {
  it('counts three builder and two tester attempts on one task', () => {
    const events = journal(
      created(),
      started('W1-A', 'b1', 'builder'), ended('W1-A', 'b1', 'builder', 'fail'),
      started('W1-A', 'b2', 'builder'), ended('W1-A', 'b2', 'builder', 'crashed'),
      started('W1-A', 'b3', 'builder'), ended('W1-A', 'b3', 'builder', 'pass'),
      started('W1-A', 't1', 'tester'), ended('W1-A', 't1', 'tester', 'fail'),
      started('W1-A', 't2', 'tester'), ended('W1-A', 't2', 'tester', 'pass'),
    );
    const state = derive(events);
    assert.equal(attemptCount(state, 'W1-A', 'builder'), 3);
    assert.equal(attemptCount(state, 'W1-A', 'tester'), 2);
    assert.equal(attemptCount(state, 'W1-A', 'merge'), 0);
    assert.equal(attemptCount(state, 'W1-B', 'builder'), 0);
    assert.equal(attemptCount(state, 'nope', 'builder'), 0);
  });

  it('stores no counter field anywhere in task state', () => {
    const state = derive(
      journal(created(), started('W1-A', 'b1', 'builder'), ended('W1-A', 'b1', 'builder', 'fail')),
    );
    const task = state.tasks.get('W1-A');
    for (const key of Object.keys(task)) {
      assert.doesNotMatch(
        key,
        /(attempts?count|count|retries|rounds?)$/i,
        `TaskState.${key} looks like a counter — counts must stay derived`,
      );
    }
    // `attempts` is the event list, not a number.
    assert.equal(Array.isArray(task.attempts), true);
  });

  it('counts only finished attempts', () => {
    const state = derive(journal(created(), started('W1-A', 'b1', 'builder')));
    assert.equal(attemptCount(state, 'W1-A', 'builder'), 0);
    assert.equal(state.tasks.get('W1-A').attempts.length, 1);
  });

  it('reports the last finished attempt and its outcome', () => {
    const state = derive(
      journal(
        created(),
        started('W1-A', 'b1', 'builder'), ended('W1-A', 'b1', 'builder', 'fail'),
        started('W1-A', 'b2', 'builder'),
      ),
    );
    const task = state.tasks.get('W1-A');
    assert.equal(lastEndedAttempt(task).attemptId, 'b1');
    assert.equal(task.outcome, 'fail');
    assert.equal(task.phase, 'building');
  });

  it('counts an ended attempt whose started line is missing', () => {
    // A hand-edited or pre-schema journal. Dropping it would undercount, and the
    // count is exactly what the policy table runs on.
    const state = derive(journal(created(), ended('W1-A', 'ghost', 'builder', 'fail')));
    assert.equal(attemptCount(state, 'W1-A', 'builder'), 1);
  });

  it('ignores a duplicate ended line', () => {
    const state = derive(
      journal(
        created(),
        started('W1-A', 'b1', 'builder'),
        ended('W1-A', 'b1', 'builder', 'fail'),
        ended('W1-A', 'b1', 'builder', 'pass'),
      ),
    );
    assert.equal(attemptCount(state, 'W1-A', 'builder'), 1);
    assert.equal(state.tasks.get('W1-A').outcome, 'fail');
  });
});

// ---------------------------------------------------------------------------

describe('derive — readiness and dead ends', () => {
  it('holds a task until every dependency has merged', () => {
    const none = derive(journal(created()));
    assert.deepEqual(readyTasks(none), ['W1-A', 'W1-B']);

    const one = derive(journal(created(), ...throughMerge('W1-A', 1, 's1')));
    assert.deepEqual(readyTasks(one), ['W1-B']);

    const both = derive(journal(created(), ...throughMerge('W1-A', 1, 's1'), ...throughMerge('W1-B', 1, 's2')));
    assert.deepEqual(readyTasks(both), ['W2-C']);
  });

  it('does not cap readiness by concurrency', () => {
    // Keeping the fold free of policy is what lets one state answer for N=1 and N=4.
    const state = derive(journal(created(), makeEvent('board.started', { concurrency: 1 })));
    assert.equal(readyTasks(state).length, 2);
  });

  it('finds tasks stranded behind an abandoned dependency, transitively', () => {
    const graph = [
      { id: 'A', title: 'A', wave: 1, dependsOn: [], touches: [] },
      { id: 'B', title: 'B', wave: 2, dependsOn: ['A'], touches: [] },
      { id: 'C', title: 'C', wave: 3, dependsOn: ['B'], touches: [] },
      { id: 'D', title: 'D', wave: 1, dependsOn: [], touches: [] },
    ];
    const state = derive(
      journal(
        makeEvent('board.created', { boardId: 'b', planPath: 'p', tasks: graph, waves: [] }),
        makeEvent('task.abandoned', { taskId: 'A', reason: 'builder-failed-twice' }),
      ),
    );
    const dead = deadEnded(state);
    assert.deepEqual([...dead.entries()], [['B', 'A'], ['C', 'B']]);
    assert.equal(dead.has('D'), false, 'an independent task must not be stranded');
    assert.deepEqual(readyTasks(state), ['D']);
  });
});

// ---------------------------------------------------------------------------

describe('derive — tolerance and totality', () => {
  const base = journal(
    created(),
    makeEvent('board.started', { concurrency: 2 }),
    ...throughMerge('W1-A', 1, 's1'),
    started('W1-B', 'b1', 'builder'),
    ended('W1-B', 'b1', 'builder', 'fail'),
  );

  it('ignores an unknown event type at every position', () => {
    const expected = derive(base);
    for (let i = 0; i <= base.length; i += 1) {
      const spiked = [...base.slice(0, i), { v: 1, seq: 999, ts: 1, type: 'x.y.z', junk: [1, 2] }, ...base.slice(i)];
      assert.deepEqual(derive(spiked), expected, `unknown event at index ${i} changed the state`);
    }
  });

  it('ignores a malformed known event rather than throwing', () => {
    const expected = derive(base);
    const spiked = [...base, { v: 1, seq: 99, ts: 1, type: 'merge.succeeded', taskId: 'W1-B' }];
    assert.deepEqual(derive(spiked), expected);
  });

  it('ignores events naming a task that does not exist', () => {
    const expected = derive(base);
    const spiked = [
      ...base,
      makeEvent('task.attempt.started', { taskId: 'ghost', attemptId: 'g1', role: 'builder' }),
      makeEvent('merge.succeeded', { taskId: 'ghost', sha: 'x' }),
      makeEvent('task.abandoned', { taskId: 'ghost', reason: 'r' }),
    ];
    assert.deepEqual(derive(spiked), expected);
  });

  it('derives from a truncated journal at every length', () => {
    for (let n = 0; n <= base.length; n += 1) {
      assert.doesNotThrow(() => derive(base.slice(0, n)), `threw at prefix length ${n}`);
    }
  });

  it('derives when the last line is corrupt', () => {
    const dropped = derive(base.slice(0, -1));
    for (const corrupt of [
      null,
      undefined,
      42,
      '{"type":"task.attempt',
      { type: 'task.attempt.ended' },
      { v: 1, type: 'task.attempt.ended', taskId: 'W1-B' },
      [],
    ]) {
      assert.deepEqual(derive([...base.slice(0, -1), corrupt]), dropped);
    }
  });

  it('derives an empty journal', () => {
    const state = derive([]);
    assert.equal(state.boardId, '');
    assert.equal(state.tasks.size, 0);
    assert.deepEqual(readyTasks(state), []);
  });
});

// ---------------------------------------------------------------------------
// Generated journals
// ---------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32) so a failure reproduces from its seed. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OUTCOMES = ['pass', 'fail', 'blocked', 'no_report', 'crashed', 'timeout'];

/** A plausible, structurally varied journal for a small linear-ish DAG. */
function generateJournal(seed) {
  const r = rng(seed);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const n = 2 + Math.floor(r() * 4);
  const tasks = [];
  for (let i = 0; i < n; i += 1) {
    tasks.push({
      id: `T${i}`,
      title: `Task ${i}`,
      wave: 1 + Math.floor(i / 2),
      dependsOn: i > 0 && r() < 0.5 ? [`T${Math.floor(r() * i)}`] : [],
      touches: [`src/t${i}/**`],
      build: 'b',
      test: 't',
      accept: 'a',
    });
  }
  const events = [
    makeEvent('board.created', { boardId: `b${seed}`, planPath: 'p.md', tasks, waves: [] }),
    makeEvent('board.started', { concurrency: 1 + Math.floor(r() * 4) }),
  ];
  let k = 0;
  for (const task of tasks) {
    const rounds = 1 + Math.floor(r() * 3);
    for (let i = 0; i < rounds; i += 1) {
      const role = pick(['builder', 'tester']);
      const id = `a${(k += 1)}`;
      events.push(makeEvent('task.attempt.started', { taskId: task.id, attemptId: id, role }));
      if (r() < 0.85) {
        events.push(makeEvent('task.attempt.ended', { taskId: task.id, attemptId: id, role, outcome: pick(OUTCOMES) }));
      }
    }
    const roll = r();
    if (roll < 0.4) {
      events.push(makeEvent('merge.enqueued', { taskId: task.id }));
      events.push(makeEvent('merge.succeeded', { taskId: task.id, sha: `sha${k}` }));
    } else if (roll < 0.55) {
      events.push(makeEvent('merge.enqueued', { taskId: task.id }));
      events.push(makeEvent('merge.conflicted', { taskId: task.id, files: ['src/x.ts'] }));
    } else if (roll < 0.7) {
      events.push(makeEvent('task.abandoned', { taskId: task.id, reason: 'builder-failed-twice' }));
    }
  }
  events.push(makeEvent('run.finished', { summary: 'done' }));
  return events.map((e, i) => ({ ...e, seq: i + 1, ts: i }));
}

describe('derive — determinism over generated journals', () => {
  it('is deterministic across 200 generated journals', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const events = generateJournal(seed);
      assert.deepEqual(derive(events), derive(events), `seed ${seed}`);
      // And independent of how the caller supplies the events.
      assert.deepEqual(derive(events), derive(events.values()), `seed ${seed} (iterator)`);
    }
  });

  it('is unaffected by ts, which is display-only', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const events = generateJournal(seed);
      const reStamped = events.map((e) => ({ ...e, ts: 9_999_999 - e.seq }));
      assert.deepEqual(derive(reStamped), derive(events), `seed ${seed}`);
    }
  });

  it('every prefix derives, and the facts that must be monotone are', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const events = generateJournal(seed);
      let previous = derive([]);
      for (let n = 0; n <= events.length; n += 1) {
        const current = derive(events.slice(0, n));
        for (const [id, task] of previous.tasks) {
          const now = current.tasks.get(id);
          assert.ok(now, `seed ${seed}: task ${id} vanished at prefix ${n}`);
          assert.ok(now.attempts.length >= task.attempts.length, `seed ${seed}: attempts shrank`);
          if (task.phase === 'merged') assert.equal(now.phase, 'merged', `seed ${seed}: ${id} un-merged`);
          if (task.phase === 'abandoned') {
            assert.equal(now.phase, 'abandoned', `seed ${seed}: ${id} un-abandoned`);
          }
        }
        if (previous.finished) assert.equal(current.finished, true, `seed ${seed}: run un-finished`);
        previous = current;
      }
    }
  });

  it('replay after a simulated crash reproduces the pre-crash state', () => {
    // This is the property that deletes boot-resume, display-wake reconcile, and
    // OOM-pause repair: restart *is* recovery.
    for (let seed = 1; seed <= 100; seed += 1) {
      const events = generateJournal(seed);
      const cut = Math.floor(events.length / 2);
      const beforeCrash = derive(events.slice(0, cut));
      const afterRestart = derive(events.slice(0, cut).map((e) => ({ ...e })));
      assert.deepEqual(afterRestart, beforeCrash, `seed ${seed}`);
    }
  });

  it('tolerates an unknown event injected anywhere in a generated journal', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const events = generateJournal(seed);
      const expected = derive(events);
      const at = seed % (events.length + 1);
      const spiked = [...events.slice(0, at), { v: 3, type: 'future.thing', x: 1 }, ...events.slice(at)];
      assert.deepEqual(derive(spiked), expected, `seed ${seed} at ${at}`);
    }
  });
});
