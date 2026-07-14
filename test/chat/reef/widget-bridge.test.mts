/**
 * Reef widget host bridge (postMessage handlers).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { installHappyDomGlobals, teardownHappyDomAsync } from '../../os/dom-helpers.mts';
import {
  getActiveReefLlmCountForTests,
  handleReefMessageForTests,
  isAllowedReefOriginForTests,
  registerReefWidgetHost,
  resetReefBridgeForTests,
  setActiveReefLlmCountForTests,
} from '../../../src/chat/reef/widget-bridge.ts';
import {
  setAutoRevealReefWidgetsForTests,
  setSkipReefWidgetValidationTimeoutForTests,
} from '../../../src/chat/reef/widget-validation.ts';
import {
  createEmptyChatObject,
  setSessionStateForTests,
} from '../../../src/state/sessions.ts';

/** @type {import('happy-dom').Window | undefined} */
let win;

function setupDom(): void {
  setSkipReefWidgetValidationTimeoutForTests(true);
  setAutoRevealReefWidgetsForTests(true);
  win = new Window();
  installHappyDomGlobals(win);
  globalThis.HTMLTextAreaElement = win.HTMLTextAreaElement;
  const input = document.createElement('textarea');
  input.id = 'msgInput';
  document.body.appendChild(input);
}

/** Bind iframe.contentWindow and build a MessageEvent from that window (source verification). */
function reefMessageFromIframe(
  iframe: HTMLIFrameElement,
  data: Record<string, unknown>,
  origin = 'null',
): MessageEvent {
  const contentWindow = { postMessage: () => {} };
  Object.defineProperty(iframe, 'contentWindow', {
    value: contentWindow,
    configurable: true,
  });
  return {
    origin,
    source: contentWindow,
    data,
  } as MessageEvent;
}

