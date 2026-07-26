/**
 * Config meta loaders mirror server reads to localStorage — Node needs both shims.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import {
  bootstrapHeadlessNodeRuntime,
  installHeadlessFetch,
} from '../../src/headless/server-context.ts';
import {
  loadToolCallsMeta,
  resetToolCallsMetaCache,
} from '../../src/config/tool-calls-meta.ts';
import { getStorageMode, setStorageModeForTests } from '../../src/config/storage-mode.ts';

describe('headless tool-calls meta (Node)', () => {
  let server: Server | null = null;
  let baseUrl = '';
  let restoreFetch: (() => void) | null = null;
  let previousStorageMode: ReturnType<typeof getStorageMode> = 'localStorage';

  beforeEach(async () => {
    previousStorageMode = getStorageMode();
    setStorageModeForTests('localStorage');
    resetToolCallsMetaCache();

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', baseUrl);
      if (url.pathname === '/api/config/ping' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (url.pathname === '/api/config/meta' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ toolCalls: { useConstrainedDecoding: true } }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind test server');
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    restoreFetch?.();
    restoreFetch = null;
    resetToolCallsMetaCache();
    setStorageModeForTests(previousStorageMode);
    if (server && typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((err) => (err ? reject(err) : resolve()));
      server = null;
    });
  });

  it('loadToolCallsMeta fails in Node when fetch is patched but localStorage is missing', async () => {
    restoreFetch = installHeadlessFetch(baseUrl);
    await assert.rejects(
      () => loadToolCallsMeta(),
      /localStorage is not defined/,
    );
  });

  it('loadToolCallsMeta succeeds after bootstrapHeadlessNodeRuntime', async () => {
    await bootstrapHeadlessNodeRuntime(baseUrl);
    assert.equal(getStorageMode(), 'server');

    const meta = await loadToolCallsMeta();
    assert.equal(meta.useConstrainedDecoding, true);
  });
});
