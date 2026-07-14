import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mergeThinkingIntoCompletionBody } from '../../src/agents/merge-thinking-body.ts';
import { LLAMA_CPP_LOCAL_PROVIDER_ID } from '../../src/providers/types.ts';
import type { ModelCapabilities } from '../../src/types.ts';

const levelCaps: ModelCapabilities = {
  vision: false,
  tools: null,
  streaming: null,
  grammar: null,
  reasoning: true,
  reasoningAllowedOptions: ['off', 'low', 'medium', 'high'],
  reasoningDefault: 'off',
  contextLength: null,
  loadState: null,
};

describe('mergeThinkingIntoCompletionBody', () => {
  test('dropdown models enable thinking when inherited on despite catalog default off', () => {
    const body: Record<string, unknown> = {};
    const { body: merged } = mergeThinkingIntoCompletionBody(
      body,
      'on',
      {
        id: 'lm-studio-local',
        apiKind: 'openai-v1',
        autoApi: false,
        modelApiOverrides: {},
      },
      levelCaps,
      undefined,
      'openai-v1',
      null,
    );
    assert.equal(merged.reasoning_effort, 'medium');
    assert.deepEqual(merged.reasoning, { effort: 'medium' });
  });

  test('llama-cpp applies default request budget when feature is supported', () => {
    const body: Record<string, unknown> = {};
    const { nativeBudgetApplied } = mergeThinkingIntoCompletionBody(
      body,
      'on',
      {
        id: LLAMA_CPP_LOCAL_PROVIDER_ID,
        apiKind: 'openai-v1',
        autoApi: false,
        modelApiOverrides: {},
      },
      {
        ...levelCaps,
        reasoningAllowedOptions: ['off', 'on'],
      },
      undefined,
      'openai-v1',
      null,
      { llamaSupportsThinkingBudget: true },
    );
    assert.equal(body.thinking_budget_tokens, 8192);
    assert.equal(nativeBudgetApplied, true);
  });
});
