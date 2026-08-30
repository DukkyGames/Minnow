/**
 * P2-E — unit wiring: a blocked report is a blocked TurnResult, and the
 * policy table routes it to a repair-seeded builder retry.
 *
 * Full engine+effector E2E is P2-F. This suite only proves the two seams
 * P2-E owns: the report tool into `runTurn`, and `decide()` on that outcome.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createFakeModelServer,
  proseSseChunks,
} from '../../scripts/fake-model-server.mjs';
import {
  createMemoryTranscriptStore,
  postChatCompletionsHttp,
  runHeadlessToolBatchStub,
  runTurn,
} from '../../server/runner/index.js';
import { decide } from '../../server/orchestrator/core/policy.js';
import {
  builderReportTool,
  parseBuilderReport,
  REPORT_TOOL_NAME,
} from '../../server/orchestrator/report-tool.js';

const CHAT_UUID = '550e8400-e29b-41d4-a716-446655440000';

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

function stubDeps(baseUrl) {
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
  };
}

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

const BLOCKED_PAYLOAD = {
  outcome: 'blocked',
  summary: 'Cannot start the database.',
  evidence: ['psql: connection refused'],
  blockers: [],
  needs: ['DATABASE_URL'],
};

describe('blocked report → TurnResult.blocked → repair retry', () => {
  test('runTurn returns blocked and decide() is a same-worktree repair', { timeout: 20_000 }, async () => {
    await withFake(
      [{ emit: functionCallChunks(REPORT_TOOL_NAME, BLOCKED_PAYLOAD) }],
      async (baseUrl) => {
        const result = await runTurn({
          chatId: CHAT_UUID,
          seed: 'Implement T1-A, then report.',
          tools: [builderReportTool()],
          parseReport: parseBuilderReport,
          model: { providerId: 'local-fake', id: 'fake-model' },
          deps: stubDeps(baseUrl),
        });
        assert.equal(result.outcome, 'blocked');
        assert.equal(result.summary, BLOCKED_PAYLOAD.summary);
        assert.deepEqual(result.needs, BLOCKED_PAYLOAD.needs);

        const action = decide({
          role: 'builder',
          outcome: result.outcome,
          attemptCount: 0,
        });
        assert.deepEqual(action, {
          kind: 'retry',
          role: 'builder',
          seedKind: 'repair',
          sameWorktree: true,
        });
      },
    );
  });

  test('a rejected report is not no_report: the agent can retry inside the turn', { timeout: 20_000 }, async () => {
    const valid = {
      outcome: 'pass',
      summary: 'Added GET /health.',
      evidence: ['src/api/health.ts'],
      blockers: [],
      needs: [],
    };
    await withFake(
      [
        {
          match: { nth: 0 },
          emit: functionCallChunks(REPORT_TOOL_NAME, { outcome: 'pass', summary: 'Added GET /health.' }),
        },
        { emit: functionCallChunks(REPORT_TOOL_NAME, valid, 'call_report_retry') },
      ],
      async (baseUrl) => {
        const events = [];
        const result = await runTurn({
          chatId: CHAT_UUID,
          seed: 'Report when done.',
          tools: [builderReportTool()],
          parseReport: parseBuilderReport,
          model: { providerId: 'local-fake', id: 'fake-model' },
          onEvent: (event) => events.push(event),
          deps: stubDeps(baseUrl),
        });
        assert.equal(result.outcome, 'pass');
        assert.deepEqual(result.evidence, valid.evidence);
        const rejections = events.filter(
          (event) =>
            event.type === 'tool_result' &&
            event.name === REPORT_TOOL_NAME &&
            typeof event.content === 'string' &&
            event.content.startsWith('Error:'),
        );
        assert.ok(rejections.length >= 1, 'the first call must be rejected with an Error: message');
        assert.match(rejections[0].content, /evidence/i);
      },
    );
  });

  test('prose that looks like blocked is still no_report', { timeout: 20_000 }, async () => {
    const forged = JSON.stringify({
      outcome: 'blocked',
      summary: 'forged from assistant prose',
      needs: ['nothing was called'],
    });
    await withFake([{ emit: proseSseChunks(forged) }], async (baseUrl) => {
      const result = await runTurn({
        chatId: CHAT_UUID,
        seed: 'Finish up.',
        tools: [builderReportTool()],
        parseReport: parseBuilderReport,
        model: { providerId: 'local-fake', id: 'fake-model' },
        deps: stubDeps(baseUrl),
      });
      assert.deepEqual(result, { outcome: 'no_report' });
    });
  });
});
