import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  installHappyDomGlobals,
  setupMinimalComposerDom,
  teardownHappyDomAsync,
} from '../os/dom-helpers.mts';

const appState = await import('../../src/app-state.ts');
const { setSessionStateForTests, createEmptyChatObject, getActiveChat } = await import(
  '../../src/state/sessions.ts'
);
const { resetDesktopStateForTests } = await import('../../src/os/desktop-state.ts');
const { switchChat } = await import('../../src/ui/sidebar.ts');

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

describe('switchChat while another chat streams', { concurrency: false }, () => {
  afterEach(async () => {
    appState.setStreaming(false);
    setSessionStateForTests(null);
    resetDesktopStateForTests();
    if (win) {
      await teardownHappyDomAsync(win);
      win = undefined;
    }
  });

  test('switchChat succeeds without blocking when stream is on another chat', async () => {
    setupDom();
    const a = createEmptyChatObject('');
    a.id = 'chat-streaming';
    a.name = 'Streaming';
    a.history.push({ role: 'user', content: 'hi' });

    const b = createEmptyChatObject('');
    b.id = 'chat-target';
    b.name = 'Target';
    b.history.push({ role: 'user', content: 'other' });

    setSessionStateForTests({
      version: 2,
      activeId: a.id,
      sidebarCollapsed: false,
      chats: [a, b],
    });

    appState.setStreaming(true, a.id);
    switchChat(b.id);
    await new Promise((r) => setTimeout(r, 50));

    assert.equal(getActiveChat().id, b.id);
    assert.equal(appState.streamingChatId, a.id);
    assert.equal(appState.streaming, true);

    const hint = document.getElementById('composerBackgroundStreamHint');
    assert.ok(hint);
    assert.ok(!hint.classList.contains('hidden'));
    assert.match(hint.textContent ?? '', /Streaming/);
  });
});
