/**
 * P1-C — `/api/boards` REST and SSE.
 *
 * Driven through a real HTTP server rather than by calling the handler, because
 * the properties that matter here are transport properties: reconnect with
 * `Last-Event-ID`, an abruptly destroyed socket, and the guarantee that no route
 * exists through which a client can write board state.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { resetMinnowHomeCache } from '../../server/config/home.js';
import { derive } from '../../server/orchestrator/core/derive.js';
import { stateFromJSON } from '../../server/orchestrator/core/snapshot.js';
import { createScriptedEffector } from '../../server/orchestrator/effector-scripted.js';
import { disposeEngines } from '../../server/orchestrator/engine.js';
import { resetJournalCache } from '../../server/orchestrator/journal.js';
import {
  createBoardsMiddleware,
  matchRoute,
  ROUTES,
  setEffectorFactory,
} from '../../server/orchestrator/middleware.js';

// ---------------------------------------------------------------------------

const PLAN = `---
name: demo-board
overview: A demo.
todos:
  - id: W1-A
    content: "Wave 1: A"
    status: pending
  - id: W1-B
    content: "Wave 1: B"
    status: pending
isProject: true
---

# Demo

## Wave Breakdown

### Wave 1 — One

#### Task W1-A: Alpha
- **Build:** build alpha
- **Test:** test alpha
- **Accept:** alpha works
- **Touches:** src/alpha/**

#### Task W1-B: Beta
- **Build:** build beta
- **Test:** test beta
- **Accept:** beta works
- **Touches:** src/beta/**
`;

/** @type {http.Server} */
let server;
/** @type {string} */
let base;
/** @type {string | undefined} */
let previousHome;

before(() => {
  previousHome = process.env.MINNOW_HOME;
});

beforeEach(async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-api-'));
  process.env.MINNOW_HOME = home;
  resetMinnowHomeCache();
  resetJournalCache();
  disposeEngines();

  // Long delays keep attempts running so the transport can be observed against
  // a board that is mid-flight rather than one that has already finished.
  setEffectorFactory(() =>
    createScriptedEffector({ script: [{ emit: { outcome: 'pass', delayMs: 60_000 } }] }),
  );

  const middleware = createBoardsMiddleware();
  server = http.createServer((req, res) => {
    void middleware(req, res, () => {
      res.statusCode = 404;
      res.end('not found');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  disposeEngines();
  await new Promise((resolve) => server.close(resolve));
});

after(() => {
  if (previousHome === undefined) delete process.env.MINNOW_HOME;
  else process.env.MINNOW_HOME = previousHome;
  resetMinnowHomeCache();
  resetJournalCache();
  disposeEngines();
});

// ---------------------------------------------------------------------------

/**
 * @param {string} method
 * @param {string} pathname
 * @param {unknown} [body]
 */
async function call(method, pathname, body) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  /** @type {any} */
  let parsed = null;
  if (text.length > 0) {
    // An unmatched verb falls through to the next middleware, which answers in
    // plain text. That is the correct outcome, not a parse failure.
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: response.status, body: parsed };
}

/** Create the demo board and return its id. */
async function createBoard(markdown = PLAN) {
  const created = await call('POST', '/api/boards', { planPath: 'demo.md', markdown });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return created.body.boardId;
}

/**
 * Read an SSE stream, resolving once `stop(frames)` says it has enough.
 *
 * @param {string} pathname
 * @param {(frames: Array<{ id?: string, event: string, data: any }>) => boolean} enough
 * @param {Record<string, string>} [headers]
 */
function readSse(pathname, enough, headers = {}) {
  return new Promise((resolve, reject) => {
    /** @type {Array<{ id?: string, event: string, data: any }>} */
    const frames = [];
    const request = http.get(`${base}${pathname}`, { headers }, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`SSE returned ${response.statusCode}`));
        return;
      }
      let buffer = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        buffer += chunk;
        let split;
        while ((split = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          if (raw.startsWith(':')) continue; // heartbeat
          /** @type {any} */
          const frame = {};
          for (const line of raw.split('\n')) {
            if (line.startsWith('id: ')) frame.id = line.slice(4);
            else if (line.startsWith('event: ')) frame.event = line.slice(7);
            else if (line.startsWith('data: ')) frame.data = JSON.parse(line.slice(6));
          }
          frames.push(frame);
          if (enough(frames)) {
            request.destroy();
            resolve(frames);
            return;
          }
        }
      });
      response.on('error', () => resolve(frames));
    });
    request.on('error', (err) => {
      if (frames.length > 0) resolve(frames);
      else reject(err);
    });
    setTimeout(() => {
      request.destroy();
      resolve(frames);
    }, 8_000).unref?.();
  });
}

// ---------------------------------------------------------------------------

