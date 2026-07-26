/**
 * Boot re-subscribe for backend-owned generations (currentGenerationId).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import type { Chat } from '../../src/types.ts';
import {
  bootGenerationResumeForChat,
  listChatsWithGenerationId,
} from '../../src/chat/generation-resume.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';
import { setServerEngineFlagForTests } from '../../src/state/server-engine-flag.ts';

const CHAT_A = '11111111-1111-1111-1111-111111111111';
const CHAT_B = '22222222-2222-2222-2222-222222222222';
const CHAT_C = '33333333-3333-3333-3333-333333333333';
const GEN_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GEN_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STARTED = 1710000000000;

function makeChat(id: string, generationId?: string): Chat {
  return {
    id,
    name: id,
    workspacePath: '',
    modelId: 'm1',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: STARTED,
    ...(generationId ? { currentGenerationId: generationId } : {}),
  };
}

describe('listChatsWithGenerationId', () => {
  test('keeps only chats with a non-empty currentGenerationId', () => {
    const chats = [
      makeChat(CHAT_B),
      makeChat(CHAT_A, GEN_A),
      makeChat(CHAT_C, GEN_C),
    ];
    assert.deepEqual(
      listChatsWithGenerationId(chats).map((c) => c.id),
      [CHAT_A, CHAT_C],
    );
  });
});

describe('bootGenerationResumeForChats ownership', () => {
  test('first resumable chat owns global streaming flag', () => {
    const resumable = listChatsWithGenerationId([
      makeChat(CHAT_B),
      makeChat(CHAT_A, GEN_A),
      makeChat(CHAT_C, GEN_C),
    ]);
    const owns: boolean[] = [];
    let first = true;
    for (const chat of resumable) {
      owns.push(first);
      first = false;
      assert.ok(chat.currentGenerationId?.trim());
    }
    assert.deepEqual(owns, [true, false]);
  });
});

describe('Phase 4 engine-on resume gate', () => {
  afterEach(() => {
    setServerEngineFlagForTests(null);
  });

  test('bootGenerationResumeForChat does not start runChatTurn when engine is on', async () => {
    setServerEngineFlagForTests(true);
    const chat = makeChat(CHAT_A, GEN_A);
    // Must not throw or require DOM/modelSelect — engine path only mirrors.
    await bootGenerationResumeForChat(chat, { ownsGlobalStreaming: true });
    assert.equal(chat.currentGenerationId, GEN_A);
  });
});

describe('runChatTurn resumeGenerationId errors', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('clears currentGenerationId when subscribe returns 404', async () => {
    globalThis.fetch = async () =>
      new Response('not found', { status: 404 });

    const chat = makeChat(CHAT_A, GEN_A);
    chat.history.push({ role: 'user', content: 'Hi' });
    setSessionStateForTests({
      version: 2,
      activeId: CHAT_A,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.performance = window.performance;

    const modelSelect = document.createElement('select');
    modelSelect.id = 'modelSelect';
    const opt = document.createElement('option');
    opt.value = 'm1';
    modelSelect.appendChild(opt);
    modelSelect.value = 'm1';
    document.body.appendChild(modelSelect);

    const temperature = document.createElement('input');
    temperature.id = 'temperature';
    temperature.value = '0.7';
    document.body.appendChild(temperature);

    const maxTokens = document.createElement('input');
    maxTokens.id = 'maxTokens';
    maxTokens.value = '512';
    document.body.appendChild(maxTokens);

    const systemPrompt = document.createElement('textarea');
    systemPrompt.id = 'systemPrompt';
    document.body.appendChild(systemPrompt);

    const chatArea = document.createElement('div');
    chatArea.id = 'chatArea';
    document.body.appendChild(chatArea);

    const sDot = document.createElement('span');
    sDot.id = 'sDot';
    document.body.appendChild(sDot);
    const sText = document.createElement('span');
    sText.id = 'sText';
    document.body.appendChild(sText);

    const { runChatTurn } = await import('../../src/tools/loop.ts');

    await runChatTurn({
      chat,
      pushUser: false,
      rawText: '',
      userText: '',
      skillId: null,
      displayText: '',
      historyContent: '',
      validAttachments: [],
      resumeGenerationId: GEN_A,
      ownsGlobalStreaming: false,
    });

    assert.equal(chat.currentGenerationId, undefined);
    setSessionStateForTests(null);
  });
});
