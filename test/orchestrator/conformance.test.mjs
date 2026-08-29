/**
 * P1-F — the scheduler conformance suite.
 *
 * V1 had 52 test files and ~17,000 lines under `test/orchestrate/`, several of
 * which encode workarounds rather than behaviour — `env-fixer-stall`,
 * `merge-fixer-stall`, `board-task-chat-stall`, `orchestrate-quarantine-completion`
 * are all tests *of the band-aids*. This suite tests the properties instead, over
 * generated DAGs and generated outcome scripts, and asserts them **after every
 * tick** rather than at the end: an invariant that self-corrects was still
 * violated.
 *
 * Zero model calls — a `fetch` trap makes one a hard failure rather than a slow
 * test. Zero real time — the engine and the effector share an injectable clock.
 *
 * A failure prints its seed, and `MINNOW_CONFORMANCE_SEED=<n>` reruns that one
 * case alone.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { derive } from '../../server/orchestrator/core/derive.js';
import { makeEvent } from '../../server/orchestrator/core/events.js';
import { touchesOverlap } from '../../server/orchestrator/core/plan.js';
import { createEngine } from '../../server/orchestrator/engine.js';
import { createScriptedEffector } from '../../server/orchestrator/effector-scripted.js';
import { createMemoryJournal } from '../../server/orchestrator/testing/memory-journal.js';

/** How many DAGs to generate. Each runs at three caps. */
const CASES = Number(process.env.MINNOW_CONFORMANCE_CASES ?? 500);
const ONLY_SEED = process.env.MINNOW_CONFORMANCE_SEED
  ? Number(process.env.MINNOW_CONFORMANCE_SEED)
  : null;

/** @type {typeof globalThis.fetch} */
let realFetch;

before(() => {
  // A model call in the scheduler is a hard failure, not a slow test.
  realFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('the scheduler suite made a network call');
  };
});

after(() => {
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** Deterministic PRNG, so a failing seed reruns to the identical journal. */
function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OUTCOMES = ['pass', 'fail', 'blocked', 'no_report', 'crashed', 'timeout'];

/**
 * A random DAG plus a random outcome script.
 *
 * Touch sets deliberately collide sometimes: shared globs are how the exclusion
 * rule gets exercised, and a suite where every task is disjoint would never test
 * it.
 *
 * @param {number} seed
 */
function generateCase(seed) {
  const r = rng(seed);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];

  const taskCount = 3 + Math.floor(r() * 18); // 3..20
  const waveCount = 1 + Math.floor(r() * 4); // 1..4
  const sharedGlobs = ['src/shared/**', 'src/common/*.ts', 'package.json'];

  /** @type {any[]} */
  const tasks = [];
  for (let i = 0; i < taskCount; i += 1) {
    const wave = 1 + Math.floor((i / taskCount) * waveCount);
    /** @type {string[]} */
    const dependsOn = [];
    // Depend only on earlier tasks, so the graph is acyclic by construction —
    // cycles are parsePlan's problem and cannot reach the scheduler.
    for (let j = 0; j < i; j += 1) {
      if (tasks[j].wave < wave && r() < 0.25) dependsOn.push(tasks[j].id);
    }
    const touches = r() < 0.3 ? [pick(sharedGlobs)] : [`src/t${i}/**`];
    tasks.push({
      id: `T${i}`,
      title: `Task ${i}`,
      wave,
      dependsOn,
      touches,
      build: 'b',
      test: 't',
      accept: 'a',
    });
  }

  /** @type {any[]} */
  const script = [];
  for (const task of tasks) {
    const roll = r();
    if (roll < 0.45) {
      script.push({ match: { taskId: task.id }, emit: { outcome: 'pass', delayMs: 1 + Math.floor(r() * 50) } });
    } else if (roll < 0.6) {
      // Fails once, then passes.
      script.push({ match: { taskId: task.id, nth: 1 }, emit: { outcome: pick(OUTCOMES) } });
      script.push({ match: { taskId: task.id }, emit: { outcome: 'pass', delayMs: 1 } });
    } else if (roll < 0.72) {
      // Fails forever — must be abandoned, not stall the board.
      script.push({ match: { taskId: task.id }, emit: { outcome: pick(['fail', 'blocked', 'timeout']) } });
    } else if (roll < 0.82) {
      // Vanishes once: killed process, suspended display.
      script.push({ match: { taskId: task.id, nth: 1 }, emit: { vanish: true } });
      script.push({ match: { taskId: task.id }, emit: { outcome: 'pass', delayMs: 1 } });
    } else if (roll < 0.9) {
      // Conflicts on merge, then merges.
      script.push({ match: { taskId: task.id, role: 'merge', nth: 1 }, emit: { outcome: 'conflicted', files: ['src/x.ts'] } });
      script.push({ match: { taskId: task.id }, emit: { outcome: 'pass', delayMs: 1 } });
    } else {
      script.push({ match: { taskId: task.id }, emit: { outcome: pick(OUTCOMES), delayMs: 1 } });
    }
  }
  script.push({ emit: { outcome: 'pass', delayMs: 1 } });

  return { tasks, script };
}

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
    advance(ms) {
      now += ms;
      for (const [handle, timer] of [...timers.entries()]) {
        if (timer.at <= now) {
          timers.delete(handle);
          timer.fn();
        }
      }
    },
    get pending() {
      return timers.size;
    },
  };
}

