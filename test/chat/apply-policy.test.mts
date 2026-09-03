/**
 * Context policy apply path — summarize fallback and local-host extractive.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyContextPolicy } from '../../src/chat/context/apply-policy.ts';
import type { ApiMessage } from '../../src/types.ts';

function user(content: string): ApiMessage {
  return { role: 'user', content };
}

function assistant(content: string): ApiMessage {
  return { role: 'assistant', content };
}

function system(content: string): ApiMessage {
  return { role: 'system', content };
}

describe('applyContextPolicy summarize fallback', () => {
  test('a 1-user-turn thread over budget truncates instead of staying untouched', async () => {
    // minRecentTurns defaults to 2, so nothing is droppable. The old path
    // passed enforcementPolicy: 'truncate' on agentConfig while resolved.policy
    // stayed 'summarize', and applyContextBudget no-op'd.
    const messages: ApiMessage[] = [system('sys'), user('z'.repeat(8000))];
    const statuses: string[] = [];
    const out = await applyContextPolicy({
      messages,
      policy: 'summarize',
      modelLimit: 20,
      agentConfig: { enforcementPolicy: 'summarize', minRecentTurns: 2 },
      providerId: 'openai',
      modelId: 'gpt-test',
      onStatus: (_level, message) => statuses.push(message),
    });
    assert.equal(out.applied, true);
    assert.equal(out.policy, 'truncate');
    assert.ok(out.tokensAfter < out.tokensBefore);
    const lastUser = out.messages.find((m) => m.role === 'user');
    assert.ok(
      typeof lastUser?.content === 'string' &&
        lastUser.content.includes('[… truncated for context budget]'),
    );
    assert.equal(statuses.some((s) => /Summarizing context/i.test(s)), false);
  });
});

describe('applyContextPolicy local extractive summarize', () => {
  test('llama-cpp-local uses dropMiddle and never paints Summarizing context', async () => {
    const messages: ApiMessage[] = [
      system('sys'),
      user('alpha '.repeat(80)),
      assistant('beta '.repeat(80)),
      user('gamma '.repeat(80)),
      assistant('delta '.repeat(80)),
    ];
    const statuses: string[] = [];
    const out = await applyContextPolicy({
      messages,
      policy: 'summarize',
      modelLimit: 80,
      agentConfig: {
        enforcementPolicy: 'summarize',
        minRecentTurns: 1,
        summaryReserveTokens: 32,
      },
      providerId: 'llama-cpp-local',
      modelId: 'gguf:test',
      onStatus: (_level, message) => statuses.push(message),
    });
    assert.equal(out.applied, true);
    assert.equal(out.policy, 'dropMiddle');
    assert.ok(out.tokensAfter <= Math.floor(80 * 0.9));
    assert.equal(statuses.some((s) => /Summarizing context/i.test(s)), false);
  });

  test('mlx-lm-local also skips the LLM summarize completion', async () => {
    const messages: ApiMessage[] = [
      system('sys'),
      user('alpha '.repeat(80)),
      assistant('beta '.repeat(80)),
      user('gamma '.repeat(80)),
    ];
    const out = await applyContextPolicy({
      messages,
      policy: 'summarize',
      modelLimit: 80,
      agentConfig: { enforcementPolicy: 'summarize', minRecentTurns: 1 },
      providerId: 'mlx-lm-local',
      modelId: 'mlx:test',
    });
    assert.equal(out.applied, true);
    assert.equal(out.policy, 'dropMiddle');
  });
});
