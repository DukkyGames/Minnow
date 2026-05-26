import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { SuiteId, TestResult } from '../../src/benchmark/types.ts';
import {
  isBackToCurrentVisibleForTests,
  restoreCurrentRunViewForTests,
  seedLiveRunPanelForTests,
  setBenchmarkAbortControllerForTests,
  setBrowsingHistoryForTests,
} from '../../src/ui/benchmark-page.ts';

const SAMPLE_RESULT: TestResult = {
  testId: 'cap-stream',
  suite: 'capability',
  label: 'Streaming',
  passed: true,
  skipped: false,
  durationMs: 1200,
  score: 1,
};

describe('benchmark history browse', () => {
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
    document.body.innerHTML = '';
  });

  afterEach(() => {
    setBenchmarkAbortControllerForTests(null);
    setBrowsingHistoryForTests(false);
  });

  test('back-to-current control is hidden until browsing history during a live run', () => {
    seedLiveRunPanelForTests({ suiteIds: ['capability' as SuiteId], results: [SAMPLE_RESULT] });
    assert.equal(isBackToCurrentVisibleForTests(), false);

    setBrowsingHistoryForTests(true);
    assert.equal(isBackToCurrentVisibleForTests(), true);
  });

  test('restoreCurrentRunView rebuilds the live suite panel', () => {
    seedLiveRunPanelForTests({
      suiteIds: ['capability' as SuiteId],
      results: [SAMPLE_RESULT],
      running: { testId: 'cap-multimodal', suite: 'capability', label: 'Multimodal' },
    });
    setBrowsingHistoryForTests(true);

    const mount = document.getElementById('benchmarkSuites');
    mount!.innerHTML = '<p class="benchmark-empty">Saved run placeholder</p>';
    mount!.classList.remove('is-live');

    restoreCurrentRunViewForTests();

    assert.equal(isBackToCurrentVisibleForTests(), false);
    assert.ok(mount!.classList.contains('is-live'));
    assert.ok(mount!.querySelector('[data-test-id="cap-stream"]'));
    assert.ok(mount!.querySelector('[data-test-id="cap-multimodal"].is-running'));
  });
});
