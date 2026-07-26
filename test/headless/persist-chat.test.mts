/**
 * Phase B.0: headless persistHeadlessChat uses PATCH so a UI-added chat is not
 * clobbered (the old GET-splice-PUT lost-update class).
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { closeSessionsDb } from '../../server/config/sessions-db.js';
import { persistHeadlessChat } from '../../src/headless/persist-chat.ts';
import {
  installHeadlessFetch,
  installHeadlessLocalStorage,
} from '../../src/headless/server-context.ts';
import {
  createConfigTestServer,
  httpRequest,
  rmTestHome,
  setTestHome,
} from '../config/test-helpers.js';

/** Minimal chat for seeding / concurrent UI write. */
function makeChat(id: string, name: string, content: string) {
  return {
    id,
    name,
    workspacePath: '',
    modelId: 'test-model',
    modeId: 'build' as const,
    history: [{ role: 'user' as const, content }],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1_700_000_000_000,
    lastMessageAt: 1_700_000_000_000,
  };
}

describe('headless persistHeadlessChat PATCH', () => {
  let homeDir: string;
  let server: ReturnType<typeof createConfigTestServer>;
  let baseUrl = '';
  let restoreFetch: (() => void) | null = null;
  let savedStore: string | undefined;

  before(async () => {
    savedStore = process.env.MINNOW_SESSIONS_STORE;
    delete process.env.MINNOW_SESSIONS_STORE;
    homeDir = setTestHome(process.env, `minnow-persist-chat-${Date.now()}`);
    installHeadlessLocalStorage();

    server = createConfigTestServer();
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    restoreFetch = installHeadlessFetch(baseUrl);
  });

  after(async () => {
    restoreFetch?.();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    closeSessionsDb();
    if (savedStore === undefined) delete process.env.MINNOW_SESSIONS_STORE;
    else process.env.MINNOW_SESSIONS_STORE = savedStore;
    await rmTestHome(homeDir);
  });

  it('PATCH upsert leaves a concurrently UI-added chat intact', async () => {
    const alpha = makeChat(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'Alpha',
      'alpha',
    );
    const seed = {
      version: 6,
      activeId: alpha.id,
      sidebarCollapsed: false,
      lastActiveChatIdByWorkspace: {},
      lastActiveChatIdByApp: {},
      groups: [],
      chats: [alpha],
    };
    const put = await httpRequest(baseUrl, 'PUT', '/api/config/sessions', seed);
    assert.equal(put.status, 200);

    // UI adds Beta (would be lost if headless still did GET-splice-PUT of a stale snapshot).
    const beta = makeChat(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'Beta UI',
      'from-ui',
    );
    const uiPatch = await httpRequest(baseUrl, 'PATCH', '/api/config/sessions', {
      baseVersion: 6,
      chats: [beta],
    });
    assert.equal(uiPatch.status, 200);

    // Headless persists Gamma with no whole-blob read — must not wipe Beta.
    const fetchCalls: { method: string; url: string }[] = [];
    const nativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      fetchCalls.push({ method: (init?.method ?? 'GET').toUpperCase(), url });
      return nativeFetch(input, init);
    }) as typeof fetch;

    try {
      await persistHeadlessChat({
        chatId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        chatName: 'Scheduled Gamma',
        workspacePath: 'C:/demo',
        modeId: 'build',
        providerId: 'lmstudio',
        modelId: 'test-model',
        history: [
          { role: 'user', content: 'run me' },
          { role: 'assistant', content: 'done' },
        ],
      });
    } finally {
      globalThis.fetch = nativeFetch;
    }

    assert.ok(
      fetchCalls.some(
        (c) => c.method === 'PATCH' && c.url.includes('/api/config/sessions'),
      ),
      'persistHeadlessChat must PATCH /api/config/sessions',
    );
    assert.equal(
      fetchCalls.some(
        (c) => c.method === 'GET' && c.url.includes('/api/config/sessions'),
      ),
      false,
      'persistHeadlessChat must not GET the whole sessions blob',
    );

    const got = await httpRequest(baseUrl, 'GET', '/api/config/sessions');
    assert.equal(got.status, 200);
    const ids = got.json.chats.map((c: { id: string }) => c.id).sort();
    assert.deepEqual(ids, [
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
    ]);
    const gamma = got.json.chats.find(
      (c: { id: string }) => c.id === 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    );
    assert.equal(gamma.name, 'Scheduled Gamma');
    assert.equal(gamma.history.length, 2);
    const betaSurvived = got.json.chats.find(
      (c: { id: string }) => c.id === 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    );
    assert.equal(betaSurvived.name, 'Beta UI');
  });
});
