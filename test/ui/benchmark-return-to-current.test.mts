import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { SuiteId, TestResult } from '../../src/benchmark/types.ts';

const FIXED_RESULT: TestResult = {
  testId: 'capability-smoke',
  suite: 'capability',
  label: 'Smoke',
  passed: true,
  skipped: false,
  durationMs: 120,
  score: 1,
};

describe('benchmark return to current run', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.HTMLButtonElement = window.HTMLButtonElement;
    globalThis.performance = window.performance;
    globalThis.CSS = {
      escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&'),
    };
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    };
    document.body.innerHTML = `
      <button type="button" id="benchmarkReturnToCurrent" class="hidden" hidden>Current run</button>
      <div id="benchmarkSuites"></div>
      <div id="benchmarkSummary"></div>
      <div id="benchmarkProgress" hidden></div>
    `;
  });

  afterEach(async () => {
    const {
      clearLiveTranscriptStateForTests,
      setViewingHistoryRunIdForTests,
    } = await import('../../src/ui/benchmark-page.ts');
    clearLiveTranscriptStateForTests();
    setViewingHistoryRunIdForTests(null);
  });

  test('return control is visible while viewing history during a live run', async () => {
    const {
      seedLiveRunUiStateForTests,
      setViewingHistoryRunIdForTests,
      syncReturnToCurrentControlForTests,
    } = await import('../../src/ui/benchmark-page.ts');

    seedLiveRunUiStateForTests({ suiteIds: ['capability'], results: [FIXED_RESULT] });
    setViewingHistoryRunIdForTests('saved-run-id');

    syncReturnToCurrentControlForTests();

    const btn = document.getElementById('benchmarkReturnToCurrent');
    assert.ok(btn);
    assert.equal(btn.classList.contains('hidden'), false);
    assert.equal(btn.hasAttribute('hidden'), false);
  });

  test('rebuildLiveBenchmarkView restores completed live cards after history', async () => {
    const {
      seedLiveRunUiStateForTests,
      rebuildLiveBenchmarkViewForTests,
    } = await import('../../src/ui/benchmark-page.ts');

    seedLiveRunUiStateForTests({ suiteIds: ['capability'], results: [FIXED_RESULT] });
    document.getElementById('benchmarkSuites')!.innerHTML =
      '<p class="benchmark-empty">Historical run placeholder</p>';

    rebuildLiveBenchmarkViewForTests();

    const card = document.querySelector(
      '.benchmark-test-card[data-test-id="capability-smoke"]',
    );
    assert.ok(card);
    assert.ok(document.getElementById('benchmarkSuites')?.classList.contains('is-live'));
  });

  test('returnToCurrentRunView clears history selection and restores live grid', async () => {
    const {
      seedLiveRunUiStateForTests,
      setViewingHistoryRunIdForTests,
      returnToCurrentRunViewForTests,
      isViewingHistoryRunForTests,
    } = await import('../../src/ui/benchmark-page.ts');

    document.body.innerHTML += `
      <select id="benchmarkHistorySelect">
        <option value="">View or compare a saved run…</option>
        <option value="saved-run-id" selected>saved</option>
      </select>
      <button type="button" id="benchmarkReturnToCurrent" class="hidden" hidden>Current run</button>
      <div id="benchmarkSuites"></div>
      <div id="benchmarkSummary"></div>
      <div id="benchmarkProgress" hidden></div>
    `;

    seedLiveRunUiStateForTests({ suiteIds: ['capability'], results: [FIXED_RESULT] });
    setViewingHistoryRunIdForTests('saved-run-id');
    document.getElementById('benchmarkSuites')!.innerHTML = '<p>history view</p>';

    returnToCurrentRunViewForTests();

    assert.equal(isViewingHistoryRunForTests(), false);
    const select = document.getElementById('benchmarkHistorySelect') as HTMLSelectElement;
    assert.equal(select.value, '');
    assert.ok(
      document.querySelector('.benchmark-test-card[data-test-id="capability-smoke"]'),
    );
  });
});
