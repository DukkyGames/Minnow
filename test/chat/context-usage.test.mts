/**
 * Context budget assembly (MIN-13) — static breakdown expectations.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  assembleContextBudget,
  buildContextUsageBreakdown,
  computeContextUsagePercent,
  estimateAttachmentTokens,
} from '../../src/chat/context-usage.ts';
import { computeOutboundPromptEstimateFromParts } from '../../src/chat/prompts/token-estimate-core.ts';
import type { Attachment, Message } from '../../src/types.ts';

describe('estimateAttachmentTokens', () => {
  test('sums text attachment bodies', () => {
    const attachments: Attachment[] = [
      {
        id: 'a1',
        name: 'notes.txt',
        kind: 'text',
        mimeType: 'text/plain',
        size: 16,
        text: 'abcd',
      },
    ];
    assert.equal(estimateAttachmentTokens(attachments), 1);
  });

  test('skips error chips', () => {
    const attachments: Attachment[] = [
      {
        id: 'e1',
        name: 'big.bin',
        kind: 'error',
        mimeType: '',
        size: 0,
        error: 'Too large',
      },
    ];
    assert.equal(estimateAttachmentTokens(attachments), 0);
  });
});

describe('buildContextUsageBreakdown', () => {
  test('includes composer and attachments when non-zero', () => {
    const estimate = computeOutboundPromptEstimateFromParts({
      systemText: 'sys',
      history: [{ role: 'user', content: 'hi' }],
      tools: [],
      userRulesText: 'rule',
    });
    const rows = buildContextUsageBreakdown(estimate, 8, 4);
    const keys = rows.map((r) => r.key);
    assert.deepEqual(keys, ['system', 'rules', 'tools', 'history', 'composer', 'attachments']);
    assert.equal(rows.find((r) => r.key === 'composer')?.tokens, 8);
    assert.equal(rows.find((r) => r.key === 'attachments')?.tokens, 4);
  });
});

describe('computeContextUsagePercent', () => {
  test('caps at 100', () => {
    assert.equal(computeContextUsagePercent(9000, 8000), 100);
  });

  test('returns null when limit unknown', () => {
    assert.equal(computeContextUsagePercent(100, null), null);
  });
});

describe('assembleContextBudget', () => {
  test('static fixture totals match bucket sum', () => {
    const history: Message[] = [
      { role: 'user', content: 'hello world' },
      { role: 'assistant', content: 'reply text here' },
    ];
    const estimate = computeOutboundPromptEstimateFromParts({
      systemText: 'System prompt body',
      history,
      tools: [],
      userRulesText: 'Always be concise',
    });
    const budget = assembleContextBudget({
      modelId: 'test/model',
      modelDisplayName: 'Test Model',
      limit: 32_768,
      estimate,
      composerTokens: 10,
      attachmentTokens: 5,
      lastTurnPromptTokens: null,
    });

    const bucketSum = budget.breakdown.reduce((sum, row) => sum + row.tokens, 0);
    assert.equal(budget.used, bucketSum);
    assert.equal(budget.used, estimate.total + 10 + 5);
    assert.equal(budget.remaining, 32_768 - budget.used);
    assert.equal(budget.percent, Math.round((budget.used / 32_768) * 100));
    assert.equal(budget.isEstimate, true);
    assert.equal(budget.lastTurnPromptTokens, null);
  });

  test('marks non-estimate when API prompt tokens exist', () => {
    const estimate = computeOutboundPromptEstimateFromParts({
      systemText: 'x',
      history: [],
      tools: [],
    });
    const budget = assembleContextBudget({
      modelId: 'm',
      modelDisplayName: 'M',
      limit: null,
      estimate,
      composerTokens: 0,
      attachmentTokens: 0,
      lastTurnPromptTokens: 1200,
    });
    assert.equal(budget.isEstimate, false);
    assert.equal(budget.limit, null);
    assert.equal(budget.percent, null);
    assert.equal(budget.remaining, null);
  });
});
