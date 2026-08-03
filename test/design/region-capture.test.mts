import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { createAnnotationOverlay } from '../../src/design/overlay.ts';
import {
  computeCropRect,
  captureRegion,
  resetRegionCaptureForTests,
  setRegionCaptureTestHooks,
  type RegionCaptureContext,
} from '../../src/design/region-capture.ts';
import {
  resetDesignModeIframeGuestForTests,
  setDesignModeUsingIframeGuest,
} from '../../src/ui/preview-design-mode-guest.ts';

describe('region-capture computeCropRect', () => {
  test('dpr=1 identity mapping', () => {
    const crop = computeCropRect({ x: 10, y: 20, width: 100, height: 50 }, 1, 800, 600);
    assert.deepEqual(crop, { sx: 10, sy: 20, sw: 100, sh: 50 });
  });

  test('dpr=2 scales guest CSS rect to device pixels', () => {
    const crop = computeCropRect({ x: 10, y: 20, width: 100, height: 50 }, 2, 1600, 1200);
    assert.deepEqual(crop, { sx: 20, sy: 40, sw: 200, sh: 100 });
  });

  test('clamps overflow so sw equals pageW - sx and dimensions stay >= 1', () => {
    const crop = computeCropRect({ x: 790, y: 580, width: 40, height: 40 }, 1, 800, 600);
    assert.equal(crop.sx, 790);
    assert.equal(crop.sw, 10);
    assert.equal(crop.sy, 580);
    assert.equal(crop.sh, 20);
    assert.ok(crop.sw >= 1);
    assert.ok(crop.sh >= 1);
  });

  test('rounds fractional dpr to integer device pixels', () => {
    const crop = computeCropRect({ x: 1.5, y: 2.5, width: 3.5, height: 4.5 }, 1.25, 500, 500);
    assert.deepEqual(crop, { sx: 2, sy: 3, sw: 4, sh: 6 });
  });
});

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('region-capture captureRegion', () => {
  const ctx: RegionCaptureContext = {
    selector: '#hero',
    boundingRect: { x: 10, y: 20, width: 100, height: 50 },
    devicePixelRatio: 1,
  };

  beforeEach(() => {
    const win = new Window();
    globalThis.window = win as unknown as Window & typeof globalThis;
    globalThis.document = win.document;
    globalThis.Image = win.Image;
    globalThis.ResizeObserver = win.ResizeObserver;
    resetRegionCaptureForTests();
  });

  afterEach(() => {
    resetRegionCaptureForTests();
  });

  test('Electron Design Mode iframe guest: never calls the hanging native capturePage', async () => {
    // Real runtime path (no test hooks). The native WebContentsView capturePage() is hidden and
    // would block until Design Mode exits, so captureRegion must short-circuit to an outline-only
    // result and let the composer chip appear immediately.
    resetRegionCaptureForTests();
    Object.assign(globalThis.window, {
      minnow: {
        preview: {
          capturePage: async () => { throw new Error('capturePage must not be called'); },
          getInfo: async () => { throw new Error('getInfo must not be called'); },
        },
      },
    });
    setDesignModeUsingIframeGuest('workspace-preview', true);

    const captured = await captureRegion(ctx);
    assert.equal(captured.cropped, false);
    assert.equal(captured.dataUrl, undefined);
    assert.equal(captured.selector, '#hero');
    assert.match(captured.error ?? '', /design-mode/i);

    resetDesignModeIframeGuestForTests();
    Object.assign(globalThis.window, { minnow: undefined });
  });

  test('inline path returns a cropped data URL', async () => {
    setRegionCaptureTestHooks({
      capturePage: async () => TINY_PNG_BASE64,
      scrollIntoView: async () => {},
      getPageDimensions: async () => ({ pageW: 800, pageH: 600 }),
      cropPngToDataUrl: async () => ({ dataUrl: 'data:image/png;base64,abc' }),
    });

    const captured = await captureRegion(ctx);
    assert.equal(captured.cropped, true);
    assert.equal(captured.dataUrl, 'data:image/png;base64,abc');
    assert.equal(captured.selector, '#hero');
    assert.deepEqual(captured.boundingRect, ctx.boundingRect);
  });

  test('tainted fallback uploads full page and records server url', async () => {
    const uploads: string[] = [];
    setRegionCaptureTestHooks({
      capturePage: async () => TINY_PNG_BASE64,
      scrollIntoView: async () => {},
      getPageDimensions: async () => ({ pageW: 800, pageH: 600 }),
      cropPngToDataUrl: async () => ({ tainted: true }),
      uploadScreenshot: async (dataBase64) => {
        uploads.push(dataBase64);
        return { id: 'shot1', sizeBytes: 2048 };
      },
    });

    const captured = await captureRegion(ctx);
    assert.equal(uploads.length, 1);
    assert.equal(captured.cropped, false);
    assert.equal(captured.serverId, 'shot1');
    assert.equal(captured.url, '/api/browser/screenshot/shot1');
    assert.match(captured.error ?? '', /full page — region @ 10,20 100×50/);

    const overlayHost = document.createElement('div');
    document.body.appendChild(overlayHost);
    const overlay = createAnnotationOverlay({ host: overlayHost });
    overlay.pinCaptureToMarker('sel-1', captured);
    overlay.render([{ id: 'sel-1', index: 1, rect: ctx.boundingRect }]);
    const label = overlayHost.querySelector('text');
    assert.equal(label?.textContent, '1*');
    const title = overlayHost.querySelector('title');
    assert.match(title?.textContent ?? '', /full page — region @/);
    overlay.destroy();
  });

  test('missing preview capture reports an error without crashing', async () => {
    setRegionCaptureTestHooks({
      capturePage: async () => '',
    });

    const captured = await captureRegion(ctx);
    assert.equal(captured.cropped, false);
    assert.equal(captured.error, 'preview capture unavailable');
  });

  test('capturePage rejection is surfaced as an error result', async () => {
    setRegionCaptureTestHooks({
      capturePage: async () => {
        throw new Error('preview guest is still loading');
      },
    });

    const captured = await captureRegion(ctx);
    assert.equal(captured.cropped, false);
    assert.equal(captured.error, 'preview guest is still loading');
  });
});
