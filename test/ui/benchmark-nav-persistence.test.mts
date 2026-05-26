import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  closeBenchmark,
  getBenchmarkAbortControllerForTests,
  isBenchmarkRunningInBackground,
  setBenchmarkAbortControllerForTests,
} from '../../src/ui/benchmark-page.ts';

describe('benchmark navigation persistence', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.HTMLButtonElement = window.HTMLButtonElement;
    globalThis.performance = window.performance;
    globalThis.CSS = window.CSS;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
    document.body.innerHTML = `
      <div id="appBody"></div>
      <div id="benchmarkView"></div>
    `;
    window.location.hash = '#/benchmark';
  });

  afterEach(() => {
    setBenchmarkAbortControllerForTests(null);
  });

  test('closeBenchmark does not abort an in-flight run', () => {
    const controller = new AbortController();
    setBenchmarkAbortControllerForTests(controller);
    document.getElementById('benchmarkView')?.classList.add('is-open');
    document.getElementById('appBody')?.classList.add('hidden');

    closeBenchmark();

    assert.equal(controller.signal.aborted, false);
    assert.equal(getBenchmarkAbortControllerForTests(), controller);
    assert.equal(isBenchmarkRunningInBackground(), true);
    assert.equal(document.getElementById('benchmarkView')?.classList.contains('is-open'), false);
  });
});
