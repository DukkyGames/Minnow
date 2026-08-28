/**
 * P0-G — snapshot format and memoised fold.
 *
 * The central property is equivalence: `deriveFrom(snapshot, journal)` must
 * equal `derive(journal)` at *every* snapshot boundary, not one. Everything else
 * here is a corruption mode that must fall back to a correct full fold rather
 * than repair anything.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { derive } from '../../server/orchestrator/core/derive.js';
import { makeEvent } from '../../server/orchestrator/core/events.js';
import {
  canonicalise,
  decanonicalise,
  deriveFrom,
  hashState,
  isSnapshotUsable,
  makeSnapshot,
  SNAPSHOT_INTERVAL,
  SNAPSHOT_VERSION,
  shouldSnapshot,
  stateFromJSON,
  stateToJSON,
} from '../../server/orchestrator/core/snapshot.js';

// ---------------------------------------------------------------------------
// A long, structurally varied journal
// ---------------------------------------------------------------------------

/** Deterministic PRNG so a failure reproduces from its seed. */
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

/** Roughly `target` events across a 40-task board. */
function longJournal(target = 5000, seed = 7) {
  const r = rng(seed);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const tasks = Array.from({ length: 40 }, (_, i) => ({
    id: `T${i}`,
    title: `Task ${i}`,
    wave: 1 + Math.floor(i / 8),
    dependsOn: i > 0 && r() < 0.4 ? [`T${Math.floor(r() * i)}`] : [],
    touches: [`src/t${i}/**`],
    build: 'b',
    test: 't',
    accept: 'a',
  }));

  const events = [
    makeEvent('board.created', { boardId: 'big', planPath: 'p.md', tasks, waves: [] }),
    makeEvent('board.started', { concurrency: 4 }),
  ];
  let n = 0;
  while (events.length < target) {
    const task = tasks[Math.floor(r() * tasks.length)];
    const role = pick(['builder', 'tester']);
    const id = `a${(n += 1)}`;
    events.push(makeEvent('task.attempt.started', { taskId: task.id, attemptId: id, role }));
    if (r() < 0.9) {
      events.push(
        makeEvent('task.attempt.ended', {
          taskId: task.id,
          attemptId: id,
          role,
          outcome: pick(OUTCOMES),
          summary: 'x'.repeat(Math.floor(r() * 40)),
        }),
      );
    }
    const roll = r();
    if (roll < 0.12) {
      events.push(makeEvent('merge.enqueued', { taskId: task.id }));
      events.push(makeEvent('merge.succeeded', { taskId: task.id, sha: `sha${n}` }));
    } else if (roll < 0.16) {
      events.push(makeEvent('merge.enqueued', { taskId: task.id }));
      events.push(makeEvent('merge.conflicted', { taskId: task.id, files: ['src/x.ts'] }));
    } else if (roll < 0.19) {
      events.push(makeEvent('task.abandoned', { taskId: task.id, reason: 'builder-failed' }));
    } else if (roll < 0.21) {
      events.push(
        makeEvent('touches.overflow', {
          taskId: task.id,
          attemptId: id,
          declared: [`src/t${task.id}/**`],
          actual: ['package-lock.json'],
        }),
      );
    }
  }
  events.push(makeEvent('run.finished', { summary: 'done' }));
  return events.map((e, i) => ({ ...e, seq: i + 1, ts: 1_700_000_000_000 + i }));
}

const JOURNAL = longJournal();

/** A snapshot taken at `throughSeq`, built the way P1-A will build it. */
function snapshotAt(throughSeq, journal = JOURNAL) {
  const head = journal.filter((e) => e.seq <= throughSeq);
  return makeSnapshot('big', derive(head), throughSeq);
}

// ---------------------------------------------------------------------------

