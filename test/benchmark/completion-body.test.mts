/**
 * Benchmark completion body builder unit tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  BENCHMARK_MAX_TOKENS,
  BENCHMARK_SAMPLER,
  BENCHMARK_THINKING_BUDGET_TOKENS,
  BENCHMARK_THINKING_EFFORT,
  buildBenchmarkCompletionBody,
} from '../../src/benchmark/completion-body.ts';
import type { ProviderCapabilities } from '../../src/providers/capability-probe.ts';
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

const noReasoningCaps: ModelCapabilities = {
  ...levelCaps,
  reasoning: false,
  reasoningAllowedOptions: undefined,
};

const provider = {
  id: 'lm-studio-local',
  apiKind: 'openai-v1' as const,
  autoApi: false,
  modelApiOverrides: {},
};

const providerCaps: ProviderCapabilities = {
  schemaVersion: 1,
  probedAt: '2026-01-01T00:00:00.000Z',
  providerId: 'lm-studio-local',
  structuredOutput: true,
  structuredOutputWithTools: true,
};

describe('buildBenchmarkCompletionBody', () => {
  test('applies fixed sampler and max_tokens', () => {
    const { body } = buildBenchmarkCompletionBody({
      provider,
      modelId: 'qwen3-8b',
      messages: [{ role: 'user', content: 'hi' }],
      capabilities: levelCaps,
      providerCapabilities: providerCaps,
      toolCallsMeta: { useConstrainedDecoding: false },
    });
    assert.equal(body.temperature, BENCHMARK_SAMPLER.temperature);
    assert.equal(body.top_p, BENCHMARK_SAMPLER.topP);
    assert.equal(body.top_k, BENCHMARK_SAMPLER.topK);
    assert.equal(body.max_tokens, BENCHMARK_MAX_TOKENS);
    assert.equal(body.stream, true);
  });

  test('caller temperature and maxTokens override defaults', () => {
    const { body } = buildBenchmarkCompletionBody({
      provider,
      modelId: 'qwen3-8b',
      messages: [{ role: 'user', content: 'hi' }],
      capabilities: levelCaps,
      providerCapabilities: providerCaps,
      toolCallsMeta: { useConstrainedDecoding: false },
      temperature: 0.5,
      maxTokens: 4096,
    });
    assert.equal(body.temperature, 0.5);
    assert.equal(body.max_tokens, 4096);
  });

  test('level-catalog model gets medium reasoning effort', () => {
    const { body } = buildBenchmarkCompletionBody({
      provider,
      modelId: 'gpt-oss-20b',
      messages: [{ role: 'user', content: 'hi' }],
      capabilities: levelCaps,
      providerCapabilities: providerCaps,
      toolCallsMeta: { useConstrainedDecoding: false },
    });
    assert.equal(body.reasoning_effort, BENCHMARK_THINKING_EFFORT);
    assert.deepEqual(body.reasoning, { effort: BENCHMARK_THINKING_EFFORT });
  });

  test('non-reasoning model omits thinking fields', () => {
    const { body } = buildBenchmarkCompletionBody({
      provider,
      modelId: 'llama-3.2-3b',
      messages: [{ role: 'user', content: 'hi' }],
      capabilities: noReasoningCaps,
      providerCapabilities: providerCaps,
      toolCallsMeta: { useConstrainedDecoding: false },
    });
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(body.thinking, undefined);
  });

  test('attaches response_format when constrained gate allows', () => {
    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'read_file',
          description: 'Read a file',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];
    const { body, usedConstrained } = buildBenchmarkCompletionBody({
      provider,
      modelId: 'qwen3-8b',
      messages: [{ role: 'user', content: 'hi' }],
      tools,
      capabilities: levelCaps,
      providerCapabilities: providerCaps,
      toolCallsMeta: { useConstrainedDecoding: true },
    });
    assert.equal(usedConstrained, true);
    assert.equal(body.response_format?.type, 'json_schema');
    assert.equal(body.tool_choice, 'auto');
  });

  test('skips response_format when constrained decoding is off', () => {
    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'read_file',
          description: 'Read a file',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];
    const { body, usedConstrained } = buildBenchmarkCompletionBody({
      provider,
      modelId: 'qwen3-8b',
      messages: [{ role: 'user', content: 'hi' }],
      tools,
      capabilities: levelCaps,
      providerCapabilities: providerCaps,
      toolCallsMeta: { useConstrainedDecoding: false },
    });
    assert.equal(usedConstrained, false);
    assert.equal(body.response_format, undefined);
  });

  test('llama-cpp native thinking budget is applied', () => {
    const { body, nativeBudgetApplied } = buildBenchmarkCompletionBody({
      provider: {
        id: 'llama-cpp-local',
        apiKind: 'openai-v1',
        autoApi: false,
        modelApiOverrides: {},
      },
      modelId: 'qwen3-8b',
      messages: [{ role: 'user', content: 'hi' }],
      capabilities: {
        ...levelCaps,
        reasoningAllowedOptions: ['off', 'on'],
      },
      providerCapabilities: {
        schemaVersion: 1,
        probedAt: '2026-01-01T00:00:00.000Z',
        providerId: 'llama-cpp-local',
        structuredOutput: false,
        structuredOutputWithTools: false,
        supportsThinkingBudget: true,
      },
      toolCallsMeta: { useConstrainedDecoding: false },
    });
    assert.equal(body.thinking_budget_tokens, BENCHMARK_THINKING_BUDGET_TOKENS);
    assert.equal(nativeBudgetApplied, true);
  });
});
