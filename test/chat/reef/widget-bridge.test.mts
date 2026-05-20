/**
 * Reef widget host bridge (postMessage handlers).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  getActiveReefLlmCountForTests,
  handleReefMessageForTests,
  registerReefWidgetHost,
  resetReefBridgeForTests,
  setActiveReefLlmCountForTests,
} from '../../../src/chat/reef/widget-bridge.ts';
import {
  createEmptyChatObject,
  setSessionStateForTests,
} from '../../../src/state/sessions.ts';

function setupDom(): void {
  const window = new Window();
  globalThis.window = window as unknown as Window & typeof globalThis;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLTextAreaElement = window.HTMLTextAreaElement;
  globalThis.Node = window.Node;
  const input = document.createElement('textarea');
  input.id = 'msgInput';
  document.body.appendChild(input);
}

describe('widget-bridge', { concurrency: false }, () => {
  afterEach(() => {
    setSessionStateForTests(null);
    resetReefBridgeForTests();
  });

  test('sendPrompt fills composer and dispatches input without sending', () => {
    setupDom();
    const chat = createEmptyChatObject('model-a');
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const host = document.createElement('div');
    const iframe = document.createElement('iframe');
    host.appendChild(iframe);
    document.body.appendChild(host);

    registerReefWidgetHost('widget-send-1', host, iframe, () => {}, '');

    let inputEvents = 0;
    const input = document.getElementById('msgInput') as HTMLTextAreaElement;
    input.addEventListener('input', () => {
      inputEvents += 1;
    });

    handleReefMessageForTests({
      origin: 'null',
      data: {
        type: 'reef',
        action: 'sendPrompt',
        widgetId: 'widget-send-1',
        text: 'Explain this chart',
      },
    } as MessageEvent);

    assert.equal(input.value, 'Explain this chart');
    assert.equal(inputEvents, 1);
  });

  test('resize sets host and iframe height', () => {
    setupDom();
    const host = document.createElement('div');
    const iframe = document.createElement('iframe');
    host.appendChild(iframe);
    registerReefWidgetHost('widget-resize-1', host, iframe, () => {}, '');

    handleReefMessageForTests({
      origin: '',
      data: {
        type: 'reef',
        action: 'resize',
        widgetId: 'widget-resize-1',
        height: 200,
      },
    } as MessageEvent);

    assert.equal(host.style.height, '200px');
    assert.equal(iframe.style.height, '200px');
  });

  test('callLLM rejects when max concurrent requests exceeded', () => {
    setupDom();
    const chat = createEmptyChatObject('model-a');
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const host = document.createElement('div');
    const iframe = document.createElement('iframe');
    host.appendChild(iframe);
    registerReefWidgetHost('widget-llm-1', host, iframe, () => {}, '');

    const posted: unknown[] = [];
    Object.defineProperty(iframe, 'contentWindow', {
      value: {
        postMessage: (payload: unknown) => {
          posted.push(payload);
        },
      },
      configurable: true,
    });

    setActiveReefLlmCountForTests(2);
    handleReefMessageForTests({
      origin: 'null',
      data: {
        type: 'reef',
        action: 'callLLM',
        widgetId: 'widget-llm-1',
        requestId: 'req-over-cap',
        messages: [{ role: 'user', content: 'hi' }],
      },
    } as MessageEvent);

    const err = posted.find(
      (p) =>
        typeof p === 'object' &&
        p !== null &&
        (p as { action?: string }).action === 'llmError',
    ) as { error?: string } | undefined;
    assert.ok(err);
    assert.match(err?.error ?? '', /max 2/i);
    assert.equal(getActiveReefLlmCountForTests(), 2);
  });

  test('ignores messages for unknown widget ids', () => {
    setupDom();
    const input = document.getElementById('msgInput') as HTMLTextAreaElement;
    handleReefMessageForTests({
      origin: 'null',
      data: {
        type: 'reef',
        action: 'sendPrompt',
        widgetId: 'missing',
        text: 'noop',
      },
    } as MessageEvent);
    assert.equal(input.value, '');
  });
});
