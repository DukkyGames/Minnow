/**
 * Regression cover for the session transcript wipe.
 *
 * Every chat that predated 2026-08-09 lost its messages while its chat row, runs
 * and timestamps survived, leaving 12k orphaned messages_fts rows behind. The
 * cause was a whole-blob PUT that deleted chats it did not list, plus a re-upsert
 * that recreated them from a payload which omitted `history`.
 */

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

import { closeSessionsDb, getSessionsDb } from '../../server/config/sessions-db.js';
import { readSessionRevision } from '../../server/config/sessions-repo.js';
import {
  createConfigTestServer,
  httpRequest,
  rmTestHome,
  setTestHome,
} from './test-helpers.js';

const ALPHA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BETA = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function makeChat(id, name, history = []) {
  return {
    id,
    name,
    workspacePath: '',
    modelId: '',
    modeId: 'build',
    history,
    lastStats: null,
    modelInfo: {},
    updatedAt: 1_700_000_000_000,
    lastMessageAt: 1_700_000_000_000,
  };
}

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

/** A chat as the client wires it while its history is still lazily unloaded. */
function withoutHistory(chat) {
  const { history: _history, ...rest } = chat;
  void _history;
  return rest;
}

function messageCount(chatId) {
  return getSessionsDb()
    .prepare('SELECT COUNT(*) AS n FROM messages WHERE chat_id = ?')
    .get(chatId).n;
}

