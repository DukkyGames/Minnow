import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import {
  initBuiltinExpertRegistry,
  registerExpertFilesFromRaw,
  resetExpertRegistry,
} from '../../../src/chat/experts/registry.ts';

describe('deleteUserExpert', () => {
  beforeEach(() => {
    resetExpertRegistry();
    initBuiltinExpertRegistry({});
    registerExpertFilesFromRaw(
      {
        './experts/my-coach/expert.full.md': `---
id: my-coach
kind: expert
label: My Coach
version: 1
---
[[EXPERT:my-coach]]
Coach`,
        './experts/my-coach/expert.lite.md': `---
id: my-coach
kind: expert
label: My Coach
version: 1
---
Lite`,
      },
      'user',
    );
  });

  afterEach(() => {
    mock.restoreAll();
    resetExpertRegistry();
  });

  test('calls DELETE entity endpoint and clears registry', async () => {
    const calls = [];
    mock.method(globalThis, 'fetch', async (url, init) => {
      calls.push({ url: String(url), method: init?.method });
      if (String(url).includes('/api/prompts/registry')) {
        return { ok: true, async json() { return { prompts: [] }; } };
      }
      if (init?.method === 'DELETE' && String(url).includes('/prompt?')) {
        return { ok: true, async json() { return { content: '', source: 'builtin' }; } };
      }
      if (init?.method === 'DELETE' && String(url).endsWith('/experts/my-coach')) {
        return { ok: true, async json() { return { ok: true }; } };
      }
      return { ok: false };
    });

    const { deleteUserExpert } = await import('../../../src/chat/experts/expert-user-ops.ts');
    await deleteUserExpert('my-coach');

    assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.includes('my-coach')));
    assert.equal(
      (await import('../../../src/chat/experts/registry.ts')).getExpert('my-coach'),
      null,
    );
  });
});