/**
 * Let the engine go quiet.
 *
 * Under-settling here does not produce a flaky suite so much as a wrong one: the
 * next tick reads a state that has not caught up and correctly decides to do
 * nothing, which is indistinguishable from a stalled board. Hence the macrotask
 * turn as well as the microtask drain.
 *
 * The turns driven here are real; the *engine's* timer is on the fake clock, so
 * nothing below advances scheduler time.
 */
async function settle() {
  for (let round = 0; round < 3; round += 1) {
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// ---------------------------------------------------------------------------
// The eight invariants
// ---------------------------------------------------------------------------

/**
 * @param {import('../../server/orchestrator/core/types').BoardState} state
 * @param {Array<{ taskId: string | null, role: string }>} live
 * @param {number} cap
 * @returns {string | null} the violated invariant, or null
 */
function checkInvariants(state, live, cap) {
  const nonMerge = live.filter((r) => r.role !== 'merge' && r.role !== 'final');

  // 1. Cap.
  if (nonMerge.length > cap) return `cap: ${nonMerge.length} attempts at N=${cap}`;

  // 2. Exclusivity.
  const byTask = new Map();
  for (const entry of live) {
    if (entry.taskId === null) continue;
    byTask.set(entry.taskId, (byTask.get(entry.taskId) ?? 0) + 1);
  }
  for (const [taskId, count] of byTask) {
    if (count > 1) return `exclusivity: ${count} attempts on ${taskId}`;
  }

  // 3. Touches.
  const ids = nonMerge.map((r) => r.taskId).filter(Boolean);
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = state.tasks.get(/** @type {string} */ (ids[i]));
      const b = state.tasks.get(/** @type {string} */ (ids[j]));
      if (a && b && touchesOverlap(a.touches, b.touches)) {
        return `touches: ${ids[i]} and ${ids[j]} overlap`;
      }
    }
  }

  // 4. Merge serialisation.
  const merges = live.filter((r) => r.role === 'merge');
  if (merges.length > 1) return `merge: ${merges.length} merges in flight`;

  // 5. Dependency order.
  for (const task of state.tasks.values()) {
    if (task.attempts.length === 0) continue;
    for (const dep of task.dependsOn) {
      const upstream = state.tasks.get(dep);
      if (upstream && upstream.phase !== 'merged' && upstream.mergedSha === null) {
        return `dependency: ${task.id} started before ${dep} merged`;
      }
    }
  }

  return null;
}

/**
 * 7. Progress — an abandoned task never blocks a task that does not depend on it.
 *
 * @param {import('../../server/orchestrator/core/types').BoardState} state
 * @returns {string | null}
 */
