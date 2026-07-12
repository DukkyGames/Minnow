import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  getBenchmarkAbortControllerForTests,
  setBenchmarkAbortControllerForTests,
  stopRunForTests,
  updateRunStopButtonForTests,
  wireBenchmarkRunBarForTests,
} from '../../src/ui/benchmark-page.ts';
import { installBenchmarkTestGlobals } from '../os/dom-helpers.mts';

describe('benchmark stop wiring', () => {
  let win: Window | undefined;

  beforeEach(() => {
    win = new Window();
    installBenchmarkTestGlobals(win);
    document.body.innerHTML = '<button type="button" id="btnBenchmarkRun">Stop</button>';
    wireBenchmarkRunBarForTests();
  });

  afterEach(() => {
    setBenchmarkAbortControllerForTests(null);
    win?.close();
    win = undefined;
  });

  test('Run button label switches to Stop while running', () => {
    document.body.innerHTML = '<button type="button" id="btnBenchmarkRun">Run</button>';
    wireBenchmarkRunBarForTests();
    updateRunStopButtonForTests(true);
    const btn = document.getElementById('btnBenchmarkRun');
    assert.equal(btn?.textContent, 'Stop');
    updateRunStopButtonForTests(false);
    assert.equal(btn?.textContent, 'Run');
  });

  test('stopRun clears abort controller so Run can start again', () => {
    document.body.innerHTML = '<button type="button" id="btnBenchmarkRun">Stop</button>';
    wireBenchmarkRunBarForTests();
    setBenchmarkAbortControllerForTests(new AbortController());
    stopRunForTests();
    assert.equal(getBenchmarkAbortControllerForTests(), null);
  });

  test('stopRun aborts the active controller', () => {
    const controller = new AbortController();
    let aborted = false;
    controller.signal.addEventListener('abort', () => {
      aborted = true;
    });
    setBenchmarkAbortControllerForTests(controller);

    document.getElementById('btnBenchmarkRun')?.click();

    assert.equal(aborted, true);
    assert.equal(getBenchmarkAbortControllerForTests(), null);
  });
});
