/**
 * P8-B — a second graph can be registered and ticked through the same
 * `createEngine` without touching board fold/plan.
 *
 * Throwaway: two events (`item.started` / `item.ended`), its own fold + plan.
 * Not an assertion-only test — it actually runs an attempt to completion.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { getMinnowHome, resetMinnowHomeCache } from '../../server/config/home.js';
import {
  createEngine,
  disposeEngines,
  getEngine,
  peekEngine,
} from '../../server/orchestrator/engine.js';
import { journalPath, resetJournalCache } from '../../server/orchestrator/journal.js';
import { emitLive, subscribeLive } from '../../server/orchestrator/live-events.js';

const STARTED = 'item.started';
const ENDED = 'item.ended';
const REQUESTED = 'run.requested';
const FINISHED = 'run.finished';

/** @returns {{ status: string, started: boolean, ended: boolean, attemptId: string | null }} */
function emptyFake() {
  return { status: 'idle', started: false, ended: false, attemptId: null };
}

/**
 * Mutates in place — the engine keeps one state object and advances it.
 *
 * @param {ReturnType<typeof emptyFake>} state
 * @param {Iterable<Record<string, unknown>>} events
 */
function foldInto(state, events) {
  for (const event of events) {
    if (event.type === REQUESTED) state.status = 'running';
    else if (event.type === STARTED) {
      state.started = true;
      state.attemptId = typeof event.attemptId === 'string' ? event.attemptId : null;
    } else if (event.type === ENDED) {
      state.ended = true;
      state.attemptId = null;
    } else if (event.type === FINISHED) {
      state.status = 'stopped';
    }
  }
  return state;
}

function fold(events) {
  return foldInto(emptyFake(), events);
}

/** @type {import('../../server/orchestrator/engine.js').Graph} */
const fakeGraph = {
  foldInto,
  plan(state) {
    if (state.status !== 'running') return [];
    if (state.ended) return [];
    return [{ taskId: 'one', role: 'worker' }];
  },
  isRunComplete: (state) => state.status === 'running' && state.ended,
  eventsForRunComplete: () => [{ v: 1, type: FINISHED, summary: 'one item' }],
  isAgentRole: (role) => role === 'worker',
  eventsForStart: (want, handle) => [
    {
      v: 1,
      type: STARTED,
      taskId: want.taskId,
      attemptId: handle.attemptId,
      role: want.role,
    },
  ],
  eventsForAttemptEnd: (end) => [
    {
      v: 1,
      type: ENDED,
      attemptId: end.attemptId,
      taskId: end.taskId,
      outcome: end.outcome,
    },
  ],
};

/**
 * In-memory journal so this graph never touches `~/.minnow/boards/`.
 *
 * @param {Record<string, unknown>[]} [seed]
 */
function createMemoryJournal(seed = []) {
  /** @type {Record<string, unknown>[]} */
  const events = seed.map((e, i) => ({ ...e, seq: i + 1, ts: i + 1 }));
  let seq = events.length;
  return {
    async loadState() {
      return fold(events);
    },
    async readHighestSeq() {
      return seq;
    },
    async readEvents() {
      return events.slice();
    },
    async appendEvent(_id, event) {
      seq += 1;
      const stamped = { v: 1, ...event, seq, ts: seq };
      events.push(stamped);
      return stamped;
    },
    async appendEvents(id, list) {
      const out = [];
      for (const event of list) out.push(await this.appendEvent(id, event));
      return out;
    },
  };
}

function createFakeEffector() {
  /** @type {Map<string, { taskId: string | null, role: string, attemptId: string }>} */
  const running = new Map();
  /** @type {(end: object) => Promise<void> | void} */
  let onEnd = async () => {};
  let n = 0;
  return {
    inspect: () => [...running.values()],
    async start(want) {
      const attemptId = `fake-${(n += 1)}`;
      running.set(attemptId, { taskId: want.taskId, role: want.role, attemptId });
      return { attemptId };
    },
    async stop(attemptId) {
      running.delete(attemptId);
    },
    onEnd(handler) {
      onEnd = handler;
    },
    /**
     * Deliver the end *then* drop from inspect — the Effector contract.
     * @param {string} attemptId
     * @param {string} [outcome]
     */
    async finish(attemptId, outcome = 'pass') {
      const entry = running.get(attemptId);
      if (!entry) throw new Error(`no attempt ${attemptId}`);
      await onEnd({
        attemptId,
        taskId: entry.taskId,
        role: entry.role,
        outcome,
      });
      running.delete(attemptId);
    },
    running,
  };
}

