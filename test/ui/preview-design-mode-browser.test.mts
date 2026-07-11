import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  enableDesignMode,
  resetDesignModeForTests,
} from '../../src/design/design-mode.ts';
import {
  resetDesignToolRegistryForTests,
} from '../../src/design/design-tool.ts';
import { resetDesignMetaCacheForTests } from '../../src/config/design-meta.ts';
import { resolveDesignModeMountOptions } from '../../src/ui/preview-design-mode-mount.ts';

describe('preview design mode browser integration', () => {
  let host: HTMLElement;
  let chrome: HTMLElement;
  let pane: HTMLElement;

  beforeEach(() => {
    const win = new Window();
    globalThis.window = win as unknown as Window & typeof globalThis;
    globalThis.document = win.document;
    globalThis.ResizeObserver = win.ResizeObserver;
    globalThis.PointerEvent = win.PointerEvent;
    globalThis.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;

    pane = document.createElement('div');
    pane.id = 'previewPane';
    host = document.createElement('div');
    host.id = 'previewBody';
    chrome = document.createElement('div');
    chrome.id = 'previewDesignChrome';
    chrome.setAttribute('hidden', '');
    pane.appendChild(host);
    pane.appendChild(chrome);
    document.body.appendChild(pane);

    host.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 400,
        height: 300,
        right: 400,
        bottom: 300,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 });

    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      if (init?.method === 'PUT') return { ok: true, json: async () => ({}) } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;

    delete (globalThis as { minnow?: unknown }).minnow;

    resetDesignMetaCacheForTests();
    resetDesignToolRegistryForTests();
    resetDesignModeForTests();
  });

  afterEach(() => {
    resetDesignModeForTests();
    resetDesignToolRegistryForTests();
    resetDesignMetaCacheForTests();
    document.body.innerHTML = '';
  });

  test('enableDesignMode with browser mount options places the strip in #previewBody', async () => {
    const options = resolveDesignModeMountOptions(host, pane, chrome);
    assert.equal(options.host, host);

    await enableDesignMode(options);

    assert.ok(host.querySelector('.mn-design-strip'));
    assert.equal(chrome.querySelector('.mn-design-strip'), null);
    assert.ok(chrome.hasAttribute('hidden'));
  });
});
