/**
 * Compact-and-retry when a provider rejects the prompt as over-context (MIN-783).
 *
 * The overflow 400 used to count as a finished turn whenever the transcript
 * already had an assistant row. These tests pin the recovery: compact, retry,
 * then crash — and salvage only this round's streamed work.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  functionCallChunks,
  proseSseChunks,
} from '../../scripts/fake-model-server.mjs';
import {
  createMemoryTranscriptStore,
  runTurn,
} from '../../server/runner/index.js';
import { resetContextEstimateCalibrationForTests } from '../../server/runner/estimate-calibration.js';

const CHAT_UUID = '11111111-1111-1111-1111-111111111111';

const LLAMA_CPP_400 =
  'request (104264 tokens) exceeds the available context size (89088 tokens), try increasing it';

const DATETIME_TOOL = {
  type: 'function',
  function: {
    name: 'get_datetime',
    description: 'Get the current date and time',
    parameters: { type: 'object', properties: {} },
  },
};

const PRIOR = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'hello' },
  { role: 'assistant', content: `${'history '.repeat(400)}done` },
  { role: 'user', content: 'continue the work' },
];

function overflowResponse() {
  return new Response(LLAMA_CPP_400, { status: 400 });
}

function sseResponse(chunks) {
  return new Response(chunks.join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function passthroughBatch(options) {
  const toolCalls = options.toolCalls ?? [];
  const outcomes = [];
  for (const toolCall of toolCalls) {
    let args = {};
    try {
      args = JSON.parse(toolCall.function?.arguments || '{}');
    } catch {
      args = {};
    }
    const result = await options.execute(toolCall.function.name, args, {
      toolCallId: toolCall.id,
    });
    const outcome = { toolCall, result };
    options.onToolDone?.(outcome);
    outcomes.push(outcome);
  }
  return outcomes;
}

function stubDeps(overrides = {}) {
  return {
    transcriptStore: createMemoryTranscriptStore(),
    postChatCompletions: async () => sseResponse(proseSseChunks('Done.')),
    runHeadlessToolBatch: passthroughBatch,
    resolveProvider: async () => ({
      id: 'local-fake',
      label: 'Local fake',
      baseUrl: 'http://127.0.0.1:9',
      apiKind: 'openai-v1',
      chatCompletionsPath: '/v1/chat/completions',
    }),
    getSubAgentTypeConfig: async () => ({}),
    resolveSamplerPreset: () => ({ preset: {}, maxTokens: 256 }),
    resolveThinkingMode: () => ({ mode: 'off' }),
    resolveThinkingBudgetTokens: () => ({ budgetTokens: null }),
    loadToolCallsMeta: async () => {},
    getToolCallsMetaSync: () => ({ useConstrainedDecoding: false }),
    isConstrainedDecodingEnabledForProvider: () => false,
    readProviderCapabilities: async () => null,
    isStructuredOutcomeResponseFormatAvailable: () => false,
    resolveSendCapabilities: () => ({}),
    resolveModelContextLimit: () => 89088,
    applyContextPolicy: async (input) => ({
      applied: false,
      messages: input.messages,
    }),
    ...overrides,
  };
}

const chatTurn = {
  injectReportTool: false,
  nudgeToolUse: false,
  finalizeStructuredOutcome: false,
};

function shrinkingPolicy() {
  const calls = [];
  const applyContextPolicy = async (input) => {
    calls.push(input);
    if (input.effectiveLimitOverride != null && input.messages.length > 2) {
      const next = [input.messages[0], input.messages[input.messages.length - 1]];
      return {
        applied: true,
        messages: next,
        statusMessage: 'Context summarized: older turns omitted',
        tokensAfter: 8,
      };
    }
    return { applied: false, messages: input.messages };
  };
  return { calls, applyContextPolicy };
}

describe('runTurn context overflow recovery', () => {
  afterEach(() => {
    resetContextEstimateCalibrationForTests();
  });

  test('overflow 400 on a chat with assistant history compact-and-retries then succeeds', async () => {
    let posts = 0;
    const { calls, applyContextPolicy } = shrinkingPolicy();
    const result = await runTurn({
      chatId: CHAT_UUID,
      seed: '',
      seedKind: 'continue',
      messages: PRIOR,
      tools: [],
      model: { providerId: 'local-fake', id: 'qwen' },
      ...chatTurn,
      deps: stubDeps({
        applyContextPolicy,
        postChatCompletions: async () => {
          posts += 1;
          if (posts === 1) return overflowResponse();
          return sseResponse(proseSseChunks('Compacted reply.'));
        },
      }),
    });
    assert.equal(result.outcome, 'no_report');
    assert.equal(posts, 2);
    assert.ok(
      calls.some((c) => c.effectiveLimitOverride != null),
      'retry must force a tighter message ceiling',
    );
  });

  test('overflow with only prior assistant history does not swallow as no_report', async () => {
    const result = await runTurn({
      chatId: CHAT_UUID,
      seed: '',
      seedKind: 'continue',
      messages: PRIOR,
      tools: [],
      model: { providerId: 'local-fake', id: 'qwen' },
      ...chatTurn,
      deps: stubDeps({
        postChatCompletions: async () => overflowResponse(),
      }),
    });
    assert.equal(result.outcome, 'crashed');
    assert.match(String(result.error), /exceeds the available context size/);
  });

  test('overflow after this-round tool work still salvages', async () => {
    let posts = 0;
    const result = await runTurn({
      chatId: CHAT_UUID,
      seed: 'What time is it?',
      tools: [DATETIME_TOOL],
      model: { providerId: 'local-fake', id: 'qwen' },
      ...chatTurn,
      execute: async () => ({ content: '2026-08-31T12:00:00.000Z' }),
      deps: stubDeps({
        postChatCompletions: async () => {
          posts += 1;
          if (posts === 1) {
            return sseResponse(functionCallChunks('get_datetime', {}, 'call_dt'));
          }
          return overflowResponse();
        },
      }),
    });
    assert.equal(result.outcome, 'no_report');
    assert.ok(posts >= 2);
  });
});
