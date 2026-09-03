/**
 * MIN-794 P0-3 — one shared read of config.json instead of 9–12 per chat switch.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  readConfigFile,
  readConfigFlag,
  resetConfigFileCacheForTests,
  writeConfigFile,
} from '../../src/config/config-file-cache.ts';

function installFetch(body: unknown): { gets: number; puts: number } {
  const counts = { gets: 0, puts: 0 };
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      counts.puts += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    counts.gets += 1;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return counts;
}

describe('config.json shared reader', () => {
  afterEach(() => {
    resetConfigFileCacheForTests();
    // @ts-expect-error test cleanup
    delete globalThis.fetch;
  });

  test('concurrent readers share one request', async () => {
    const counts = installFetch({ features: { memoryInjection: false } });

    const [a, b, c] = await Promise.all([
      readConfigFlag(['features', 'memoryInjection'], true),
      readConfigFlag(['features', 'memoryInjection'], true),
      readConfigFile(),
    ]);

    assert.equal(counts.gets, 1, 'the six-socket pool must not carry the same file 12 times');
    assert.equal(a, false);
    assert.equal(b, false);
    assert.ok(c);
  });

  test('a later read inside the TTL is served from cache', async () => {
    const counts = installFetch({ features: { memoryInjection: true } });

    await readConfigFile();
    await readConfigFile();

    assert.equal(counts.gets, 1);
  });

  test('fresh reads bypass the cache, and a write invalidates it', async () => {
    const counts = installFetch({ features: {} });

    await readConfigFile();
    await readConfigFile({ fresh: true });
    assert.equal(counts.gets, 2);

    await writeConfigFile({ features: { memoryInjection: false } });
    await readConfigFile();
    assert.equal(counts.puts, 1);
    assert.equal(counts.gets, 3, 'a write must not leave a stale value behind');
  });

  test('a failed read falls back without poisoning the cache', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response('nope', { status: 500 });
    }) as typeof fetch;

    assert.equal(await readConfigFlag(['features', 'memoryInjection'], true), true);
    assert.equal(await readConfigFlag(['features', 'memoryInjection'], true), true);
    assert.equal(calls, 2, 'nothing was cached, so the next read retries');
  });
});
