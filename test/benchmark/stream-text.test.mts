/**
 * Benchmark stream text accumulation (prose only; not reasoning).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { streamCompletionTestDetails } from '../../src/benchmark/completion-valid.ts';
import {
  accumulateBenchmarkStreamDelta,
  completionTextFromFallback,
  completionTextFromMessage,
  resolveBenchmarkCompletionText,
} from '../../src/benchmark/stream-text.ts';
import type { ChatCompletionChunk } from '../../src/types.ts';

describe('accumulateBenchmarkStreamDelta', () => {
  test('content-only delta', () => {
    const chunk: ChatCompletionChunk = {
      choices: [{ index: 0, delta: { content: 'hi' } }],
    };
    assert.equal(accumulateBenchmarkStreamDelta(chunk), 'hi');
  });

  test('reasoning-only delta is ignored', () => {
    const chunk: ChatCompletionChunk = {
      choices: [{ index: 0, delta: { reasoning_content: 'think' } }],
    };
    assert.equal(accumulateBenchmarkStreamDelta(chunk), '');
  });

  test('mixed content and reasoning returns prose only', () => {
    const chunk: ChatCompletionChunk = {
      choices: [
        {
          index: 0,
          delta: { content: 'a', reasoning: 'b' },
        },
      ],
    };
    assert.equal(accumulateBenchmarkStreamDelta(chunk), 'a');
  });

  test('usage-only terminal chunk yields empty', () => {
    const chunk: ChatCompletionChunk = {
      choices: [],
      usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 },
    };
    assert.equal(accumulateBenchmarkStreamDelta(chunk), '');
  });
});

describe('completionTextFromMessage', () => {
  test('prose only', () => {
    assert.equal(completionTextFromMessage({ content: 'hello' }), 'hello');
  });

  test('reasoning only yields empty', () => {
    assert.equal(completionTextFromMessage({ reasoning_content: 'chain' }), '');
  });

  test('prose wins when both prose and reasoning present', () => {
    const text = completionTextFromMessage({
      content: 'answer',
      reasoning: 'thought',
    });
    assert.equal(text, 'answer');
  });
});

describe('completionTextFromFallback', () => {
  test('reads message content only from completion chunk', () => {
    const fallback: ChatCompletionChunk = {
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'ok', reasoning_content: 'r' },
        },
      ],
    };
    assert.equal(completionTextFromFallback(fallback), 'ok');
  });

  test('uses reasoning when content is empty', () => {
    const fallback: ChatCompletionChunk = {
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', reasoning_content: 'thought then answer' },
        },
      ],
    };
    assert.equal(completionTextFromFallback(fallback), 'thought then answer');
  });
});

describe('resolveBenchmarkCompletionText', () => {
  test('prefers content over reasoning', () => {
    assert.equal(resolveBenchmarkCompletionText('answer', 'thought'), 'answer');
  });

  test('falls back to reasoning when content empty', () => {
    assert.equal(resolveBenchmarkCompletionText('', 'only reasoning'), 'only reasoning');
  });
});

describe('streamCompletionTestDetails', () => {
  test('pass returns text preview', () => {
    const details = streamCompletionTestDetails(
      {
        text: 'hello world',
        contentText: 'hello world',
        reasoningText: '',
        toolCalls: [],
        timing: { ttftMs: 10, totalMs: 100, tokPerSec: null, usage: {}, stats: {} },
        messages: [],
      },
      true,
    );
    assert.equal(details, 'hello world');
  });

  test('fail returns finish and usage hint', () => {
    const details = streamCompletionTestDetails(
      {
        text: '',
        contentText: '',
        reasoningText: '',
        toolCalls: [],
        finishReason: 'stop',
        timing: {
          ttftMs: null,
          totalMs: 50,
          tokPerSec: null,
          usage: { completion_tokens: 0, total_tokens: 12 },
          stats: {},
          finishReason: 'stop',
        },
        messages: [],
      },
      false,
    );
    assert.match(details, /empty stream \(finish=stop/);
    assert.match(details, /completion_tokens=0/);
  });
});
