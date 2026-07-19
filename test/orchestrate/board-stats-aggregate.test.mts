import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  aggregateBoardMetrics,
  chatCumulativeUsage,
  latestTurnStatsPair,
} from '../../src/chat/orchestrate/board-stats-aggregate.ts';
import {
  createEmptyChatObject,
  sessionState,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

function makeChat(overrides: Partial<Chat> & Pick<Chat, 'id'>): Chat {
  return {
    ...createEmptyChatObject('test-model', '/workspace'),
    ...overrides,
  };
}

function makeBoardGroup(): ChatGroup {
  return {
    id: 'group-11111111-1111-1111-1111-111111111111',
    name: 'Board',
    workspacePath: '/workspace',
    collapsed: false,
    order: 0,
    createdAt: 1,
    plannerChatId: 'planner-11111111-1111-1111-1111-111111111111',
    orchestrateBoard: {
      planPath: 'documentation/plans/test.md',
      waves: [{ id: 'w1', title: 'Wave 1', collapsed: false }],
      tasks: [
        {
          id: 'T1',
          title: 'Task 1',
          status: 'complete',
          category: 'build',
          waveId: 'w1',
          chatId: 'member-11111111-1111-1111-1111-111111111111',
        },
        {
          id: 'T2',
          title: 'Task 2',
          status: 'complete',
          category: 'build',
          waveId: 'w1',
          chatId: 'member-22222222-2222-2222-2222-222222222222',
        },
        {
          id: 'T3',
          title: 'Task 3',
          status: 'complete',
          category: 'build',
          waveId: 'w1',
          chatId: 'member-33333333-3333-3333-3333-333333333333',
        },
      ],
      autoRunning: false,
      lastUpdatedAt: 1,
    },
  };
}

describe('board stats aggregate (MIN-414)', () => {
  afterEach(() => {
    setSessionStateForTests(null);
  });

  test('chatCumulativeUsage prefers token ledger totals over history', () => {
    const chat = makeChat({
      id: 'chat-a',
      history: [
        {
          role: 'assistant',
          content: 'old',
          usage: { prompt_tokens: 999, completion_tokens: 999, total_tokens: 1998 },
        },
      ],
      tokenLedger: {
        entries: [],
        totals: {
          promptTokens: 100,
          completionTokens: 40,
          totalTokens: 140,
          costUsd: 0,
          completionCount: 1,
        },
        bySource: {},
      },
    });
    const usage = chatCumulativeUsage(chat);
    assert.deepEqual(usage, {
      prompt_tokens: 100,
      completion_tokens: 40,
      total_tokens: 140,
    });
  });

  test('aggregateBoardMetrics sums tokens across planner and member chats', () => {
    const group = makeBoardGroup();
    const planner = makeChat({
      id: 'planner-11111111-1111-1111-1111-111111111111',
      modeId: 'orchestrate',
    });
    planner.lastStats = {
      tokens_per_second: 10,
      time_to_first_token: 0.2,
      generation_time: 1,
      total_tokens: 300,
      prompt_tokens: 200,
      completion_tokens: 100,
      stop_reason: null,
    };
    planner.tokenLedger = {
      entries: [],
      totals: {
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300,
        costUsd: 0,
        completionCount: 1,
      },
      bySource: {},
    };

    const member1 = makeChat({
      id: 'member-11111111-1111-1111-1111-111111111111',
      modeId: 'build',
    });
    member1.lastStats = {
      tokens_per_second: 20,
      time_to_first_token: 0.4,
      generation_time: 2,
      total_tokens: 500,
      prompt_tokens: 400,
      completion_tokens: 100,
      stop_reason: null,
    };
    member1.tokenLedger = {
      entries: [],
      totals: {
        promptTokens: 400,
        completionTokens: 100,
        totalTokens: 500,
        costUsd: 0,
        completionCount: 1,
      },
      bySource: {},
    };

    const member2 = makeChat({
      id: 'member-22222222-2222-2222-2222-222222222222',
      modeId: 'build',
    });
    member2.lastStats = {
      tokens_per_second: 30,
      time_to_first_token: 0.6,
      generation_time: 3,
      total_tokens: 700,
      prompt_tokens: 500,
      completion_tokens: 200,
      stop_reason: null,
    };
    member2.tokenLedger = {
      entries: [],
      totals: {
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
        costUsd: 0,
        completionCount: 1,
      },
      bySource: {},
    };

    const member3 = makeChat({
      id: 'member-33333333-3333-3333-3333-333333333333',
      modeId: 'build',
    });
    member3.lastStats = {
      tokens_per_second: 40,
      time_to_first_token: 0.8,
      generation_time: 4,
      total_tokens: 900,
      prompt_tokens: 600,
      completion_tokens: 300,
      stop_reason: null,
    };
    member3.tokenLedger = {
      entries: [],
      totals: {
        promptTokens: 600,
        completionTokens: 300,
        totalTokens: 900,
        costUsd: 0,
        completionCount: 1,
      },
      bySource: {},
    };

    setSessionStateForTests({
      version: 6,
      activeId: planner.id,
      sidebarCollapsed: false,
      chats: [planner, member1, member2, member3],
      groups: [group],
    });

    const metrics = aggregateBoardMetrics(group);
    assert.equal(metrics.usage.prompt_tokens, 1700);
    assert.equal(metrics.usage.completion_tokens, 700);
    assert.equal(metrics.usage.total_tokens, 2400);
    assert.equal(metrics.stats.tokens_per_second, 30);
    assert.ok(
      metrics.stats.time_to_first_token != null &&
        Math.abs(metrics.stats.time_to_first_token - 0.5) < 1e-9,
    );
    assert.equal(metrics.stats.generation_time, 2.5);
  });

  test('latestTurnStatsPair reads lastStats snapshot', () => {
    const chat = makeChat({
      id: 'chat-b',
      lastStats: {
        tokens_per_second: 12.5,
        time_to_first_token: 0.15,
        generation_time: 0.9,
        total_tokens: 42,
        prompt_tokens: 30,
        completion_tokens: 12,
      },
    });
    const pair = latestTurnStatsPair(chat);
    assert.deepEqual(pair, {
      stats: {
        tokens_per_second: 12.5,
        time_to_first_token: 0.15,
        generation_time: 0.9,
        stop_reason: undefined,
      },
      usage: {
        prompt_tokens: 30,
        completion_tokens: 12,
        total_tokens: 42,
      },
    });
  });
});
