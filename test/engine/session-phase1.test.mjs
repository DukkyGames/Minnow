/**
 * Session Engine Phase 1 (MIN-359): command dispatch + flag gating.
 */

import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { handleConfigRequest } from '../../server/config/middleware.js';
import { handleSessionRequest } from '../../server/session/middleware.js';
import { resetSessionRevStoreForTests } from '../../server/session/rev-store.js';
import { resetSessionSseForTests } from '../../server/session/sse.js';
import {
  resetSessionEngineForTests,
  ensureSessionEngineBooted,
  getEngineSessionState,
} from '../../server/session/engine.js';
import { closeSessionsDb } from '../../server/config/sessions-db.js';
import {
  httpRequest,
  readFixture,
  setTestHome,
  rmTestHome,
} from '../config/test-helpers.js';

/** @type {Record<string, unknown>} */
let defaultSessionFixture;

function createPhase1TestServer() {
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

function httpRequestWithHeaders(baseUrl, method, pathname, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const payload = body != null ? JSON.stringify(body) : undefined;
    const req = http.request(
      url,
      {
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
          ...extraHeaders,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = text;
          }
          resolve({
            status: res.statusCode,
            json,
            text,
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('session engine phase 1 (MIN-359)', () => {
  /** @type {string | undefined} */
  let home;
  /** @type {http.Server | undefined} */
  let server;
  /** @type {string | undefined} */
  let baseUrl;
  /** @type {string | undefined} */
  let prevEngineFlag;

  before(async () => {
    home = setTestHome(process.env, 'minnow-session-phase1');
    defaultSessionFixture = JSON.parse(await readFixture('expected-sessions-state.json'));
    prevEngineFlag = process.env.MINNOW_SERVER_ENGINE;
    process.env.MINNOW_SERVER_ENGINE = '1';
    resetSessionRevStoreForTests();
    resetSessionSseForTests();
    resetSessionEngineForTests();
    server = createPhase1TestServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  beforeEach(() => {
    resetSessionRevStoreForTests();
    resetSessionEngineForTests();
    process.env.MINNOW_SERVER_ENGINE = '1';
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

  test('GET /api/session/engine reports enabled flag (default-on + opt-out)', async () => {
    const res = await httpRequest(baseUrl, 'GET', '/api/session/engine');
    assert.equal(res.status, 200);
    assert.equal(res.json?.enabled, true);

    // Phase 4: unset env ⇒ still enabled (default-on).
    delete process.env.MINNOW_SERVER_ENGINE;
    const unset = await httpRequest(baseUrl, 'GET', '/api/session/engine');
    assert.equal(unset.status, 200);
    assert.equal(unset.json?.enabled, true);

    process.env.MINNOW_SERVER_ENGINE = '0';
    const off = await httpRequest(baseUrl, 'GET', '/api/session/engine');
    assert.equal(off.status, 200);
    assert.equal(off.json?.enabled, false);
    process.env.MINNOW_SERVER_ENGINE = '1';
  });

  test('POST /api/session/commands returns 503 when flag off', async () => {
    process.env.MINNOW_SERVER_ENGINE = '0';
    const put = await httpRequest(baseUrl, 'PUT', '/api/config/sessions', defaultSessionFixture);
    assert.equal(put.status, 200);
    const chatId = defaultSessionFixture.chats[0].id;
    const res = await httpRequest(baseUrl, 'POST', '/api/session/commands', {
      type: 'send_message',
      chatId,
      text: 'hello',
    });
    assert.equal(res.status, 503);
    assert.equal(res.json?.code, 'ENGINE_DISABLED');
    process.env.MINNOW_SERVER_ENGINE = '1';
  });

  test('steer_message and enqueue_message mutate session state + bump rev', async () => {
    const put = await httpRequest(baseUrl, 'PUT', '/api/config/sessions', defaultSessionFixture);
    assert.equal(put.status, 200);
    const chatId = defaultSessionFixture.chats[0].id;

    await ensureSessionEngineBooted();

    const steer = await httpRequest(baseUrl, 'POST', '/api/session/commands', {
      type: 'steer_message',
      chatId,
      text: 'steer correction',
    });
    assert.equal(steer.status, 202);
    assert.ok(typeof steer.json?.rev === 'number' && steer.json.rev > 0);

    const stateAfterSteer = /** @type {any} */ (getEngineSessionState());
    const chatAfterSteer = stateAfterSteer?.chats?.find((c) => c.id === chatId);
    assert.equal(chatAfterSteer?.pendingSteerMessage, 'steer correction');

    // Simulate an active turn so enqueue is accepted as follow-up.
    const { beginEngineTurn, endEngineTurn } = await import('../../server/session/engine.js');
    const controller = beginEngineTurn(chatId);
    const enqueue = await httpRequest(baseUrl, 'POST', '/api/session/commands', {
      type: 'enqueue_message',
      chatId,
      text: 'queued follow-up',
    });
    assert.equal(enqueue.status, 202);
    assert.equal(enqueue.json?.detail, 'queued');
    const stateAfterQueue = /** @type {any} */ (getEngineSessionState());
    const chatAfterQueue = stateAfterQueue?.chats?.find((c) => c.id === chatId);
    assert.ok(Array.isArray(chatAfterQueue?.pendingMessageQueue));
    assert.equal(chatAfterQueue.pendingMessageQueue.length, 1);
    assert.equal(chatAfterQueue.pendingMessageQueue[0].text, 'queued follow-up');
    endEngineTurn(chatId, controller);
  });

  test('stop_generation clears steer and engineTurnActive', async () => {
    const put = await httpRequest(baseUrl, 'PUT', '/api/config/sessions', defaultSessionFixture);
    assert.equal(put.status, 200);
    const chatId = defaultSessionFixture.chats[0].id;
    await ensureSessionEngineBooted();

    await httpRequest(baseUrl, 'POST', '/api/session/commands', {
      type: 'steer_message',
      chatId,
      text: 'will clear',
    });

    const stop = await httpRequest(baseUrl, 'POST', '/api/session/commands', {
      type: 'stop_generation',
      chatId,
    });
    assert.equal(stop.status, 202);
    const chat = /** @type {any} */ (getEngineSessionState())?.chats?.find((c) => c.id === chatId);
    assert.equal(chat?.pendingSteerMessage, undefined);
    assert.equal(chat?.engineTurnActive, false);
  });

  test('send_message rejects unknown chat with 404', async () => {
    const put = await httpRequest(baseUrl, 'PUT', '/api/config/sessions', defaultSessionFixture);
    assert.equal(put.status, 200);
    await ensureSessionEngineBooted();

    const res = await httpRequest(baseUrl, 'POST', '/api/session/commands', {
      type: 'send_message',
      chatId: 'missing-chat-id',
      text: 'hello',
    });
    assert.equal(res.status, 404);
  });

  test('send_message accepts attachments and persists history placeholders', async () => {
    const put = await httpRequest(baseUrl, 'PUT', '/api/config/sessions', defaultSessionFixture);
    assert.equal(put.status, 200);
    await ensureSessionEngineBooted();
    const chatId = defaultSessionFixture.chats[0].id;

    const res = await httpRequest(baseUrl, 'POST', '/api/session/commands', {
      type: 'send_message',
      chatId,
      text: 'describe this',
      historyContent: 'describe this\n\n[image: shot.png]',
      attachments: [
        {
          id: 'att-1',
          name: 'shot.png',
          kind: 'image',
          mimeType: 'image/png',
          size: 8,
          dataUrl: 'data:image/png;base64,abcd',
        },
      ],
    });
    assert.equal(res.status, 202);
    assert.equal(res.json?.accepted, true);

    // User row is committed before the async tool loop settles (or fails without a model).
    const chat = /** @type {any} */ (getEngineSessionState())?.chats?.find((c) => c.id === chatId);
    const lastUser = [...(chat?.history ?? [])].reverse().find((m) => m.role === 'user');
    assert.ok(lastUser);
    assert.match(String(lastUser.content), /\[image: shot\.png\]/);
    // Raw attachment blobs must not land on Chat (SSE size); only history string does.
    assert.equal(chat?.engineTurnAttachments, undefined);
  });

  test('answer_question without a parked waiter returns accepted:false', async () => {
    const put = await httpRequest(baseUrl, 'PUT', '/api/config/sessions', defaultSessionFixture);
    assert.equal(put.status, 200);
    await ensureSessionEngineBooted();
    const chatId = defaultSessionFixture.chats[0].id;

    const res = await httpRequest(baseUrl, 'POST', '/api/session/commands', {
      type: 'answer_question',
      chatId,
      toolCallId: 'missing',
      result: { status: 'cancelled', answers: [] },
    });
    assert.equal(res.status, 202);
    assert.equal(res.json?.accepted, false);
    assert.equal(res.json?.detail, 'no_pending_question');
  });

  test('unknown command type returns 400', async () => {
    const put = await httpRequest(baseUrl, 'PUT', '/api/config/sessions', defaultSessionFixture);
    assert.equal(put.status, 200);
    await ensureSessionEngineBooted();
    const res = await httpRequest(baseUrl, 'POST', '/api/session/commands', {
      type: 'not_a_real_command',
      chatId: 'x',
    });
    assert.equal(res.status, 400);
  });

  test('concurrent mutates serialize without lost updates', async () => {
    const put = await httpRequest(baseUrl, 'PUT', '/api/config/sessions', defaultSessionFixture);
    assert.equal(put.status, 200);
    await ensureSessionEngineBooted();
    const chatId = defaultSessionFixture.chats[0].id;
    const { mutateEngineState, getEngineSessionState } = await import(
      '../../server/session/engine.js'
    );

    await Promise.all([
      mutateEngineState((state) => {
        const chat = state.chats.find((c) => c.id === chatId);
        chat.pendingSteerMessage = 'from-a';
      }),
      mutateEngineState((state) => {
        const chat = state.chats.find((c) => c.id === chatId);
        if (!Array.isArray(chat.pendingMessageQueue)) chat.pendingMessageQueue = [];
        chat.pendingMessageQueue.push({
          id: 'q1',
          text: 'from-b',
          createdAt: 1,
        });
      }),
    ]);

    const chat = /** @type {any} */ (getEngineSessionState())?.chats?.find((c) => c.id === chatId);
    assert.equal(chat?.pendingSteerMessage, 'from-a');
    assert.equal(chat?.pendingMessageQueue?.length, 1);
    assert.equal(chat?.pendingMessageQueue?.[0]?.text, 'from-b');
  });

  test('hard commit invalidates pending soft flush', async () => {
    const put = await httpRequest(baseUrl, 'PUT', '/api/config/sessions', defaultSessionFixture);
    assert.equal(put.status, 200);
    await ensureSessionEngineBooted();
    const chatId = defaultSessionFixture.chats[0].id;
    const {
      mutateEngineState,
      flushEngineStateNow,
      getEngineSessionState,
    } = await import('../../server/session/engine.js');

    await mutateEngineState((state) => {
      const chat = state.chats.find((c) => c.id === chatId);
      chat.currentGenerationId = 'gen-soft';
    }, { soft: true });

    await mutateEngineState((state) => {
      const chat = state.chats.find((c) => c.id === chatId);
      chat.currentGenerationId = undefined;
      chat.engineTurnActive = false;
      chat.history.push({ role: 'assistant', content: 'final' });
    });

    // Soft debounce window — hard path must have cancelled the quiet rewrite.
    await new Promise((r) => setTimeout(r, 120));
    await flushEngineStateNow();

    const chat = /** @type {any} */ (getEngineSessionState())?.chats?.find((c) => c.id === chatId);
    assert.equal(chat?.currentGenerationId, undefined);
    assert.ok(chat?.history?.some((m) => m.content === 'final'));
  });
});
