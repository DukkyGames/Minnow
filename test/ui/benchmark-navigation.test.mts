import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  closeBenchmark,
  getBenchmarkAbortControllerForTests,
  setBenchmarkAbortControllerForTests,
} from '../../src/ui/benchmark-page.ts';

describe('benchmark navigation persistence', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.performance = window.performance;

    document.body.innerHTML = `
      <div id="appBody"></div>
      <div id="benchmarkView" class="benchmark-page is-open"></div>
    `;
    window.location.hash = '#/benchmark';
  });

  afterEach(() => {
    setBenchmarkAbortControllerForTests(null);
  });

  test('closeBenchmark does not abort an in-flight client run', () => {
    const controller = new AbortController();
    let aborted = false;
    controller.signal.addEventListener('abort', () => {
      aborted = true;
    });
    setBenchmarkAbortControllerForTests(controller);

    closeBenchmark();

    assert.equal(aborted, false);
    assert.equal(getBenchmarkAbortControllerForTests(), controller);
    assert.equal(document.getElementById('benchmarkView')?.classList.contains('is-open'), false);
  });
});
