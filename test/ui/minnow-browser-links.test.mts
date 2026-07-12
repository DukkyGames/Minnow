import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  handleMinnowBrowserLinkClick,
  isMinnowBrowserUrl,
  openUrlInMinnowBrowser,
  resetMinnowBrowserLinkRoutingForTests,
} from '../../src/ui/minnow-browser-links.ts';
import {
  installHappyDomGlobals,
  installMinnowPreviewMock,
  teardownHappyDomAsync,
} from '../os/dom-helpers.mts';

describe('minnow-browser-links', () => {
  /** @type {Window | undefined} */
  let win: Window | undefined;

  beforeEach(() => {
    win = new Window({ url: 'http://localhost:9473/' });
    installHappyDomGlobals(win);
    installMinnowPreviewMock(win);
    resetMinnowBrowserLinkRoutingForTests();
  });

  afterEach(async () => {
    if (win) {
      await teardownHappyDomAsync(win);
      win = undefined;
    }
    resetMinnowBrowserLinkRoutingForTests();
  });

  test('isMinnowBrowserUrl accepts http(s) URLs only', () => {
    assert.equal(isMinnowBrowserUrl('https://example.com'), true);
    assert.equal(isMinnowBrowserUrl('http://localhost:5173/'), true);
    assert.equal(isMinnowBrowserUrl('/api/research/report/abc'), false);
    assert.equal(isMinnowBrowserUrl('mailto:test@example.com'), false);
    assert.equal(isMinnowBrowserUrl('documentation/foo.md'), false);
  });

  test('chat bubble link click is intercepted inside #chatArea', () => {
    const area = document.createElement('div');
    area.id = 'chatArea';
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble msg-bubble--md';
    const anchor = document.createElement('a');
    anchor.href = 'https://example.com/docs';
    anchor.textContent = 'docs';
    bubble.appendChild(anchor);
    area.appendChild(bubble);
    document.body.appendChild(area);

    const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: anchor, configurable: true });
    handleMinnowBrowserLinkClick(event);

    assert.equal(event.defaultPrevented, true);
  });

  test('chat bubble link click ignores anchors outside chat roots', () => {
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble msg-bubble--md';
    const anchor = document.createElement('a');
    anchor.href = 'https://example.com/outside';
    bubble.appendChild(anchor);
    document.body.appendChild(bubble);

    const event = new window.MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: anchor, configurable: true });
    handleMinnowBrowserLinkClick(event);

    assert.equal(event.defaultPrevented, false);
  });

  test('openUrlInMinnowBrowser ignores empty URLs', async () => {
    let called = false;
    window.minnow = {
      preview: {
        hide: () => undefined,
        show: async () => {
          called = true;
        },
      },
    };

    openUrlInMinnowBrowser('   ');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(called, false);
  });
});
