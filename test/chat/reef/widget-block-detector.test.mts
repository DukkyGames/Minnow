/**
 * Reef widget fence detection and host mounting.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { setStreaming } from '../../../src/app-state.ts';
import { mountReefWidgetBlocks } from '../../../src/chat/reef/widget-block-detector.ts';
import { resetReefBridgeForTests } from '../../../src/chat/reef/widget-bridge.ts';
import {
  createEmptyChatObject,
  setSessionStateForTests,
} from '../../../src/state/sessions.ts';

function setupDom(): void {
  const window = new Window();
  globalThis.window = window as unknown as Window & typeof globalThis;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => '22222222-2222-2222-2222-222222222222' },
    configurable: true,
  });
}

function reefBubbleWithFence(): HTMLElement {
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble msg-bubble--md';
  const pre = document.createElement('pre');
  pre.setAttribute('data-lang', 'reef-widget');
  const code = document.createElement('code');
  code.textContent = '<div>Widget</div>';
  pre.appendChild(code);
  bubble.appendChild(pre);
  return bubble;
}

describe('widget-block-detector', { concurrency: false }, () => {
  afterEach(() => {
    setStreaming(false);
    setSessionStateForTests(null);
    resetReefBridgeForTests();
  });

  test('mounts iframe host when mode is reef and not streaming', () => {
    setupDom();
    const chat = createEmptyChatObject('model-a');
    chat.modeId = 'reef';
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const bubble = reefBubbleWithFence();
    mountReefWidgetBlocks(bubble);

    const host = bubble.querySelector('.reef-widget-host');
    assert.ok(host);
    assert.equal(host?.dataset.reefMounted, 'true');
    assert.ok(host?.querySelector('iframe.reef-widget-iframe'));
    assert.equal(bubble.querySelector('pre[data-lang="reef-widget"]'), null);
  });

  test('skips mount when mode is not reef', () => {
    setupDom();
    const chat = createEmptyChatObject('model-a');
    chat.modeId = 'build';
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const bubble = reefBubbleWithFence();
    mountReefWidgetBlocks(bubble);
    assert.equal(bubble.querySelector('.reef-widget-host'), null);
    assert.ok(bubble.querySelector('pre[data-lang="reef-widget"]'));
  });

  test('skips mount while streaming', () => {
    setupDom();
    const chat = createEmptyChatObject('model-a');
    chat.modeId = 'reef';
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });
    setStreaming(true);

    const bubble = reefBubbleWithFence();
    mountReefWidgetBlocks(bubble);
    assert.equal(bubble.querySelector('.reef-widget-host'), null);
  });

  test('does not remount when pre already marked', () => {
    setupDom();
    const chat = createEmptyChatObject('model-a');
    chat.modeId = 'reef';
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const bubble = reefBubbleWithFence();
    bubble.querySelector('pre')!.dataset.reefMounted = 'true';
    mountReefWidgetBlocks(bubble);
    assert.equal(bubble.querySelector('.reef-widget-host'), null);
  });
});
