/**
 * ensureVoiceWorker — readiness helper and start-on-demand polling.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  ensureVoiceWorker,
  isVoiceWorkerReady,
  type VoiceRuntimeStatus,
} from '../../src/voice/api-client.ts';

function baseStatus(
  patch: Partial<VoiceRuntimeStatus> = {},
): VoiceRuntimeStatus {
  return {
    installed: true,
    running: false,
    health: 'stopped',
    cudaAvailable: false,
    torchVariant: 'cpu',
    port: null,
    installedAt: null,
    installedPackages: [],
    skippedPackages: [],
    installJob: null,
    worker: { ok: false, status: 'stopped' },
    ...patch,
  };
}

describe('isVoiceWorkerReady', () => {
  test('returns true only when installed, running, and ready', () => {
    assert.equal(
      isVoiceWorkerReady(
        baseStatus({ running: true, health: 'ready' }),
      ),
      true,
    );
    assert.equal(isVoiceWorkerReady(baseStatus({ running: true })), false);
    assert.equal(
      isVoiceWorkerReady(baseStatus({ health: 'ready' })),
      false,
    );
    assert.equal(
      isVoiceWorkerReady(baseStatus({ installed: false, health: 'ready' })),
      false,
    );
  });
});

describe('ensureVoiceWorker', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns immediately when worker is already ready', async () => {
    const ready = baseStatus({ running: true, health: 'ready', port: 8765 });
    globalThis.fetch = async () =>
      new Response(JSON.stringify(ready), { status: 200 });

    const result = await ensureVoiceWorker({ timeoutMs: 1_000 });
    assert.equal(result.health, 'ready');
  });

  test('starts worker and polls until ready', async () => {
    const stopped = baseStatus();
    const ready = baseStatus({ running: true, health: 'ready', port: 8765 });
    let statusCalls = 0;
    let startCalled = false;

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/voice/runtime/start') && init?.method === 'POST') {
        startCalled = true;
        return new Response(JSON.stringify({ ok: true, port: 8765 }), {
          status: 200,
        });
      }
      if (url.endsWith('/api/voice/runtime/status')) {
        statusCalls += 1;
        const body = statusCalls < 2 ? stopped : ready;
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    };

    const result = await ensureVoiceWorker({
      timeoutMs: 5_000,
      pollIntervalMs: 10,
    });
    assert.equal(startCalled, true);
    assert.equal(result.health, 'ready');
  });

  test('throws when runtime is not installed', async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify(baseStatus({ installed: false })), {
        status: 200,
      });

    await assert.rejects(
      () => ensureVoiceWorker({ timeoutMs: 500 }),
      /not installed/i,
    );
  });
});
