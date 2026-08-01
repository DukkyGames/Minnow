/**
 * Code map injection tri-state + global default resolution.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  fetchCodeMapInjectionDefault,
  resolveCodeMapInjectionEnabled,
  resolveCodeMapInjectionTriState,
  saveCodeMapInjectionDefault,
} from '../../../src/brain/code-injection-config.ts';
import type { Chat } from '../../../src/types.ts';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';

function baseChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: CHAT_ID,
    name: 'Test',
    modelId: 'm',
    history: [],
    updatedAt: 1,
    workspacePath: 'C:/repo',
    ...overrides,
  };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('resolveCodeMapInjectionEnabled', () => {
  it('inherit follows global default off', () => {
    const chat = baseChat();
    assert.equal(resolveCodeMapInjectionEnabled(chat, false), false);
  });

  it('inherit follows global default on', () => {
    const chat = baseChat();
    assert.equal(resolveCodeMapInjectionEnabled(chat, true), true);
  });

  it('chat on overrides global off', () => {
    const chat = baseChat({ codeMapInjection: 'on' });
    assert.equal(resolveCodeMapInjectionEnabled(chat, false), true);
  });

  it('chat off overrides global on', () => {
    const chat = baseChat({ codeMapInjection: 'off' });
    assert.equal(resolveCodeMapInjectionEnabled(chat, true), false);
  });
});

describe('resolveCodeMapInjectionTriState', () => {
  it('defaults to inherit', () => {
    assert.equal(resolveCodeMapInjectionTriState(baseChat()), 'inherit');
  });

  it('normalizes invalid values to inherit', () => {
    const chat = baseChat({ codeMapInjection: 'bogus' as 'on' });
    assert.equal(resolveCodeMapInjectionTriState(chat), 'inherit');
  });
});

describe('fetchCodeMapInjectionDefault', () => {
  it('returns false when unset', async () => {
    globalThis.fetch = async () =>
      ({
        ok: true,
        json: async () => ({ features: {} }),
      }) as Response;
    assert.equal(await fetchCodeMapInjectionDefault(), false);
  });

  it('reads features.codeMapInjectionDefault', async () => {
    globalThis.fetch = async () =>
      ({
        ok: true,
        json: async () => ({ features: { codeMapInjectionDefault: true } }),
      }) as Response;
    assert.equal(await fetchCodeMapInjectionDefault(), true);
  });
});

describe('saveCodeMapInjectionDefault', () => {
  it('PUTs updated features flag', async () => {
    let putBody = '';
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('config.json') && (!init || init.method === 'GET')) {
        return {
          ok: true,
          json: async () => ({ features: { memoryInjection: true } }),
        } as Response;
      }
      if (init?.method === 'PUT') {
        putBody = String(init.body);
        return { ok: true, json: async () => ({}) } as Response;
      }
      return { ok: false } as Response;
    };
    const ok = await saveCodeMapInjectionDefault(true);
    assert.equal(ok, true);
    const parsed = JSON.parse(putBody) as {
      features?: { codeMapInjectionDefault?: boolean };
    };
    assert.equal(parsed.features?.codeMapInjectionDefault, true);
  });
});
