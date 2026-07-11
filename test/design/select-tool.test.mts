/**
 * Real Select tool (MIN-366): element-picker payload → captured crop → elementRef chip
 * → overlay marker, exercised end-to-end through the same-origin iframe fallback path
 * (no Electron `window.minnow.preview` needed).
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { createSelectDesignTool, type DesignToolContext } from '../../src/design/design-tool.ts';
import { createAnnotationOverlay } from '../../src/design/overlay.ts';
import {
  resetRegionCaptureForTests,
  setRegionCaptureTestHooks,
} from '../../src/design/region-capture.ts';
import { clearAttachments, getPendingAttachments } from '../../src/attachments/store.ts';
import {
  DEFAULT_FILE_PANEL_STATE,
  resetFilePanelStateForTests,
  setFilePanelState,
} from '../../src/state/file-panel.ts';

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('Select design tool (MIN-366)', () => {
  let host: HTMLElement;
  let frame: HTMLIFrameElement;
  let childWin: Window;

  beforeEach(() => {
    const win = new Window();
    globalThis.window = win as unknown as Window & typeof globalThis;
    globalThis.document = win.document;
    globalThis.ResizeObserver = win.ResizeObserver;
    globalThis.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;
    globalThis.Image = win.Image;
    globalThis.MouseEvent = win.MouseEvent as unknown as typeof MouseEvent;
    Object.assign(globalThis.window, { location: { origin: 'http://127.0.0.1:5173' }, minnow: undefined });

    host = document.createElement('div');
    host.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 });
    document.body.appendChild(host);

    frame = document.createElement('iframe');
    frame.id = 'previewFrame';
    document.body.appendChild(frame);

    childWin = new Window();
    childWin.document.body.innerHTML = '<button class="cta primary">Buy now</button>';
    const button = childWin.document.querySelector('button')!;
    button.getBoundingClientRect = () =>
      ({ x: 12, y: 24, width: 96, height: 32, left: 12, top: 24, right: 108, bottom: 56, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(frame, 'contentWindow', { configurable: true, value: childWin });
    Object.defineProperty(frame, 'contentDocument', { configurable: true, value: childWin.document });

    resetFilePanelStateForTests();
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      previewSource: { kind: 'workspace', path: 'pricing.html' },
    });

    resetRegionCaptureForTests();
    setRegionCaptureTestHooks({
      capturePage: async () => TINY_PNG_BASE64,
      scrollIntoView: async () => {},
      getPageDimensions: async () => ({ pageW: 400, pageH: 300 }),
      cropPngToDataUrl: async () => ({ dataUrl: 'data:image/png;base64,CROPPED' }),
    });

    // Element → source mapping (MIN-369) calls fetch as its first ladder step for a static
    // .html page; stub it so handlePick's async resolution has something deterministic to land.
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({ file: 'pricing.html', line: 42, confidence: 'exact' }),
      }) as Response) as typeof fetch;
  });

  afterEach(() => {
    clearAttachments();
    resetRegionCaptureForTests();
    resetFilePanelStateForTests();
    document.body.innerHTML = '';
    // @ts-expect-error test cleanup
    delete globalThis.fetch;
  });

  function makeCtx(): DesignToolContext {
    return { instanceId: 'workspace-preview', host, overlay: createAnnotationOverlay({ host }) };
  }

  async function flush(): Promise<void> {
    // element-picker's iframe click handler kicks off a fire-and-forget async handlePick
    // whose capture chain (scroll → capturePage → decode dims → crop) is several await
    // hops deep. Drain it with real macrotasks, not just microtask ticks, so the chip and
    // overlay marker have landed before we assert.
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  test('id/label match the strip button contract', () => {
    const tool = createSelectDesignTool();
    assert.equal(tool.id, 'select');
    assert.equal(tool.label, 'Select');
  });

  test('click on the guest pushes an elementRef chip with the full payload shape', async () => {
    const tool = createSelectDesignTool();
    const ctx = makeCtx();
    tool.arm(ctx);
    await flush();

    const button = childWin.document.querySelector('button')!;
    button.dispatchEvent(new childWin.MouseEvent('click', { bubbles: true }));
    await flush();

    const pending = getPendingAttachments();
    assert.equal(pending.length, 1);
    const chip = pending[0];
    assert.equal(chip.kind, 'elementRef');
    assert.equal(chip.tagName, 'button');
    assert.deepEqual(chip.classList, ['cta', 'primary']);
    assert.equal(chip.pageUrl, 'pricing.html');
    assert.equal(chip.uid, 1);
    assert.ok(chip.selector, 'selector should be captured');
    assert.ok(chip.stylesDigest && chip.stylesDigest.includes('font:'), 'stylesDigest should be a computed-styles digest');
    assert.equal(chip.croppedDataUrl, 'data:image/png;base64,CROPPED');
    assert.match(chip.outerHtmlPreview ?? '', /button/);

    tool.disarm();
  });

  test('the chip is pushed without a sourceMapping, then upgraded in place once resolution lands (MIN-369)', async () => {
    // Hold the source-map fetch open so we can observe the chip's un-upgraded state before
    // resolving it — proves the pick never waits on this lookup.
    let resolveFetch: (res: Response) => void = () => {};
    globalThis.fetch = (() =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })) as unknown as typeof fetch;

    const tool = createSelectDesignTool();
    const ctx = makeCtx();
    tool.arm(ctx);
    await flush();

    const button = childWin.document.querySelector('button')!;
    button.dispatchEvent(new childWin.MouseEvent('click', { bubbles: true }));
    await flush();

    const beforeResolution = getPendingAttachments();
    assert.equal(beforeResolution.length, 1, 'chip pushed even though source-map lookup is still pending');
    assert.equal(beforeResolution[0].sourceMapping, undefined);

    resolveFetch({
      ok: true,
      json: async () => ({ file: 'pricing.html', line: 42, confidence: 'exact' }),
    } as Response);
    await flush();

    const afterResolution = getPendingAttachments();
    assert.equal(afterResolution.length, 1, 'still the same single chip, not a duplicate');
    assert.deepEqual(afterResolution[0].sourceMapping, {
      file: 'pricing.html',
      line: 42,
      confidence: 'exact',
    });

    tool.disarm();
  });

  test('picking the same element twice dedupes to one chip and one marker', async () => {
    const tool = createSelectDesignTool();
    const ctx = makeCtx();
    tool.arm(ctx);
    await flush();

    const button = childWin.document.querySelector('button')!;
    button.dispatchEvent(new childWin.MouseEvent('click', { bubbles: true }));
    await flush();
    button.dispatchEvent(new childWin.MouseEvent('click', { bubbles: true, shiftKey: true }));
    await flush();

    assert.equal(getPendingAttachments().length, 1);
    tool.disarm();
  });

  test('refreshGuestBinding re-attaches after the iframe guest reloads', async () => {
    const tool = createSelectDesignTool();
    const ctx = makeCtx();
    tool.arm(ctx);
    await flush();

    const button = childWin.document.querySelector('button')!;
    button.dispatchEvent(new childWin.MouseEvent('click', { bubbles: true }));
    await flush();
    assert.equal(getPendingAttachments().length, 1);

    const reloadedWin = new Window();
    reloadedWin.document.body.innerHTML = '<p class="headline">Reloaded</p>';
    const headline = reloadedWin.document.querySelector('p')!;
    headline.getBoundingClientRect = () =>
      ({ x: 8, y: 16, width: 120, height: 18, left: 8, top: 16, right: 128, bottom: 34, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(frame, 'contentWindow', { configurable: true, value: reloadedWin });
    Object.defineProperty(frame, 'contentDocument', { configurable: true, value: reloadedWin.document });

    headline.dispatchEvent(new reloadedWin.MouseEvent('click', { bubbles: true }));
    await flush();
    assert.equal(getPendingAttachments().length, 1, 'stale picker should not see the new document');

    tool.refreshGuestBinding();
    await flush();
    clearAttachments();

    headline.dispatchEvent(new reloadedWin.MouseEvent('click', { bubbles: true }));
    await flush();
    assert.equal(getPendingAttachments().length, 1);
    assert.equal(getPendingAttachments()[0]?.tagName, 'p');

    tool.disarm();
  });

  test('disarm clears overlay markers and disables the picker', async () => {
    const tool = createSelectDesignTool();
    const ctx = makeCtx();
    tool.arm(ctx);
    await flush();

    const button = childWin.document.querySelector('button')!;
    button.dispatchEvent(new childWin.MouseEvent('click', { bubbles: true }));
    await flush();
    assert.equal(getPendingAttachments().length, 1);
    assert.ok(host.querySelector('.mn-design-overlay-markers')!.childNodes.length > 0);

    tool.disarm();
    assert.equal(host.querySelector('.mn-design-overlay-markers')!.childNodes.length, 0);

    // A click after disarm must not add another chip — the iframe listener was detached.
    button.dispatchEvent(new childWin.MouseEvent('click', { bubbles: true }));
    await flush();
    assert.equal(getPendingAttachments().length, 1);
  });
});
