/**
 * Header reasoning effort select: visibility, options, and chat sync.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');

const { setSessionStateForTests, createEmptyChatObject, flushScheduledSessionSaveForTests } =
  await import('../../src/state/sessions.ts');
const { modelCache } = await import('../../src/app-state.ts');
const { encodeModelSelectKey } = await import('../../src/lib/model-select-key.ts');
const {
  initHeaderReasoningEffort,
  syncHeaderReasoningEffortFromActiveChat,
} = await import('../../src/ui/header-reasoning-effort.ts');

function setupDom(): Window {
  const win = new Window();
  globalThis.document = win.document as unknown as Document;
  globalThis.window = win as unknown as Window & typeof globalThis.window;
  globalThis.HTMLElement = win.HTMLElement;
  globalThis.Node = win.Node;
  globalThis.Event = win.Event as typeof Event;

  document.body.innerHTML = `
    <div id="reasoningEffortWrap" class="reasoning-effort-wrap hidden">
      <select id="reasoningEffortSelect" disabled></select>
    </div>
    <div id="osReasoningEffortWrap" class="mn-os-mb-reasoning-effort-wrap hidden">
      <select id="osReasoningEffortSelect" disabled></select>
    </div>
    <div id="composerThinkingWrap"></div>
  `;
  return win;
}

function teardownDom(): void {
  flushScheduledSessionSaveForTests();
  modelCache.clear();
  setSessionStateForTests(null);
}

function seedChat(overrides: Record<string, unknown> = {}) {
  const chat = createEmptyChatObject('gpt-5-preview');
  chat.id = 'chat-reasoning-1';
  chat.providerId = 'openai';
  chat.modelId = 'gpt-5-preview';
  Object.assign(chat, overrides);
  setSessionStateForTests({
    version: 2,
    activeId: chat.id,
    sidebarCollapsed: false,
    chats: [chat],
  });
  return chat;
}

describe('header reasoning effort HTML', () => {
  test('index.html defines top-bar reasoning effort wrap and select', () => {
    assert.match(indexHtml, /id="reasoningEffortWrap"/);
    assert.match(indexHtml, /id="reasoningEffortSelect"/);
    assert.match(indexHtml, /reasoning-effort-wrap/);
  });
});

describe('syncHeaderReasoningEffortFromActiveChat', () => {
  afterEach(() => {
    teardownDom();
  });

  test('hides wrappers when model has fewer than two reasoning options', () => {
    setupDom();
    const chat = seedChat({ providerId: 'lmstudio', modelId: 'local/small' });

    modelCache.set(encodeModelSelectKey('lmstudio', 'local/small'), {
      id: 'local/small',
      capabilities: {
        vision: false,
        tools: null,
        streaming: null,
        grammar: null,
        reasoning: true,
        reasoningAllowedOptions: ['medium'],
        contextLength: null,
        loadState: null,
      },
    });

    initHeaderReasoningEffort();
    syncHeaderReasoningEffortFromActiveChat();

    const topWrap = document.getElementById('reasoningEffortWrap');
    const osWrap = document.getElementById('osReasoningEffortWrap');
    assert.ok(topWrap?.classList.contains('hidden'));
    assert.ok(osWrap?.classList.contains('hidden'));
  });

  test('shows wrappers and syncs chat.reasoningEffort on change when 2+ options', () => {
    const win = setupDom();
    const chat = seedChat();

    modelCache.set(encodeModelSelectKey('openai', 'gpt-5-preview'), {
      id: 'gpt-5-preview',
      capabilities: {
        vision: false,
        tools: null,
        streaming: null,
        grammar: null,
        reasoning: true,
        reasoningAllowedOptions: ['low', 'medium', 'high'],
        reasoningDefault: 'medium',
        contextLength: null,
        loadState: null,
      },
    });

    initHeaderReasoningEffort();
    syncHeaderReasoningEffortFromActiveChat();

    const topWrap = document.getElementById('reasoningEffortWrap');
    const topSelect = document.getElementById('reasoningEffortSelect') as HTMLSelectElement;
    const osSelect = document.getElementById('osReasoningEffortSelect') as HTMLSelectElement;

    assert.ok(!topWrap?.classList.contains('hidden'));
    assert.equal(topSelect.options.length, 3);
    assert.equal(topSelect.value, 'medium');

    topSelect.value = 'high';
    topSelect.dispatchEvent(new win.Event('change', { bubbles: true }));

    assert.equal(chat.reasoningEffort, 'high');
    assert.equal(osSelect.value, 'high');
  });
});
