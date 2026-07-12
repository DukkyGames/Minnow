/**
 * Draw & Comment tool composite region capture (MIN-367): overlay SVG rasterized onto the
 * cropped screenshot region. Uses the region-capture test hooks (`compositeOverlay`) the same
 * way region-capture.test.mts mocks `cropPngToDataUrl` — no real canvas/Image decode needed.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  captureRegionWithOverlay,
  resetRegionCaptureForTests,
  setRegionCaptureTestHooks,
  type RegionCaptureContext,
} from '../../src/design/region-capture.ts';

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('captureRegionWithOverlay', () => {
  const ctx: RegionCaptureContext = {
    selector: '[data-mn-uid="1"]',
    boundingRect: { x: 10, y: 20, width: 100, height: 50 },
    devicePixelRatio: 2,
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

  test('composites the overlay SVG onto the crop when a real crop is produced', async () => {
    const compositeCalls: Array<{ crop: unknown; dpr: number }> = [];
    setRegionCaptureTestHooks({
      capturePage: async () => TINY_PNG_BASE64,
      scrollIntoView: async () => {},
      getPageDimensions: async () => ({ pageW: 800, pageH: 600 }),
      cropPngToDataUrl: async () => ({ dataUrl: 'data:image/png;base64,CROP' }),
      compositeOverlay: async (cropDataUrl, svgMarkup, crop, dpr) => {
        compositeCalls.push({ crop, dpr });
        assert.equal(cropDataUrl, 'data:image/png;base64,CROP');
        assert.match(svgMarkup, /<svg/);
        return { dataUrl: 'data:image/png;base64,COMPOSITED' };
      },
    });

    const svgMarkup = '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="10" height="10"/></svg>';
    const captured = await captureRegionWithOverlay(ctx, svgMarkup);

    assert.equal(captured.cropped, true);
    assert.equal(captured.dataUrl, 'data:image/png;base64,COMPOSITED');
    assert.equal(compositeCalls.length, 1);
    assert.equal(compositeCalls[0]?.dpr, 2);
    // crop offset is boundingRect × devicePixelRatio (device px), matching computeCropRect's math.
    assert.deepEqual(compositeCalls[0]?.crop, { sx: 20, sy: 40, sw: 200, sh: 100 });
  });

  test('falls back to the plain crop when compositing reports taint', async () => {
    setRegionCaptureTestHooks({
      capturePage: async () => TINY_PNG_BASE64,
      scrollIntoView: async () => {},
      getPageDimensions: async () => ({ pageW: 800, pageH: 600 }),
      cropPngToDataUrl: async () => ({ dataUrl: 'data:image/png;base64,CROP' }),
      compositeOverlay: async () => ({ tainted: true }),
    });

    const captured = await captureRegionWithOverlay(ctx, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    assert.equal(captured.cropped, true);
    assert.equal(captured.dataUrl, 'data:image/png;base64,CROP');
  });

  test('skips compositing (and the base capture stays untouched) when there is no svg markup', async () => {
    let compositeCalled = false;
    setRegionCaptureTestHooks({
      capturePage: async () => TINY_PNG_BASE64,
      scrollIntoView: async () => {},
      getPageDimensions: async () => ({ pageW: 800, pageH: 600 }),
      cropPngToDataUrl: async () => ({ dataUrl: 'data:image/png;base64,CROP' }),
      compositeOverlay: async () => {
        compositeCalled = true;
        return { dataUrl: 'data:image/png;base64,SHOULD-NOT-HAPPEN' };
      },
    });

    const captured = await captureRegionWithOverlay(ctx, '');
    assert.equal(compositeCalled, false);
    assert.equal(captured.dataUrl, 'data:image/png;base64,CROP');
  });

  test('does not attempt to composite over an uncropped (full-page fallback) capture', async () => {
    let compositeCalled = false;
    setRegionCaptureTestHooks({
      capturePage: async () => TINY_PNG_BASE64,
      scrollIntoView: async () => {},
      getPageDimensions: async () => ({ pageW: 800, pageH: 600 }),
      cropPngToDataUrl: async () => ({ tainted: true }),
      uploadScreenshot: async () => ({ id: 'shot1', sizeBytes: 100 }),
      compositeOverlay: async () => {
        compositeCalled = true;
        return { dataUrl: 'data:image/png;base64,SHOULD-NOT-HAPPEN' };
      },
    });

    const captured = await captureRegionWithOverlay(ctx, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    assert.equal(compositeCalled, false);
    assert.equal(captured.cropped, false);
    assert.equal(captured.serverId, 'shot1');
  });
});
