/**
 * Token ledger rollups, caps, and source keys.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  emptyLedger,
  mergeTotals,
  recordTokenUsage,
  resetTokenLedger,
  sourceKey,
  sumSessionLedgerTotals,
} from '../../src/usage/token-ledger.ts';
import { TOKEN_LEDGER_ENTRY_CAP } from '../../src/usage/types.ts';

const FIXED_ENTRY_ID = '11111111-1111-1111-1111-111111111111';
const FIXED_AT = 1_700_000_000_000;

function makeChat() {
  return {
    id: 'chat-1',
    name: 'Test',
    workspacePath: '',
    modelId: 'm1',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: FIXED_AT,
  };
}

const USAGE_A = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };
const USAGE_B = { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 };

describe('recordTokenUsage', () => {
  test('rollup totals and bySource keys', () => {
    const chat = makeChat();
    recordTokenUsage(chat, {
      id: FIXED_ENTRY_ID,
      at: FIXED_AT,
      source: { kind: 'main', modeId: 'build' },
      providerId: 'p1',
      modelId: 'gpt-4o',
      usage: USAGE_A,
      costUsd: 0.01,
    });
    recordTokenUsage(chat, {
      id: '22222222-2222-2222-2222-222222222222',
      at: FIXED_AT + 1,
      source: { kind: 'sub-agent', subAgentType: 'explore', runId: 'run-1' },
      providerId: 'p1',
      modelId: 'gpt-4o',
      usage: USAGE_B,
      costUsd: 0.02,
    });

    assert.equal(chat.tokenLedger.totals.promptTokens, 300);
    assert.equal(chat.tokenLedger.totals.completionTokens, 150);
    assert.equal(chat.tokenLedger.totals.totalTokens, 450);
    assert.equal(chat.tokenLedger.totals.costUsd, 0.03);
    assert.equal(chat.tokenLedger.totals.completionCount, 2);
    assert.equal(sourceKey({ kind: 'main', modeId: 'build' }), 'main:build');
    assert.deepEqual(chat.tokenLedger.bySource['main:build'].totalTokens, 150);
    assert.deepEqual(chat.tokenLedger.bySource['sub-agent:explore'].totalTokens, 300);
  });

  test('entry cap evicts oldest rows', () => {
    const chat = makeChat();
    for (let i = 0; i < TOKEN_LEDGER_ENTRY_CAP + 5; i++) {
      recordTokenUsage(chat, {
        at: FIXED_AT + i,
        source: { kind: 'title' },
        providerId: 'p1',
        modelId: 'm',
        usage: { total_tokens: 1 },
        costUsd: null,
      });
    }
    assert.equal(chat.tokenLedger.entries.length, TOKEN_LEDGER_ENTRY_CAP);
    assert.equal(chat.tokenLedger.totals.completionCount, TOKEN_LEDGER_ENTRY_CAP + 5);
    assert.equal(chat.tokenLedger.entries[0].at, FIXED_AT + 5);
  });

  test('resetTokenLedger clears ledger', () => {
    const chat = makeChat();
    recordTokenUsage(chat, {
      source: { kind: 'title' },
      providerId: 'p1',
      modelId: 'm',
      usage: USAGE_A,
      costUsd: null,
    });
    resetTokenLedger(chat);
    assert.deepEqual(chat.tokenLedger, emptyLedger());
  });

  test('skips empty usage', () => {
    const chat = makeChat();
    const result = recordTokenUsage(chat, {
      source: { kind: 'title' },
      providerId: 'p1',
      modelId: 'm',
      usage: {},
      costUsd: null,
    });
    assert.equal(result, null);
    assert.equal(chat.tokenLedger, undefined);
  });
});

describe('sumSessionLedgerTotals', () => {
  test('aggregates across chats', () => {
    const a = makeChat();
    const b = makeChat();
    b.id = 'chat-2';
    recordTokenUsage(a, {
      source: { kind: 'main', modeId: 'build' },
      providerId: 'p1',
      modelId: 'm',
      usage: USAGE_A,
      costUsd: 0.01,
    });
    recordTokenUsage(b, {
      source: { kind: 'main', modeId: 'build' },
      providerId: 'p1',
      modelId: 'm',
      usage: USAGE_B,
      costUsd: 0.02,
    });
    const totals = sumSessionLedgerTotals([a, b]);
    assert.equal(totals.totalTokens, 450);
    assert.equal(totals.costUsd, 0.03);
  });
});

describe('mergeTotals', () => {
  test('adds prompt and completion independently', () => {
    const base = emptyLedger().totals;
    const next = mergeTotals(base, USAGE_A, 0.5);
    assert.equal(next.promptTokens, 100);
    assert.equal(next.completionTokens, 50);
    assert.equal(next.costUsd, 0.5);
  });
});
