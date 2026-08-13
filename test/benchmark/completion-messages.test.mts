/**
 * Benchmark completion message helpers.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { applyBenchmarkSystemPrompt } from '../../src/benchmark/completion-messages.ts';

describe('applyBenchmarkSystemPrompt', () => {
  test('returns messages unchanged when no extra system is provided', () => {
    const input = [{ role: 'user' as const, content: 'Hi' }];
    const out = applyBenchmarkSystemPrompt(input);
    assert.equal(out.length, 1);
    assert.equal(out[0]?.role, 'user');
    assert.equal(out[0]?.content, 'Hi');
  });

  test('prepends extra system when none exists', () => {
    const out = applyBenchmarkSystemPrompt([{ role: 'user', content: 'Hi' }], {
      extraSystem: 'Be brief.',
    });
    assert.equal(out[0]?.role, 'system');
    assert.match(String(out[0]?.content), /Be brief/);
  });

  test('merges extra system with existing system message', () => {
    const out = applyBenchmarkSystemPrompt(
      [
        { role: 'system', content: 'Mode prompt.' },
        { role: 'user', content: 'Hi' },
      ],
      { extraSystem: 'Be brief.' },
    );
    assert.equal(out.length, 2);
    assert.match(String(out[0]?.content), /Mode prompt/);
    assert.match(String(out[0]?.content), /Be brief/);
  });
});