describe('snapshot — the equivalence property', () => {
  it('resumes to the same state at every 200-event boundary', () => {
    const full = derive(JOURNAL);
    let boundaries = 0;
    for (let through = SNAPSHOT_INTERVAL; through < JOURNAL.length; through += SNAPSHOT_INTERVAL) {
      boundaries += 1;
      const snapshot = snapshotAt(through);
      assert.equal(isSnapshotUsable(snapshot, JOURNAL), true, `unusable at ${through}`);
      assert.deepEqual(deriveFrom(snapshot, JOURNAL), full, `diverged at ${through}`);
    }
    assert.ok(boundaries >= 20, `only ${boundaries} boundaries tested`);
  });

  it('resumes correctly from every single-event boundary in the first 300', () => {
    // Boundaries are where off-by-ones live, so sweep them densely too.
    const full = derive(JOURNAL.slice(0, 300));
    const head = JOURNAL.slice(0, 300);
    for (let through = 0; through <= 300; through += 1) {
      const snapshot = snapshotAt(through, head);
      assert.deepEqual(deriveFrom(snapshot, head), full, `diverged at ${through}`);
    }
  });

  it('resumes from a snapshot that is already current', () => {
    const last = JOURNAL[JOURNAL.length - 1].seq;
    const snapshot = snapshotAt(last);
    assert.deepEqual(deriveFrom(snapshot, JOURNAL), derive(JOURNAL));
  });

  it('resumes from an empty-board snapshot with no anchor event', () => {
    const snapshot = makeSnapshot('big', derive([]), 0);
    assert.equal(isSnapshotUsable(snapshot, JOURNAL), true);
    assert.deepEqual(deriveFrom(snapshot, JOURNAL), derive(JOURNAL));
  });

  it('folds only the tail', () => {
    // Proven without instrumentation: events at or below throughSeq are ignored
    // even when they would change the state if folded again.
    const through = 1000;
    const snapshot = snapshotAt(through);
    const contradicted = JOURNAL.map((e) =>
      e.seq <= through ? { ...e, type: 'task.abandoned', taskId: 'T0', reason: 'injected' } : e,
    );
    assert.deepEqual(deriveFrom(snapshot, contradicted), deriveFrom(snapshot, JOURNAL));
  });
});

// ---------------------------------------------------------------------------

