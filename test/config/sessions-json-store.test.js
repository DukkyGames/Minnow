/**
 * JSON rollback store (`MINNOW_SESSIONS_STORE=json`) must honour the same
 * history-key contract as SQLite.
 *
 * `validateSessionState` rewrites every history-omitting wire chat to `history: []`,
 * so writing the validated blob straight to disk erased the transcript of every
 * chat a lazy boot had not hydrated.
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

const ALPHA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BETA = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const GHOST = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

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

function withoutHistory(chat) {
  const { history: _history, ...rest } = chat;
  void _history;
  return rest;
}

describe('sessions JSON store history contract', () => {
  let homeDir;
  let server;
  let baseUrl;
  let savedStore;

  before(async () => {
    savedStore = process.env.MINNOW_SESSIONS_STORE;
    process.env.MINNOW_SESSIONS_STORE = 'json';
    homeDir = setTestHome(process.env, `minnow-sessions-json-${Date.now()}`);
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
    const res = await httpRequest(
      baseUrl,
      'PUT',
      '/api/config/sessions',
      makeState([
        makeChat(ALPHA, 'Alpha', [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi' },
        ]),
        makeChat(BETA, 'Beta', [{ role: 'user', content: 'beta only' }]),
      ]),
    );
    assert.equal(res.status, 200);
  });

  test('a history-omitting PUT preserves stored messages', async () => {
    const res = await httpRequest(
      baseUrl,
      'PUT',
      '/api/config/sessions',
      makeState([withoutHistory(makeChat(ALPHA, 'Alpha renamed')), withoutHistory(makeChat(BETA, 'Beta'))]),
    );
    assert.equal(res.status, 200);

    const after = (await httpRequest(baseUrl, 'GET', '/api/config/sessions')).json;
    const alpha = after.chats.find((c) => c.id === ALPHA);
    assert.equal(alpha.name, 'Alpha renamed');
    assert.equal(alpha.history.length, 2);
    assert.equal(after.chats.find((c) => c.id === BETA).history.length, 1);
  });

  test('a PUT that omits a chat does not delete it', async () => {
    const res = await httpRequest(
      baseUrl,
      'PUT',
      '/api/config/sessions',
      makeState([makeChat(ALPHA, 'Alpha', [{ role: 'user', content: 'hello' }])]),
    );
    assert.equal(res.status, 200);

    const after = (await httpRequest(baseUrl, 'GET', '/api/config/sessions')).json;
    const beta = after.chats.find((c) => c.id === BETA);
    assert.ok(beta, 'chat missing from the payload must survive');
    assert.equal(beta.history.length, 1);
  });

  test('deleteChatIds still removes a chat', async () => {
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
  });

  test('an unknown chat with no history is not created empty', async () => {
    const res = await httpRequest(
      baseUrl,
      'PUT',
      '/api/config/sessions',
      makeState([
        makeChat(ALPHA, 'Alpha', [{ role: 'user', content: 'hello' }]),
        withoutHistory(makeChat(GHOST, 'Ghost')),
      ]),
    );
    assert.equal(res.status, 200);

    const after = (await httpRequest(baseUrl, 'GET', '/api/config/sessions')).json;
    assert.equal(
      after.chats.some((c) => c.id === GHOST),
      false,
      'a chat with no recoverable history must not be created blank',
    );
  });

  test('a chat that ships its history is created normally', async () => {
    const res = await httpRequest(
      baseUrl,
      'PUT',
      '/api/config/sessions',
      makeState([
        makeChat(ALPHA, 'Alpha', [{ role: 'user', content: 'hello' }]),
        makeChat(GHOST, 'Ghost', [{ role: 'user', content: 'brand new' }]),
      ]),
    );
    assert.equal(res.status, 200);

    const after = (await httpRequest(baseUrl, 'GET', '/api/config/sessions')).json;
    const ghost = after.chats.find((c) => c.id === GHOST);
    assert.ok(ghost);
    assert.equal(ghost.history.length, 1);
  });
});
