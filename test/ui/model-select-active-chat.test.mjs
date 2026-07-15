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
    setSessionStateForTests(null);
    if (win) {
      await teardownHappyDomAsync(win);
      win = undefined;
    }
  });

  test('syncModelSelectForActiveChat does not bleed picker value across chats', () => {
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
      encodeModelSelectKey('prov-b', 'model-b'),
      'picker should follow the newly active chat',
    );
    assert.equal(getActiveChat().providerId, 'prov-b');
    assert.equal(getActiveChat().modelId, 'model-b');
  });

  test('onModelSelectChange persists composite provider and model on chat', () => {
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

    sel.value = encodeModelSelectKey('prov-b', 'model-b');
    onModelSelectChange();

    assert.equal(getActiveChat().providerId, 'prov-b');
    assert.equal(getActiveChat().modelId, 'model-b');
  });

  test('onModelSelectChange stops streaming on the active chat', () => {
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

    sel.value = encodeModelSelectKey('prov-b', 'model-b');
    onModelSelectChange();

    assert.equal(abortCalled, true);
    assert.equal(getActiveChat().providerId, 'prov-b');
    assert.equal(getActiveChat().modelId, 'model-b');
  });

  test('syncModelSelectForActiveChat clears stale picker when chat model is missing from catalog', () => {
    setupDom();
    const sel = document.getElementById('modelSelect');
    appendModelOption(sel, 'prov-a', 'model-a', 'A');

    const chat = createEmptyChatObject('');
    chat.id = 'chat-missing';
    chat.providerId = 'prov-z';
    chat.modelId = 'model-z';

    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    sel.value = encodeModelSelectKey('prov-a', 'model-a');
    syncModelSelectForActiveChat();

    assert.equal(sel.value, '');
    assert.equal(getActiveChat().providerId, 'prov-z');
    assert.equal(getActiveChat().modelId, 'model-z');
  });
});