describe('POST /api/boards', () => {
  it('creates a board from a plan and returns its derived state', async () => {
    const created = await call('POST', '/api/boards', { planPath: 'demo.md', markdown: PLAN });
    assert.equal(created.status, 201);
    assert.equal(created.body.boardId, 'demo-board');
    const state = stateFromJSON(created.body.state);
    assert.deepEqual([...state.tasks.keys()], ['W1-A', 'W1-B']);
    assert.equal(state.status, 'created');
    assert.deepEqual(state.tasks.get('W1-A').touches, ['src/alpha/**']);
  });

  it('returns 400 with ParseError[] and line numbers, not a 500', async () => {
    const broken = PLAN.replace('- **Touches:** src/beta/**\n', '');
    const response = await call('POST', '/api/boards', { planPath: 'demo.md', markdown: broken });
    assert.equal(response.status, 400);
    assert.equal(response.body.ok, false);
    assert.ok(Array.isArray(response.body.errors));
    assert.ok(response.body.errors.length > 0);
    for (const error of response.body.errors) {
      assert.equal(typeof error.line, 'number');
      assert.ok(error.line >= 1);
      assert.ok(error.message.length > 0);
      assert.ok(error.hint.length > 0);
    }
    assert.match(response.body.detail, /^line \d+:\d+ — /m);
  });

  it('returns 400 for garbage rather than creating a half-board', async () => {
    const response = await call('POST', '/api/boards', { planPath: 'x.md', markdown: 'nonsense' });
    assert.equal(response.status, 400);
    assert.equal((await call('GET', '/api/boards')).body.boards.length, 0);
  });

  it('requires a planPath', async () => {
    assert.equal((await call('POST', '/api/boards', {})).status, 400);
  });

  it('refuses to clobber an existing board', async () => {
    await createBoard();
    const again = await call('POST', '/api/boards', { planPath: 'demo.md', markdown: PLAN });
    assert.equal(again.status, 409);
  });
});

describe('GET /api/boards', () => {
  it('lists boards with their status', async () => {
    await createBoard();
    const list = await call('GET', '/api/boards');
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.boards.map((b) => b.boardId), ['demo-board']);
    assert.equal(list.body.boards[0].taskCount, 2);
    assert.equal(list.body.boards[0].status, 'created');
  });

  it('404s for a board that does not exist', async () => {
    assert.equal((await call('GET', '/api/boards/nope')).status, 404);
    assert.equal((await call('GET', '/api/boards/nope/journal')).status, 404);
    assert.equal((await call('POST', '/api/boards/nope/start', { concurrency: 1 })).status, 404);
  });

  it('serves a state that always equals the fold of its own journal', async () => {
    // The HTTP surface cannot be allowed to disagree with the fold.
    const boardId = await createBoard();
    await call('POST', `/api/boards/${boardId}/start`, { concurrency: 2 });

    const state = await call('GET', `/api/boards/${boardId}`);
    const journal = await call('GET', `/api/boards/${boardId}/journal`);
    assert.deepEqual(stateFromJSON(state.body.state), derive(journal.body.events));
  });
});

describe('commands', () => {
  it('starts, changes concurrency, and stops', async () => {
    const boardId = await createBoard();

    const started = await call('POST', `/api/boards/${boardId}/start`, { concurrency: 2 });
    assert.equal(started.status, 200);
    assert.equal(stateFromJSON(started.body.state).status, 'running');
    assert.equal(stateFromJSON(started.body.state).concurrency, 2);

    const changed = await call('POST', `/api/boards/${boardId}/concurrency`, { n: 1 });
    assert.equal(stateFromJSON(changed.body.state).concurrency, 1);

    const stopped = await call('POST', `/api/boards/${boardId}/stop`);
    assert.equal(stateFromJSON(stopped.body.state).status, 'stopped');
    assert.equal(stateFromJSON(stopped.body.state).stopReason, 'user');
  });

  it('rejects a nonsense concurrency', async () => {
    const boardId = await createBoard();
    for (const concurrency of [0, -1, 1.5, 'two', null, 1000]) {
      const response = await call('POST', `/api/boards/${boardId}/start`, { concurrency });
      assert.equal(response.status, 400, JSON.stringify(concurrency));
    }
  });

  it('starts a single task on demand, and 409s when it cannot', async () => {
    const boardId = await createBoard();
    await call('POST', `/api/boards/${boardId}/start`, { concurrency: 1 });

    const ok = await call('POST', `/api/boards/${boardId}/tasks/W1-B/start`);
    assert.equal(ok.status, 200);

    const again = await call('POST', `/api/boards/${boardId}/tasks/W1-B/start`);
    assert.equal(again.status, 409);
  });
});

