import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  getBenchmarkAbortControllerForTests,
  setBenchmarkAbortControllerForTests,
  stopRunForTests,
  updateRunStopButtonForTests,
} from '../../src/ui/benchmark-page.ts';

describe('benchmark stop wiring', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.HTMLButtonElement = window.HTMLButtonElement;
    globalThis.performance = window.performance;
    document.body.innerHTML = '<button type="button" id="btnBenchmarkRun">Stop</button>';
  });

  afterEach(() => {
    setBenchmarkAbortControllerForTests(null);
  });

  test('Run button label switches to Stop while running', () => {
    document.body.innerHTML = '<button type="button" id="btnBenchmarkRun">Run</button>';
    updateRunStopButtonForTests(true);
    const btn = document.getElementById('btnBenchmarkRun');
    assert.equal(btn?.textContent, 'Stop');
    updateRunStopButtonForTests(false);
    assert.equal(btn?.textContent, 'Run');
  });

  test('stopRun clears abort controller so Run can start again', () => {
    document.body.innerHTML = '<button type="button" id="btnBenchmarkRun">Stop</button>';
    setBenchmarkAbortControllerForTests(new AbortController());
    stopRunForTests();
    assert.equal(getBenchmarkAbortControllerForTests(), null);
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
    document.getElementById('btnBenchmarkRun')?.click();

    assert.equal(aborted, true);
    assert.equal(getBenchmarkAbortControllerForTests(), null);
  });
});