describe('widget-bridge', { concurrency: false }, () => {
  afterEach(async () => {
    setSessionStateForTests(null);
    resetReefBridgeForTests();
    if (win) {
      await teardownHappyDomAsync(win);
      win = undefined;
    }
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

    handleReefMessageForTests(
      reefMessageFromIframe(iframe, {
        type: 'reef',
        action: 'sendPrompt',
        widgetId: 'widget-send-1',
        text: 'Explain this chart',
      }),
    );

    assert.equal(input.value, 'Explain this chart');
    assert.equal(inputEvents, 1);
  });

  test('resize sets host and iframe height', () => {
    setupDom();
    const host = document.createElement('div');
    const iframe = document.createElement('iframe');
    host.appendChild(iframe);
    registerReefWidgetHost('widget-resize-1', host, iframe, () => {}, '');

    handleReefMessageForTests(
      reefMessageFromIframe(iframe, {
        type: 'reef',
        action: 'resize',
        widgetId: 'widget-resize-1',
        height: 200,
      }),
    );

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
    const contentWindow = {
      postMessage: (payload: unknown) => {
        posted.push(payload);
      },
    };
    Object.defineProperty(iframe, 'contentWindow', {
      value: contentWindow,
      configurable: true,
    });

    setActiveReefLlmCountForTests(2);
    handleReefMessageForTests({
      origin: 'null',
      source: contentWindow,
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
    const iframe = document.createElement('iframe');
    handleReefMessageForTests(
      reefMessageFromIframe(iframe, {
        type: 'reef',
        action: 'sendPrompt',
        widgetId: 'missing',
        text: 'noop',
      }),
    );
    assert.equal(input.value, '');
  });

  test('isAllowedReefOrigin rejects empty and untrusted origins', () => {
    setupDom();
    assert.equal(isAllowedReefOriginForTests(''), true);
    assert.equal(isAllowedReefOriginForTests('https://evil.example'), false);
    assert.equal(isAllowedReefOriginForTests('null'), true);
    assert.equal(isAllowedReefOriginForTests(window.location.origin), true);
  });

  test('accepts reef messages when event.source is null for sandboxed srcdoc', () => {
    setupDom();
    setAutoRevealReefWidgetsForTests(false);
    const host = document.createElement('div');
    host.className = 'reef-widget-host reef-widget-host--validating';
    const iframe = document.createElement('iframe');
    host.appendChild(iframe);
    registerReefWidgetHost('widget-null-source', host, iframe, () => {}, '');

    handleReefMessageForTests({
      origin: 'null',
      source: null,
      data: {
        type: 'reef',
        action: 'resize',
        widgetId: 'widget-null-source',
        height: 160,
      },
    } as MessageEvent);
    handleReefMessageForTests({
      origin: 'null',
      source: null,
      data: {
        type: 'reef',
        action: 'validateResult',
        widgetId: 'widget-null-source',
        ok: true,
        errors: [],
      },
    } as MessageEvent);

    assert.equal(host.classList.contains('reef-widget-host--error'), false);
    assert.equal(host.style.height, '160px');
    assert.notEqual(host.classList.contains('reef-widget-host--validating'), true);
  });

  test('ignores reef messages when event.source is not the widget iframe', () => {
    setupDom();
    const host = document.createElement('div');
    const iframe = document.createElement('iframe');
    host.appendChild(iframe);
    registerReefWidgetHost('widget-deputy-1', host, iframe, () => {}, '');

    const input = document.getElementById('msgInput') as HTMLTextAreaElement;
    reefMessageFromIframe(iframe, {
      type: 'reef',
      action: 'sendPrompt',
      widgetId: 'widget-deputy-1',
      text: 'should not apply',
    });

    handleReefMessageForTests({
      origin: 'null',
      source: { postMessage: () => {} },
      data: {
        type: 'reef',
        action: 'sendPrompt',
        widgetId: 'widget-deputy-1',
        text: 'forged by another window',
      },
    } as MessageEvent);

    assert.equal(input.value, '');
  });

  test('validateResult ok reveals iframe after resize', () => {
    setupDom();
    setAutoRevealReefWidgetsForTests(false);
    const host = document.createElement('div');
    host.className = 'reef-widget-host reef-widget-host--validating';
    const iframe = document.createElement('iframe');
    iframe.style.visibility = 'hidden';
    host.appendChild(iframe);
    registerReefWidgetHost('widget-validate-ok', host, iframe, () => {}, '');

    handleReefMessageForTests(
      reefMessageFromIframe(iframe, {
        type: 'reef',
        action: 'resize',
        widgetId: 'widget-validate-ok',
        height: 180,
      }),
    );
    handleReefMessageForTests(
      reefMessageFromIframe(iframe, {
        type: 'reef',
        action: 'validateResult',
        widgetId: 'widget-validate-ok',
        ok: true,
        errors: [],
      }),
    );

    assert.equal(host.classList.contains('reef-widget-host--validating'), false);
    assert.equal(host.classList.contains('reef-widget-host--error'), false);
    assert.notEqual(iframe.style.visibility, 'hidden');
    assert.equal(host.style.height, '180px');
  });

  test('validateResult failure shows error panel and removes iframe', () => {
    setupDom();
    setAutoRevealReefWidgetsForTests(false);
    const host = document.createElement('div');
    host.className = 'reef-widget-host reef-widget-host--validating';
    const iframe = document.createElement('iframe');
    host.appendChild(iframe);
    registerReefWidgetHost('widget-validate-fail', host, iframe, () => {}, '');

    handleReefMessageForTests(
      reefMessageFromIframe(iframe, {
        type: 'reef',
        action: 'validateResult',
        widgetId: 'widget-validate-fail',
        ok: false,
        errors: ['ReferenceError: foo is not defined'],
      }),
    );

    assert.equal(host.classList.contains('reef-widget-host--error'), true);
    assert.equal(host.querySelector('iframe'), null);
    assert.match(host.textContent ?? '', /ReferenceError/);
  });

  test('widgetError is merged into validation failure', () => {
    setupDom();
    setAutoRevealReefWidgetsForTests(false);
    const host = document.createElement('div');
    host.className = 'reef-widget-host reef-widget-host--validating';
    const iframe = document.createElement('iframe');
    host.appendChild(iframe);
    registerReefWidgetHost('widget-validate-err', host, iframe, () => {}, '');

    handleReefMessageForTests(
      reefMessageFromIframe(iframe, {
        type: 'reef',
        action: 'widgetError',
        widgetId: 'widget-validate-err',
        error: 'JSX transform error',
      }),
    );
    handleReefMessageForTests(
      reefMessageFromIframe(iframe, {
        type: 'reef',
        action: 'validateResult',
        widgetId: 'widget-validate-err',
        ok: true,
        errors: [],
      }),
    );

    assert.equal(host.classList.contains('reef-widget-host--error'), true);
    assert.match(host.textContent ?? '', /JSX transform/);
  });

  test('ignores reef messages from disallowed origins', () => {
    setupDom();
    const host = document.createElement('div');
    const iframe = document.createElement('iframe');
    host.appendChild(iframe);
    registerReefWidgetHost('widget-origin-1', host, iframe, () => {}, '');

    const input = document.getElementById('msgInput') as HTMLTextAreaElement;
    handleReefMessageForTests(
      reefMessageFromIframe(
        iframe,
        {
          type: 'reef',
          action: 'sendPrompt',
          widgetId: 'widget-origin-1',
          text: 'blocked',
        },
        'https://evil.example',
      ),
    );

    assert.equal(input.value, '');
  });
});
