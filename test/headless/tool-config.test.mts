/**
 * Headless tool catalog must wait for ~/.minnow tools.json — not sync defaults.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import {
  ensureToolConfigReady,
  invalidateToolConfigCache,
  setToolConfigForTests,
} from '../../src/tools/config.ts';
import { getHeadlessToolDefinitions } from '../../src/headless/execute-tool.ts';
import {
  installHeadlessFetch,
  installHeadlessLocalStorage,
} from '../../src/headless/server-context.ts';
import { detectConfigServer, getStorageMode, setStorageModeForTests } from '../../src/config/storage-mode.ts';

describe('headless tool config', () => {
  let server: Server | null = null;
  let baseUrl = '';
  let restoreFetch: (() => void) | null = null;
  let previousStorageMode: ReturnType<typeof getStorageMode> = 'localStorage';

  beforeEach(async () => {
    previousStorageMode = getStorageMode();
    setStorageModeForTests('localStorage');
    invalidateToolConfigCache();
    installHeadlessLocalStorage();

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', baseUrl);
      if (url.pathname === '/api/config/ping' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (url.pathname === '/api/config/tools' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            enabled: { read_file: true },
            permissions: {
              default: { read_file: 'full' },
            },
            keys: { braveApiKey: '', tavilyApiKey: '' },
            webSearchProvider: 'duckduckgo',
            toolCache: { enabled: true },
          }),
        );
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
    restoreFetch = installHeadlessFetch(baseUrl);
  });

  afterEach(async () => {
    restoreFetch?.();
    restoreFetch = null;
    invalidateToolConfigCache();
    setStorageModeForTests(previousStorageMode);
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((err) => (err ? reject(err) : resolve()));
      server = null;
    });
  });

  it('getHeadlessToolDefinitions includes server tools after ensureToolConfigReady', async () => {
    await detectConfigServer();
    assert.equal(getStorageMode(), 'server');

    await ensureToolConfigReady();

    const defs = getHeadlessToolDefinitions('build');
    const names = defs.map((d) => d.function.name);
    assert.ok(names.includes('read_file'), `expected read_file in ${names.join(', ')}`);
  });

  it('sync loadToolConfig alone omits tools not in default seed', () => {
    setToolConfigForTests({
      enabled: { read_file: true },
      permissions: {
        default: { read_file: 'full' },
      },
      keys: { braveApiKey: '', tavilyApiKey: '' },
      webSearchProvider: 'duckduckgo',
      toolCache: { enabled: true },
    });

    const defs = getHeadlessToolDefinitions('build');
    const names = defs.map((d) => d.function.name);
    assert.ok(names.includes('read_file'));
  });
});