describe('SSE', () => {
  it('opens with a snapshot frame carrying the current seq and state', async () => {
    const boardId = await createBoard();
    const frames = await readSse(`/api/boards/${boardId}/events`, (f) => f.length >= 1);

    assert.equal(frames[0].event, 'snapshot');
    assert.equal(frames[0].id, '1');
    assert.equal(frames[0].data.seq, 1);
    const state = stateFromJSON(frames[0].data.state);
    assert.deepEqual([...state.tasks.keys()], ['W1-A', 'W1-B']);
  });

  it('streams each subsequent event with its seq as the frame id', async () => {
    const boardId = await createBoard();
    const streamed = readSse(`/api/boards/${boardId}/events`, (f) => f.length >= 3);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await call('POST', `/api/boards/${boardId}/start`, { concurrency: 1 });

    const frames = await streamed;
    assert.equal(frames[0].event, 'snapshot');
    assert.equal(frames[1].event, 'event');
    assert.equal(frames[1].data.type, 'board.started');
    assert.equal(frames[1].id, String(frames[1].data.seq));
    assert.equal(frames[2].data.type, 'task.attempt.started');
  });

  it('gives two clients connecting mid-run identical sequences from their connect points', async () => {
    const boardId = await createBoard();
    await call('POST', `/api/boards/${boardId}/start`, { concurrency: 1 });

    const first = readSse(`/api/boards/${boardId}/events`, (f) => f.length >= 2);
    const second = readSse(`/api/boards/${boardId}/events`, (f) => f.length >= 2);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await call('POST', `/api/boards/${boardId}/concurrency`, { n: 2 });

    const [a, b] = await Promise.all([first, second]);
    assert.equal(a[0].event, 'snapshot');
    assert.equal(b[0].event, 'snapshot');
    assert.deepEqual(
      a.slice(1).map((f) => f.data.seq),
      b.slice(1).map((f) => f.data.seq),
    );
  });

  it('resumes from Last-Event-ID with exactly the missed tail', async () => {
    const boardId = await createBoard();
    await call('POST', `/api/boards/${boardId}/start`, { concurrency: 1 });
    const journal = (await call('GET', `/api/boards/${boardId}/journal`)).body.events;
    assert.ok(journal.length >= 3, `journal only has ${journal.length} events`);

    const frames = await readSse(
      `/api/boards/${boardId}/events`,
      (f) => f.length >= journal.length - 1,
      { 'Last-Event-ID': '1' },
    );

    // No snapshot, no re-fold from zero: just the events after seq 1.
    assert.equal(frames.every((f) => f.event === 'event'), true, 'a snapshot was re-sent');
    const seqs = frames.map((f) => f.data.seq);
    assert.deepEqual(seqs, journal.slice(1, seqs.length + 1).map((e) => e.seq));
    assert.equal(new Set(seqs).size, seqs.length, 'duplicates in the resumed tail');
    for (let i = 1; i < seqs.length; i += 1) {
      assert.equal(seqs[i], seqs[i - 1] + 1, 'a gap in the resumed tail');
    }
  });

  it('drops the subscriber when a socket is destroyed, and keeps appending', async () => {
    const boardId = await createBoard();

    const request = http.get(`${base}/api/boards/${boardId}/events`);
    await new Promise((resolve) => request.once('response', resolve));
    request.destroy();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // The engine must be entirely unaffected by a dead client.
    const started = await call('POST', `/api/boards/${boardId}/start`, { concurrency: 1 });
    assert.equal(started.status, 200);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const journal = await call('GET', `/api/boards/${boardId}/journal`);
    assert.ok(journal.body.events.length >= 2);
  });

  it('404s a stream for a board that does not exist', async () => {
    const response = await fetch(`${base}/api/boards/nope/events`);
    assert.equal(response.status, 404);
    await response.text();
  });
});

describe('the surface itself', () => {
  it('exposes exactly the nine documented routes', async () => {
    assert.deepEqual(
      ROUTES.map((r) => `${r.method} ${r.name}`).sort(),
      [
        'GET events',
        'GET get',
        'GET journal',
        'GET list',
        'POST concurrency',
        'POST create',
        'POST start',
        'POST startTask',
        'POST stop',
      ],
    );
  });

  it('has no route that writes board state', async () => {
    // Locked decision 2 made enforceable: there is no mutation verb the renderer
    // can reach that is not a command the engine chose to expose.
    for (const route of ROUTES) {
      assert.notEqual(route.method, 'PUT', `${route.name} is a PUT`);
      assert.notEqual(route.method, 'PATCH', `${route.name} is a PATCH`);
      assert.notEqual(route.method, 'DELETE', `${route.name} is a DELETE`);
    }
    const boardId = await createBoard();
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      assert.equal((await call(method, `/api/boards/${boardId}`)).status, 404, method);
    }
  });

  it('matches routes exactly, with no prefix surprises', () => {
    assert.equal(matchRoute('GET', '/api/boards')?.name, 'list');
    assert.equal(matchRoute('GET', '/api/boards/b1')?.name, 'get');
    assert.equal(matchRoute('GET', '/api/boards/b1/events')?.name, 'events');
    assert.deepEqual(matchRoute('POST', '/api/boards/b1/tasks/W1-A/start')?.params, ['b1', 'W1-A']);
    assert.equal(matchRoute('GET', '/api/boards/b1/nope'), null);
    assert.equal(matchRoute('POST', '/api/boards/b1'), null);
    assert.equal(matchRoute('GET', '/api/boardsomething'), null);
  });

  it('leaves unrelated paths to the next middleware', async () => {
    const response = await fetch(`${base}/api/something-else`);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), 'not found');
  });
});
