/**
 * BUG-002: streamTurn accumulates reasoning deltas via SSE buffer (unit probe).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createSseEventBuffer, feedSseEventBuffer, flushSseEventBuffer } from '../../src/api/sse-parse.ts';
import {
  BenchmarkStreamReasoningAccumulator,
  BenchmarkStreamTextAccumulator,
  resolveBenchmarkCompletionText,
} from '../../src/benchmark/stream-text.ts';
import type { ChatCompletionChunk } from '../../src/types.ts';

/** Mirror streamTurn handleChunk accumulation for fixtures. */
function accumulateFromSseBytes(sse: string): string {
  const textAcc = new BenchmarkStreamTextAccumulator();
  const reasoningAcc = new BenchmarkStreamReasoningAccumulator();
  const buffer = createSseEventBuffer();
  const handleChunk = (chunk: ChatCompletionChunk): void => {
    textAcc.ingestChunk(chunk);
    reasoningAcc.ingestChunk(chunk);
  };
  feedSseEventBuffer(buffer, sse, handleChunk);
  flushSseEventBuffer(buffer, handleChunk);
  return resolveBenchmarkCompletionText(textAcc.getText(), reasoningAcc.getText());
}

function countStreamChunksFromSseBytes(sse: string): number {
  const buffer = createSseEventBuffer();
  let streamChunkCount = 0;
  const handleChunk = (): void => {
    streamChunkCount += 1;
  };
  feedSseEventBuffer(buffer, sse, handleChunk);
  flushSseEventBuffer(buffer, handleChunk);
  return streamChunkCount;
}

describe('benchmark SSE accumulation (streamTurn pattern)', () => {
  test('reasoning-only stream uses reasoning as completion text', () => {
    const sse =
      'data: {"choices":[{"delta":{"reasoning_content":"hello"}}]}\n\n' +
      'data: {"choices":[{"finish_reason":"stop"}]}\n\n' +
      'data: [DONE]\n\n';
    assert.equal(accumulateFromSseBytes(sse), 'hello');
  });

  test('content stream produces prose', () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n' +
      'data: [DONE]\n\n';
    assert.equal(accumulateFromSseBytes(sse), 'hi');
  });

  test('counts one handleChunk per SSE data event (streamTurn telemetry)', () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"b"}}]}\n\n' +
      'data: [DONE]\n\n';
    assert.equal(countStreamChunksFromSseBytes(sse), 2);
  });
});
