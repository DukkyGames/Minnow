import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { isAbortError } from '../../src/benchmark/abort.ts';
import { runBenchmark } from '../../src/benchmark/runner.ts';
import { defaultSessionState } from '../../src/config/defaults.ts';
import { setSessionStateForTests } from '../../src/state/sessions.ts';

describe('runBenchmark cancellation', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.performance = window.performance;
    document.body.innerHTML =
      '<select id="modelSelect"><option value="bench-model" selected>Bench</option></select>';
    setSessionStateForTests(defaultSessionState());
  });

  afterEach(() => {
    setSessionStateForTests(null);
  });

  test('pre-aborted signal rejects with run-cancelled and no run-done', async () => {
    const controller = new AbortController();
    controller.abort();

    const events: string[] = [];
    await assert.rejects(
      () =>
        runBenchmark({
          preset: 'quick',
          suites: [],
          saveToHistory: false,
          signal: controller.signal,
          onProgress: (event) => {
            events.push(event.type);
          },
        }),
      (err: unknown) => isAbortError(err),
    );

    assert.ok(events.includes('run-cancelled'));
    assert.ok(!events.includes('run-done'));
    assert.ok(!events.includes('suite-start'));
  });
});
