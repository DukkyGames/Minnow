import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Window } from 'happy-dom';
import {
  APP_TOPBAR_HEIGHT_PX,
  isAppShellStyled,
  whenAppStylesReady,
} from '../../src/boot/app-ready.ts';

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

  it('ignores third-party stylesheet links', async () => {
    win = new Window();
    const g = globalThis as typeof globalThis & { document: Document; window: Window };
    g.document = win.document;
    g.window = win as unknown as Window & typeof globalThis.window;

    const external = win.document.createElement('link');
    external.rel = 'stylesheet';
    external.href = 'https://fonts.googleapis.com/css2?family=Test';
    Object.defineProperty(external, 'sheet', { configurable: true, get: () => null });
    win.document.head.appendChild(external);

    await whenAppStylesReady();
  });

  it('waits for a bundled stylesheet link load event', async () => {
    win = new Window();
    const g = globalThis as typeof globalThis & { document: Document; window: Window };
    g.document = win.document;
    g.window = win as unknown as Window & typeof globalThis.window;

    const link = win.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://example.test/assets/pending.css';
    Object.defineProperty(link, 'sheet', { configurable: true, get: () => null });
    win.document.head.appendChild(link);

    const pending = whenAppStylesReady();
    link.dispatchEvent(new win.Event('load'));
    await pending;
  });

  it('resolves when a bundled link is already loaded before listeners attach', async () => {
    win = new Window();
    const g = globalThis as typeof globalThis & { document: Document; window: Window };
    g.document = win.document;
    g.window = win as unknown as Window & typeof globalThis.window;

    const link = win.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://example.test/assets/already.css';
    Object.defineProperty(link, 'sheet', { configurable: true, get: () => ({}) });
    win.document.head.appendChild(link);

    await assert.doesNotReject(() => whenAppStylesReady());
  });
});

describe('isAppShellStyled', () => {
  let win: Window;

  afterEach(() => {
    win?.close();
  });

  it('returns true when the topbar probe is flex', () => {
    win = new Window();
    const g = globalThis as typeof globalThis & {
      document: Document;
      window: Window;
      getComputedStyle: typeof getComputedStyle;
    };
    g.document = win.document;
    g.window = win as unknown as Window & typeof globalThis.window;
    g.getComputedStyle = win.getComputedStyle.bind(win);

    const topbar = win.document.createElement('header');
    topbar.className = 'topbar';
    win.document.body.appendChild(topbar);
    const style = win.document.createElement('style');
    style.textContent = `.topbar { display: flex; height: ${APP_TOPBAR_HEIGHT_PX}px; }`;
    win.document.head.appendChild(style);

    assert.equal(isAppShellStyled(), true);
  });

  it('returns false when the topbar probe is missing', () => {
    win = new Window();
    const g = globalThis as typeof globalThis & { document: Document; window: Window };
    g.document = win.document;
    g.window = win as unknown as Window & typeof globalThis.window;

    assert.equal(isAppShellStyled(), false);
  });

  it('returns false when topbar is not yet styled', () => {
    win = new Window();
    const g = globalThis as typeof globalThis & {
      document: Document;
      window: Window;
      getComputedStyle: typeof getComputedStyle;
    };
    g.document = win.document;
    g.window = win as unknown as Window & typeof globalThis.window;
    g.getComputedStyle = win.getComputedStyle.bind(win);

    const topbar = win.document.createElement('header');
    topbar.className = 'topbar';
    win.document.body.appendChild(topbar);

    assert.equal(isAppShellStyled(), false);
  });
});
