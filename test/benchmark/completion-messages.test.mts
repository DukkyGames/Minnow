/**
 * Benchmark completion message helpers.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { applyBenchmarkSystemPrompt } from '../../src/benchmark/completion-messages.ts';

describe('applyBenchmarkSystemPrompt', () => {
  test('prepends system message when none exists', () => {
    const out = applyBenchmarkSystemPrompt([{ role: 'user', content: 'Hi' }]);
    assert.equal(out[0]?.role, 'system');
    assert.match(String(out[0]?.content), /main assistant message content/i);
  });

  test('merges with existing system message', () => {
    const out = applyBenchmarkSystemPrompt([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Hi' },
    ]);
    assert.equal(out.length, 2);
    assert.match(String(out[0]?.content), /Be brief/);
    assert.match(String(out[0]?.content), /main assistant message content/i);
  });
});
