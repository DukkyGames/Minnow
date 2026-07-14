/**
 * Inline thinking extraction and stream routing (MiniMax, Qwen, Gemma, gpt-oss).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  extractInlineThinkingFromContent,
  HarmonyChannelRouter,
  InlineContentThinkingRouter,
  normalizeThinkingMarkup,
  type RoutedContentPart,
} from '../../src/api/inline-thinking.ts';
import { extractReasoningDelta } from '../../src/api/reasoning.ts';

const RT_OPEN = '<' + 'redacted_thinking>';
const RT_CLOSE = '</' + 'redacted_thinking>';

function collectRouted(router: InlineContentThinkingRouter, chunks: readonly string[]): RoutedContentPart[] {
  const parts: RoutedContentPart[] = [];
  for (const chunk of chunks) {
    parts.push(...router.feed(chunk));
  }
  parts.push(...router.flush());
  return parts;
}

function thinkingText(parts: readonly RoutedContentPart[]): string {
  return parts
    .filter(([, isThinking]) => isThinking)
    .map(([text]) => text)
    .join('');
}

function replyText(parts: readonly RoutedContentPart[]): string {
  return parts
    .filter(([, isThinking]) => !isThinking)
    .map(([text]) => text)
    .join('');
}

describe('extractInlineThinkingFromContent', () => {
  test('MiniMax sample splits reasoning prose from reply', () => {
    const input =
      'The user just sent "test". … I shouldn\'t use save_memory …\n\nWorking. What can I help you with?';
    const split = extractInlineThinkingFromContent(input);
    assert.equal(split.thinking.length, 1);
    assert.match(split.thinking[0], /The user just sent/);
    assert.match(split.thinking[0], /save_memory/);
    assert.equal(split.reply, 'Working. What can I help you with?');
  });

  test('tagged redacted_thinking block', () => {
    const input = `${RT_OPEN}reasoning here${RT_CLOSE}\n\nHello`;
    const split = extractInlineThinkingFromContent(input);
    assert.deepEqual(split.thinking, ['reasoning here']);
    assert.equal(split.reply, 'Hello');
  });

  test('Thinking Process prefix (Qwen3.5-style)', () => {
    const input = 'Thinking Process: I need to answer this.\n\nHello there!';
    const split = extractInlineThinkingFromContent(input);
    assert.deepEqual(split.thinking, ['I need to answer this.']);
    assert.equal(split.reply, 'Hello there!');
  });

  test('Gemma-style untagged reasoning paragraph', () => {
    const input = 'The user asked about cats.\n\nHello!';
    const split = extractInlineThinkingFromContent(input);
    assert.deepEqual(split.thinking, ['The user asked about cats.']);
    assert.equal(split.reply, 'Hello!');
  });

  test('reasoning-only turn stays intact', () => {
    const input = 'The user wants help with Python. I should explain clearly.';
    const split = extractInlineThinkingFromContent(input);
    assert.deepEqual(split.thinking, []);
    assert.equal(split.reply, input);
  });

  test('prose-only instruct model is not split', () => {
    const input = 'Here is your answer about local LLM inference.';
    const split = extractInlineThinkingFromContent(input);
    assert.deepEqual(split.thinking, []);
    assert.equal(split.reply, input);
  });
});

describe('normalizeThinkingMarkup / Gemma channels', () => {
  test('Gemma thought and response channel wrappers', () => {
    const input =
      '<|channel>thought\ninternal reasoning<channel|>\n<|channel>response\nHello user!<channel|>';
    const normalized = normalizeThinkingMarkup(input);
    assert.match(normalized, /internal reasoning/);
    assert.match(normalized, /Hello user!/);
    const split = extractInlineThinkingFromContent(input);
    assert.deepEqual(split.thinking, ['internal reasoning']);
    assert.equal(split.reply, 'Hello user!');
  });
});

describe('InlineContentThinkingRouter', () => {
  test('stray closing tag without opener (MiniMax quirk)', () => {
    const router = new InlineContentThinkingRouter({ thinkingModel: true });
    const parts = collectRouted(router, ['The user wants help' + RT_CLOSE + '\n\nHello']);
    assert.equal(thinkingText(parts), 'The user wants help');
    assert.equal(replyText(parts).trim(), 'Hello');
  });

  test('streams partial open/close tags across chunk boundaries', () => {
    const router = new InlineContentThinkingRouter({ thinkingModel: true });
    const parts = collectRouted(router, [
      RT_OPEN.slice(0, 12),
      RT_OPEN.slice(12) + 'reason',
      'ing' + RT_CLOSE + '\n\nHi!',
    ]);
    assert.equal(thinkingText(parts), 'reasoning');
    assert.match(replyText(parts), /Hi!/);
  });
});

describe('HarmonyChannelRouter', () => {
  test('routes gpt-oss analysis vs final channels', () => {
    const router = new HarmonyChannelRouter();
    const parts = [
      ...router.feed('<|channel|>analysis<|message|>thinking here'),
      ...router.feed('<|channel|>final<|message|>visible reply'),
      ...router.flush(),
    ];
    assert.equal(thinkingText(parts), 'thinking here');
    assert.equal(replyText(parts), 'visible reply');
  });

  test('suppresses commentary tool-call channel from visible prose', () => {
    const router = new HarmonyChannelRouter();
    const parts = [
      ...router.feed('<|channel|>commentary to=functions.list_directory '),
      ...router.feed('code{ "path": "." }'),
      ...router.feed('<|channel|>final<|message|>Listing the workspace.'),
      ...router.flush(),
    ];
    assert.equal(replyText(parts), 'Listing the workspace.');
    assert.match(router.getCommentaryParseText(), /to=functions\.list_directory/);
    assert.match(router.getCommentaryParseText(), /"path":\s*"\.\s*"/);
  });
});

describe('extractReasoningDelta', () => {
  test('reads delta.thinking SSE field', () => {
    const text = extractReasoningDelta({
      choices: [{ delta: { thinking: 'step one' } }],
    });
    assert.equal(text, 'step one');
  });
});
