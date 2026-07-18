import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  evaluateGoal,
  setGoalEvalAgentImplForTests,
  setGoalEvalImplForTests,
} from '../../src/chat/goal/evaluate.ts';
import { MIN_GOAL_EVAL_VERIFICATION_TOOL_CALLS, MIN_GOAL_TURNS_BEFORE_PASS } from '../../src/chat/goal/eval-tools.ts';
import {
  createEmptyChatObject,
  flushScheduledSessionSaveForTests,
  setActiveGoal,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';

const FIXED_CHAT_ID = '11111111-1111-1111-1111-111111111111';
const CONDITION = 'all unit tests pass';

function seedChat(turnCount = MIN_GOAL_TURNS_BEFORE_PASS) {
  const chat = createEmptyChatObject('m1');
  chat.id = FIXED_CHAT_ID;
  chat.providerId = 'lmstudio';
  chat.modelId = 'test-model';
  setActiveGoal(chat, CONDITION);
  chat.activeGoal!.turnCount = turnCount;
  setSessionStateForTests({
    version: 3,
    activeId: chat.id,
    sidebarCollapsed: false,
    chats: [chat],
  });
  return chat;
}

describe('evaluateGoal', () => {
  afterEach(() => {
    setGoalEvalAgentImplForTests(null);
    setGoalEvalImplForTests(null);
    flushScheduledSessionSaveForTests();
    setSessionStateForTests(null);
  });

  test('gate forces NO when agent returns YES with low verification tool count', async () => {
    const chat = seedChat();
    setGoalEvalAgentImplForTests(async () => ({
      raw: 'YES: rubber stamp.',
      verificationToolCalls: MIN_GOAL_EVAL_VERIFICATION_TOOL_CALLS - 1,
    }));

    const result = await evaluateGoal(chat);
    assert.equal(result.met, false);
    assert.match(result.reason, /Pass blocked/);
    assert.match(result.reason, /verification tool call/);
  });

  test('allows YES when agent returns sufficient verification tool calls', async () => {
    const chat = seedChat();
    setGoalEvalAgentImplForTests(async () => ({
      raw: 'YES: verified with tests.',
      verificationToolCalls: MIN_GOAL_EVAL_VERIFICATION_TOOL_CALLS,
    }));

    const result = await evaluateGoal(chat);
    assert.equal(result.met, true);
    assert.equal(result.reason, 'verified with tests.');
  });
});
