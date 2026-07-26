/**
 * Engine stream mirror: mid-turn reload / history paint must keep
 * Generating response… / Thinking… and replayed tokens.
 *
 * Run with --experimental-test-module-mocks (see test/run-all.mjs).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import { Window } from 'happy-dom';
import type { ChatCompletionChunk } from '../../src/types.ts';

type ChunkHandler = (chunk: ChatCompletionChunk) => void;
type EndHandler = () => void;

let chunkHandler: ChunkHandler | null = null;
let endHandler: EndHandler | null = null;
let lastGenerationId = '';

mock.module('../../src/api/generations.ts', {
  namedExports: {
    subscribeToGeneration(
      generationId: string,
      options: { onChunk: ChunkHandler; onEnd?: EndHandler; onTransportError?: (e: unknown) => void },
    ) {
      lastGenerationId = generationId;
      chunkHandler = options.onChunk;
      endHandler = options.onEnd ?? null;
      return () => {
        chunkHandler = null;
        endHandler = null;
      };
    },
    subscribeToGenerationRaw() {
      return () => {};
    },
    async createGeneration() {
      return { generationId: 'mock-generation' };
    },
    async cancelGeneration() {},
    formatGenerationErrorMessage(message: string) {
      return message?.trim() || 'Unknown error';
    },
    isGenerationTimeoutError() {
      return false;
    },
    GenerationNotFoundError: class GenerationNotFoundError extends Error {
      constructor() {
        super('Generation not found');
        this.name = 'GenerationNotFoundError';
      }
    },
    GENERATION_LOST_ON_RESTART_MESSAGE: 'This reply was lost when the server restarted.',
  },
});

const appState = await import('../../src/app-state.ts');
const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts'
);
const { setServerEngineFlagForTests } = await import('../../src/state/server-engine-flag.ts');
const {
  syncEngineStreamMirrors,
  resetEngineStreamMirrorForTests,
  hasEngineStreamMirror,
} = await import('../../src/chat/engine-stream-mirror.ts');
const { remountStreamDomForChat } = await import('../../src/tools/stream-chat-dom.ts');
const { renderChatFromHistory } = await import('../../src/ui/messages.ts');
const { STREAM_LABEL_GENERATING, STREAM_LABEL_THINKING } = await import(
  '../../src/ui/stream-status.ts'
);

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const GEN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let activeWindow: InstanceType<typeof Window> | null = null;

function setupDom(): void {
  activeWindow?.close();
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;

  const area = document.createElement('div');
  area.id = 'chatArea';
  document.body.appendChild(area);

  for (const id of ['modelSelect', 'sendBtn', 'msgInput', 'sDot', 'sText']) {
    const el =
      id === 'modelSelect'
        ? document.createElement('select')
        : id === 'msgInput'
          ? document.createElement('textarea')
          : document.createElement(id === 'sendBtn' ? 'button' : 'span');
    el.id = id;
    document.body.appendChild(el);
  }

  const inputBar = document.createElement('div');
  inputBar.className = 'input-bar-composer';
  document.body.appendChild(inputBar);

  for (const id of [
    'stripTPS',
    'stripTTFT',
    'stripGen',
    'stripTotal',
    'barPrompt',
    'barCompletion',
    'cntPrompt',
    'cntCompletion',
    'iArch',
    'iQuant',
    'iCtx',
    'iStop',
    'statsExpandPreview',
  ]) {
    const el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }

  activeWindow = window;
}

function makeEngineChat() {
  const chat = createEmptyChatObject('');
  chat.id = CHAT_ID;
  chat.name = 'Engine mid-turn';
  chat.history.push({ role: 'user', content: 'hi' });
  chat.currentGenerationId = GEN_ID;
  chat.engineTurnActive = true;
  return chat;
}

function emitReasoning(text: string): void {
  assert.ok(chunkHandler);
  chunkHandler!({
    choices: [{ delta: { reasoning: text } }],
  } as ChatCompletionChunk);
}

function emitContent(text: string): void {
  assert.ok(chunkHandler);
  chunkHandler!({
    choices: [{ delta: { content: text } }],
  } as ChatCompletionChunk);
}

describe('engine-stream-mirror mid-turn reload', { concurrency: false }, () => {
  afterEach(() => {
    resetEngineStreamMirrorForTests();
    setServerEngineFlagForTests(null);
    setSessionStateForTests(null);
    appState.setStreaming(false);
    chunkHandler = null;
    endHandler = null;
    lastGenerationId = '';
    activeWindow?.close();
    activeWindow = null;
  });

  test('paints Generating response… shell without joining streamingChatIds', () => {
    setupDom();
    setServerEngineFlagForTests(true);
    const chat = makeEngineChat();
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    syncEngineStreamMirrors();

    assert.equal(lastGenerationId, GEN_ID);
    assert.equal(hasEngineStreamMirror(chat.id), true);
    assert.equal(appState.streamingChatIds.has(chat.id), false);

    const label = document
      .getElementById('chatArea')
      ?.querySelector('.stream-status__label');
    assert.equal(label?.textContent, STREAM_LABEL_GENERATING);
  });

  test('mirrors thinking deltas into live ThoughtBubble UI', () => {
    setupDom();
    setServerEngineFlagForTests(true);
    const chat = makeEngineChat();
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    syncEngineStreamMirrors();
    emitReasoning('I should plan carefully');

    const area = document.getElementById('chatArea');
    assert.ok(area?.querySelector('.thoughts-toggle--live'));
    assert.equal(
      area?.querySelector('.thoughts-toggle__label')?.textContent,
      'Thinking…',
    );
    // Live thinking owns the indicator — generic stream-status is hidden.
    assert.ok(area?.querySelector('.stream-status')?.classList.contains('hidden'));
  });

  test('history paint remounts generating shell and restores prose tokens', async () => {
    setupDom();
    setServerEngineFlagForTests(true);
    const chat = makeEngineChat();
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    syncEngineStreamMirrors();
    emitContent('Hello');
    emitContent(' world');

    // Simulate boot / session-sync wiping live shells.
    renderChatFromHistory(chat);
    await new Promise((resolve) => setImmediate(resolve));

    const area = document.getElementById('chatArea');
    const bubbles = area?.querySelectorAll('.msg.assistant .msg-bubble');
    assert.ok(bubbles && bubbles.length >= 1);
    const liveBubble = area?.querySelector('.msg--awaiting-prose .msg-bubble, .msg.assistant .msg-bubble');
    assert.ok(liveBubble);
    assert.match(liveBubble?.textContent ?? '', /Hello world/);
  });

  test('sync after disconnected row remounts Thinking… without resubscribing', () => {
    setupDom();
    setServerEngineFlagForTests(true);
    const chat = makeEngineChat();
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    syncEngineStreamMirrors();
    emitReasoning('still thinking');
    const firstHandler = chunkHandler;

    // Wipe the mount (history paint without awaiting remount).
    const area = document.getElementById('chatArea');
    assert.ok(area);
    area.replaceChildren();

    syncEngineStreamMirrors();
    assert.equal(chunkHandler, firstHandler, 'must keep the same generation subscription');

    remountStreamDomForChat(chat.id);
    assert.ok(area.querySelector('.thoughts-toggle--live'));
    assert.equal(
      area.querySelector('.thoughts-toggle__label')?.textContent,
      STREAM_LABEL_THINKING,
    );
  });

  test('onEnd tears down mirror state', () => {
    setupDom();
    setServerEngineFlagForTests(true);
    const chat = makeEngineChat();
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    syncEngineStreamMirrors();
    assert.equal(hasEngineStreamMirror(chat.id), true);
    endHandler?.();
    assert.equal(hasEngineStreamMirror(chat.id), false);
  });
});
