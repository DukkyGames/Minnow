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
  ASK_QUESTION_TOOL_NAME,
  ASK_QUESTION_TIMEOUT_ERROR,
  ASK_QUESTION_UNAVAILABLE_ERROR,
  DEFAULT_ASK_TIMEOUT_MS,
  postChatCompletionsHttp,
  resolveTurnTools,
  runHeadlessToolBatchStub,
  runTurn,
  buildOpeningMessages,
} from '../../server/runner/index.js';
import { SUB_AGENT_TOOL_USE_NUDGE_INSTRUCTION } from '../../server/runner/turn-continuation.js';

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
 * OpenAI-v1 tool-call SSE, same shape as the fake host's report_outcome helper
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

/**
 * The same tool-call stream, but with the provider reporting usage on the
 * finish chunk — which is where OpenAI-v1 puts it.
 *
 * @param {string} name
 * @param {unknown} args
 * @param {Record<string, number>} usage
 */
function functionCallChunksWithUsage(name, args, usage) {
  const chunks = functionCallChunks(name, args);
  const finish = JSON.stringify({
    choices: [{ delta: {}, finish_reason: 'tool_calls' }],
    usage,
  });
  // Replace the finish chunk; keep the delta and the end event around it.
  return [chunks[0], `data: ${finish}\n\n`, chunks[2]];
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
  const runnerDir = path.join(PROJECT_ROOT, 'server', 'runner');

  test('does not import the sub-agent prose outcome parser', () => {
    // pass/fail/blocked must come from the report tool, not transcript scraping.
    assert.equal(source.includes('tryParseStructuredOutcomeFromAssistantProse'), false);
    assert.equal(source.includes('legacyOutcomeFromSummary'), false);
    assert.equal(source.includes('sub-agent-structured-outcome'), false);
  });

  test('does not branch on isBoard for tool availability', () => {
    // Injection (`ask`) decides ask_question — never a product-shaped board check.
    const files = fs.readdirSync(runnerDir).filter((name) => name.endsWith('.js'));
    for (const name of files) {
      const code = fs.readFileSync(path.join(runnerDir, name), 'utf8');
      assert.equal(/\bisBoard\b/.test(code), false, `${name} must not mention isBoard`);
      assert.equal(code.includes('if (isBoard)'), false, `${name} must not branch on isBoard`);
    }
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

describe('P5-D the turn reports what it cost (MIN-722)', () => {
  const payload = { outcome: 'pass', summary: 'Did the work.', evidence: ['ok'] };

  test('usage reaches the caller on the path a successful attempt actually takes', async () => {
    // That path is a throw: `report_outcome` unwinds the loop, so the inner
    // runner's return — and the usage it would have carried — never arrives.
    // Collecting segments as they land is the only accounting that survives it,
    // and this is the test that would fail if that were quietly reverted.
    await withFake(
      [
        {
          emit: functionCallChunksWithUsage(DEFAULT_REPORT_TOOL_NAME, payload, {
            prompt_tokens: 1234,
            completion_tokens: 56,
            total_tokens: 1290,
          }),
        },
      ],
      async (baseUrl) => {
        const result = await runTurn({
          chatId: CHAT_UUID,
          seed: 'Do the work, then report.',
          tools: [],
          model: { providerId: 'local-fake', id: 'fake-model' },
          deps: stubDeps(baseUrl),
        });
        assert.equal(result.outcome, 'pass');
        assert.equal(result.usage?.prompt_tokens, 1234);
        assert.equal(result.usage?.completion_tokens, 56);
        assert.equal(result.usage?.total_tokens, 1290);
      },
    );
  });

  test('a provider that reports no usage yields no usage field, not zeros', async () => {
    await withFake([{ emit: functionCallChunks(DEFAULT_REPORT_TOOL_NAME, payload) }], async (baseUrl) => {
      const result = await runTurn({
        chatId: CHAT_UUID,
        seed: 'Do the work, then report.',
        tools: [],
        model: { providerId: 'local-fake', id: 'fake-model' },
        deps: stubDeps(baseUrl),
      });
      // Zeros would be a lie that sums cleanly and reads as a free attempt.
      assert.equal('usage' in result, false);
    });
  });
});

describe('P6-A chat-shaped turn (MIN-723)', () => {
  const DATETIME_TOOL = {
    type: 'function',
    function: {
      name: 'get_datetime',
      description: 'Get the current date and time',
      parameters: { type: 'object', properties: {} },
    },
  };

  test('prose + get_datetime without a report is no_report and emits events', { timeout: 20_000 }, async () => {
    /** @type {string[]} */
    const executed = [];
    /** @type {string[]} */
    const eventTypes = [];
    await withFake(
      [
        {
          match: { nth: 0 },
          emit: functionCallChunks('get_datetime', {}, 'call_dt'),
        },
        { emit: proseSseChunks('It is noon.') },
      ],
      async (baseUrl) => {
        const result = await runTurn({
          chatId: CHAT_UUID,
          seed: 'What time is it?',
          tools: [DATETIME_TOOL],
          model: { providerId: 'local-fake', id: 'fake-model' },
          onEvent: (event) => eventTypes.push(event.type),
          deps: stubDeps(baseUrl, { runHeadlessToolBatch: passthroughBatch }),
          execute: async (name) => {
            executed.push(name);
            return { content: '2026-08-31T12:00:00.000Z' };
          },
        });
        assert.ok(executed.includes('get_datetime'));
        assert.equal(result.outcome, 'no_report');
        assert.ok(eventTypes.includes('tool_call'));
        assert.ok(eventTypes.includes('tool_result'));
        assert.ok(
          eventTypes.includes('delta') || eventTypes.includes('thinking'),
          'a chat-shaped completion must emit stream events',
        );
      },
    );
  });

  test('report_outcome stays injected even when the caller passes chat tools', { timeout: 20_000 }, async () => {
    await withFake([{ emit: proseSseChunks('Done.') }], async (baseUrl, fake) => {
      await runTurn({
        chatId: CHAT_UUID,
        seed: 'Just finish.',
        tools: [DATETIME_TOOL],
        model: { providerId: 'local-fake', id: 'fake-model' },
        limits: { maxTurns: 2 },
        deps: stubDeps(baseUrl),
      });
      const completion = fake.requests.find((row) => row.pathname === '/v1/chat/completions');
      assert.ok(completion, 'expected a completion request');
      const names = (completion.body?.tools ?? []).map((tool) => tool.function?.name);
      assert.ok(names.includes('get_datetime'));
      assert.ok(
        names.includes(DEFAULT_REPORT_TOOL_NAME),
        'P6-A did not add a way to omit the report tool — that is a gap, not a silent patch',
      );
    });
  });
});

describe('P6-B AskCapability (MIN-724)', () => {
  const ASK_ARGS = {
    questions: [
      {
        id: 'q1',
        prompt: 'Ready?',
        options: [
          { id: 'yes', label: 'Yes' },
          { id: 'no', label: 'No' },
        ],
      },
    ],
  };

  const ANSWER_JSON =
    '{"status":"answered","answers":[{"questionId":"q1","selectedIds":["yes"],"otherText":null}]}';

  test('capability present: chat-shaped turn asks and receives an answer', { timeout: 20_000 }, async () => {
    /** @type {unknown[]} */
    const asked = [];
    /** @type {string[]} */
    const executed = [];
    await withFake(
      [
        {
          match: { nth: 0 },
          emit: functionCallChunks(ASK_QUESTION_TOOL_NAME, ASK_ARGS, 'call_ask'),
        },
        { emit: proseSseChunks('Thanks.') },
      ],
      async (baseUrl) => {
        const events = [];
        const result = await runTurn({
          chatId: CHAT_UUID,
          seed: 'Ask if needed, then finish.',
          tools: [],
          model: { providerId: 'local-fake', id: 'fake-model' },
          onEvent: (event) => events.push(event),
          deps: stubDeps(baseUrl, { runHeadlessToolBatch: passthroughBatch }),
          ask: {
            ask: async (question) => {
              asked.push(question);
              return ANSWER_JSON;
            },
          },
          execute: async (name) => {
            executed.push(name);
            return { content: '' };
          },
        });
        assert.equal(asked.length, 1, 'injected ask() must run');
        assert.equal(executed.includes(ASK_QUESTION_TOOL_NAME), false, 'must not double-prompt via execute');
        assert.equal(result.outcome, 'no_report');
        assert.ok(
          events.some(
            (event) =>
              event.type === 'tool_result' &&
              event.name === ASK_QUESTION_TOOL_NAME &&
              String(event.content).includes('answered'),
          ),
        );
      },
    );
  });

  test('capability present: ask_question is on the resolved tool list', { timeout: 20_000 }, async () => {
    const resolved = resolveTurnTools([], { ask: { ask: async () => '' } });
    assert.ok(resolved.some((tool) => tool.function.name === ASK_QUESTION_TOOL_NAME));
    await withFake([{ emit: proseSseChunks('Done.') }], async (baseUrl, fake) => {
      await runTurn({
        chatId: CHAT_UUID,
        seed: 'Just finish.',
        tools: [],
        model: { providerId: 'local-fake', id: 'fake-model' },
        limits: { maxTurns: 2 },
        deps: stubDeps(baseUrl),
        ask: { ask: async () => ANSWER_JSON },
      });
      const completion = fake.requests.find((row) => row.pathname === '/v1/chat/completions');
      assert.ok(completion, 'expected a completion request');
      const names = (completion.body?.tools ?? []).map((tool) => tool.function?.name);
      assert.ok(names.includes(ASK_QUESTION_TOOL_NAME));
      assert.ok(names.includes(DEFAULT_REPORT_TOOL_NAME));
    });
  });

  test('null / omitted capability: ask_question is absent even if the caller passed it', () => {
    const withSchema = resolveTurnTools([ASK_QUESTION_TOOL], { ask: null });
    assert.equal(
      withSchema.some((tool) => tool.function.name === ASK_QUESTION_TOOL_NAME),
      false,
    );
    const omitted = resolveTurnTools([ASK_QUESTION_TOOL], {});
    assert.equal(
      omitted.some((tool) => tool.function.name === ASK_QUESTION_TOOL_NAME),
      false,
    );
    assert.ok(withSchema.some((tool) => tool.function.name === DEFAULT_REPORT_TOOL_NAME));
    assert.equal(DEFAULT_ASK_TIMEOUT_MS, 60 * 60 * 1000);
  });

  test('headless null: fabricated ask_question is an immediate error and does not hang', { timeout: 8_000 }, async () => {
    let hangingAskCalled = 0;
    /** @type {string[]} */
    const executed = [];
    const hangingAsk = {
      ask: async () => {
        hangingAskCalled += 1;
        await new Promise(() => {});
      },
    };
    void hangingAsk;
    const started = Date.now();
    await withFake(
      [
        {
          match: { nth: 0 },
          emit: functionCallChunks(ASK_QUESTION_TOOL_NAME, ASK_ARGS, 'call_ask'),
        },
        { emit: proseSseChunks('Continuing without an answer.') },
      ],
      async (baseUrl) => {
        const events = [];
        const result = await runTurn({
          chatId: CHAT_UUID,
          seed: 'Do not wait on a human.',
          tools: [ASK_QUESTION_TOOL],
          model: { providerId: 'local-fake', id: 'fake-model' },
          onEvent: (event) => events.push(event),
          deps: stubDeps(baseUrl, { runHeadlessToolBatch: passthroughBatch }),
          ask: null,
          execute: async (name) => {
            executed.push(name);
            if (name === ASK_QUESTION_TOOL_NAME) {
              await new Promise(() => {});
            }
            return { content: '' };
          },
        });
        assert.ok(Date.now() - started < 5_000, 'null path must not wait on a modal');
        assert.equal(hangingAskCalled, 0, 'hanging ask() must not be called');
        assert.equal(executed.includes(ASK_QUESTION_TOOL_NAME), false);
        assert.equal(result.outcome, 'no_report');
        assert.ok(
          events.some(
            (event) =>
              event.type === 'tool_result' &&
              event.name === ASK_QUESTION_TOOL_NAME &&
              event.content === ASK_QUESTION_UNAVAILABLE_ERROR,
          ),
          'fabricated call must surface the immediate Error: tool result',
        );
      },
    );
  });

  test('unanswered interactive question times out and the turn resolves', { timeout: 8_000 }, async () => {
    const started = Date.now();
    await withFake(
      [
        {
          match: { nth: 0 },
          emit: functionCallChunks(ASK_QUESTION_TOOL_NAME, ASK_ARGS, 'call_ask'),
        },
        { emit: proseSseChunks('Moved on after timeout.') },
      ],
      async (baseUrl) => {
        const events = [];
        const result = await runTurn({
          chatId: CHAT_UUID,
          seed: 'Ask, then continue.',
          tools: [],
          model: { providerId: 'local-fake', id: 'fake-model' },
          onEvent: (event) => events.push(event),
          deps: stubDeps(baseUrl, { runHeadlessToolBatch: passthroughBatch }),
          ask: {
            ask: () => new Promise(() => {}),
          },
          askTimeoutMs: 80,
        });
        assert.ok(Date.now() - started < 5_000, 'ask timeout must resolve the turn');
        assert.equal(result.outcome, 'no_report');
        assert.ok(
          events.some(
            (event) =>
              event.type === 'tool_result' &&
              event.name === ASK_QUESTION_TOOL_NAME &&
              event.content === ASK_QUESTION_TIMEOUT_ERROR,
          ),
        );
      },
    );
  });

  test('null capability: model does not see ask_question even if the caller passed it', { timeout: 20_000 }, async () => {
    await withFake([{ emit: proseSseChunks('Done.') }], async (baseUrl, fake) => {
      await runTurn({
        chatId: CHAT_UUID,
        seed: 'Just finish.',
        tools: [ASK_QUESTION_TOOL],
        model: { providerId: 'local-fake', id: 'fake-model' },
        limits: { maxTurns: 2 },
        deps: stubDeps(baseUrl),
        ask: null,
      });
      const completion = fake.requests.find((row) => row.pathname === '/v1/chat/completions');
      assert.ok(completion, 'expected a completion request');
      const names = (completion.body?.tools ?? []).map((tool) => tool.function?.name);
      assert.equal(names.includes(ASK_QUESTION_TOOL_NAME), false);
      assert.ok(names.includes(DEFAULT_REPORT_TOOL_NAME));
    });
  });

  test('composer abort during ask does not hang', { timeout: 8_000 }, async () => {
    const controller = new AbortController();
    await withFake(
      [{ emit: functionCallChunks(ASK_QUESTION_TOOL_NAME, ASK_ARGS, 'call_ask') }],
      async (baseUrl) => {
        const turn = runTurn({
          chatId: CHAT_UUID,
          seed: 'Ask.',
          tools: [],
          model: { providerId: 'local-fake', id: 'fake-model' },
          signal: controller.signal,
          deps: stubDeps(baseUrl, { runHeadlessToolBatch: passthroughBatch }),
          ask: {
            ask: () => new Promise(() => {}),
          },
          askTimeoutMs: 60_000,
        });
        setTimeout(() => controller.abort(), 50);
        const result = await turn;
        assert.equal(result.outcome, 'crashed');
        assert.equal(result.error, 'aborted');
      },
    );
  });
});

describe('P6-C runTurn interface (MIN-725)', () => {
  const DATETIME_TOOL = {
    type: 'function',
    function: {
      name: 'get_datetime',
      description: 'Get the current date and time',
      parameters: { type: 'object', properties: {} },
    },
  };

  test('buildOpeningMessages isolated start is [system, user(seed)]', () => {
    const opened = buildOpeningMessages('sys', 'hello');
    assert.equal(opened.length, 2);
    assert.equal(opened[0].role, 'system');
    assert.equal(opened[0].content, 'sys');
    assert.equal(opened[1].role, 'user');
    assert.equal(opened[1].content, 'hello');
  });

  test('buildOpeningMessages continue appends seed and skips a leading system', () => {
    const opened = buildOpeningMessages('new-sys', 'second', [
      { role: 'system', content: 'old-sys' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'hi' },
    ]);
    assert.equal(opened[0].content, 'new-sys');
    assert.deepEqual(
      opened.slice(1).map((m) => m.role),
      ['user', 'assistant', 'user'],
    );
    assert.equal(opened[opened.length - 1].content, 'second');
  });

  test('buildOpeningMessages continue does not duplicate a matching last user', () => {
    const opened = buildOpeningMessages('sys', 'hello', [{ role: 'user', content: 'hello' }]);
    assert.equal(opened.length, 2);
    assert.equal(opened[1].content, 'hello');
  });

  test('history continuation: prior turns reach the model and persist suffixes', { timeout: 20_000 }, async () => {
    const store = createMemoryTranscriptStore();
    store.append(CHAT_UUID, { role: 'user', content: 'first' });
    store.append(CHAT_UUID, { role: 'assistant', content: 'hi' });
    await withFake([{ emit: proseSseChunks('second reply') }], async (baseUrl, fake) => {
      const result = await runTurn({
        chatId: CHAT_UUID,
        seed: 'second',
        seedKind: 'continue',
        tools: [],
        model: { providerId: 'local-fake', id: 'fake-model' },
        transcript: store,
        deps: stubDeps(baseUrl),
        injectReportTool: false,
        nudgeToolUse: false,
        finalizeStructuredOutcome: false,
        systemPrompt: 'chat system',
      });
      assert.equal(result.outcome, 'no_report');
      const completion = fake.requests.find((row) => row.pathname === '/v1/chat/completions');
      assert.ok(completion, 'expected a completion request');
      const roles = (completion.body?.messages ?? []).map((m) => `${m.role}:${m.content}`);
      assert.ok(roles[0].startsWith('system:'), 'continue still prepends this turn systemPrompt');
      assert.ok(roles.includes('user:first'), 'prior user must reach the model');
      assert.ok(roles.includes('assistant:hi'), 'prior assistant must reach the model');
      assert.ok(roles.includes('user:second'), 'new seed must be appended');
    });
    const persisted = store.load(CHAT_UUID)?.messages ?? [];
    const persistedRoles = persisted.map((m) => m.role);
    assert.equal(persistedRoles.includes('system'), false, 'must not splice a system row into product history');
    assert.deepEqual(
      persisted.map((m) => `${m.role}:${m.content}`).slice(0, 3),
      ['user:first', 'assistant:hi', 'user:second'],
    );
    assert.equal(persisted.filter((m) => m.role === 'user' && m.content === 'second').length, 1);
  });

  /**
   * Expert chats seed `chat.history` with an authored assistant greeting
   * (`createExpertChatFromSeed`), so a continue turn on one used to open the
   * conversation on an assistant row. `buildOpeningTranscript` folds that
   * preamble into the system message — and reports the `persistFrom` boundary,
   * because the folded row makes the opening shorter than `prior.length + 1`.
   */
  test(
    'expert chat: user-first body, and the reply is persisted exactly once',
    { timeout: 20_000 },
    async () => {
      const greeting = 'Hi — I am **Security reviewer**. What are we looking at?';
      const store = createMemoryTranscriptStore();
      // What an expert chat holds on its second send: the greeting, then the
      // user row chat pushed before calling runTurn.
      store.append(CHAT_UUID, { role: 'assistant', content: greeting });
      store.append(CHAT_UUID, { role: 'user', content: 'audit this' });

      await withFake([{ emit: proseSseChunks('reply') }], async (baseUrl, fake) => {
        const result = await runTurn({
          chatId: CHAT_UUID,
          seed: 'audit this',
          seedKind: 'continue',
          tools: [],
          model: { providerId: 'local-fake', id: 'fake-model' },
          transcript: store,
          deps: stubDeps(baseUrl),
          injectReportTool: false,
          nudgeToolUse: false,
          finalizeStructuredOutcome: false,
          systemPrompt: 'chat system',
        });
        assert.equal(result.outcome, 'no_report');

        const completion = fake.requests.find((row) => row.pathname === '/v1/chat/completions');
        const sent = completion?.body?.messages ?? [];
        assert.equal(sent[0]?.role, 'system');
        assert.match(sent[0].content, /chat system/);
        assert.match(sent[0].content, /already greeted the user in the UI/);
        assert.match(sent[0].content, /Security reviewer/, 'greeting reaches the model');
        assert.deepEqual(
          sent.slice(1).map((m) => `${m.role}:${m.content}`),
          ['user:audit this'],
          'no assistant row before the first user turn',
        );
      });

      // The fold is send-only: the greeting stays in product history, the user
      // row is not duplicated, and this turn's reply lands exactly once.
      // Anchoring persist on `have + 1` instead of `persistFrom` drops it.
      assert.deepEqual(
        (store.load(CHAT_UUID)?.messages ?? []).map((m) => `${m.role}:${m.content}`),
        [`assistant:${greeting}`, 'user:audit this', 'assistant:reply'],
      );
    },
  );

  test(
    'continue: a seed already stored is not persisted a second time',
    { timeout: 20_000 },
    async () => {
      const store = createMemoryTranscriptStore();
      store.append(CHAT_UUID, { role: 'user', content: 'first' });
      store.append(CHAT_UUID, { role: 'assistant', content: 'hi' });
      // Chat pushes the user row before the send; the opening must not re-add it.
      store.append(CHAT_UUID, { role: 'user', content: 'second' });

      await withFake([{ emit: proseSseChunks('second reply') }], async (baseUrl) => {
        await runTurn({
          chatId: CHAT_UUID,
          seed: 'second',
          seedKind: 'continue',
          tools: [],
          model: { providerId: 'local-fake', id: 'fake-model' },
          transcript: store,
          deps: stubDeps(baseUrl),
          injectReportTool: false,
          nudgeToolUse: false,
          finalizeStructuredOutcome: false,
          systemPrompt: 'chat system',
        });
      });

      assert.deepEqual(
        (store.load(CHAT_UUID)?.messages ?? []).map((m) => `${m.role}:${m.content}`),
        ['user:first', 'assistant:hi', 'user:second', 'assistant:second reply'],
      );
    },
  );

  test('isolated seed (board default) still starts [system, user] with no prior', { timeout: 20_000 }, async () => {
    const store = createMemoryTranscriptStore();
    await withFake([{ emit: proseSseChunks('Done.') }], async (baseUrl, fake) => {
      await runTurn({
        chatId: CHAT_UUID,
        seed: 'only seed',
        tools: [],
        model: { providerId: 'local-fake', id: 'fake-model' },
        transcript: store,
        deps: stubDeps(baseUrl),
        // Opening-shape only — skip sub-agent extras so the first completion is the seed.
        nudgeToolUse: false,
        finalizeStructuredOutcome: false,
      });
      const completion = fake.requests.find((row) => row.pathname === '/v1/chat/completions');
      const messages = completion.body?.messages ?? [];
      assert.equal(messages[0]?.role, 'system');
      assert.equal(messages[1]?.role, 'user');
      assert.equal(messages[1]?.content, 'only seed');
      assert.equal(messages.length, 2);
    });
    const persisted = store.load(CHAT_UUID)?.messages ?? [];
    assert.equal(persisted[0]?.role, 'system', 'isolated persist still stores the leading system');
  });

  test('injectReportTool false omits report_outcome; board default still injects', () => {
    const chatShaped = resolveTurnTools([DATETIME_TOOL], { injectReportTool: false });
    assert.ok(chatShaped.some((t) => t.function.name === 'get_datetime'));
    assert.equal(
      chatShaped.some((t) => t.function.name === DEFAULT_REPORT_TOOL_NAME),
      false,
      'chat must not see report_outcome',
    );
    const nullName = resolveTurnTools([DATETIME_TOOL], { reportToolName: null });
    assert.equal(nullName.some((t) => t.function.name === DEFAULT_REPORT_TOOL_NAME), false);
    const boardDefault = resolveTurnTools([DATETIME_TOOL], {});
    assert.ok(
      boardDefault.some((t) => t.function.name === DEFAULT_REPORT_TOOL_NAME),
      'board default remains inject-on',
    );
  });

  test('chat-shaped turn does not put report_outcome on the wire', { timeout: 20_000 }, async () => {
    await withFake([{ emit: proseSseChunks('It is noon.') }], async (baseUrl, fake) => {
      const result = await runTurn({
        chatId: CHAT_UUID,
        seed: 'What time is it?',
        tools: [DATETIME_TOOL],
        model: { providerId: 'local-fake', id: 'fake-model' },
        deps: stubDeps(baseUrl),
        injectReportTool: false,
        nudgeToolUse: false,
        finalizeStructuredOutcome: false,
        systemPrompt: 'You are a chat assistant.',
      });
      assert.equal(result.outcome, 'no_report');
      const completion = fake.requests.find((row) => row.pathname === '/v1/chat/completions');
      const names = (completion.body?.tools ?? []).map((tool) => tool.function?.name);
      assert.ok(names.includes('get_datetime'));
      assert.equal(names.includes(DEFAULT_REPORT_TOOL_NAME), false);
    });
  });

  test('nudgeToolUse false: prose with tools does not inject the sub-agent nudge', { timeout: 20_000 }, async () => {
    await withFake([{ emit: proseSseChunks('Just prose.') }], async (baseUrl, fake) => {
      const result = await runTurn({
        chatId: CHAT_UUID,
        seed: 'Hi',
        tools: [DATETIME_TOOL],
        model: { providerId: 'local-fake', id: 'fake-model' },
        deps: stubDeps(baseUrl),
        injectReportTool: false,
        nudgeToolUse: false,
        finalizeStructuredOutcome: false,
        systemPrompt: 'chat',
      });
      assert.equal(result.outcome, 'no_report');
      const completions = fake.requests.filter((row) => row.pathname === '/v1/chat/completions');
      assert.equal(completions.length, 1, 'no extra nudge completion');
      const userContents = (completions[0].body?.messages ?? [])
        .filter((m) => m.role === 'user')
        .map((m) => m.content);
      assert.equal(userContents.includes(SUB_AGENT_TOOL_USE_NUDGE_INSTRUCTION), false);
    });
  });

  test('nudgeToolUse default still nudges when tools are present (board)', { timeout: 20_000 }, async () => {
    await withFake(
      [{ emit: proseSseChunks('Prose first.') }, { emit: proseSseChunks('After nudge.') }],
      async (baseUrl, fake) => {
        await runTurn({
          chatId: CHAT_UUID,
          seed: 'Do the task.',
          tools: [DATETIME_TOOL],
          model: { providerId: 'local-fake', id: 'fake-model' },
          deps: stubDeps(baseUrl),
          limits: { maxTurns: 2 },
        });
        const completions = fake.requests.filter((row) => row.pathname === '/v1/chat/completions');
        assert.ok(completions.length >= 2, 'default still spends a nudge completion');
        const nudged = completions.some((row) =>
          (row.body?.messages ?? []).some(
            (m) => m.role === 'user' && m.content === SUB_AGENT_TOOL_USE_NUDGE_INSTRUCTION,
          ),
        );
        assert.ok(nudged, 'board default must still inject the tool-use nudge');
      },
    );
  });
});

