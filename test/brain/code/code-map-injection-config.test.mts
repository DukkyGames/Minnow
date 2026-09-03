/**
 * Code map injection tri-state + global default resolution.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  chatUsesDesktopSandboxWorkspace,
  fetchCodeMapInjectionDefault,
  resolveCodeMapInjectionEnabled,
  resolveCodeMapInjectionTriState,
  saveCodeMapInjectionDefault,
  shouldInjectCodeMap,
} from '../../../src/brain/code-injection-config.ts';
import { resetConfigFileCacheForTests } from '../../../src/config/config-file-cache.ts';
import { resetDesktopWorkspacePathCache } from '../../../src/lib/desktop-workspace.ts';
import { setLocalServerAvailableForTests } from '../../../src/tools/config.ts';
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
  // config.json is read through a shared cache now; it must not leak across cases.
  resetConfigFileCacheForTests();
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
      if (url.includes('config.json') && (!init?.method || init.method === 'GET')) {
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

describe('shouldInjectCodeMap', () => {
  it('returns false for desktop sandbox workspace chats', async () => {
    resetDesktopWorkspacePathCache();
    setLocalServerAvailableForTests(true);
    const desktopPath = 'C:/Users/me/.minnow/workspace';
    const chat = baseChat({
      workspacePath: desktopPath,
      codeMapInjection: 'on',
    });

    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('/api/desktop-workspace')) {
        return {
          ok: true,
          json: async () => ({ path: desktopPath, fileCount: 0 }),
        } as Response;
      }
      if (url.includes('/api/config/file')) {
        return {
          ok: true,
          json: async () => ({ features: { codeMapInjectionDefault: true } }),
        } as Response;
      }
      if (url.includes('/api/brain/code/config')) {
        return {
          ok: true,
          json: async () => ({ enabled: true, repoMapTokenBudget: 8000 }),
        } as Response;
      }
      return { ok: false } as Response;
    };

    assert.equal(await shouldInjectCodeMap(chat), false);
    assert.equal(await chatUsesDesktopSandboxWorkspace(chat), true);
    setLocalServerAvailableForTests(false);
    resetDesktopWorkspacePathCache();
  });
});
