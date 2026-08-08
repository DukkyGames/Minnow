/**
 * CI boot budget — happy-dom harness for scheduleMarkAppReady (loader dismiss path).
 * CSS sentinel is applied AFTER the timer starts so the harness actually waits for
 * whenAppShellStyled. Chrome-ready is signaled separately (dual-gate).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';
import {
  APP_CSS_READY_PROPERTY,
  markChromeReady,
  resetAppReadyForTests,
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
    resetAppReadyForTests();
    win?.close();
  });

  it('scheduleMarkAppReady completes within startup harness ceiling', async () => {
    win = new Window();
    installWindow(win);
    win.document.body.innerHTML =
      '<div id="app-loader" class="app-loader" aria-busy="true"></div>';
    win.window.__MINNOW_BOOT_ORIGIN_MS = win.performance.now();

    const started = win.performance.now();
    scheduleMarkAppReady();
    // Apply CSS after the timer starts — mirrors real boot where stylesheet arrives async.
    win.setTimeout(() => {
      applyAppCss(win);
      // Dual-gate: chrome paint must also signal before the loader dismisses.
      markChromeReady();
    }, 12);

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

    const elapsed = win.performance.now();
    const delta = elapsed - started;
    assert.ok(
      win.document.documentElement.classList.contains('app-ready'),
      'expected app-ready class',
    );
    assert.ok(
      delta <= budgets.startup.appReadyHarnessMaxMs,
      `boot harness took ${delta.toFixed(1)} ms (limit ${budgets.startup.appReadyHarnessMaxMs} ms)`,
    );
    // Gate must not resolve before CSS is applied (previously ~20 ms with pre-seeded sentinel).
    assert.ok(
      delta >= 12,
      `boot harness resolved too fast (${delta.toFixed(1)} ms) — CSS sentinel may have been pre-applied`,
    );

    const metrics = win.window.__MINNOW_BOOT_METRICS__;
    assert.ok(metrics);
    assert.ok(metrics!.appReadyMs <= budgets.startup.appReadyHarnessMaxMs);
  });

  it('does not dismiss the loader on CSS alone without chrome-ready', async () => {
    win = new Window();
    installWindow(win);
    win.document.body.innerHTML =
      '<div id="app-loader" class="app-loader" aria-busy="true"></div>';

    scheduleMarkAppReady();
    applyAppCss(win);

    await new Promise<void>((resolve) => win.setTimeout(resolve, 80));

    assert.equal(
      win.document.documentElement.classList.contains('app-ready'),
      false,
      'loader must wait for chrome-ready',
    );
  });
});
