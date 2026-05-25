import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  getBenchmarkAbortControllerForTests,
  setBenchmarkAbortControllerForTests,
} from '../../src/ui/benchmark-page.ts';

describe('benchmark stop wiring', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.performance = window.performance;
    document.body.innerHTML = '<button type="button" id="btnBenchmarkStop">Stop</button>';
  });

  afterEach(() => {
    setBenchmarkAbortControllerForTests(null);
  });

  test('stopRun aborts the active controller', async () => {
    const controller = new AbortController();
    let aborted = false;
    controller.signal.addEventListener('abort', () => {
      aborted = true;
    });
    setBenchmarkAbortControllerForTests(controller);

    const { initBenchmarkPage } = await import('../../src/ui/benchmark-page.ts');
    initBenchmarkPage();
    document.getElementById('btnBenchmarkStop')?.click();

    assert.equal(aborted, true);
    assert.equal(getBenchmarkAbortControllerForTests(), controller);
  });
});
