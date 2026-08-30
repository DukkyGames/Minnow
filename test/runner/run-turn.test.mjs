/**
 * P2-B — `runTurn()` board-agnostic entry (MIN-699).
 *
 * Plain `node --test` like P2-A. Fake host is `scripts/fake-model-server.mjs`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import {
  createFakeModelServer,
  proseSseChunks,
} from '../../scripts/fake-model-server.mjs';
import {
  createMemoryTranscriptStore,
  DEFAULT_REPORT_TOOL_NAME,
  postChatCompletionsHttp,
  runHeadlessToolBatchStub,
  runTurn,
} from '../../server/runner/index.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUN_TURN_JS = path.join(PROJECT_ROOT, 'server', 'runner', 'run-turn.js');

/** Hardcoded UUID — proves chatId is opaque, not a board lookup. */
const CHAT_UUID = '550e8400-e29b-41d4-a716-446655440000';

const ASK_QUESTION_TOOL = {
  type: 'function',
  function: {
    name: 'ask_question',
    description: 'Ask the user a question',
    parameters: {
      type: 'object',
      properties: { prompt: { type: 'string' } },
      required: ['prompt'],
    },
  },
};

/**
 * OpenAI-v1 tool-call SSE, same shape as the fake host's board_report helper
 * but with an injected tool name so this suite never hardcodes a role tool.
 * @param {string} name
 * @param {unknown} args
 * @param {string} [toolCallId]
 */
function functionCallChunks(name, args, toolCallId = 'call_report') {
  const argStr = typeof args === 'string' ? args : JSON.stringify(args);
  const delta = JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: toolCallId,
              type: 'function',
              function: { name, arguments: argStr },
            },
          ],
        },
      },
    ],
  });
  const finish = JSON.stringify({
    choices: [{ delta: {}, finish_reason: 'tool_calls' }],
  });
  return [
    `data: ${delta}\n\n`,
    `data: ${finish}\n\n`,
    'event: end\ndata: {"status":"complete"}\n\n',
  ];
}

/** P2-D will replace this. Tests that need execute to run inject it. */
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
    outcomes.push({ toolCall, result });
  }
  return outcomes;
}

