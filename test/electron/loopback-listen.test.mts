/**
 * Packaged in-process server prefers a stable loopback port.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, test } from 'node:test';
import { listenOnPreferredLoopback } from '../../electron/loopback-listen.ts';

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

describe('listenOnPreferredLoopback', () => {
  test('binds the preferred port when it is free', async () => {
    const scout = http.createServer();
    await new Promise<void>((resolve, reject) => {
      scout.once('error', reject);
      scout.listen(0, '127.0.0.1', () => resolve());
    });
    const preferred = (scout.address() as { port: number }).port;
    await closeServer(scout);

    const server = http.createServer();
    try {
      const bound = await listenOnPreferredLoopback(server, preferred);
      assert.equal(bound.port, preferred);
      assert.equal(bound.ephemeral, false);
    } finally {
      await closeServer(server);
    }
  });

  test('falls back to an ephemeral port when the preferred port is busy', async () => {
    const blocker = http.createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(0, '127.0.0.1', () => resolve());
    });
    const preferred = (blocker.address() as { port: number }).port;

    const server = http.createServer();
    try {
      const bound = await listenOnPreferredLoopback(server, preferred);
      assert.equal(bound.ephemeral, true);
      assert.notEqual(bound.port, preferred);
    } finally {
      await closeServer(server);
      await closeServer(blocker);
    }
  });
});
