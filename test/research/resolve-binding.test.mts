import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { MODEL_SELECT_KEY_SEP } from '../../src/lib/model-select-key.ts';
import { resetResearchConfigCache } from '../../src/config/research-config.ts';
import { resolveResearchModelBinding } from '../../src/research/resolve-binding.ts';
import {
  createEmptyChatObject,
  getActiveChat,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';

function encodeModelSelectKey(providerId: string, modelId: string): string {
  return `${providerId}${MODEL_SELECT_KEY_SEP}${modelId}`;
}

function installDom(): void {
  document.body.innerHTML = `
    <select id="modelSelect">
      <option value="${encodeModelSelectKey('default-provider', 'default-model')}">Default</option>
      <option value="${encodeModelSelectKey('composer-provider', 'composer-model')}">Composer</option>
    </select>
  `;
  const sel = document.getElementById('modelSelect') as HTMLSelectElement;
  sel.value = encodeModelSelectKey('default-provider', 'default-model');
}

function seedActiveChat(providerId: string, modelId: string): void {
  const chat = createEmptyChatObject(modelId);
  chat.providerId = providerId;
  setSessionStateForTests({ chats: [chat], activeId: chat.id, groups: [] });
}

describe('resolveResearchModelBinding', () => {
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      HTMLElement: typeof HTMLElement;
      fetch: typeof fetch;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;

    originalFetch = globalThis.fetch;
    g.fetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/api/config/research')) {
        return {
          ok: true,
          json: async () => ({ model: { providerId: '', model: '' } }),
        } as Response;
      }
      return originalFetch(input);
    }) as typeof fetch;

    resetResearchConfigCache();
    installDom();
    seedActiveChat('composer-provider', 'composer-model');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetResearchConfigCache();
    setSessionStateForTests(null);
    document.body.innerHTML = '';
  });

  test('prefers active chat model over global default select value', async () => {
    const binding = await resolveResearchModelBinding();

    assert.equal(binding.providerId, 'composer-provider');
    assert.equal(binding.model, 'composer-model');
    assert.notEqual(getActiveChat().modelId, 'default-model');
  });

  test('uses Settings dedicated model when configured', async () => {
    globalThis.fetch = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/api/config/research')) {
        return {
          ok: true,
          json: async () => ({
            model: { providerId: 'settings-provider', model: 'settings-model' },
          }),
        } as Response;
      }
      return originalFetch(input);
    }) as typeof fetch;
    resetResearchConfigCache();

    const binding = await resolveResearchModelBinding();

    assert.equal(binding.providerId, 'settings-provider');
    assert.equal(binding.model, 'settings-model');
  });

  test('honors per-run UI overrides', async () => {
    const binding = await resolveResearchModelBinding({
      overrideProvider: 'override-provider',
      overrideModel: 'override-model',
    });

    assert.equal(binding.providerId, 'override-provider');
    assert.equal(binding.model, 'override-model');
  });
});
