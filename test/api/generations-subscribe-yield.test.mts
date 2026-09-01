/**
 * MIN-729: one `read()` of many SSE `\n\n` blocks must yield so the event loop
 * can run. Events are not dropped.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  SSE_BLOCKS_PER_YIELD,
  subscribeToGenerationRaw,
} from '../../src/api/generations.ts';

const originalFetch = globalThis.fetch;
const originalScheduler = (globalThis as { scheduler?: unknown }).scheduler;

afterEach(() => {
  globalThis.fetch = originalFetch;
  const g = globalThis as { scheduler?: unknown };
  if (originalScheduler === undefined) {
    delete g.scheduler;
  } else {
    g.scheduler = originalScheduler;
  }
});

function sseBlock(n: number): string {
  return `data: {"n":${n}}\n\n`;
}

function mockStreamFetch(chunks: Uint8Array[]): void {
  globalThis.fetch = (async () => {
    let index = 0;
    const reader = {
      read: async () => {
        if (index >= chunks.length) return { done: true as const, value: undefined };
        const value = chunks[index];
        index += 1;
        return { done: false as const, value };
      },
    };
    return {
      ok: true,
      status: 200,
      body: { getReader: () => reader },
    } as unknown as Response;
  }) as typeof fetch;
}

async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 2000) {
      throw new Error(`timed out waiting for ${label}`);
    }
    await Promise.resolve();
  }
}

describe('SSE subscribe yield (MIN-729)', () => {
  test('a single read of many blocks yields mid-burst then delivers every event', async () => {
    const total = SSE_BLOCKS_PER_YIELD * 2 + 3;
    const payload = Array.from({ length: total }, (_, i) => sseBlock(i)).join('');
    mockStreamFetch([new TextEncoder().encode(payload)]);

    const yieldWaiters: Array<() => void> = [];
    (globalThis as { scheduler?: { yield: () => Promise<void> } }).scheduler = {
      yield: () =>
        new Promise<void>((resolve) => {
          yieldWaiters.push(resolve);
        }),
    };

    const received: string[] = [];
    let ended = false;
    subscribeToGenerationRaw('gen-yield', {
      onChunk: (text) => {
        received.push(text);
      },
      onEnd: () => {
        ended = true;
      },
    });

    await waitUntil(() => yieldWaiters.length === 1, 'first SSE yield');
    assert.equal(received.length, SSE_BLOCKS_PER_YIELD);

    yieldWaiters.shift()?.();
    await waitUntil(() => yieldWaiters.length === 1, 'second SSE yield');
    assert.equal(received.length, SSE_BLOCKS_PER_YIELD * 2);

    yieldWaiters.shift()?.();
    await waitUntil(() => ended, 'stream end');
    assert.equal(received.length, total, 'every SSE block is delivered');
    assert.ok(received.every((block) => block.endsWith('\n\n')));
  });
});