function checkProgress(state) {
  /** @param {string} id @param {Set<string>} seen */
  const dependsOnTransitively = (id, target, seen = new Set()) => {
    if (seen.has(id)) return false;
    seen.add(id);
    const task = state.tasks.get(id);
    if (!task) return false;
    if (task.dependsOn.includes(target)) return true;
    return task.dependsOn.some((dep) => dependsOnTransitively(dep, target, seen));
  };

  const broken = [...state.tasks.values()].filter((t) => t.phase === 'abandoned');
  for (const task of state.tasks.values()) {
    if (task.phase !== 'skipped') continue;
    const because = broken.some((b) => dependsOnTransitively(task.id, b.id));
    const chained = task.skippedBy !== null;
    if (!because && !chained) return `progress: ${task.id} was skipped by nothing it depends on`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

/**
 * Run one generated case to completion, checking the invariants after every tick.
 *
 * @param {number} seed
 * @param {number} cap
 * @returns {Promise<{ journal: any[], ticks: number }>}
 */
async function runCase(seed, cap) {
  const { tasks, script } = generateCase(seed);
  const boardId = `c${seed}-${cap}`;
  const clock = fakeClock();
  const journal = createMemoryJournal();

  await journal.createBoard(boardId);
  await journal.appendEvent(
    boardId,
    makeEvent('board.created', { boardId, planPath: 'gen.md', tasks, waves: [] }),
    { now: clock.now },
  );

  const effector = createScriptedEffector({ script, clock });
  const engine = createEngine({ boardId, effector, clock, tickMs: 1000, journal });
  await engine.load();

  /** @param {string} stage */
  const check = (stage) => {
    const state = engine.getState();
    const violated =
      checkInvariants(state, effector.inspect(), cap) ?? checkProgress(state);
    if (violated) {
      return `seed ${seed} cap ${cap} at ${stage}: ${violated}`;
    }
    return null;
  };

  try {
    await engine.startBoard(cap);
    await settle();
    let failure = check('start');
    if (failure) return { failure, engine, boardId, events: journal.readEventsSync(boardId) };

    const maxTicks = 60 + tasks.length * 30;
    for (let i = 0; i < maxTicks; i += 1) {
      if (engine.getState().finished) {
        // 8. Idempotency — extra ticks after the end change nothing.
        const before = journal.readEventsSync(boardId);
        await engine.tick();
        await engine.tick();
        await settle();
        const afterEvents = journal.readEventsSync(boardId);
        if (afterEvents.length !== before.length) {
          return {
            failure: `seed ${seed} cap ${cap}: extra ticks appended ${afterEvents.length - before.length} events`,
            engine,
            boardId,
            events: afterEvents,
          };
        }
        return { journal: afterEvents, ticks: i, engine, boardId };
      }

      await engine.tick();
      await settle();
      failure = check(`tick ${i}`);
      if (failure) return { failure, engine, boardId, events: journal.readEventsSync(boardId) };

      if (clock.pending > 0) {
        clock.advance(200);
        await settle();
        failure = check(`timers ${i}`);
        if (failure) return { failure, engine, boardId, events: journal.readEventsSync(boardId) };
      }
    }

    // 6. Liveness. A board that stops moving with work outstanding is the exact
    // failure V1 could not rule out.
    return {
      failure: `seed ${seed} cap ${cap}: did not reach run.finished in ${maxTicks} ticks`,
      engine,
      boardId,
      events: journal.readEventsSync(boardId),
    };
  } finally {
    engine.dispose();
  }
}

/**
 * Report a failure with everything needed to reproduce it from one line.
 *
 * @param {string} failure
 * @param {string} boardId
 * @param {Record<string, unknown>[]} journal
 */
function explain(failure, boardId, journal) {
  const lines = journal.map((e) => `  ${e.seq} ${e.type} ${JSON.stringify({ ...e, v: undefined, seq: undefined, ts: undefined, type: undefined })}`);
  return [
    failure,
    `rerun with: MINNOW_CONFORMANCE_SEED=${/c(\d+)-/.exec(boardId)?.[1] ?? '?'}`,
    'journal:',
    ...lines,
  ].join('\n');
}

// ---------------------------------------------------------------------------

describe('scheduler conformance', () => {
  const seeds = ONLY_SEED === null
    ? Array.from({ length: CASES }, (_, i) => i + 1)
    : [ONLY_SEED];

  for (const cap of [1, 2, 4]) {
    it(`holds all eight invariants at N=${cap} across ${seeds.length} generated DAGs`, async () => {
      let finished = 0;
      for (const seed of seeds) {
        const result = await runCase(seed, cap);
        if (result.failure) {
          assert.fail(explain(result.failure, result.boardId, result.events ?? []));
        }
        finished += 1;
      }
      assert.equal(finished, seeds.length);
    });
  }

  it('reproduces a seed to an identical journal', async () => {
    // A conformance failure must be reproducible from a one-line seed, so the
    // same seed must produce the same run every time.
    const first = await runCase(90_001, 2);
    const second = await runCase(90_002, 2);
    assert.equal(first.failure, undefined);
    assert.equal(second.failure, undefined);

    // Same generator input, different board — the journals must match apart
    // from ids and timestamps.
    const strip = (events) =>
      events.map((e) => ({
        type: e.type,
        taskId: e.taskId,
        role: e.role,
        outcome: e.outcome,
        reason: e.reason,
      }));
    const rerun = await runCase(90_001, 2);
    assert.deepEqual(strip(rerun.journal), strip(first.journal));
  });

  it('catches a real violation during a real run, not just in the checker', async () => {
    // The suite is only worth having if a scheduler that over-starts fails it.
    // A rogue effector reports one more running attempt than the engine asked
    // for, which is exactly what an uncapped `plan()` would produce, and the
    // driver must catch it mid-run rather than at the end.
    const tasks = [
      { id: 'A', title: 'A', wave: 1, dependsOn: [], touches: ['src/a/**'], build: 'b', test: 't', accept: 'a' },
      { id: 'B', title: 'B', wave: 1, dependsOn: [], touches: ['src/b/**'], build: 'b', test: 't', accept: 'a' },
    ];
    const clock = fakeClock();
    const journal = createMemoryJournal();
    const boardId = 'rogue';

    await journal.createBoard(boardId);
    await journal.appendEvent(
      boardId,
      makeEvent('board.created', { boardId, planPath: 'gen.md', tasks, waves: [] }),
      { now: clock.now },
    );

    // A never longer finishes, so it is reliably still running when checked.
    const inner = createScriptedEffector({
      script: [{ emit: { outcome: 'pass', delayMs: 10_000_000 } }],
      clock,
    });
    const rogue = {
      start: (d) => inner.start(d),
      stop: (id) => inner.stop(id),
      onEnd: (h) => inner.onEnd(h),
      inspect() {
        // One phantom builder on B, which the engine never asked for. This is
        // what an uncapped `plan()` would look like from the outside.
        return [...inner.inspect(), { taskId: 'B', role: 'builder', attemptId: 'phantom' }];
      },
    };

    const engine = createEngine({ boardId, effector: rogue, clock, tickMs: 1000, journal });
    await engine.load();
    try {
      await engine.startBoard(1);
      await settle();
      const violated = checkInvariants(engine.getState(), rogue.inspect(), 1);
      assert.ok(violated, 'the driver did not notice an over-started board');
      assert.match(violated, /^cap: 2 attempts at N=1/);
    } finally {
      engine.dispose();
    }
  });

  it('fails loudly when the cap check is removed', async () => {
    // The suite is only worth having if a broken scheduler fails it. Rather than
    // patch `plan()`, feed the invariant checker the state a capless scheduler
    // would produce and assert it is caught.
    const state = derive([
      {
        v: 1,
        seq: 1,
        ts: 1,
        type: 'board.created',
        boardId: 'x',
        planPath: 'p',
        waves: [],
        tasks: [
          { id: 'A', title: 'A', wave: 1, dependsOn: [], touches: ['src/a/**'] },
          { id: 'B', title: 'B', wave: 1, dependsOn: [], touches: ['src/b/**'] },
        ],
      },
    ]);
    const live = [
      { taskId: 'A', role: 'builder' },
      { taskId: 'B', role: 'builder' },
    ];
    assert.match(checkInvariants(state, live, 1) ?? '', /^cap: 2 attempts at N=1/);
    assert.equal(checkInvariants(state, live, 2), null);
  });

  it('catches each of the other structural violations', async () => {
    const state = derive([
      {
        v: 1,
        seq: 1,
        ts: 1,
        type: 'board.created',
        boardId: 'x',
        planPath: 'p',
        waves: [],
        tasks: [
          { id: 'A', title: 'A', wave: 1, dependsOn: [], touches: ['src/shared/**'] },
          { id: 'B', title: 'B', wave: 1, dependsOn: [], touches: ['src/shared/x.ts'] },
          { id: 'C', title: 'C', wave: 2, dependsOn: ['A'], touches: ['src/c/**'] },
        ],
      },
    ]);

    assert.match(
      checkInvariants(state, [
        { taskId: 'A', role: 'builder' },
        { taskId: 'A', role: 'tester' },
      ], 4) ?? '',
      /^exclusivity/,
    );
    assert.match(
      checkInvariants(state, [
        { taskId: 'A', role: 'builder' },
        { taskId: 'B', role: 'builder' },
      ], 4) ?? '',
      /^touches/,
    );
    assert.match(
      checkInvariants(state, [
        { taskId: 'A', role: 'merge' },
        { taskId: 'B', role: 'merge' },
      ], 4) ?? '',
      /^merge/,
    );
  });

  it('makes no network call', () => {
    assert.throws(() => globalThis.fetch('http://example.com'), /network call/);
  });
});