describe('snapshot — a cache, never a source', () => {
  it('changes nothing when deleted', () => {
    assert.deepEqual(deriveFrom(null, JOURNAL), derive(JOURNAL));
    assert.deepEqual(deriveFrom(undefined, JOURNAL), derive(JOURNAL));
  });

  it('falls back to a correct full fold on every corruption mode', () => {
    const full = derive(JOURNAL);
    const good = snapshotAt(1000);

    const corruptions = {
      'mutated state': { ...good, state: stateToJSON(derive(JOURNAL.slice(0, 40))) },
      'mutated throughSeq': { ...good, throughSeq: 1200 },
      'mutated hash': { ...good, stateHash: 'deadbeefdeadbeef' },
      'missing hash': { ...good, stateHash: '' },
      'ahead of the journal': { ...good, throughSeq: JOURNAL.length + 500 },
      'anchor event missing': { ...good, throughSeq: 1000.5 },
      'negative throughSeq': { ...good, throughSeq: -1 },
      'null state': { ...good, state: null },
      'garbage state': { ...good, state: 'not a state' },
      'version skew': { ...good, v: SNAPSHOT_VERSION + 1 },
      'no version': { ...good, v: undefined },
      'an array': [1, 2, 3],
      'a string': 'snapshot',
      'a number': 42,
    };

    for (const [label, snapshot] of Object.entries(corruptions)) {
      assert.equal(isSnapshotUsable(snapshot, JOURNAL), false, `${label}: reported usable`);
      assert.deepEqual(deriveFrom(snapshot, JOURNAL), full, `${label}: wrong fallback state`);
    }
  });

  it('ignores a version-skewed snapshot rather than migrating it', () => {
    const skewed = { ...snapshotAt(1000), v: 99 };
    assert.equal(isSnapshotUsable(skewed, JOURNAL), false);
    // The proof it was not migrated: the result is byte-identical to the full fold.
    assert.equal(hashState(deriveFrom(skewed, JOURNAL)), hashState(derive(JOURNAL)));
  });

  it('detects a snapshot whose state was edited by hand', () => {
    const tampered = snapshotAt(1000);
    const state = stateFromJSON(tampered.state);
    state.concurrency = 99;
    assert.deepEqual(
      deriveFrom({ ...tampered, state: stateToJSON(state) }, JOURNAL),
      derive(JOURNAL),
    );
  });

  it('exposes no repair path', async () => {
    // Structural: the module's whole answer to a bad snapshot is "fold it all
    // again". If a future edit adds a second answer, this fails.
    const module = await import('../../server/orchestrator/core/snapshot.js');
    for (const name of Object.keys(module)) {
      assert.doesNotMatch(
        name,
        /repair|reconcile|patch|fix|migrate|salvage/i,
        `snapshot.js exports ${name}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------

describe('hashState — stable and order-independent', () => {
  it('is stable across repeated calls', () => {
    const state = derive(JOURNAL);
    const first = hashState(state);
    for (let i = 0; i < 20; i += 1) assert.equal(hashState(state), first);
  });

  it('is independent of Map insertion order', () => {
    const state = derive(JOURNAL);
    const reordered = derive(JOURNAL);
    const entries = [...reordered.tasks.entries()].reverse();
    reordered.tasks = new Map(entries);
    reordered.taskOrder = [...reordered.taskOrder];
    assert.notDeepEqual([...state.tasks.keys()], [...reordered.tasks.keys()]);
    assert.equal(hashState(reordered), hashState(state));
  });

  it('is independent of object key order', () => {
    const a = { x: 1, y: { p: 2, q: 3 } };
    const b = { y: { q: 3, p: 2 }, x: 1 };
    assert.equal(JSON.stringify(canonicalise(a)), JSON.stringify(canonicalise(b)));
  });

  it('depends on array order, which is meaningful', () => {
    const state = derive(JOURNAL);
    const swapped = derive(JOURNAL);
    const task = [...swapped.tasks.values()].find((t) => t.attempts.length >= 2);
    assert.ok(task, 'no task with two attempts in the fixture');
    task.attempts.reverse();
    assert.notEqual(hashState(swapped), hashState(state));
  });

  it('changes when any part of the state changes', () => {
    const base = derive(JOURNAL);
    const seen = new Set([hashState(base)]);
    for (const mutate of [
      (s) => { s.concurrency += 1; },
      (s) => { s.status = 'stopped'; },
      (s) => { s.integrationSha = 'x'; },
      (s) => { s.finished = !s.finished; },
      (s) => { s.mergeQueue = [...s.mergeQueue, 'T0']; },
      (s) => { s.tasks.get('T0').phase = 'merged'; },
      (s) => { s.tasks.get('T0').touches = ['src/other/**']; },
    ]) {
      const state = derive(JOURNAL);
      mutate(state);
      const hash = hashState(state);
      assert.equal(seen.has(hash), false, 'collision after a state change');
      seen.add(hash);
    }
  });

  it('produces a fixed-width hex digest', () => {
    assert.match(hashState(derive(JOURNAL)), /^[0-9a-f]{16}$/);
    assert.match(hashState(derive([])), /^[0-9a-f]{16}$/);
  });
});

// ---------------------------------------------------------------------------

describe('canonical form round-trips', () => {
  it('restores a state exactly', () => {
    const state = derive(JOURNAL);
    const restored = stateFromJSON(stateToJSON(state));
    assert.deepEqual(restored, state);
    assert.ok(restored.tasks instanceof Map);
    assert.equal(hashState(restored), hashState(state));
  });

  it('survives JSON serialisation, which is how it reaches disk', () => {
    const state = derive(JOURNAL);
    const restored = stateFromJSON(JSON.parse(JSON.stringify(stateToJSON(state))));
    assert.deepEqual(restored, state);
  });

  it('restores nested Maps and empty collections', () => {
    const value = { m: new Map([['b', 2], ['a', new Map([['z', 1]])]]), e: new Map(), a: [] };
    const restored = decanonicalise(canonicalise(value));
    assert.deepEqual(restored, value);
  });

  it('fills in defaults for a snapshot missing newer fields', () => {
    const state = stateFromJSON({ boardId: 'b' });
    assert.equal(state.boardId, 'b');
    assert.equal(state.status, 'created');
    assert.ok(state.tasks instanceof Map);
    assert.equal(state.tasks.size, 0);
  });

  it('coerces a non-finite number rather than emitting invalid JSON', () => {
    assert.equal(canonicalise(Number.NaN), null);
    assert.equal(canonicalise(Number.POSITIVE_INFINITY), null);
  });
});

// ---------------------------------------------------------------------------

describe('snapshot cadence', () => {
  it('is due every SNAPSHOT_INTERVAL events', () => {
    assert.equal(SNAPSHOT_INTERVAL, 200);
    assert.equal(shouldSnapshot(200), true);
    assert.equal(shouldSnapshot(400), true);
    assert.equal(shouldSnapshot(199), false);
    assert.equal(shouldSnapshot(0), false);
    assert.equal(shouldSnapshot(-200), false);
    assert.equal(shouldSnapshot(1.5), false);
  });
});

// ---------------------------------------------------------------------------

describe('the memoised fold is actually faster', () => {
  /** Best of several runs, after a warm-up, so this is not measuring JIT. */
  function time(fn) {
    for (let i = 0; i < 3; i += 1) fn();
    let best = Infinity;
    for (let i = 0; i < 7; i += 1) {
      const start = performance.now();
      fn();
      best = Math.min(best, performance.now() - start);
    }
    return best;
  }

  it('beats loading a 5,000-event board from the journal alone', () => {
    assert.ok(JOURNAL.length >= 5000, `fixture is only ${JOURNAL.length} events`);
    const through = JOURNAL[JOURNAL.length - 1].seq - SNAPSHOT_INTERVAL;
    const snapshot = snapshotAt(through);

    // What a board load actually costs: reading JSONL off disk and parsing it,
    // then folding. Measuring the fold alone understates the snapshot badly —
    // parsing is the dominant term, and skipping it is most of what a snapshot
    // buys. The lines are pre-rendered so neither path pays for serialisation.
    const lines = JOURNAL.map((e) => JSON.stringify(e));
    const tailLines = JOURNAL.filter((e) => e.seq > through).map((e) => JSON.stringify(e));
    const snapshotText = JSON.stringify(snapshot);

    const full = time(() => derive(lines.map((line) => JSON.parse(line))));
    const memoised = time(() => {
      const restored = JSON.parse(snapshotText);
      const tail = tailLines.map((line) => JSON.parse(line));
      return deriveFrom(restored, tail);
    });

    // The bar is 1.4x, not the 10x the "skip 4,800 of 5,000 events" framing
    // suggests, and the gap is worth understanding rather than tuning away.
    //
    // Board state grows with the journal: every attempt is retained, because
    // attempt counts are derived rather than stored. So the snapshot is about
    // the same size as the journal it replaces (390 KB here), and reading plus
    // verifying it is the same order of work as reading plus folding the
    // journal. Measured on this fixture: full 4.1 ms, memoised 2.5 ms.
    //
    // The consequence for P1-A is that a snapshot is worth having but is not a
    // large win, and no snapshot interval changes that — the verify cost is
    // O(state), not O(interval). The large win for the reconcile loop is not
    // snapshots at all: it is keeping the derived state in memory and calling
    // `foldInto` on each new event instead of re-folding on every tick.
    assert.ok(
      memoised < full / 1.4,
      `memoised ${memoised.toFixed(2)}ms vs full ${full.toFixed(2)}ms — no material speedup`,
    );
  });

  it('is faster still when the caller passes only the tail', () => {
    // The fast path P1-A uses: the head is never read, let alone parsed.
    const through = JOURNAL[JOURNAL.length - 1].seq - SNAPSHOT_INTERVAL;
    const snapshot = snapshotAt(through);
    const tail = JOURNAL.filter((e) => e.seq > through);

    assert.equal(isSnapshotUsable(snapshot, tail), true, 'tail-only must verify');
    assert.deepEqual(deriveFrom(snapshot, tail), derive(JOURNAL));

    const full = time(() => derive(JOURNAL));
    const tailOnly = time(() => deriveFrom(snapshot, tail));
    assert.ok(
      tailOnly < full,
      `tail-only ${tailOnly.toFixed(2)}ms vs full ${full.toFixed(2)}ms`,
    );
  });
});
