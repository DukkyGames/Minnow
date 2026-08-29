/**
 * P1-E — the renderer as a view.
 *
 * Driven end to end: a real engine behind a real HTTP server, with the real
 * client folding the real SSE stream. What is being proved is that the view and
 * the engine cannot disagree about what the journal means, because they run the
 * same `derive()`.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { resetMinnowHomeCache } from '../../server/config/home.js';
import { derive } from '../../server/orchestrator/core/derive.js';
import { createScriptedEffector } from '../../server/orchestrator/effector-scripted.js';
import { disposeEngines } from '../../server/orchestrator/engine.js';
import { readEvents, resetJournalCache } from '../../server/orchestrator/journal.js';
import {
  createBoardsMiddleware,
  setEffectorFactory,
} from '../../server/orchestrator/middleware.js';
import {
  createBoardClient,
  createBoardFromPlan,
  listBoards,
  PlanParseFailure,
  readJournal,
  type EventStream,
} from '../../src/orchestrator/client.ts';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const PLAN = `---
name: view-board
overview: A board to look at.
todos:
  - id: W1-A
    content: "Wave 1: A"
    status: pending
  - id: W1-B
    content: "Wave 1: B"
    status: pending
isProject: true
---

# View Board

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
let server: http.Server;
let base = '';
let previousHome: string | undefined;
let realFetch: typeof globalThis.fetch;

before(() => {
  previousHome = process.env.MINNOW_HOME;
  realFetch = globalThis.fetch;
});

beforeEach(async () => {
  process.env.MINNOW_HOME = await fsp.mkdtemp(path.join(os.tmpdir(), 'minnow-client-'));
  resetMinnowHomeCache();
  resetJournalCache();
  disposeEngines();
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
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  // The client uses relative URLs, as it does in the browser. Point them at the
  // test server rather than teaching the client about absolute ones.
  globalThis.fetch = ((input: any, init?: any) =>
    realFetch(
      typeof input === 'string' && input.startsWith('/') ? `${base}${input}` : input,
      init,
    )) as typeof globalThis.fetch;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  disposeEngines();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

after(() => {
  globalThis.fetch = realFetch;
  if (previousHome === undefined) delete process.env.MINNOW_HOME;
  else process.env.MINNOW_HOME = previousHome;
  resetMinnowHomeCache();
  resetJournalCache();
  disposeEngines();
});

// ---------------------------------------------------------------------------

/**
 * A minimal SSE reader standing in for `EventSource`.
 *
 * Node exposes `EventSource` only behind a flag and happy-dom has none, so the
 * client takes the stream as a seam. This is a real HTTP SSE client — it parses
 * frames off the wire — not a fake that replays canned events.
 */
function openTestStream(url: string): EventStream & { reopenedWith?: string } {
  const listeners = new Map<string, Array<(event: { data: string }) => void>>();
  let lastEventId: string | null = null;
  let request: http.ClientRequest | null = null;
  let closed = false;

  const fire = (type: string, data: string) => {
    for (const listener of listeners.get(type) ?? []) listener({ data });
  };

  const stream: any = {
    addEventListener(type: string, listener: (event: { data: string }) => void) {
      const existing = listeners.get(type) ?? [];
      existing.push(listener);
      listeners.set(type, existing);
    },
    close() {
      closed = true;
      request?.destroy();
    },
    /** Drop and reconnect, exactly as EventSource does, carrying Last-Event-ID. */
    reconnect() {
      request?.destroy();
      open();
    },
    get lastEventId() {
      return lastEventId;
    },
  };

  function open() {
    if (closed) return;
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (lastEventId !== null) headers['Last-Event-ID'] = lastEventId;
    stream.reopenedWith = lastEventId ?? undefined;

    request = http.get(`${base}${url}`, { headers }, (response) => {
      fire('open', '');
      let buffer = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        buffer += chunk;
        let split: number;
        while ((split = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          if (raw.startsWith(':')) continue;
          let type = 'message';
          let data = '';
          for (const line of raw.split('\n')) {
            if (line.startsWith('id: ')) lastEventId = line.slice(4);
            else if (line.startsWith('event: ')) type = line.slice(7);
            else if (line.startsWith('data: ')) data = line.slice(6);
          }
          fire(type, data);
        }
      });
    });
    request.on('error', () => {
      if (!closed) fire('error', '');
    });
  }

  open();
  return stream;
}

