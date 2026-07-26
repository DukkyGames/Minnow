/**
 * Composer queue drain + single error-row (MIN-354 landing).
 * Mocks the tool loop so turn lifetime is deterministic — a real failing turn
 * races the enqueue HTTP round-trip and flakes under --test concurrency.
 *
 * Run with --experimental-test-module-mocks (see test/run-all.mjs).
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, beforeEach, describe, mock, test } from 'node:test';
import {
  httpRequest,
  readFixture,
  setTestHome,
  rmTestHome,
} from '../config/test-helpers.js';

/** @type {Array<() => void>} */
const turnReleases = [];
/** @type {Array<'ok' | 'fail'>} */
const turnOutcomes = [];
let turnStarts = 0;

// Must register before any server/session import pulls in loop-loader.
mock.module('../../server/session/loop-loader.js', {
  namedExports: {
    async runEngineMainChatTurn() {
      turnStarts += 1;
      const outcome = turnOutcomes.shift() ?? 'ok';
      await new Promise((resolve, reject) => {
        turnReleases.push(() => {
          if (outcome === 'fail') reject(new Error('forced turn failure'));
          else resolve(undefined);
        });
      });
    },
    resetLoopLoaderForTests() {
      /* no-op under mock */
    },
  },
});

const { handleConfigRequest } = await import('../../server/config/middleware.js');
const { handleSessionRequest } = await import('../../server/session/middleware.js');
const { resetSessionRevStoreForTests } = await import('../../server/session/rev-store.js');
const { resetSessionSseForTests } = await import('../../server/session/sse.js');
const { closeSessionsDb } = await import('../../server/config/sessions-db.js');
const {
  resetSessionEngineForTests,
  ensureSessionEngineBooted,
  getEngineSessionState,
} = await import('../../server/session/engine.js');

/** @type {Record<string, unknown>} */
let defaultSessionFixture;

function createTestServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    void handleSessionRequest(req, res, url.pathname).then((sessionHandled) => {
      if (sessionHandled) return;
      void handleConfigRequest(req, res, url.pathname).then((configHandled) => {
        if (!configHandled) {
          res.statusCode = 404;
          res.end('not found');
        }
      });
    });
  });
}

/** Release the oldest parked mocked turn. */
function releaseOldestTurn() {
  const release = turnReleases.shift();
  assert.ok(release, 'expected a parked engine turn to release');
  release();
}

/**
 * Poll until `predicate` holds. The drain is fire-and-forget across a turn
 * teardown plus a session write, so a fixed sleep is a coin flip on slow CI.
 * @param {() => boolean} predicate
 * @param {string} what
 * @param {number} [timeoutMs]
 */
async function waitFor(predicate, what, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail(`timed out after ${timeoutMs}ms waiting for: ${what}`);
}

describe('session engine queue drain + error row', () => {
  /** @type {string | undefined} */
  let home;
  /** @type {http.Server | undefined} */
  let server;
  /** @type {string | undefined} */
  let baseUrl;
  /** @type {string | undefined} */
  let prevEngineFlag;

  before(async () => {
    home = setTestHome(process.env, 'minnow-session-queue-drain');
    defaultSessionFixture = JSON.parse(await readFixture('expected-sessions-state.json'));
    prevEngineFlag = process.env.MINNOW_SERVER_ENGINE;
    process.env.MINNOW_SERVER_ENGINE = '1';
    resetSessionRevStoreForTests();
    resetSessionSseForTests();
    resetSessionEngineForTests();
    server = createTestServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  beforeEach(() => {
    resetSessionRevStoreForTests();
    resetSessionEngineForTests();
    process.env.MINNOW_SERVER_ENGINE = '1';
    turnStarts = 0;
    turnReleases.length = 0;
    turnOutcomes.length = 0;
  });

  after(async () => {
    resetSessionSseForTests();
    resetSessionRevStoreForTests();
    resetSessionEngineForTests();
    if (prevEngineFlag === undefined) delete process.env.MINNOW_SERVER_ENGINE;
    else process.env.MINNOW_SERVER_ENGINE = prevEngineFlag;
    closeSessionsDb();
    await new Promise((resolve) => server?.close(resolve));
    if (home) await rmTestHome(home);
  });

  test('composer follow-up drains after the turn ends (not re-enqueued)', async () => {
    turnOutcomes.push('ok', 'ok');
    const put = await httpRequest(baseUrl, 'PUT', '/api/config/sessions', defaultSessionFixture);
    assert.equal(put.status, 200);
    await ensureSessionEngineBooted();
    const chatId = /** @type {{ chats: { id: string }[] }} */ (defaultSessionFixture).chats[0].id;

    const send = await httpRequest(baseUrl, 'POST', '/api/session/commands', {
      type: 'send_message',
      chatId,
      text: 'first turn',
    });
    assert.equal(send.status, 202);

    // Turn is parked in the mock — enqueue while still active.
    const enqueue = await httpRequest(baseUrl, 'POST', '/api/session/commands', {
      type: 'enqueue_message',
      chatId,
      text: 'queued follow-up',
    });
    assert.equal(enqueue.status, 202);
    assert.equal(enqueue.json?.detail, 'queued');
    assert.equal(turnStarts, 1);

    const mid = /** @type {any} */ (getEngineSessionState())?.chats?.find((c) => c.id === chatId);
    assert.equal(mid?.pendingMessageQueue?.length, 1);

    // Settle first turn — teardown must drain (not re-queue).
    releaseOldestTurn();
    await waitFor(() => turnStarts === 2, 'drain should start a second turn');

    const afterDrain = /** @type {any} */ (getEngineSessionState())?.chats?.find(
      (c) => c.id === chatId,
    );
    assert.equal(
      Array.isArray(afterDrain?.pendingMessageQueue) ? afterDrain.pendingMessageQueue.length : 0,
      0,
    );
    const userTexts = (afterDrain?.history ?? [])
      .filter((m) => m.role === 'user')
      .map((m) => String(m.content));
    assert.ok(userTexts.includes('first turn'));
    assert.ok(userTexts.includes('queued follow-up'));

    // Settle second turn so it cannot leak into the next test.
    releaseOldestTurn();
    await new Promise((r) => setTimeout(r, 40));
  });

  test('failing turn writes exactly one assistant Error row', async () => {
    turnOutcomes.push('fail');
    const put = await httpRequest(baseUrl, 'PUT', '/api/config/sessions', defaultSessionFixture);
    assert.equal(put.status, 200);
    await ensureSessionEngineBooted();
    const chatId = /** @type {{ chats: { id: string }[] }} */ (defaultSessionFixture).chats[0].id;

    const send = await httpRequest(baseUrl, 'POST', '/api/session/commands', {
      type: 'send_message',
      chatId,
      text: 'will fail',
    });
    assert.equal(send.status, 202);
    assert.equal(turnStarts, 1);

    releaseOldestTurn();
    const errorRowsNow = () => {
      const chat = /** @type {any} */ (getEngineSessionState())?.chats?.find(
        (c) => c.id === chatId,
      );
      return (chat?.history ?? []).filter(
        (m) => m.role === 'assistant' && String(m.content).startsWith('Error:'),
      );
    };
    await waitFor(() => errorRowsNow().length > 0, 'error row written after failed turn');
    // Settle: a duplicate row would land right after the first, so give the
    // (removed) second writer a window to prove it is really gone.
    await new Promise((r) => setTimeout(r, 100));

    const errorRows = errorRowsNow();
    assert.equal(errorRows.length, 1, `expected one Error row, got ${errorRows.length}`);
    assert.match(String(errorRows[0].content), /forced turn failure/);
  });
});
