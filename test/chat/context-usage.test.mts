/**
 * Context budget assembly (MIN-13) — static breakdown expectations.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  estimateInFlightOverlayTokens,
} from '../../src/chat/context-in-flight.ts';
import {
  assembleContextBudget,
  buildContextUsageBreakdown,
  computeContextUsagePercent,
  estimateAttachmentTokens,
  resolveContextLimit,
} from '../../src/chat/context-usage.ts';
import { contextLengthFromModelRow } from '../../src/lib/context-length.ts';
import type { Chat } from '../../src/types.ts';
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

  test('caps image dataUrl at fixed per-image budget (not full base64)', () => {
    const attachments: Attachment[] = [
      {
        id: 'img1',
        name: 'photo.png',
        kind: 'image',
        mimeType: 'image/png',
        size: 1_000_000,
        dataUrl: `data:image/png;base64,${'A'.repeat(40_000)}`,
      },
    ];
    assert.equal(estimateAttachmentTokens(attachments), 256);
  });
});

describe('estimateInFlightOverlayTokens', () => {
  test('counts only pending tool-call JSON (not streaming completion)', () => {
    const tokens = estimateInFlightOverlayTokens({
      partialAssistantText: 'abcd',
      thinkingText: 'efgh',
      pendingToolCallsJson: '{"name":"read_file"}',
    });
    // 20 chars of tool-call JSON, priced at the payload rate.
    assert.equal(tokens, 7);
  });

  test('returns zero when only streaming prose or reasoning is present', () => {
    assert.equal(
      estimateInFlightOverlayTokens({
        partialAssistantText: 'abcd',
        thinkingText: 'efgh',
      }),
      0,
    );
  });
});

describe('buildContextUsageBreakdown', () => {
  test('includes in-flight row when non-zero', () => {
    const estimate = computeOutboundPromptEstimateFromParts({
      systemText: 'sys',
      history: [],
      tools: [],
    });
    const rows = buildContextUsageBreakdown(estimate, 0, 0, 12);
    assert.equal(rows.find((r) => r.key === 'inFlight')?.tokens, 12);
    assert.equal(rows.find((r) => r.key === 'inFlight')?.label, 'In progress (estimate)');
  });

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

  test('splits code map from system and shows loading row when injection is on', () => {
    const estimate = computeOutboundPromptEstimateFromParts({
      systemText: 'sys',
      history: [],
      tools: [],
    });
    estimate.composedSystem = 1000;
    estimate.codeMapSystem = 400;
    estimate.codeMapInjectionEnabled = true;
    const rows = buildContextUsageBreakdown(estimate, 0, 0);
    assert.equal(rows.find((r) => r.key === 'system')?.tokens, 600);
    assert.equal(rows.find((r) => r.key === 'codeMap')?.tokens, 400);

    const loadingEstimate = computeOutboundPromptEstimateFromParts({
      systemText: 'sys',
      history: [],
      tools: [],
    });
    loadingEstimate.codeMapInjectionEnabled = true;
    const loadingRows = buildContextUsageBreakdown(loadingEstimate, 0, 0);
    assert.equal(loadingRows.find((r) => r.key === 'codeMap')?.label, 'Code map (loading)');
    assert.equal(loadingRows.find((r) => r.key === 'codeMap')?.tokens, 0);
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

describe('contextLengthFromModelRow', () => {
  test('uses loaded_context_length when model is loaded', () => {
    assert.equal(
      contextLengthFromModelRow({
        state: 'loaded',
        max_context_length: 262_144,
        loaded_context_length: 62_000,
      }),
      62_000,
    );
  });

  test('ignores loaded_context_length when model is not loaded', () => {
    assert.equal(
      contextLengthFromModelRow({
        state: 'not-loaded',
        max_context_length: 131_072,
        loaded_context_length: 62_000,
      }),
      131_072,
    );
  });

  test('falls back to known table when row has id but no context fields', () => {
    assert.equal(
      contextLengthFromModelRow({
        id: 'gpt-4o-mini',
        state: 'loaded',
      }),
      128_000,
    );
  });
});

describe('resolveContextLimit', () => {
  test('prefers configured loaded_context_length over catalog max', async () => {
    const { modelCache } = await import('../../src/app-state.ts');
    modelCache.set('vendor/model', {
      id: 'vendor/model',
      state: 'loaded',
      max_context_length: 262_144,
      loaded_context_length: 62_000,
    });
    const chat = { modelInfo: {} } as Chat;
    assert.equal(resolveContextLimit('vendor/model', chat), 62_000);
    modelCache.delete('vendor/model');
  });

  test('prefers live cache over persisted modelInfo when they differ (MIN-183)', async () => {
    const { modelCache } = await import('../../src/app-state.ts');
    modelCache.set('vendor/model', {
      id: 'vendor/model',
      state: 'loaded',
      max_context_length: 262_144,
      loaded_context_length: 62_000,
    });
    const chat = { modelInfo: { context_length: 48_000 } } as Chat;
    assert.equal(resolveContextLimit('vendor/model', chat), 62_000);
    modelCache.delete('vendor/model');
  });

  test('falls back to last-turn model_info when cache has no context length', async () => {
    const { modelCache } = await import('../../src/app-state.ts');
    const { setSessionStateForTests } = await import('../../src/state/sessions.ts');
    modelCache.clear();
    const chat = { id: 'c-min-183', modelInfo: { context_length: 48_000 } } as Chat;
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });
    assert.equal(resolveContextLimit('vendor/model', chat), 48_000);
    setSessionStateForTests(null);
  });

  test('falls back to max when model is not loaded', async () => {
    const { modelCache } = await import('../../src/app-state.ts');
    modelCache.set('vendor/model', {
      id: 'vendor/model',
      state: 'not-loaded',
      max_context_length: 131_072,
      loaded_context_length: 62_000,
    });
    const chat = { modelInfo: {} } as Chat;
    assert.equal(resolveContextLimit('vendor/model', chat), 131_072);
    modelCache.delete('vendor/model');
  });

  test('uses known table for openai-v1 model without row context fields', async () => {
    const { modelCache } = await import('../../src/app-state.ts');
    modelCache.set('gpt-4o', {
      id: 'gpt-4o',
      state: 'loaded',
    });
    const chat = { modelInfo: {} } as Chat;
    assert.equal(resolveContextLimit('gpt-4o', chat), 128_000);
    modelCache.delete('gpt-4o');
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
      inFlightTokens: 7,
      lastTurnPromptTokens: null,
    });

    const bucketSum = budget.breakdown.reduce((sum, row) => sum + row.tokens, 0);
    assert.equal(budget.used, bucketSum);
    assert.equal(budget.used, estimate.total + 10 + 5 + 7);
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
