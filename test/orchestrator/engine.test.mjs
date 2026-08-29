/**
 * P1-B — the reconcile loop and the effector interface.
 *
 * The properties that matter are the ones that let V1's entire recovery
 * subsystem be deleted: ticking twice changes nothing, a process that vanishes
 * comes back with no code that knows about vanishing, and nothing is journaled
 * before the effect it records has happened.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { resetMinnowHomeCache } from '../../server/config/home.js';
import { makeEvent } from '../../server/orchestrator/core/events.js';
import { createEngine } from '../../server/orchestrator/engine.js';
import { createScriptedEffector } from '../../server/orchestrator/effector-scripted.js';
import {
  appendEvent,
  createBoard,
  readEvents,
  resetJournalCache,
} from '../../server/orchestrator/journal.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENGINE_SOURCE = path.join(PROJECT_ROOT, 'server/orchestrator/engine.js');

/** @type {string | undefined} */
let previousHome;

before(() => {
  previousHome = process.env.MINNOW_HOME;
});

/**
 * Every engine a test built.
 *
 * Each test gets its own MINNOW_HOME, so an engine left ticking would append
 * into the *next* test's board — which is exactly the kind of cross-test
 * contamination that makes a scheduler suite untrustworthy.
 *
 * @type {Array<{ dispose: () => void }>}
 */
let liveEngines = [];

beforeEach(async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-engine-'));
  process.env.MINNOW_HOME = home;
  resetMinnowHomeCache();
  resetJournalCache();
  liveEngines = [];
});

afterEach(async () => {
  for (const engine of liveEngines) engine.dispose();
  liveEngines = [];
  // Let any append already in flight finish against the home it was started in.
  await settle();
});

