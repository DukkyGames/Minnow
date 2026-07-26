/**
 * Hub DOM lifecycle — composer must survive teardown/remount (mode changes).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { setSessionStateForTests, createEmptyChatObject } = await import(
  '../../src/state/sessions.ts'
);
const { renderHub, teardownHub, isHubMounted, isHubMountedForChat, HUB_ROOT_ID } =
  await import('../../src/ui/hub.ts');
const { renderChatFromHistory } = await import('../../src/ui/messages.ts');

let domWindow: Window | null = null;

function setupDom(): void {
  const window = new Window();
  domWindow = window;
  globalThis.window = window as unknown as Window & typeof globalThis.window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);

  document.body.innerHTML = `
    <div id="mainColumn">
      <div id="chatArea"></div>
      <div class="input-bar">
        <textarea id="msgInput"></textarea>
        <div id="modeSelector"></div>
      </div>
    </div>
  `;
  teardownHub();
}

afterEach(() => {
  teardownHub();
  setSessionStateForTests(null);
  domWindow?.close();
  domWindow = null;
});

describe('hub teardown', () => {
  test('remounting hub keeps .input-bar in the document', () => {
    setupDom();
    const chat = createEmptyChatObject('test-model');
    setSessionStateForTests({
      version: 3,
      activeId: chat.id,
      chats: [chat],
      sidebarCollapsed: false,
    });

    renderHub(chat);
    assert.equal(isHubMounted(), true);
    assert.ok(document.querySelector('.input-bar--hub'));

    renderHub(chat);
    assert.equal(isHubMounted(), true);
    assert.ok(document.getElementById('msgInput'), 'composer textarea survives remount');
    assert.ok(
      document.getElementById(HUB_ROOT_ID)?.querySelector('.hub-composer-slot .input-bar'),
      'composer stays inside hub slot after remount',
    );
  });

  test('renderChatFromHistory skips hub remount for the same empty chat', () => {
    setupDom();
    const chat = createEmptyChatObject('test-model');
    setSessionStateForTests({
      version: 3,
      activeId: chat.id,
      chats: [chat],
      sidebarCollapsed: false,
    });

    renderHub(chat);
    const hubRoot = document.getElementById(HUB_ROOT_ID);
    assert.ok(hubRoot);

    const input = document.getElementById('msgInput') as HTMLTextAreaElement;
    input.value = 'typing without losing focus';
    input.focus();

    renderChatFromHistory(chat);
    assert.equal(document.getElementById(HUB_ROOT_ID), hubRoot, 'hub root is not replaced');
    assert.equal(isHubMountedForChat(chat.id), true);
    assert.equal(input.value, 'typing without losing focus');
  });
});
