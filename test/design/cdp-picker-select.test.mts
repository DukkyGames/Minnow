/**
 * CDP picking routing + renderer-side lifecycle (MIN-370 P7): shouldUseCdpPicker() gating and
 * createCdpElementPicker()'s enable/disable against a mocked window.minnow.preview.cdpPicker.
 * The CDP → PickedElement adapter itself is tested without any DOM in
 * test/electron/preview-cdp-adapt.test.mjs; this file covers the renderer wiring around it.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  createBestElementPicker,
  createCdpElementPicker,
  shouldUseCdpPicker,
  type PickedElement,
} from '../../src/design/element-picker.ts';
import {
  resetDesignModeIframeGuestForTests,
  setDesignModeUsingIframeGuest,
} from '../../src/ui/preview-design-mode-guest.ts';
import {
  DEFAULT_FILE_PANEL_STATE,
  resetFilePanelStateForTests,
  setFilePanelState,
} from '../../src/state/file-panel.ts';

const SAMPLE_PICK: PickedElement = {
  uid: 1,
  cssSelector: '#buy-now',
  tagName: 'button',
  classList: ['cta'],
  outerHTMLPreview: '<button id="buy-now">Buy now</button>',
  boundingRect: { x: 12, y: 24, width: 96, height: 32 },
  devicePixelRatio: 2,
  stylesDigest: 'font:14px/20px Inter 400; color:rgb(0,0,0); bg:rgb(255,255,255); p:0 m:0; layout:flex',
  shiftKey: false,
  accessibleName: 'Buy now',
  contrastRatio: 21,
  domPath: 'body > button#buy-now',
  attributes: { id: 'buy-now' },
  computedStyles: { color: 'rgb(0,0,0)', display: 'flex' },
};

function mockCdpPicker(overrides: Partial<Record<string, unknown>> = {}) {
  const pickListeners: Array<(picked: PickedElement) => void> = [];
  const errorListeners: Array<(message: string) => void> = [];
  return {
    enable: async () => ({ ok: true }),
    disable: async () => {},
    onPick: (cb: (picked: PickedElement) => void) => {
      pickListeners.push(cb);
      return () => {
        const i = pickListeners.indexOf(cb);
        if (i >= 0) pickListeners.splice(i, 1);
      };
    },
    onError: (cb: (message: string) => void) => {
      errorListeners.push(cb);
      return () => {
        const i = errorListeners.indexOf(cb);
        if (i >= 0) errorListeners.splice(i, 1);
      };
    },
    emitPick: (picked: PickedElement) => pickListeners.forEach((cb) => cb(picked)),
    emitError: (message: string) => errorListeners.forEach((cb) => cb(message)),
    ...overrides,
  };
}

describe('CDP picking routing + lifecycle (MIN-370)', () => {
  beforeEach(() => {
    // happy-dom's `location` is a getter-only accessor — Object.assign(window, {location:{...}})
    // silently no-ops. Set the origin via the Window constructor's `url` option instead.
    const win = new Window({ url: 'http://127.0.0.1:5173/' });
    globalThis.window = win as unknown as Window & typeof globalThis;
    globalThis.document = win.document;
    resetFilePanelStateForTests();
    resetDesignModeIframeGuestForTests();
  });

  afterEach(() => {
    resetFilePanelStateForTests();
    resetDesignModeIframeGuestForTests();
    (globalThis.window as unknown as { minnow?: unknown }).minnow = undefined;
  });

  test('shouldUseCdpPicker is false without window.minnow (npm start / non-Electron)', () => {
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      previewSource: { kind: 'url', url: 'https://example.com' },
    });
    assert.equal(shouldUseCdpPicker(), false);
  });

  test('shouldUseCdpPicker is false for same-origin pages even in Electron', () => {
    (globalThis.window as any).minnow = { preview: { cdpPicker: mockCdpPicker() } };
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      previewSource: { kind: 'url', url: 'http://127.0.0.1:5173/app' },
    });
    assert.equal(shouldUseCdpPicker(), false);
  });

  test('shouldUseCdpPicker is false for workspace (static HTML) pages', () => {
    (globalThis.window as any).minnow = { preview: { cdpPicker: mockCdpPicker() } };
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      previewSource: { kind: 'workspace', path: 'pricing.html' },
    });
    assert.equal(shouldUseCdpPicker(), false);
  });

  test('shouldUseCdpPicker is true for cross-origin URLs in Electron', () => {
    (globalThis.window as any).minnow = { preview: { cdpPicker: mockCdpPicker() } };
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      previewSource: { kind: 'url', url: 'https://example.com/pricing' },
    });
    assert.equal(shouldUseCdpPicker(), true);
  });

  test('shouldUseCdpPicker is false while Design Mode uses the iframe guest (Draw/Comment on cross-origin)', () => {
    (globalThis.window as any).minnow = { preview: { cdpPicker: mockCdpPicker() } };
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      previewSource: { kind: 'url', url: 'https://example.com/pricing' },
    });
    setDesignModeUsingIframeGuest(true);
    assert.equal(shouldUseCdpPicker(), false);
  });

  test('createCdpElementPicker: enable subscribes and forwards picks to onPick', async () => {
    const cdp = mockCdpPicker();
    (globalThis.window as any).minnow = { preview: { cdpPicker: cdp } };

    const received: PickedElement[] = [];
    const picker = createCdpElementPicker({ onPick: (picked) => void received.push(picked) });
    await picker.enable();
    assert.equal(picker.isEnabled(), true);

    cdp.emitPick(SAMPLE_PICK);
    assert.equal(received.length, 1);
    assert.equal(received[0].cssSelector, '#buy-now');
  });

  test('createCdpElementPicker: enable failure surfaces onError and does not mark enabled', async () => {
    const cdp = mockCdpPicker({ enable: async () => ({ ok: false, error: 'CDP attach failed' }) });
    (globalThis.window as any).minnow = { preview: { cdpPicker: cdp } };

    const errors: string[] = [];
    const picker = createCdpElementPicker({
      onPick: () => {},
      onError: (message) => errors.push(message),
    });
    await picker.enable();
    assert.equal(picker.isEnabled(), false);
    assert.deepEqual(errors, ['CDP attach failed']);
  });

  test('createCdpElementPicker: disable unsubscribes and stops forwarding picks', async () => {
    const cdp = mockCdpPicker();
    (globalThis.window as any).minnow = { preview: { cdpPicker: cdp } };

    const received: PickedElement[] = [];
    const picker = createCdpElementPicker({ onPick: (picked) => void received.push(picked) });
    await picker.enable();
    await picker.disable();
    assert.equal(picker.isEnabled(), false);

    cdp.emitPick(SAMPLE_PICK);
    assert.equal(received.length, 0);
  });

  test('createCdpElementPicker: no window.minnow surfaces a clear error instead of throwing', async () => {
    const errors: string[] = [];
    const picker = createCdpElementPicker({
      onPick: () => {},
      onError: (message) => errors.push(message),
    });
    await picker.enable();
    assert.equal(picker.isEnabled(), false);
    assert.equal(errors.length, 1);
  });

  test('createBestElementPicker routes to CDP for cross-origin Electron guests', async () => {
    const cdp = mockCdpPicker();
    (globalThis.window as any).minnow = { preview: { cdpPicker: cdp, execJs: async () => ({}) } };
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      previewSource: { kind: 'url', url: 'https://example.com/pricing' },
    });

    const received: PickedElement[] = [];
    const picker = createBestElementPicker({ onPick: (picked) => void received.push(picked) });
    await picker.enable();

    cdp.emitPick(SAMPLE_PICK);
    assert.equal(received.length, 1, 'best picker should have routed to the CDP implementation');
  });

  test('createBestElementPicker falls back to execJs/iframe for same-origin pages', async () => {
    const cdp = mockCdpPicker();
    let execJsCalls = 0;
    (globalThis.window as any).minnow = {
      preview: {
        cdpPicker: cdp,
        execJs: async () => {
          execJsCalls += 1;
          return { ok: true };
        },
      },
    };
    setFilePanelState({
      ...DEFAULT_FILE_PANEL_STATE,
      previewSource: { kind: 'url', url: 'http://127.0.0.1:5173/app' },
    });

    const picker = createBestElementPicker({ onPick: () => {} });
    await picker.enable();
    assert.ok(execJsCalls > 0, 'should have used the execJs transport, not CDP');
  });
});