after(() => {
  if (previousHome === undefined) delete process.env.MINNOW_HOME;
  else process.env.MINNOW_HOME = previousHome;
  resetMinnowHomeCache();
  resetJournalCache();
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** A clock the test drives. Nothing here waits on real time. */
function fakeClock() {
  let now = 1_700_000_000_000;
  /** @type {Map<number, { at: number, fn: () => void }>} */
  const timers = new Map();
  let nextHandle = 0;
  return {
    now: () => now,
    setTimer(fn, ms) {
      const handle = (nextHandle += 1);
      timers.set(handle, { at: now + ms, fn });
      return handle;
    },
    clearTimer(handle) {
      timers.delete(/** @type {number} */ (handle));
    },
    /** Advance time, firing everything due. */
    async advance(ms) {
      now += ms;
      const due = [...timers.entries()].filter(([, t]) => t.at <= now);
      for (const [handle, timer] of due) {
        timers.delete(handle);
        timer.fn();
      }
      await settle();
    },
    get pending() {
      return timers.size;
    },
  };
}

/**
 * Let the engine go quiet.
 *
 * The engine's appends are real filesystem writes, and each one costs several
 * turns of the loop — the write itself, plus the `stat` that revalidates the
 * journal's tail. Draining microtasks is not enough, and under-settling makes
 * the suite *wrong* rather than flaky: the next tick reads a state that has not
 * caught up and correctly does nothing, which looks exactly like a stalled board.
 */
async function settle(rounds = 60) {
  for (let round = 0; round < 3; round += 1) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
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

/**
 * A loaded engine over a fresh board.
 *
 * @param {{ boardId?: string, tasks?: object[], script?: object[], effector?: object }} [setup]
 */
async function harness(setup = {}) {
  const boardId = setup.boardId ?? 'b1';
  const clock = fakeClock();
  await createBoard(boardId);
  await appendEvent(
    boardId,
    makeEvent('board.created', {
      boardId,
      planPath: 'plan.md',
      tasks: setup.tasks ?? [task('A')],
      waves: [],
    }),
    { now: clock.now },
  );

  const effector = setup.effector ?? createScriptedEffector({ script: setup.script ?? [], clock });
  const engine = createEngine({ boardId, effector, clock, tickMs: 5000 });
  liveEngines.push(engine);
  await engine.load();
  return { boardId, engine, effector, clock };
}

/** Run a board to completion, bounded so a stall fails instead of hanging. */
async function runToCompletion(engine, clock, concurrency = 1, maxTicks = 400) {
  await engine.startBoard(concurrency);
  for (let i = 0; i < maxTicks; i += 1) {
    await settle();
    if (engine.getState().finished) return i;
    await engine.tick();
    if (clock.pending > 0) await clock.advance(10_000);
  }
  assert.fail(`board did not finish in ${maxTicks} ticks`);
}

// ---------------------------------------------------------------------------

describe('engine — the tick', () => {
  it('runs a single-task board end to end', async () => {
    const { engine, clock, boardId } = await harness();
    await runToCompletion(engine, clock);

    const state = engine.getState();
    assert.equal(state.tasks.get('A').phase, 'merged');
    assert.equal(state.finished, true);
    assert.equal(state.status, 'stopped');
    assert.equal(state.stopReason, 'complete');

    const types = (await readEvents(boardId)).map((e) => e.type);
    assert.deepEqual(types, [
      'board.created',
      'board.started',
      'task.attempt.started',
      'task.attempt.ended',
      'task.attempt.started',
      'task.attempt.ended',
      'merge.enqueued',
      'merge.succeeded',
      'final.test.ended',
      'run.finished',
      'board.stopped',
    ]);
  });

  it('is idempotent — a second tick on identical state starts nothing', async () => {
    const { engine, effector, clock } = await harness({
      script: [{ match: { role: 'builder' }, emit: { outcome: 'pass', delayMs: 1000 } }],
    });
    await engine.startBoard(1);
    await settle();

    const afterFirst = effector.started.length;
    assert.equal(afterFirst, 1);
    for (let i = 0; i < 10; i += 1) {
      await engine.tick();
      await settle();
    }
    assert.equal(effector.started.length, afterFirst, 'extra ticks started work');
    assert.equal(clock.pending >= 1, true);
  });

  it('starts exactly one process per {taskId, role} under 20 concurrent ticks', async () => {
    const { engine, effector } = await harness({
      script: [{ emit: { outcome: 'pass', delayMs: 5000 } }],
      tasks: [task('A'), task('B'), task('C')],
    });
    await engine.startBoard(3);
    await Promise.all(Array.from({ length: 20 }, () => engine.tick()));
    await settle();

    const keys = effector.started.map((s) => `${s.taskId}:${s.role}`);
    assert.deepEqual([...new Set(keys)].sort(), ['A:builder', 'B:builder', 'C:builder']);
    assert.equal(keys.length, 3, `double-started: ${keys.join(', ')}`);
  });

  it('coalesces a tick that fires during a tick rather than queueing passes', async () => {
    const { engine } = await harness({ script: [{ emit: { outcome: 'pass', delayMs: 5000 } }] });
    await engine.startBoard(1);

    // Fire a burst without awaiting: the first pass runs, the rest set the dirty
    // bit, and exactly one extra pass follows.
    const ticks = Array.from({ length: 50 }, () => engine.tick());
    await Promise.all(ticks);
    await settle();
    assert.equal(engine.getState().tasks.get('A').phase, 'building');
  });

  it('never exceeds the cap across a long simulated run', async () => {
    const tasks = Array.from({ length: 8 }, (_, i) => task(`T${i}`));
    const { engine, effector, clock } = await harness({
      tasks,
      script: [{ emit: { outcome: 'pass', delayMs: 100 } }],
    });
    await engine.startBoard(1);

    let peak = 0;
    for (let i = 0; i < 200 && !engine.getState().finished; i += 1) {
      const live = effector.inspect().filter((r) => r.role !== 'merge').length;
      peak = Math.max(peak, live);
      await engine.tick();
      await settle();
      if (clock.pending > 0) await clock.advance(1000);
    }
    assert.equal(peak <= 1, true, `peak concurrency was ${peak} at N=1`);
    assert.equal(engine.getState().finished, true);
  });
});

// ---------------------------------------------------------------------------

describe('engine — journaling completed effects only', () => {
  it('appends task.attempt.started strictly after effector.start() resolves', async () => {
    /** @type {string[]} */
    const order = [];
    const inner = createScriptedEffector({ script: [{ emit: { outcome: 'pass', delayMs: 9999 } }] });
    const effector = {
      inspect: () => inner.inspect(),
      onEnd: (h) => inner.onEnd(h),
      stop: (id) => inner.stop(id),
      async start(desired) {
        order.push('start:called');
        const handle = await inner.start(desired);
        order.push('start:resolved');
        return handle;
      },
    };

    const { engine, boardId } = await harness({ effector });
    const unsubscribe = engine.subscribe((event) => {
      if (event.type === 'task.attempt.started') order.push('journal:started');
    });
    await engine.startBoard(1);
    await settle();
    unsubscribe();

    assert.deepEqual(order, ['start:called', 'start:resolved', 'journal:started']);
    const events = await readEvents(boardId);
    assert.equal(events.filter((e) => e.type === 'task.attempt.started').length, 1);
  });

  it('journals nothing when the effector cannot start the process', async () => {
    let attempts = 0;
    const inner = createScriptedEffector({});
    const effector = {
      inspect: () => inner.inspect(),
      onEnd: (h) => inner.onEnd(h),
      stop: (id) => inner.stop(id),
      async start(desired) {
        attempts += 1;
        if (attempts <= 2) throw new Error('spawn failed');
        return inner.start(desired);
      },
    };

    const { engine, boardId } = await harness({ effector });
    await engine.startBoard(1);
    await settle();

    // The first two starts throw, and there is no effect to record for either.
    let events = await readEvents(boardId);
    assert.equal(events.filter((e) => e.type === 'task.attempt.started').length, 0);
    assert.equal(attempts, 1);

    await engine.tick();
    await settle();
    assert.equal(attempts, 2);
    events = await readEvents(boardId);
    assert.equal(events.filter((e) => e.type === 'task.attempt.started').length, 0);

    // The next tick simply tries again, and succeeds. That is the whole
    // recovery mechanism — no backoff, no retry counter, no repair path.
    await engine.tick();
    await settle();
    events = await readEvents(boardId);
    const builderStarts = events.filter(
      (e) => e.type === 'task.attempt.started' && e.role === 'builder',
    );
    assert.equal(builderStarts.length, 1, 'the builder was started more than once');
    // The two failed starts consumed no attempts, so the policy still sees this
    // as the task's first try.
    assert.equal(
      events.filter((e) => e.type === 'task.attempt.ended' && e.role === 'builder').length,
      1,
    );
  });

  it('never writes an event type that names an intent', async () => {
    const { engine, clock, boardId } = await harness({
      tasks: [task('A'), task('B', { dependsOn: ['A'], touches: ['src/b/**'] })],
      script: [{ match: { taskId: 'A', role: 'builder' }, emit: { outcome: 'fail' } }],
    });
    await runToCompletion(engine, clock, 2);
    for (const event of await readEvents(boardId)) {
      assert.doesNotMatch(String(event.type), /\.(requested|pending|starting|will)$/);
    }
  });
});

// ---------------------------------------------------------------------------

describe('engine — self-healing is a consequence, not a feature', () => {
  it('restarts a process that vanished, with no watchdog involved', async () => {
    const { engine, effector } = await harness({
      script: [{ emit: { outcome: 'pass', delayMs: 9999 } }],
    });
    await engine.startBoard(1);
    await settle();
    assert.equal(effector.inspect().length, 1);
    assert.equal(effector.started.length, 1);

    // Kill it out from under the engine: no exit event, no outcome, nothing.
    effector.vanishAll();
    assert.equal(effector.inspect().length, 0);

    await engine.tick();
    await settle();
    assert.equal(effector.started.length, 2, 'the vanished attempt was not restarted');
    assert.equal(effector.inspect().length, 1);
  });

  it('recovers from a vanish at every point in a task lifecycle', async () => {
    for (const vanishAfter of [0, 1, 2, 3, 4]) {
      const { engine, effector, clock } = await harness({
        boardId: `v${vanishAfter}`,
        script: [{ emit: { outcome: 'pass' } }],
      });
      await engine.startBoard(1);
      for (let i = 0; i < vanishAfter; i += 1) {
        await settle();
        await engine.tick();
      }
      effector.vanishAll();
      await runToCompletion(engine, clock, 1);
      assert.equal(engine.getState().finished, true, `vanish after ${vanishAfter}`);
    }
  });

  it('survives every process disappearing at once — the display-sleep analogue', async () => {
    const tasks = Array.from({ length: 4 }, (_, i) => task(`T${i}`));
    const { engine, effector, clock } = await harness({
      tasks,
      script: [{ emit: { outcome: 'pass', delayMs: 500 } }],
    });
    await engine.startBoard(4);
    await settle();
    assert.equal(effector.inspect().length, 4);

    effector.vanishAll();
    await runToCompletion(engine, clock, 4);
    assert.equal(engine.getState().finished, true);
  });

  it('lets running work finish when the cap is lowered, but starts nothing new', async () => {
    // The cap gates starting, not continuing. Killing a builder halfway through
    // an edit to enforce a number the user changed after the fact throws away
    // real work; the useful behaviour is to stop picking up more.
    const tasks = [task('A'), task('B'), task('C'), task('D')];
    const { engine, effector } = await harness({
      tasks,
      script: [{ emit: { outcome: 'pass', delayMs: 9999 } }],
    });
    await engine.startBoard(3);
    await settle();
    assert.equal(effector.inspect().length, 3);

    await engine.setConcurrency(1);
    await settle();
    assert.equal(effector.inspect().length, 3, 'in-flight work was killed by a cap change');
    assert.equal(effector.started.length, 3, 'a fourth task was started below the cap');

    // Raising it again picks up the remaining task.
    await engine.setConcurrency(4);
    await settle();
    assert.equal(effector.inspect().length, 4);
  });

  it('stops everything when the board stops', async () => {
    const tasks = [task('A'), task('B'), task('C')];
    const { engine, effector } = await harness({
      tasks,
      script: [{ emit: { outcome: 'pass', delayMs: 9999 } }],
    });
    await engine.startBoard(3);
    await settle();
    assert.equal(effector.inspect().length, 3);

    await engine.stopBoard('user');
    await settle();
    assert.equal(effector.inspect().length, 0, 'stopping the board left work running');
  });
});

// ---------------------------------------------------------------------------

describe('engine — the policy has one application point', () => {
  it('retries, then abandons, then skips what the abandonment stranded', async () => {
    const tasks = [
      task('A'),
      task('B', { dependsOn: ['A'], touches: ['src/b/**'] }),
      task('C', { touches: ['src/c/**'] }),
    ];
    const { engine, clock, boardId } = await harness({
      tasks,
      script: [{ match: { taskId: 'A' }, emit: { outcome: 'fail' } }, { emit: { outcome: 'pass' } }],
    });
    await runToCompletion(engine, clock, 2);

    const state = engine.getState();
    assert.equal(state.tasks.get('A').phase, 'abandoned');
    assert.equal(state.tasks.get('B').phase, 'skipped');
    assert.equal(state.tasks.get('B').skippedBy, 'A');
    // An abandoned task must never block one that does not depend on it.
    assert.equal(state.tasks.get('C').phase, 'merged');
    assert.equal(state.finished, true);

    const events = await readEvents(boardId);
    const abandon = events.find((e) => e.type === 'task.abandoned');
    assert.equal(abandon.taskId, 'A');
    assert.equal(abandon.reason, 'builder-failed');
    assert.ok(abandon.evidence, 'the abandonment carries no evidence');
    // Three builder attempts before giving up, per the policy table.
    assert.equal(
      events.filter((e) => e.type === 'task.attempt.started' && e.taskId === 'A').length,
      3,
    );
  });

  it('re-opens the owning task on a merge conflict rather than spawning a fixer', async () => {
    const { engine, clock, boardId } = await harness({
      script: [
        { match: { role: 'merge', nth: 1 }, emit: { outcome: 'conflicted', files: ['src/a.ts'] } },
        { emit: { outcome: 'pass' } },
      ],
    });
    await runToCompletion(engine, clock, 1);

    const events = await readEvents(boardId);
    assert.equal(events.filter((e) => e.type === 'merge.conflicted').length, 1);
    assert.equal(events.filter((e) => e.type === 'merge.succeeded').length, 1);
    // The retry is the builder, with a rebase seed. No merge-fixer role exists.
    const seeds = events
      .filter((e) => e.type === 'task.attempt.started')
      .map((e) => e.seedKind);
    assert.ok(seeds.includes('rebase'), `seeds were ${seeds.join(', ')}`);
    for (const event of events) assert.doesNotMatch(String(event.role ?? ''), /fixer/);
    assert.equal(engine.getState().tasks.get('A').phase, 'merged');
  });

  it('repairs a blocked builder in place instead of running an env-fixer', async () => {
    const { engine, clock, boardId } = await harness({
      script: [
        { match: { role: 'builder', nth: 1 }, emit: { outcome: 'blocked' } },
        { emit: { outcome: 'pass' } },
      ],
    });
    await runToCompletion(engine, clock, 1);

    const started = (await readEvents(boardId)).filter((e) => e.type === 'task.attempt.started');
    assert.deepEqual(
      started.map((e) => `${e.role}:${e.seedKind}`),
      ['builder:initial', 'builder:repair', 'tester:initial'],
    );
  });

  it('routes every outcome in the six-way union to the right next action', async () => {
    const cases = [
      ['pass', ['builder:initial', 'tester:initial']],
      ['fail', ['builder:initial', 'builder:failure-aware']],
      ['blocked', ['builder:initial', 'builder:repair']],
      ['no_report', ['builder:initial', 'builder:continue']],
      ['crashed', ['builder:initial', 'builder:continue']],
      ['timeout', ['builder:initial', 'builder:continue']],
    ];
    for (const [outcome, expected] of cases) {
      const { engine, boardId } = await harness({
        boardId: `o-${outcome}`,
        script: [
          { match: { role: 'builder', nth: 1 }, emit: { outcome } },
          { emit: { outcome: 'pass', delayMs: 9999 } },
        ],
      });
      await engine.startBoard(1);
      await settle();
      await engine.tick();
      await settle();

      const started = (await readEvents(boardId))
        .filter((e) => e.type === 'task.attempt.started')
        .map((e) => `${e.role}:${e.seedKind}`);
      assert.deepEqual(started.slice(0, 2), expected, outcome);
    }
  });
});

// ---------------------------------------------------------------------------

describe('engine — commands', () => {
  it('records a stop and desires nothing afterwards', async () => {
    const { engine, effector } = await harness({
      script: [{ emit: { outcome: 'pass', delayMs: 9999 } }],
    });
    await engine.startBoard(1);
    await settle();
    await engine.stopBoard('user');
    await settle();

    assert.equal(engine.getState().status, 'stopped');
    assert.equal(effector.inspect().length, 0);

    const before = effector.started.length;
    await engine.tick();
    await settle();
    assert.equal(effector.started.length, before, 'a stopped board started work');
  });

  it('starts one task on demand, outside the cap', async () => {
    const tasks = [task('A'), task('B')];
    const { engine, effector } = await harness({
      tasks,
      script: [{ emit: { outcome: 'pass', delayMs: 9999 } }],
    });
    await engine.startBoard(1);
    await settle();
    assert.equal(effector.inspect().length, 1);

    assert.equal(await engine.startTask('B'), true);
    await settle();
    assert.deepEqual(
      effector.inspect().map((r) => r.taskId).sort(),
      ['A', 'B'],
    );
    // And asking again while it runs does nothing.
    assert.equal(await engine.startTask('B'), false);
  });

  it('emits every appended event to subscribers, in order', async () => {
    /** @type {string[]} */
    const seen = [];
    const { engine, clock } = await harness();
    engine.subscribe((event) => seen.push(String(event.type)));
    await runToCompletion(engine, clock, 1);
    assert.deepEqual(seen.slice(0, 3), ['board.started', 'task.attempt.started', 'task.attempt.ended']);
    assert.equal(seen.at(-1), 'board.stopped');
  });

  it('stops ticking once disposed', async () => {
    const { engine, effector, clock } = await harness({
      script: [{ emit: { outcome: 'pass', delayMs: 9999 } }],
    });
    await engine.startBoard(1);
    await settle();
    const before = effector.started.length;

    engine.dispose();
    await engine.tick();
    await clock.advance(60_000);
    assert.equal(effector.started.length, before);
  });
});

// ---------------------------------------------------------------------------

describe('engine — what must not be in it', () => {
  it('has exactly one timer', async () => {
    // A second timer in this file is a watchdog, a nudge, or a deferred
    // continuation by another name — the mechanisms that took V1 to 26,657 lines.
    const source = await fs.readFile(ENGINE_SOURCE, 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    assert.equal((code.match(/setTimeout\s*\(/g) ?? []).length, 1);
    assert.equal((code.match(/setInterval\s*\(/g) ?? []).length, 0);
    assert.equal((code.match(/setImmediate\s*\(/g) ?? []).length, 0);
    assert.equal((code.match(/queueMicrotask\s*\(/g) ?? []).length, 0);
  });

  it('contains no repair subsystem, by name', async () => {
    const source = await fs.readFile(ENGINE_SOURCE, 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    for (const banned of [
      'stallRecovery',
      'watchdog',
      'nudge',
      'selfHeal',
      'bootResume',
      'displayWake',
      'oomRecovery',
      'reconcileRunning',
      'PipelineHold',
      'reserveLaunchSlot',
    ]) {
      assert.equal(code.includes(banned), false, `engine.js contains ${banned}`);
    }
  });

  it('keeps no retry counters', async () => {
    const source = await fs.readFile(ENGINE_SOURCE, 'utf8');
    for (const banned of ['buildAttempts', 'testAttempts', 'fixerAttempts', 'envFixAttempts']) {
      assert.equal(source.includes(banned), false, `engine.js contains ${banned}`);
    }
  });
});
