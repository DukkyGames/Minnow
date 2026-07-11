import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { createAnnotationOverlay } from '../../src/design/overlay.ts';

describe('design annotation overlay', () => {
  let host: HTMLElement;

  beforeEach(() => {
    const win = new Window();
    globalThis.window = win as unknown as Window & typeof globalThis;
    globalThis.document = win.document;
    globalThis.ResizeObserver = win.ResizeObserver;
    globalThis.PointerEvent = win.PointerEvent;

    host = document.createElement('div');
    host.style.width = '400px';
    host.style.height = '300px';
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
    document.body.appendChild(host);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('render creates rect outlines and numbered badges', () => {
    const overlay = createAnnotationOverlay({ host });
    overlay.render([
      { id: 'a', index: 1, rect: { x: 10, y: 20, width: 100, height: 50 } },
      { id: 'b', index: 2, rect: { x: 140, y: 60, width: 80, height: 40 } },
    ]);

    const svg = host.querySelector('svg.mn-design-overlay');
    assert.ok(svg);
    const markerRects = svg!.querySelectorAll('.mn-design-overlay-markers rect');
    assert.equal(markerRects.length, 4);
    const labels = svg!.querySelectorAll('.mn-design-overlay-markers text');
    assert.equal(labels.length, 2);
    assert.equal(labels[0]?.textContent, '1');
    assert.equal(labels[1]?.textContent, '2');
    overlay.destroy();
  });

  test('mapGuestRect is identity at DPR 1 without host transform', () => {
    const overlay = createAnnotationOverlay({ host });
    const mapped = overlay.mapGuestRect(
      { x: 12, y: 34, width: 56, height: 78 },
      2,
    );
    assert.deepEqual(mapped, { x: 12, y: 34, width: 56, height: 78 });
    overlay.destroy();
  });

  test('mapGuestRect divides by host CSS scale when transformed', () => {
    const overlay = createAnnotationOverlay({ host });
    host.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 200,
        height: 150,
        right: 200,
        bottom: 150,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 400 });

    const mapped = overlay.mapGuestRect(
      { x: 20, y: 40, width: 100, height: 50 },
      1,
    );
    assert.deepEqual(mapped, { x: 40, y: 80, width: 200, height: 100 });
    overlay.destroy();
  });

  test('clear removes markers and destroy removes svg', () => {
    const overlay = createAnnotationOverlay({ host });
    overlay.render([{ id: 'a', index: 1, rect: { x: 0, y: 0, width: 10, height: 10 } }]);
    overlay.clear();
    assert.equal(host.querySelectorAll('.mn-design-overlay-markers rect').length, 0);
    overlay.destroy();
    assert.equal(host.querySelector('svg'), null);
  });

  test('free-draw emits coordinate-only rect', () => {
    const overlay = createAnnotationOverlay({ host });
    const emitted: Array<{ x: number; y: number; width: number; height: number }> = [];
    overlay.enableFreeDraw((rect) => emitted.push(rect));

    const svg = host.querySelector('svg.mn-design-overlay') as SVGSVGElement;
    assert.ok(svg);

    svg.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 20, clientY: 30, bubbles: true }),
    );
    svg.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 120, clientY: 130, bubbles: true }),
    );
    svg.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 120, clientY: 130, bubbles: true }),
    );

    assert.equal(emitted.length, 1);
    assert.deepEqual(emitted[0], { x: 20, y: 30, width: 100, height: 100 });
    overlay.destroy();
  });
});
