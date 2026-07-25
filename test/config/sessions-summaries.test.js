/**
 * Phase C.1: GET /api/config/sessions/summaries — no history key; counts/preview correct.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { closeSessionsDb } from '../../server/config/sessions-db.js';
import {
  createConfigTestServer,
  httpRequest,
  rmTestHome,
  setTestHome,
} from './test-helpers.js';

/** Minimal chat row for PUT fixtures. */
function makeChat(id, name, extra = {}) {
  return {
    id,
    name,
    workspacePath: extra.workspacePath ?? '',
    modelId: '',
    modeId: 'build',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1_700_000_000_000,
    lastMessageAt: 1_700_000_000_000,
    ...extra,
  };
}

/** Whole-blob SessionState with the given chats. */
function makeState(chats, extra = {}) {
  return {
    version: 6,
    activeId: chats[0]?.id ?? '',
    sidebarCollapsed: false,
    lastActiveChatIdByWorkspace: {},
    lastActiveChatIdByApp: {},
    groups: [],
    chats,
    ...extra,
  };
}

describe('GET /api/config/sessions/summaries', () => {
  let homeDir;
  let server;
  let baseUrl;
  let savedStore;

  before(async () => {
    savedStore = process.env.MINNOW_SESSIONS_STORE;
    delete process.env.MINNOW_SESSIONS_STORE;
    homeDir = setTestHome(process.env, `minnow-sessions-summaries-${Date.now()}`);
    server = createConfigTestServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    closeSessionsDb();
    if (savedStore === undefined) delete process.env.MINNOW_SESSIONS_STORE;
    else process.env.MINNOW_SESSIONS_STORE = savedStore;
    await rmTestHome(homeDir);
  });

  beforeEach(async () => {
    const seed = makeState([
      makeChat('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Alpha', {
        workspacePath: '/ws/alpha',
        history: [
          { role: 'user', content: 'hello from alpha' },
          { role: 'assistant', content: 'alpha reply that is long enough to preview' },
        ],
      }),
      makeChat('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Beta', {
        workspacePath: '/ws/beta',
        history: [{ role: 'user', content: 'beta only' }],
      }),
      makeChat('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Empty', {
        workspacePath: '/ws/alpha',
        history: [],
      }),
    ]);
    const put = await httpRequest(baseUrl, 'PUT', '/api/config/sessions', seed);
    assert.equal(put.status, 200);
  });

  test('summaries omit history and expose denormalized count/preview', async () => {
    const res = await httpRequest(baseUrl, 'GET', '/api/config/sessions/summaries');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.chats));
    assert.equal(res.json.chats.length, 3);

    for (const chat of res.json.chats) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(chat, 'history'),
        false,
        `summary for ${chat.id} must not include history`,
      );
      assert.equal(typeof chat.messageCount, 'number');
      assert.equal(typeof chat.lastMessagePreview, 'string');
    }

    const alpha = res.json.chats.find((c) => c.id.startsWith('aaaa'));
    assert.ok(alpha);
    assert.equal(alpha.messageCount, 2);
    assert.equal(alpha.lastMessagePreview, 'alpha reply that is long enough to preview');
    assert.equal(alpha.name, 'Alpha');

    const beta = res.json.chats.find((c) => c.id.startsWith('bbbb'));
    assert.ok(beta);
    assert.equal(beta.messageCount, 1);
    assert.equal(beta.lastMessagePreview, 'beta only');

    const empty = res.json.chats.find((c) => c.id.startsWith('cccc'));
    assert.ok(empty);
    assert.equal(empty.messageCount, 0);
    assert.equal(empty.lastMessagePreview, '');
  });

  test('workspace filter returns only matching chats', async () => {
    const res = await httpRequest(
      baseUrl,
      'GET',
      '/api/config/sessions/summaries?workspace=/ws/alpha',
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.chats.length, 2);
    for (const chat of res.json.chats) {
      assert.equal(chat.workspacePath, '/ws/alpha');
      assert.equal(Object.prototype.hasOwnProperty.call(chat, 'history'), false);
    }
  });

  test('history route returns full message list for one chat', async () => {
    const res = await httpRequest(
      baseUrl,
      'GET',
      '/api/config/sessions/history/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.chatId, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    assert.equal(res.json.history.length, 2);
    assert.equal(res.json.history[0].content, 'hello from alpha');
    assert.equal(res.json.history[1].content, 'alpha reply that is long enough to preview');
  });
});
