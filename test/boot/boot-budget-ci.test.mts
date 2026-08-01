/**
 * CI boot budget — happy-dom harness for scheduleMarkAppReady (loader dismiss path).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import {
  APP_CSS_READY_PROPERTY,
  scheduleMarkAppReady,
} from '../../src/boot/app-ready.ts';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const budgets = JSON.parse(readFileSync(path.join(REPO_ROOT, 'budgets.json'), 'utf8'));

type BootGlobals = typeof globalThis & {
  document: Document;
  window: Window;
  getComputedStyle: typeof getComputedStyle;
  requestAnimationFrame: typeof requestAnimationFrame;
};

function installWindow(win: Window): void {
  const g = globalThis as BootGlobals;
  g.document = win.document;
  g.window = win as unknown as Window & typeof globalThis.window;
  g.getComputedStyle = win.getComputedStyle.bind(win);
  g.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    win.setTimeout(() => cb(win.performance.now()), 4)) as typeof requestAnimationFrame;
}

function applyAppCss(win: Window): void {
  const style = win.document.createElement('style');
  style.textContent = `:root { ${APP_CSS_READY_PROPERTY}: 1; }`;
  win.document.head.appendChild(style);
}

describe('boot budget (CI harness)', () => {
  let win: Window;

  afterEach(() => {
    win?.close();
  });

  it('scheduleMarkAppReady completes within startup harness ceiling', async () => {
    win = new Window();
    installWindow(win);
    win.window.__MINNOW_BOOT_ORIGIN_MS = win.performance.now();
    applyAppCss(win);

    const started = win.performance.now();
    scheduleMarkAppReady();

    await new Promise<void>((resolve) => {
      const deadline = started + budgets.startup.appReadyHarnessMaxMs;
      const tick = () => {
        if (win.document.documentElement.classList.contains('app-ready')) {
          resolve();
          return;
        }
        if (win.performance.now() >= deadline) {
          resolve();
          return;
        }
        win.setTimeout(tick, 8);
      };
      tick();
    });

    const elapsed = win.performance.now() - started;
    assert.ok(
      win.document.documentElement.classList.contains('app-ready'),
      'expected app-ready class',
    );
    assert.ok(
      elapsed <= budgets.startup.appReadyHarnessMaxMs,
      `boot harness took ${elapsed.toFixed(1)} ms (limit ${budgets.startup.appReadyHarnessMaxMs} ms)`,
    );

    const metrics = win.window.__MINNOW_BOOT_METRICS__;
    assert.ok(metrics);
    assert.ok(metrics!.appReadyMs <= budgets.startup.appReadyHarnessMaxMs);
  });
});
