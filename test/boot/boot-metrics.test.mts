import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { Window } from 'happy-dom';
import {
  getBootMetrics,
  readBootOriginMs,
  recordAppReadyMetrics,
  resetBootMetricsForTests,
} from '../../src/boot/boot-metrics.ts';
import { markAppReady } from '../../src/boot/app-ready.ts';

describe('boot metrics', () => {
  let win: Window;

  afterEach(() => {
    resetBootMetricsForTests();
    win?.close();
  });

  it('records app-ready delta from inline boot origin', () => {
    win = new Window();
    const g = globalThis as typeof globalThis & { window: Window; document: Document };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;

    win.window.__MINNOW_BOOT_ORIGIN_MS = 100;
    const snapshot = recordAppReadyMetrics(250);

    assert.equal(snapshot.appReadyMs, 150);
    assert.equal(getBootMetrics()?.appReadyMs, 150);
  });

  it('markAppReady stores metrics on window', () => {
    win = new Window();
    const g = globalThis as typeof globalThis & { window: Window; document: Document };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;

    win.window.__MINNOW_BOOT_ORIGIN_MS = 0;
    markAppReady();

    assert.ok(win.window.__MINNOW_BOOT_METRICS__);
    assert.ok(win.window.__MINNOW_BOOT_METRICS__!.appReadyMs >= 0);
  });

  it('readBootOriginMs falls back to now when unset', () => {
    win = new Window();
    const g = globalThis as typeof globalThis & { window: Window };
    g.window = win as unknown as Window & typeof globalThis.window;

    assert.equal(readBootOriginMs(42), 42);
  });
});