function stubDeps(baseUrl, overrides = {}) {
  return {
    transcriptStore: createMemoryTranscriptStore(),
    postChatCompletions: postChatCompletionsHttp,
    runHeadlessToolBatch: runHeadlessToolBatchStub,
    resolveProvider: async () => ({
      id: 'local-fake',
      label: 'Local fake',
      baseUrl,
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
    resolveModelContextLimit: () => null,
    applyContextPolicy: async (input) => ({
      applied: false,
      messages: input.messages,
    }),
    ...overrides,
  };
}

/**
 * @param {unknown[]} scenario
 * @param {(baseUrl: string, fake: ReturnType<typeof createFakeModelServer>) => Promise<void>} fn
 */
async function withFake(scenario, fn) {
  const fake = createFakeModelServer({ scenario });
  fake.reset();
  const port = await fake.listen(0);
  try {
    await fn(`http://127.0.0.1:${port}`, fake);
  } finally {
    await fake.close();
  }
}

describe('runTurn source contract', () => {
  const source = fs.readFileSync(RUN_TURN_JS, 'utf8');

  test('does not import the sub-agent prose outcome parser', () => {
    // pass/fail/blocked must come from the report tool, not transcript scraping.
    assert.equal(source.includes('tryParseStructuredOutcomeFromAssistantProse'), false);
    assert.equal(source.includes('legacyOutcomeFromSummary'), false);
    assert.equal(source.includes('sub-agent-structured-outcome'), false);
  });

  test('does not branch on ask_question', () => {
    // Presence in `tools` is the only gate; a name check here would be a product branch.
    assert.equal(source.includes('ask_question'), false);
  });
});

describe('runTurn report tool → verbatim outcome', () => {
  test('pass payload is returned as-is', { timeout: 20_000 }, async () => {
    const payload = {
      outcome: 'pass',
      summary: 'All checks green.',
      evidence: ['tests/foo.test.js'],
    };
    await withFake([{ emit: functionCallChunks(DEFAULT_REPORT_TOOL_NAME, payload) }], async (baseUrl) => {
      const events = [];
      const result = await runTurn({
        chatId: CHAT_UUID,
        seed: 'Do the work, then report.',
        tools: [],
        model: { providerId: 'local-fake', id: 'fake-model' },
        onEvent: (event) => events.push(event),
        deps: stubDeps(baseUrl),
      });
      assert.deepEqual(result, payload);
      assert.ok(
        events.some((event) => event.type === 'tool_call' && event.name === DEFAULT_REPORT_TOOL_NAME),
        'onEvent should see the report tool call',
      );
    });
  });

  test('custom systemPrompt is forwarded as the system row (Phase 6 finding)', { timeout: 20_000 }, async () => {
    const payload = {
      outcome: 'pass',
      summary: 'Prompt injection ok.',
      evidence: [],
    };
    await withFake([{ emit: functionCallChunks(DEFAULT_REPORT_TOOL_NAME, payload) }], async (baseUrl, fake) => {
      await runTurn({
        chatId: CHAT_UUID,
        seed: 'Do the work, then report.',
        tools: [],
        model: { providerId: 'local-fake', id: 'fake-model' },
        systemPrompt: 'You are the P2-F systemPrompt injection test.',
        deps: stubDeps(baseUrl),
      });
      const completion = fake.requests.find(
        (row) => row.method === 'POST' && String(row.pathname ?? row.url ?? '').includes('chat/completions'),
      );
      assert.ok(completion, 'expected a chat completions request');
      const messages = completion.body?.messages;
      assert.ok(Array.isArray(messages), 'expected messages on the request body');
      const system = messages.find((msg) => msg.role === 'system');
      assert.match(String(system?.content ?? ''), /P2-F systemPrompt injection test/);
    });
  });

  test('fail payload is returned as-is', { timeout: 20_000 }, async () => {
    const payload = {
      outcome: 'fail',
      summary: 'Tests red.',
      blockers: ['assert.equal failed'],
    };
    await withFake([{ emit: functionCallChunks(DEFAULT_REPORT_TOOL_NAME, payload) }], async (baseUrl) => {
      const result = await runTurn({
        chatId: CHAT_UUID,
        seed: 'Do the work, then report.',
        tools: [],
        model: { providerId: 'local-fake', id: 'fake-model' },
        deps: stubDeps(baseUrl),
      });
      assert.deepEqual(result, payload);
    });
  });

  test('blocked payload is returned as-is', { timeout: 20_000 }, async () => {
    const payload = {
      outcome: 'blocked',
      summary: 'Need a runtime.',
      needs: ['python3'],
    };
    await withFake([{ emit: functionCallChunks(DEFAULT_REPORT_TOOL_NAME, payload) }], async (baseUrl) => {
      const result = await runTurn({
        chatId: CHAT_UUID,
        seed: 'Do the work, then report.',
        tools: [],
        model: { providerId: 'local-fake', id: 'fake-model' },
        deps: stubDeps(baseUrl),
      });
      assert.deepEqual(result, payload);
    });
  });
});

describe('runTurn without a successful report', () => {
  test('prose that looks like a pass is still no_report', { timeout: 20_000 }, async () => {
    // Tempt the inner sub-agent JSON parser. runTurn must not adopt that guess.
    const forged = JSON.stringify({
      outcome: 'pass',
      summary: 'forged from assistant prose',
      evidence: ['there was no tool call'],
    });
    await withFake([{ emit: proseSseChunks(forged) }], async (baseUrl) => {
      const result = await runTurn({
        chatId: CHAT_UUID,
        seed: 'Finish up.',
        tools: [],
        model: { providerId: 'local-fake', id: 'fake-model' },
        deps: stubDeps(baseUrl),
      });
      assert.deepEqual(result, { outcome: 'no_report' });
    });
  });

  test('malformed report tool call does not count as a report', { timeout: 20_000 }, async () => {
    await withFake(
      [
        {
          match: { nth: 0 },
          emit: functionCallChunks(DEFAULT_REPORT_TOOL_NAME, { outcome: 'pass' }),
        },
        { emit: proseSseChunks('continuing after a rejected report') },
      ],
      async (baseUrl) => {
        const result = await runTurn({
          chatId: CHAT_UUID,
          seed: 'Finish up.',
          tools: [],
          model: { providerId: 'local-fake', id: 'fake-model' },
          deps: stubDeps(baseUrl),
        });
        assert.deepEqual(result, { outcome: 'no_report' });
      },
    );
  });

  test('malformed report can be retried inside the turn', { timeout: 20_000 }, async () => {
    const valid = {
      outcome: 'pass',
      summary: 'All checks green.',
      evidence: ['tests/foo.test.js'],
    };
    await withFake(
      [
        {
          match: { nth: 0 },
          emit: functionCallChunks(DEFAULT_REPORT_TOOL_NAME, { outcome: 'pass' }),
        },
        { emit: functionCallChunks(DEFAULT_REPORT_TOOL_NAME, valid, 'call_report_retry') },
      ],
      async (baseUrl) => {
        const events = [];
        const result = await runTurn({
          chatId: CHAT_UUID,
          seed: 'Finish up.',
          tools: [],
          model: { providerId: 'local-fake', id: 'fake-model' },
          onEvent: (event) => events.push(event),
          deps: stubDeps(baseUrl),
        });
        assert.deepEqual(result, valid);
        assert.ok(
          events.some(
            (event) =>
              event.type === 'tool_result' &&
              event.name === DEFAULT_REPORT_TOOL_NAME &&
              String(event.content).startsWith('Error:'),
          ),
          'the rejected call must surface an Error: tool result',
        );
      },
    );
  });
});

describe('runTurn timeout and crash', () => {
  test('maxTurns exceeded is timeout', { timeout: 20_000 }, async () => {
    await withFake([{ emit: proseSseChunks('still going') }], async (baseUrl) => {
      const result = await runTurn({
        chatId: CHAT_UUID,
        seed: 'Never report.',
        tools: [],
        model: { providerId: 'local-fake', id: 'fake-model' },
        limits: { maxTurns: 1 },
        deps: stubDeps(baseUrl),
      });
      assert.deepEqual(result, { outcome: 'timeout' });
    });
  });

  test('wallClockMs exceeded is timeout', { timeout: 20_000 }, async () => {
    const deps = stubDeps('http://127.0.0.1:1', {
      postChatCompletions: (_provider, _body, signal) =>
        new Promise((_, reject) => {
          const fail = () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          };
          if (signal?.aborted) {
            fail();
            return;
          }
          signal.addEventListener('abort', fail, { once: true });
        }),
    });
    const result = await runTurn({
      chatId: CHAT_UUID,
      seed: 'Hang.',
      tools: [],
      model: { providerId: 'local-fake', id: 'fake-model' },
      limits: { wallClockMs: 40 },
      deps,
    });
    assert.deepEqual(result, { outcome: 'timeout' });
  });

  test('thrown provider error is crashed with the message', async () => {
    const deps = stubDeps('http://127.0.0.1:1', {
      postChatCompletions: async () => {
        throw new Error('provider exploded');
      },
    });
    const result = await runTurn({
      chatId: CHAT_UUID,
      seed: 'Go.',
      tools: [],
      model: { providerId: 'local-fake', id: 'fake-model' },
      deps,
    });
    assert.equal(result.outcome, 'crashed');
    assert.equal(result.error, 'provider exploded');
  });
});

describe('runTurn tools and opaque chatId', () => {
  test('ask_question in tools is executed when the model calls it', { timeout: 20_000 }, async () => {
    /** @type {string[]} */
    const executed = [];
    await withFake(
      [
        {
          match: { nth: 0 },
          emit: functionCallChunks('ask_question', { prompt: 'Ready?' }, 'call_ask'),
        },
        { emit: proseSseChunks('Done.') },
      ],
      async (baseUrl) => {
        const result = await runTurn({
          chatId: CHAT_UUID,
          seed: 'Ask if needed, then finish.',
          tools: [ASK_QUESTION_TOOL],
          model: { providerId: 'local-fake', id: 'fake-model' },
          cwd: 'C:\\work\\slot',
          deps: stubDeps(baseUrl, { runHeadlessToolBatch: passthroughBatch }),
          execute: async (name, args, ctx) => {
            executed.push(name);
            assert.equal(ctx.cwd, 'C:\\work\\slot');
            assert.equal(ctx.chatId, CHAT_UUID);
            return { content: name === 'ask_question' ? 'yes' : '' };
          },
        });
        assert.ok(executed.includes('ask_question'), 'ask_question must be dispatched');
        assert.deepEqual(result, { outcome: 'no_report' });
      },
    );
  });

  test('ask_question omitted from tools is not advertised', { timeout: 20_000 }, async () => {
    await withFake([{ emit: proseSseChunks('Done.') }], async (baseUrl, fake) => {
      await runTurn({
        chatId: CHAT_UUID,
        seed: 'Just finish.',
        tools: [],
        model: { providerId: 'local-fake', id: 'fake-model' },
        limits: { maxTurns: 2 },
        deps: stubDeps(baseUrl),
      });
      const completion = fake.requests.find((row) => row.pathname === '/v1/chat/completions');
      assert.ok(completion, 'expected a completion request');
      const names = (completion.body?.tools ?? []).map((tool) => tool.function?.name);
      assert.equal(names.includes('ask_question'), false);
      assert.ok(names.includes(DEFAULT_REPORT_TOOL_NAME));
    });
  });

  test('works with a UUID chatId and no board in existence', { timeout: 20_000 }, async () => {
    const payload = {
      outcome: 'pass',
      summary: 'opaque id',
      evidence: [],
    };
    const transcript = createMemoryTranscriptStore();
    await withFake([{ emit: functionCallChunks(DEFAULT_REPORT_TOOL_NAME, payload) }], async (baseUrl) => {
      const result = await runTurn({
        chatId: CHAT_UUID,
        seed: 'Report when done.',
        tools: [],
        model: { providerId: 'local-fake', id: 'fake-model' },
        transcript,
        deps: stubDeps(baseUrl),
      });
      assert.deepEqual(result, payload);
      const row = transcript.load(CHAT_UUID);
      assert.ok(row, 'transcript is keyed by the opaque chatId');
      assert.equal(transcript.load('not-a-real-board'), null);
    });
  });
});
