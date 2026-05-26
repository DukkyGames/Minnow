import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  assertNotAborted,
  benchmarkAbortError,
  isAbortError,
  raceWithAbort,
  rethrowIfAborted,
} from '../../src/benchmark/abort.ts';

describe('benchmark abort helpers', () => {
  test('assertNotAborted throws when signal is aborted', () => {
    const controller = new AbortController();
    controller.abort();
    assert.throws(() => assertNotAborted(controller.signal), (err: unknown) => {
      return isAbortError(err);
    });
  });

  test('isAbortError recognizes DOMException AbortError', () => {
    const err = new DOMException('cancelled', 'AbortError');
    assert.equal(isAbortError(err), true);
  });

  test('rethrowIfAborted propagates abort errors', () => {
    const controller = new AbortController();
    controller.abort();
    const err = benchmarkAbortError(controller.signal);
    assert.throws(() => rethrowIfAborted(err, controller.signal), (thrown: unknown) => {
      return isAbortError(thrown);
    });
  });

  test('rethrowIfAborted ignores non-abort errors', () => {
    const controller = new AbortController();
    assert.doesNotThrow(() => rethrowIfAborted(new Error('network'), controller.signal));
  });

  test('raceWithAbort rejects when signal aborts before work finishes', async () => {
    const controller = new AbortController();
    const pending = new Promise<string>(() => {
      /* never settles */
    });
    const raced = raceWithAbort(controller.signal, pending);
    controller.abort();
    await assert.rejects(raced, (err: unknown) => isAbortError(err));
  });
});
