/**
 * Outbound prompt estimate breakdown (pure parts, no DOM).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  computeOutboundPromptEstimateFromParts,
  estimateHistoryTokens,
  estimateTokensFromText,
  estimateToolsTokens,
  formatTokenEstimateLabel,
  historyToApiMessagesForEstimate,
  serializeMessageContentForEstimate,
} from '../../src/chat/prompts/token-estimate-core.ts';
import type { Message } from '../../src/types.ts';

describe('estimateTokensFromText', () => {
  test('empty string returns 0', () => {
    assert.equal(estimateTokensFromText(''), 0);
  });

  test('four characters rounds to 1 token', () => {
    assert.equal(estimateTokensFromText('abcd'), 1);
  });

  test('4000 characters rounds to 1000 tokens', () => {
    assert.equal(estimateTokensFromText('x'.repeat(4000)), 1000);
  });

  test('unicode uses UTF-16 code unit length', () => {
    assert.equal(estimateTokensFromText('🙂🙂🙂🙂'), 2);
  });
});

describe('historyToApiMessagesForEstimate', () => {
  test('omits assistant thinking segments from API-shaped rows', () => {
    const history: Message[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'answer',
        thinking: ['hidden reasoning'],
      },
    ];
    const api = historyToApiMessagesForEstimate(history);
    assert.equal(api.length, 2);
    assert.equal(api[1].role, 'assistant');
    assert.equal(api[1].content, 'answer');
    assert.equal('thinking' in api[1], false);
  });
});

describe('estimateHistoryTokens', () => {
  test('sums user and assistant string content', () => {
    const history: Message[] = [
      { role: 'user', content: 'abcd' },
      { role: 'assistant', content: 'efgh' },
    ];
    assert.equal(estimateHistoryTokens(history), 2);
  });

  test('assistant thinking segments are excluded from serialized content', () => {
    const history: Message[] = [
      {
        role: 'assistant',
        content: 'answer',
        thinking: ['reason A', 'reason B'],
      },
    ];
    const serialized = serializeMessageContentForEstimate(history[0]);
    assert.equal(serialized, 'answer');
    assert.equal(estimateHistoryTokens(history), estimateTokensFromText('answer'));
  });

  test('assistant tool_calls include JSON in serialized content', () => {
    const history: Message[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'tc1',
            type: 'function',
            function: { name: 'read_file', arguments: '{}' },
          },
        ],
      },
    ];
    const serialized = serializeMessageContentForEstimate(history[0]);
    assert.match(serialized, /read_file/);
    assert.ok(estimateHistoryTokens(history) > 0);
  });
});

describe('estimateToolsTokens', () => {
  test('empty tools array returns 0', () => {
    assert.equal(estimateToolsTokens([]), 0);
  });

  test('JSON schema size is estimated', () => {
    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'get_datetime',
          description: 'Returns current date and time',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];
    const direct = estimateTokensFromText(JSON.stringify(tools));
    assert.equal(estimateToolsTokens(tools), direct);
  });
});

describe('formatTokenEstimateLabel', () => {
  test('formats sub-thousand with locale grouping', () => {
    assert.match(formatTokenEstimateLabel(240), /240/);
    assert.match(formatTokenEstimateLabel(240), /estimate/);
  });

  test('formats thousands as k suffix', () => {
    assert.equal(formatTokenEstimateLabel(12_400), '~12.4k tokens (estimate)');
  });
});

describe('computeOutboundPromptEstimateFromParts', () => {
  test('total equals sum of buckets', () => {
    const history: Message[] = [
      { role: 'user', content: 'hello world' },
      { role: 'assistant', content: 'reply text here' },
    ];
    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'calculate',
          description: 'Math',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];
    const est = computeOutboundPromptEstimateFromParts({
      systemText: 'System prompt body',
      history,
      tools,
      userRulesText: 'Always be concise',
    });
    assert.equal(
      est.total,
      est.composedSystem + est.userRules + est.history + est.tools,
    );
    assert.equal(est.composedSystem, estimateTokensFromText('System prompt body'));
    assert.ok(est.history > 0);
    assert.ok(est.tools > 0);
    assert.ok(est.userRules > 0);
  });

  test('legacy fallback flag is preserved', () => {
    const est = computeOutboundPromptEstimateFromParts({
      systemText: 'legacy drawer text',
      history: [],
      tools: [],
      legacyFallback: true,
    });
    assert.equal(est.legacyFallback, true);
    assert.equal(est.total, est.composedSystem);
  });

  test('empty inputs yield zero total', () => {
    const est = computeOutboundPromptEstimateFromParts({
      systemText: '',
      history: [],
      tools: [],
    });
    assert.equal(est.total, 0);
  });
});
