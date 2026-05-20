/**
 * Title schedule: races, duplicate guard, disabled config.
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  resetTitlesConfigCache,
  setTitlesConfigForTests,
} from '../../src/config/titles-meta.ts';
import {
  applyGeneratedChatTitle,
  sessionState,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import {
  resetTitleGenerationInflight,
  resetTitleScheduleContext,
  scheduleChatTitleGeneration,
  setGenerateChatTitleForTests,
} from '../../src/chat/titles/schedule.ts';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';

function setupDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  document.body.innerHTML = '<div id="chatList"></div>';
}

function seedSession(name = 'New chat') {
  setSessionStateForTests({
    version: 2,
    activeId: CHAT_ID,
    sidebarCollapsed: false,
    lastActiveChatIdByWorkspace: {},
    chats: [
      {
        id: CHAT_ID,
        name,
        workspacePath: '',
        modelId: 'test-model',
        history: [],
        lastStats: null,
        modelInfo: {},
        updatedAt: 1,
      },
    ],
  });
}

function getChat() {
  if (!sessionState?.chats[0]) throw new Error('test session not seeded');
  return sessionState.chats[0];
}

function waitMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('scheduleChatTitleGeneration', () => {
  beforeEach(() => {
    setupDom();
    seedSession();
    resetTitleGenerationInflight();
    resetTitleScheduleContext();
    resetTitlesConfigCache();
    setTitlesConfigForTests({
      enabled: true,
      modelId: '',
      providerId: '',
      maxTokens: 24,
      temperature: 0.3,
    });
    setGenerateChatTitleForTests(null);
  });

  test('updates placeholder name after job completes', async () => {
    setGenerateChatTitleForTests(async () => 'Generated title');

    scheduleChatTitleGeneration(CHAT_ID, 'Hello world');
    await waitMicrotasks();
    await waitMicrotasks();

    const chat = getChat();
    assert.equal(chat.name, 'Generated title');
  });

  test('does not overwrite user rename before apply', async () => {
    setGenerateChatTitleForTests(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve('Late title'), 20);
        }),
    );

    scheduleChatTitleGeneration(CHAT_ID, 'Hello');
    const chat = getChat();
    chat.name = 'My thread';
    await new Promise((r) => setTimeout(r, 40));

    assert.equal(chat.name, 'My thread');
  });

  test('duplicate schedule calls generate once', async () => {
    let calls = 0;
    setGenerateChatTitleForTests(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return 'Once';
    });

    scheduleChatTitleGeneration(CHAT_ID, 'a');
    scheduleChatTitleGeneration(CHAT_ID, 'b');
    await new Promise((r) => setTimeout(r, 30));

    assert.equal(calls, 1);
  });

  test('applies for New Chat casing variant', async () => {
    seedSession('New Chat');
    setGenerateChatTitleForTests(async () => 'Cased title');

    scheduleChatTitleGeneration(CHAT_ID, 'Hello');
    await waitMicrotasks();
    await waitMicrotasks();

    assert.equal(getChat().name, 'Cased title');
  });

  test('uses schedule context model and provider overrides', async () => {
    getChat().modelId = '';
    setGenerateChatTitleForTests(async (_seed, options) => {
      assert.equal(options.modelId, 'context-model');
      assert.equal(options.providerId, 'context-provider');
      return 'Context title';
    });

    scheduleChatTitleGeneration(CHAT_ID, 'Hello', {
      modelId: 'context-model',
      providerId: 'context-provider',
    });
    await waitMicrotasks();
    await waitMicrotasks();

    assert.equal(getChat().name, 'Context title');
  });

  test('disabled config skips generation', async () => {
    let calls = 0;
    setGenerateChatTitleForTests(async () => {
      calls += 1;
      return 'Nope';
    });
    setTitlesConfigForTests({
      enabled: false,
      modelId: '',
      providerId: '',
      maxTokens: 24,
      temperature: 0.3,
    });

    scheduleChatTitleGeneration(CHAT_ID, 'Hello');
    await waitMicrotasks();
    await waitMicrotasks();

    assert.equal(calls, 0);
    const chat = getChat();
    assert.equal(chat.name, 'New chat');
  });
});

describe('applyGeneratedChatTitle', () => {
  beforeEach(() => {
    seedSession();
  });

  test('applies only for placeholder name', async () => {
    assert.equal(applyGeneratedChatTitle(CHAT_ID, 'Fresh title'), true);
    const chat = getChat();
    assert.equal(chat.name, 'Fresh title');
    assert.equal(applyGeneratedChatTitle(CHAT_ID, 'Another'), false);
  });
});
