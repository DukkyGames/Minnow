import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Window } from 'happy-dom';
import { whenAppStylesReady } from '../../src/boot/app-ready.ts';

describe('whenAppStylesReady', () => {
  let win: Window;

  afterEach(() => {
    win?.close();
  });

  it('resolves immediately when there are no stylesheet links', async () => {
    win = new Window();
    const g = globalThis as typeof globalThis & { document: Document; window: Window };
    g.document = win.document;
    g.window = win as unknown as Window & typeof globalThis.window;

    await assert.doesNotReject(() => whenAppStylesReady());
  });

  it('resolves when a stylesheet link is already loaded', async () => {
    win = new Window();
    const g = globalThis as typeof globalThis & { document: Document; window: Window };
    g.document = win.document;
    g.window = win as unknown as Window & typeof globalThis.window;

    const link = win.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://example.test/app.css';
    Object.defineProperty(link, 'sheet', { value: {} });
    win.document.head.appendChild(link);

    await whenAppStylesReady();
  });

  it('waits for a stylesheet link load event', async () => {
    win = new Window();
    const g = globalThis as typeof globalThis & { document: Document; window: Window };
    g.document = win.document;
    g.window = win as unknown as Window & typeof globalThis.window;

    const link = win.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://example.test/pending.css';
    Object.defineProperty(link, 'sheet', { configurable: true, get: () => null });
    win.document.head.appendChild(link);

    const pending = whenAppStylesReady();
    link.dispatchEvent(new win.Event('load'));
    await pending;
  });
});
