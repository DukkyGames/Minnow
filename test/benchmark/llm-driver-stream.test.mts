/**
 * Benchmark SSE accumulation and inline-thinking split (streamTurn pattern).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { extractInlineThinkingFromContent } from '../../src/api/inline-thinking.ts';
import { finalizeToolCalls, mergeToolCallDelta } from '../../src/api/chat.ts';
import { createSseEventBuffer, feedSseEventBuffer, flushSseEventBuffer } from '../../src/api/sse-parse.ts';
import { mergeContentJsonToolCalls } from '../../src/providers/constrained-tool-content.ts';
import {
  BenchmarkStreamContentRouter,
  BenchmarkStreamReasoningAccumulator,
  BenchmarkStreamTextAccumulator,
  resolveBenchmarkCompletionText,
} from '../../src/benchmark/stream-text.ts';
import type { ChatCompletionChunk, ToolCallAccumulator } from '../../src/types.ts';

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

function accumulateRoutedFromSseBytes(sse: string, modelId = 'qwen3-8b'): {
  contentText: string;
  reasoningText: string;
  toolCalls: ReturnType<typeof finalizeToolCalls>;
} {
  const router = new BenchmarkStreamContentRouter(modelId);
  let toolAcc: ToolCallAccumulator = {};
  const buffer = createSseEventBuffer();
  const handleChunk = (chunk: ChatCompletionChunk): void => {
    toolAcc = mergeToolCallDelta(toolAcc, chunk);
    const reasoningDelta = chunk.choices?.[0]?.delta?.reasoning_content;
    if (typeof reasoningDelta === 'string' && reasoningDelta) {
      router.ingestReasoningDelta(reasoningDelta);
    }
    const contentDelta = chunk.choices?.[0]?.delta?.content;
    if (typeof contentDelta === 'string' && contentDelta) {
      router.ingestContentDelta(contentDelta);
    }
  };
  feedSseEventBuffer(buffer, sse, handleChunk);
  flushSseEventBuffer(buffer, handleChunk);
  router.flush();

  let contentText = router.getProseText();
  let reasoningText = router.getReasoningText();
  const split = extractInlineThinkingFromContent(contentText);
  if (split.thinking.length && split.reply.trim()) {
    reasoningText = [reasoningText, ...split.thinking].filter(Boolean).join('\n\n');
    contentText = split.reply;
  }

  const toolCalls = mergeContentJsonToolCalls(contentText, finalizeToolCalls(toolAcc), {
    harmonyParseText: router.getCommentaryParseText(),
  });

  return { contentText, reasoningText, toolCalls };
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

  test('inline redacted_thinking in content splits into reasoning and reply', () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"<think>1.10 - 1.00</think> The ball costs $0.05."}}]}\n\n' +
      'data: [DONE]\n\n';
    const { contentText, reasoningText } = accumulateRoutedFromSseBytes(sse);
    assert.equal(contentText.trim(), 'The ball costs $0.05.');
    assert.match(reasoningText, /1\.10 - 1\.00/);
  });

  test('constrained tool_calls JSON in content is parsed', () => {
    const payload = JSON.stringify({
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"README.md"}' },
        },
      ],
    });
    const sse =
      `data: {"choices":[{"delta":{"content":${JSON.stringify(payload)}}}]}\n\n` +
      'data: [DONE]\n\n';
    const { toolCalls } = accumulateRoutedFromSseBytes(sse);
    assert.equal(toolCalls.length, 1);
    assert.equal(toolCalls[0]?.function.name, 'read_file');
    assert.match(toolCalls[0]?.function.arguments ?? '', /README/);
  });
});