describe('sessions history loss regressions', () => {
  let homeDir;
  let server;
  let baseUrl;
  let savedStore;

  before(async () => {
    savedStore = process.env.MINNOW_SESSIONS_STORE;
    delete process.env.MINNOW_SESSIONS_STORE;
    homeDir = setTestHome(process.env, `minnow-sessions-loss-${Date.now()}`);
    server = createConfigTestServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    closeSessionsDb();
    if (savedStore === undefined) delete process.env.MINNOW_SESSIONS_STORE;
    else process.env.MINNOW_SESSIONS_STORE = savedStore;
    await rmTestHome(homeDir);
  });

  beforeEach(async () => {
    const seeded = makeState([
      makeChat(ALPHA, 'Alpha', [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ]),
      makeChat(BETA, 'Beta', [{ role: 'user', content: 'beta only' }]),
    ]);
    const res = await httpRequest(baseUrl, 'PUT', '/api/config/sessions', seeded);
    assert.equal(res.status, 200);
  });

  test('PUT that omits a chat does not delete it', async () => {
    // A client booted lazily, or one whose load degraded, holds a short list.
    const partial = makeState([makeChat(ALPHA, 'Alpha', [{ role: 'user', content: 'hello' }])]);
    const res = await httpRequest(baseUrl, 'PUT', '/api/config/sessions', partial);
    assert.equal(res.status, 200);

    const after = (await httpRequest(baseUrl, 'GET', '/api/config/sessions')).json;
    const beta = after.chats.find((c) => c.id === BETA);
    assert.ok(beta, 'chat missing from the payload must survive');
    assert.equal(beta.history.length, 1);
  });

  test('PUT deletes only the ids it names', async () => {
    const res = await httpRequest(baseUrl, 'PUT', '/api/config/sessions', {
      ...makeState([makeChat(ALPHA, 'Alpha', [{ role: 'user', content: 'hello' }])]),
      deleteChatIds: [BETA],
    });
    assert.equal(res.status, 200);

    const after = (await httpRequest(baseUrl, 'GET', '/api/config/sessions')).json;
    assert.equal(
      after.chats.some((c) => c.id === BETA),
      false,
    );
    assert.equal(messageCount(BETA), 0);
  });

  test('deleting a chat sweeps its FTS rows', async () => {
    const db = getSessionsDb();
    const before = db
      .prepare('SELECT COUNT(*) AS n FROM messages_fts WHERE chat_id = ?')
      .get(ALPHA).n;
    assert.ok(before > 0, 'seed should have indexed rows');

    await httpRequest(baseUrl, 'PATCH', '/api/config/sessions', {
      baseVersion: 6,
      deleteChatIds: [ALPHA],
    });

    const orphaned = db
      .prepare('SELECT COUNT(*) AS n FROM messages_fts WHERE chat_id = ?')
      .get(ALPHA).n;
    assert.equal(orphaned, 0, 'FTS rows must not outlive the chat');
  });

  test('a history-omitting write cannot resurrect a deleted chat as empty', async () => {
    await httpRequest(baseUrl, 'PATCH', '/api/config/sessions', {
      baseVersion: 6,
      deleteChatIds: [ALPHA],
    });

    // The other window still holds ALPHA in memory, unhydrated, and flushes it.
    const res = await httpRequest(baseUrl, 'PATCH', '/api/config/sessions', {
      baseVersion: 6,
      chats: [withoutHistory(makeChat(ALPHA, 'Alpha'))],
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.applied.chats, 0, 'empty resurrection must be refused');

    const after = (await httpRequest(baseUrl, 'GET', '/api/config/sessions')).json;
    assert.equal(
      after.chats.some((c) => c.id === ALPHA),
      false,
      'a chat with no recoverable history must not come back blank',
    );
  });

  test('PUT preserves messages for chats that omit history', async () => {
    const res = await httpRequest(baseUrl, 'PUT', '/api/config/sessions', {
      ...makeState([
        withoutHistory(makeChat(ALPHA, 'Alpha renamed')),
        withoutHistory(makeChat(BETA, 'Beta')),
      ]),
    });
    assert.equal(res.status, 200);

    const after = (await httpRequest(baseUrl, 'GET', '/api/config/sessions')).json;
    assert.equal(after.chats.find((c) => c.id === ALPHA).history.length, 2);
    assert.equal(after.chats.find((c) => c.id === ALPHA).name, 'Alpha renamed');
    assert.equal(after.chats.find((c) => c.id === BETA).history.length, 1);
  });

  test('a stale baseRevision is rejected instead of overwriting', async () => {
    const stale = readSessionRevision();

    // Another window writes first.
    const first = await httpRequest(baseUrl, 'PATCH', '/api/config/sessions', {
      baseVersion: 6,
      baseRevision: stale,
      chats: [makeChat(BETA, 'Beta from window two', [{ role: 'user', content: 'newer' }])],
    });
    assert.equal(first.status, 200);

    const conflict = await httpRequest(baseUrl, 'PATCH', '/api/config/sessions', {
      baseVersion: 6,
      baseRevision: stale,
      chats: [makeChat(BETA, 'Beta from window one', [])],
    });
    assert.equal(conflict.status, 409);
    assert.equal(typeof conflict.json.revision, 'number');

    const after = (await httpRequest(baseUrl, 'GET', '/api/config/sessions')).json;
    const beta = after.chats.find((c) => c.id === BETA);
    assert.equal(beta.name, 'Beta from window two');
    assert.equal(beta.history.length, 1, 'the losing write must not have landed');
  });

  test('writes without a baseRevision still apply', async () => {
    const res = await httpRequest(baseUrl, 'PATCH', '/api/config/sessions', {
      baseVersion: 6,
      chats: [makeChat(BETA, 'Beta unversioned', [{ role: 'user', content: 'beta only' }])],
    });
    assert.equal(res.status, 200);
    const after = (await httpRequest(baseUrl, 'GET', '/api/config/sessions')).json;
    assert.equal(after.chats.find((c) => c.id === BETA).name, 'Beta unversioned');
  });

  test('summaries expose the revision clients echo back', async () => {
    const res = await httpRequest(baseUrl, 'GET', '/api/config/sessions/summaries');
    assert.equal(res.status, 200);
    assert.equal(res.json.revision, readSessionRevision());
  });
});