/** Wait until `predicate` holds, or fail. */
async function until(predicate: () => boolean, what: string, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${what}`);
}

async function makeBoard() {
  const { boardId } = await createBoardFromPlan('view.md', { markdown: PLAN });
  return boardId;
}

// ---------------------------------------------------------------------------

describe('board client — reading', () => {
  it('lists boards', async () => {
    assert.deepEqual(await listBoards(), []);
    await makeBoard();
    const boards = await listBoards();
    assert.equal(boards.length, 1);
    assert.equal(boards[0].boardId, 'view-board');
    assert.equal(boards[0].taskCount, 2);
  });

  it('surfaces a plan that does not parse with its line numbers', async () => {
    // The author needs to know what to fix, not that "board creation failed".
    await assert.rejects(
      () => createBoardFromPlan('bad.md', { markdown: PLAN.replace('- **Touches:** src/beta/**\n', '') }),
      (err: unknown) => {
        assert.ok(err instanceof PlanParseFailure);
        assert.ok(err.errors.length > 0);
        assert.equal(typeof err.errors[0].line, 'number');
        assert.ok(err.errors[0].hint.length > 0);
        return true;
      },
    );
  });

  it('derives the board from the snapshot frame', async () => {
    const boardId = await makeBoard();
    const client = createBoardClient(boardId, { openStream: openTestStream });
    try {
      client.connect();
      await until(() => client.getState() !== null, 'the snapshot frame');

      const state = client.getState()!;
      assert.deepEqual([...state.tasks.keys()], ['W1-A', 'W1-B']);
      assert.equal(state.status, 'created');
      assert.deepEqual(state.tasks.get('W1-A')!.touches, ['src/alpha/**']);
    } finally {
      client.close();
    }
  });

  it('folds each streamed event, matching the server exactly', async () => {
    const boardId = await makeBoard();
    const client = createBoardClient(boardId, { openStream: openTestStream });
    try {
      client.connect();
      await until(() => client.getState() !== null, 'the snapshot frame');

      await client.start(2);
      await until(
        () => client.getState()?.tasks.get('W1-A')?.phase === 'building',
        'the first attempt to start',
      );

      // The view and the engine run the same fold, so they cannot disagree.
      const fromJournal = derive(await readEvents(boardId));
      assert.deepEqual(client.getState(), fromJournal);
    } finally {
      client.close();
    }
  });

  it('reads the raw journal', async () => {
    const boardId = await makeBoard();
    const events = await readJournal(boardId);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'board.created');
  });
});

describe('board client — reconnect', () => {
  it('catches up through Last-Event-ID rather than re-folding from zero', async () => {
    const boardId = await makeBoard();
    const stream = openTestStream(`/api/boards/${boardId}/events`) as any;
    const client = createBoardClient(boardId, { openStream: () => stream });

    try {
      client.connect();
      await until(() => client.getState() !== null, 'the snapshot frame');
      await client.start(2);
      await until(
        () => client.getState()?.status === 'running',
        'the board to start',
      );

      // The lid closes. Events keep happening.
      stream.close();
      await client.setConcurrency(1);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // The lid opens. EventSource reconnects with Last-Event-ID, and the server
      // answers with the tail — not a snapshot, and not the whole journal.
      const resumed = openTestStream(`/api/boards/${boardId}/events`) as any;
      const catchUp = createBoardClient(boardId, { openStream: () => resumed });
      catchUp.connect();
      await until(() => catchUp.getState() !== null, 'the resumed snapshot');
      await until(() => catchUp.getState()?.concurrency === 1, 'the missed concurrency change');

      assert.deepEqual(catchUp.getState(), derive(await readEvents(boardId)));
      catchUp.close();
    } finally {
      client.close();
    }
  });

  it('reports the connection state so a view can show it', async () => {
    const boardId = await makeBoard();
    const client = createBoardClient(boardId, { openStream: openTestStream });
    try {
      client.connect();
      await until(() => client.isConnected(), 'the stream to open');
      client.close();
      assert.equal(client.isConnected(), false);
    } finally {
      client.close();
    }
  });
});

describe('board client — commands', () => {
  it('sends every mutation as a POST and waits for the event to come back', async () => {
    const boardId = await makeBoard();
    const client = createBoardClient(boardId, { openStream: openTestStream });
    try {
      client.connect();
      await until(() => client.getState() !== null, 'the snapshot frame');

      // The view must never optimistically mutate: state changes only when the
      // engine says so, over the stream.
      const before = client.getState()!;
      assert.equal(before.status, 'created');

      await client.start(2);
      await until(() => client.getState()?.status === 'running', 'board.started');
      assert.equal(client.getState()!.concurrency, 2);

      await client.setConcurrency(3);
      await until(() => client.getState()?.concurrency === 3, 'the concurrency change');

      await client.stop();
      await until(() => client.getState()?.status === 'stopped', 'board.stopped');
      assert.equal(client.getState()!.stopReason, 'user');
    } finally {
      client.close();
    }
  });

  it('reports whether a manual task start was accepted', async () => {
    const boardId = await makeBoard();
    const client = createBoardClient(boardId, { openStream: openTestStream });
    try {
      client.connect();
      await until(() => client.getState() !== null, 'the snapshot frame');
      await client.start(1);
      await until(() => client.getState()?.status === 'running', 'board.started');

      assert.equal(await client.startTask('W1-B'), true);
      await until(
        () => client.getState()?.tasks.get('W1-B')?.phase === 'building',
        'the manual start',
      );
      // Asking again while it runs is answered, not thrown.
      assert.equal(await client.startTask('W1-B'), false);
    } finally {
      client.close();
    }
  });

  it('notifies subscribers on every change', async () => {
    const boardId = await makeBoard();
    const client = createBoardClient(boardId, { openStream: openTestStream });
    const seen: string[] = [];
    const unsubscribe = client.subscribe((state) => {
      if (state) seen.push(state.status);
    });
    try {
      client.connect();
      await until(() => seen.length > 0, 'the first notification');
      await client.start(1);
      await until(() => seen.includes('running'), 'a running notification');
      unsubscribe();
      const count = seen.length;
      await client.stop();
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(seen.length, count, 'unsubscribe did not take effect');
    } finally {
      client.close();
    }
  });
});

describe('the renderer writes nothing', () => {
  it('exposes no way to set board state', () => {
    const client = createBoardClient('x', { openStream: openTestStream });
    client.close();
    for (const name of Object.keys(client)) {
      assert.doesNotMatch(
        name,
        /^(set|update|patch|write|mutate|apply)(?!Concurrency$)/,
        `the client exposes ${name}`,
      );
    }
  });

  it('imports the fold from the shared core rather than reimplementing it', async () => {
    // One definition of what an event means, used by both sides. A second one in
    // the renderer is how a view starts disagreeing with the engine.
    const source = await fsp.readFile(
      path.join(PROJECT_ROOT, 'src/orchestrator/client.ts'),
      'utf8',
    );
    assert.match(source, /from '\.\.\/\.\.\/server\/orchestrator\/core\/derive\.js'/);
    assert.match(source, /from '\.\.\/\.\.\/server\/orchestrator\/core\/snapshot\.js'/);
  });

  it('reaches no V1 board module', async () => {
    const source = await fsp.readFile(
      path.join(PROJECT_ROOT, 'src/orchestrator/client.ts'),
      'utf8',
    );
    for (const banned of [
      'orchestrate-board-store',
      'orchestrate-board-actions',
      'orchestrate-self-heal',
      'board-tools',
    ]) {
      assert.equal(source.includes(banned), false, `client.ts reaches ${banned}`);
    }
  });

  it('has no V1 store import anywhere under src/orchestrator', () => {
    // The guard MIN-695 asks for. It is scoped to the new directory now; it
    // widens to `src/ui/orchestrate-board*` when the V1 view is removed.
    const dir = path.join(PROJECT_ROOT, 'src/orchestrator');
    for (const entry of fs.readdirSync(dir, { recursive: true }) as string[]) {
      const file = path.join(dir, String(entry));
      if (!fs.statSync(file).isFile()) continue;
      const source = fs.readFileSync(file, 'utf8');
      assert.equal(
        source.includes('orchestrate-board-store'),
        false,
        `${entry} imports the V1 board store`,
      );
    }
  });
});
