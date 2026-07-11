import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  getOrCreatePreviewIframe,
  loadPreviewIframeUrl,
  destroyPreviewIframe,
  resetPreviewIframesForTests,
} from '../../src/ui/preview-iframe-fallback.ts';

describe('preview-iframe-fallback', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window as unknown as typeof globalThis.window;
    globalThis.document = window.document as unknown as Document;
    globalThis.HTMLElement = window.HTMLElement as unknown as typeof HTMLElement;
    globalThis.HTMLIFrameElement = window.HTMLIFrameElement as unknown as typeof HTMLIFrameElement;
    document.body.innerHTML = '<div id="host-a"></div><div id="host-b"></div>';
    resetPreviewIframesForTests();
  });

  afterEach(() => {
    resetPreviewIframesForTests();
  });

  test('creates one same-origin iframe per instance id, reused on repeat calls', () => {
    const host = document.getElementById('host-a')!;
    const first = getOrCreatePreviewIframe('design', host);
    const second = getOrCreatePreviewIframe('design', host);
    assert.equal(first, second);
    assert.equal(host.querySelectorAll('iframe').length, 1);
    assert.equal(first.getAttribute('sandbox'), 'allow-scripts allow-forms allow-popups allow-modals');
  });

  test('two instances get independent iframes that can hold different URLs', () => {
    const hostA = document.getElementById('host-a')!;
    const hostB = document.getElementById('host-b')!;
    const workspaceFrame = getOrCreatePreviewIframe('workspace-preview', hostA);
    const designFrame = getOrCreatePreviewIframe('design', hostB);

    assert.notEqual(workspaceFrame, designFrame);

    loadPreviewIframeUrl('workspace-preview', 'http://localhost/workspace.html');
    loadPreviewIframeUrl('design', 'http://localhost/design-canvas.html');

    assert.equal(workspaceFrame.src, 'http://localhost/workspace.html');
    assert.equal(designFrame.src, 'http://localhost/design-canvas.html');
    assert.notEqual(workspaceFrame.src, designFrame.src);
  });

  test('destroyPreviewIframe removes only the targeted instance', () => {
    const hostA = document.getElementById('host-a')!;
    const hostB = document.getElementById('host-b')!;
    getOrCreatePreviewIframe('workspace-preview', hostA);
    getOrCreatePreviewIframe('design', hostB);

    destroyPreviewIframe('design');

    assert.equal(hostA.querySelectorAll('iframe').length, 1);
    assert.equal(hostB.querySelectorAll('iframe').length, 0);
  });
});