/** @type {string | undefined} */
let previousHome;
/** @type {Array<{ dispose: () => void }>} */
let live = [];

before(() => {
  previousHome = process.env.MINNOW_HOME;
});

beforeEach(async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-p8b-'));
  process.env.MINNOW_HOME = home;
  resetMinnowHomeCache();
  resetJournalCache();
  live = [];
});

afterEach(() => {
  for (const engine of live) engine.dispose();
  live = [];
  disposeEngines();
});

after(() => {
  if (previousHome === undefined) delete process.env.MINNOW_HOME;
  else process.env.MINNOW_HOME = previousHome;
  resetMinnowHomeCache();
  resetJournalCache();
});

describe('P8-B injected graph', () => {
  it('ticks a two-event fake graph to completion through createEngine', async () => {
    const journal = createMemoryJournal([{ v: 1, type: REQUESTED }]);
    const effector = createFakeEffector();
    const engine = createEngine({
      boardId: 'fake-run',
      graph: fakeGraph,
      journal,
      effector,
      tickMs: 100_000,
    });
    live.push(engine);
    await engine.load();
    await engine.tick();

    const afterStart = await journal.readEvents();
    assert.equal(
      afterStart.some((e) => e.type === STARTED),
      true,
      'tick must journal item.started',
    );
    assert.equal(effector.running.size, 1);

    const attemptId = [...effector.running.keys()][0];
    await effector.finish(attemptId);

    const types = (await journal.readEvents()).map((e) => e.type);
    assert.deepEqual(
      types.filter((t) => t === STARTED || t === ENDED || t === FINISHED),
      [STARTED, ENDED, FINISHED],
    );
    assert.equal(engine.getState().status, 'stopped');
    assert.equal(engine.getState().ended, true);
  });

  it('registers a second graph in the same process without colliding with boards', async () => {
    const boardEffector = createFakeEffector();
    const fakeEffector = createFakeEffector();
    const journal = createMemoryJournal([{ v: 1, type: REQUESTED }]);

    const boardEngine = await getEngine('shared-id', () => boardEffector, { tickMs: 100_000 });
    live.push(boardEngine);
    const fakeEngine = await getEngine('shared-id', () => fakeEffector, {
      namespace: 'fake',
      graph: fakeGraph,
      journal,
      tickMs: 100_000,
    });
    live.push(fakeEngine);

    assert.notEqual(
      peekEngine('shared-id'),
      peekEngine('shared-id', 'fake'),
      'peekEngine(id) stays the boards engine',
    );
    assert.equal(peekEngine('shared-id'), boardEngine);
    assert.equal(peekEngine('shared-id', 'fake'), fakeEngine);

    await fakeEngine.tick();
    assert.equal(
      (await journal.readEvents()).some((e) => e.type === STARTED),
      true,
    );
    // The board journal was not written by the fake tick.
    assert.equal(boardEngine.getHighestSeq(), 0);
  });

  it('live-events routes on an opaque key, not a board-shaped name', () => {
    /** @type {unknown[]} */
    const seen = [];
    const unsub = subscribeLive('agents:chat-1', (payload) => seen.push(payload));
    emitLive({
      key: 'agents:chat-1',
      boardId: 'not-the-routing-key',
      attemptId: 'a1',
      taskId: null,
      role: 'worker',
      event: /** @type {any} */ ({ type: 'text', text: 'hi' }),
    });
    unsub();
    assert.equal(seen.length, 1);
    assert.equal(/** @type {{ key?: string }} */ (seen[0]).key, 'agents:chat-1');
  });
});

describe('P8-B journal path', () => {
  it('journalPath(id) still resolves under ~/.minnow/boards/<id>/journal.jsonl', () => {
    const id = 'some-id';
    const resolved = journalPath(id);
    const expected = path.join(getMinnowHome(), 'boards', id, 'journal.jsonl');
    assert.equal(path.resolve(resolved), path.resolve(expected));
    assert.match(resolved.replaceAll('\\', '/'), /\/boards\/some-id\/journal\.jsonl$/);
  });
});
