import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  installHappyDomGlobals,
  setupMinimalComposerDom,
  teardownHappyDomAsync,
} from '../os/dom-helpers.mts';
import { encodeModelSelectKey } from '../../src/lib/model-select-key.ts';

const appState = await import('../../src/app-state.ts');
const { setSessionStateForTests, createEmptyChatObject, getActiveChat } = await import(
  '../../src/state/sessions.ts'
);
const {
  onModelSelectChange,
  syncModelSelectForActiveChat,
} = await import('../../src/ui/sidebar.ts');
const { onActiveChatModelChange } = await import('../../src/ui/chat-model-ui.ts');
const { readPersistedDefaultModelValue } = await import('../../src/ui/default-model.ts');
const { resetContextUsageRingForTests } = await import('../../src/ui/context-usage-ring.ts');

/** @type {import('happy-dom').Window | undefined} */
let win;

function setupDom() {
  win = new Window();
  installHappyDomGlobals(win);
  setupMinimalComposerDom(document);

  const modelSelect = document.createElement('select');
  modelSelect.id = 'modelSelect';
  document.body.appendChild(modelSelect);

  const inputBar = document.createElement('div');
  inputBar.className = 'input-bar-composer';
  document.body.appendChild(inputBar);

  for (const id of [
    'stripTPS',
    'stripTTFT',
    'stripGen',
    'stripTotal',
    'stripCost',
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
}

function appendModelOption(select, providerId, modelId, label = modelId) {
  const opt = document.createElement('option');
  opt.value = encodeModelSelectKey(providerId, modelId);
  opt.textContent = label;
  select.appendChild(opt);
}

describe('model select active chat binding', { concurrency: false }, () => {
  afterEach(async () => {
    appState.setStreaming(false);
    resetContextUsageRingForTests();
    setSessionStateForTests(null);
    try {
      localStorage.removeItem('minnow-default-model-select');
    } catch {
      /* ignore */
    }
    if (win) {
      await teardownHappyDomAsync(win);
      win = undefined;
    }
  });

  test('syncModelSelectForActiveChat keeps default picker when switching chats', () => {
    setupDom();
    const sel = document.getElementById('modelSelect');
    appendModelOption(sel, 'prov-a', 'model-a', 'A');
    appendModelOption(sel, 'prov-b', 'model-b', 'B');

    const chatA = createEmptyChatObject('');
    chatA.id = 'chat-a';
    chatA.providerId = 'prov-a';
    chatA.modelId = 'model-a';

    const chatB = createEmptyChatObject('');
    chatB.id = 'chat-b';
    chatB.providerId = 'prov-b';
    chatB.modelId = 'model-b';

    setSessionStateForTests({
      version: 2,
      activeId: chatA.id,
      sidebarCollapsed: false,
      chats: [chatA, chatB],
    });

    sel.value = encodeModelSelectKey('prov-a', 'model-a');
    setSessionStateForTests({
      version: 2,
      activeId: chatB.id,
      sidebarCollapsed: false,
      chats: [chatA, chatB],
    });
    syncModelSelectForActiveChat();

    assert.equal(
      sel.value,
      encodeModelSelectKey('prov-a', 'model-a'),
      'default picker should stay on the global default',
    );
    assert.equal(getActiveChat().providerId, 'prov-b');
    assert.equal(getActiveChat().modelId, 'model-b');
  });

  test('onModelSelectChange updates persisted default without mutating active chat', () => {
    setupDom();
    const sel = document.getElementById('modelSelect');
    appendModelOption(sel, 'prov-a', 'model-a', 'A');
    appendModelOption(sel, 'prov-b', 'model-b', 'B');

    const chat = createEmptyChatObject('');
    chat.id = 'chat-1';
    chat.providerId = 'prov-a';
    chat.modelId = 'model-a';
    chat.history.push({ role: 'user', content: 'fixture' });

    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    sel.value = encodeModelSelectKey('prov-b', 'model-b');
    onModelSelectChange();

    assert.equal(getActiveChat().providerId, 'prov-a');
    assert.equal(getActiveChat().modelId, 'model-a');
    assert.equal(
      readPersistedDefaultModelValue(),
      encodeModelSelectKey('prov-b', 'model-b'),
    );
  });

  test('onActiveChatModelChange persists composite provider and model on chat', () => {
    setupDom();
    const sel = document.getElementById('modelSelect');
    appendModelOption(sel, 'prov-a', 'model-a', 'A');
    appendModelOption(sel, 'prov-b', 'model-b', 'B');

    const chat = createEmptyChatObject('');
    chat.id = 'chat-1';
    chat.providerId = 'prov-a';
    chat.modelId = 'model-a';

    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    sel.value = encodeModelSelectKey('prov-a', 'model-a');
    onActiveChatModelChange(encodeModelSelectKey('prov-b', 'model-b'));

    assert.equal(getActiveChat().providerId, 'prov-b');
    assert.equal(getActiveChat().modelId, 'model-b');
    assert.equal(
      sel.value,
      encodeModelSelectKey('prov-a', 'model-a'),
      'composer change must not alter default picker',
    );
  });

  test('onActiveChatModelChange stops streaming on the active chat', () => {
    setupDom();
    const sel = document.getElementById('modelSelect');
    appendModelOption(sel, 'prov-a', 'model-a', 'A');
    appendModelOption(sel, 'prov-b', 'model-b', 'B');

    const chat = createEmptyChatObject('');
    chat.id = 'chat-stream';
    chat.providerId = 'prov-a';
    chat.modelId = 'model-a';
    chat.currentGenerationId = 'gen-123';

    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    appState.setStreaming(true, chat.id);
    appState.setChatAbort(chat.id, new AbortController());

    let abortCalled = false;
    const controller = appState.getChatAbort(chat.id);
    controller.signal.addEventListener('abort', () => {
      abortCalled = true;
    });

    onActiveChatModelChange(encodeModelSelectKey('prov-b', 'model-b'));

    assert.equal(abortCalled, true);
    assert.equal(getActiveChat().providerId, 'prov-b');
    assert.equal(getActiveChat().modelId, 'model-b');
  });
});
