import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { setChatFetchAbort } from '../../src/app-state.ts';
import { stopGeneration } from '../../src/chat/stop-generation.ts';

describe('stopGeneration', () => {
  test('calls abort() when chatFetchAbort is set', () => {
    let aborted = false;
    const controller = new AbortController();
    controller.signal.addEventListener('abort', () => {
      aborted = true;
    });
    setChatFetchAbort(controller);
    stopGeneration();
    assert.equal(aborted, true);
    setChatFetchAbort(null);
  });

  test('no-op when chatFetchAbort is null', () => {
    setChatFetchAbort(null);
    assert.doesNotThrow(() => stopGeneration());
  });
});
