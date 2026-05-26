/**
 * BUG-002: streamTurn accumulates reasoning deltas via SSE buffer (unit probe).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createSseEventBuffer, feedSseEventBuffer, flushSseEventBuffer } from '../../src/api/sse-parse.ts';
import { BenchmarkStreamTextAccumulator } from '../../src/benchmark/stream-text.ts';
import type { ChatCompletionChunk } from '../../src/types.ts';

/** Mirror streamTurn handleChunk accumulation for fixtures. */
function accumulateFromSseBytes(sse: string): string {
  const textAcc = new BenchmarkStreamTextAccumulator();
  const buffer = createSseEventBuffer();
  const handleChunk = (chunk: ChatCompletionChunk): void => {
    textAcc.ingestChunk(chunk);
  };
  feedSseEventBuffer(buffer, sse, handleChunk);
  flushSseEventBuffer(buffer, handleChunk);
  return textAcc.getText();
}

describe('benchmark SSE accumulation (streamTurn pattern)', () => {
  test('reasoning-only stream does not count as completion text', () => {
    const sse =
      'data: {"choices":[{"delta":{"reasoning_content":"hello"}}]}\n\n' +
      'data: {"choices":[{"finish_reason":"stop"}]}\n\n' +
      'data: [DONE]\n\n';
    assert.equal(accumulateFromSseBytes(sse), '');
  });

  test('content stream produces prose', () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
      'data: [DONE]\n\n';
    assert.equal(accumulateFromSseBytes(sse), 'hi');
  });
});
