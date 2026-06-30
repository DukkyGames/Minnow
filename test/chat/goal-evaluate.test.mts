import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import type { ChatCompletionBody } from '../../src/api/chat.ts';
import type { ChatCompletionChunk } from '../../src/types.ts';
import {
  evaluateGoal,
  setGoalEvalPortFactoryForTests,
} from '../../src/chat/goal/evaluate.ts';
import { setGoalEvalConfigForTests, resetGoalEvalConfigCache } from '../../src/config/goal-eval-meta.ts';
import {
  createEmptyChatObject,
  flushScheduledSessionSaveForTests,
  setActiveGoal,
  setSessionStateForTests,
} from '../../src/state/sessions.ts';

const FIXED_CHAT_ID = '11111111-1111-1111-1111-111111111111';
const CONDITION = 'all unit tests pass';

function seedChat(providerId = 'lmstudio') {
  const chat = createEmptyChatObject('m1');
  chat.id = FIXED_CHAT_ID;
  chat.providerId = providerId;
  chat.modelId = 'test-model';
  setActiveGoal(chat, CONDITION);
  setSessionStateForTests({
    version: 3,
    activeId: chat.id,
    sidebarCollapsed: false,
    chats: [chat],
  });
  return chat;
}

const YES_CHUNK: ChatCompletionChunk = {
  choices: [{ message: { role: 'assistant', content: 'YES: condition met.' } }],
};

describe('evaluateGoal', () => {
  afterEach(() => {
    setGoalEvalPortFactoryForTests(null);
    resetGoalEvalConfigCache();
    flushScheduledSessionSaveForTests();
    setSessionStateForTests(null);
  });

  test('uses goal-eval provider binding when configured', async () => {
    const chat = seedChat('chat-provider');
    setGoalEvalConfigForTests({
      modelId: 'eval-model',
      providerId: 'goal-eval-provider',
      maxTokens: 256,
      temperature: 0.1,
    });

    const seen: string[] = [];
    setGoalEvalPortFactoryForTests((providerId) => ({
      async complete(body: ChatCompletionBody, _signal?: AbortSignal) {
        seen.push(providerId ?? '');
        assert.equal(body.model, 'eval-model');
        return YES_CHUNK;
      },
    }));

    const result = await evaluateGoal(chat);
    assert.equal(result.met, true);
    assert.deepEqual(seen, ['goal-eval-provider']);
  });

  test('falls back to chat provider when goal-eval provider is unset', async () => {
    const chat = seedChat('chat-provider');
    setGoalEvalConfigForTests({
      modelId: '',
      providerId: '',
      maxTokens: 256,
      temperature: 0.1,
    });

    const seen: string[] = [];
    setGoalEvalPortFactoryForTests((providerId) => ({
      async complete(_body: ChatCompletionBody, _signal?: AbortSignal) {
        seen.push(providerId ?? '');
        return YES_CHUNK;
      },
    }));

    const result = await evaluateGoal(chat);
    assert.equal(result.met, true);
    assert.deepEqual(seen, ['chat-provider']);
  });

  test('reads reasoning channel when content is empty', async () => {
    const chat = seedChat('chat-provider');
    setGoalEvalConfigForTests({
      modelId: 'eval-model',
      providerId: '',
      maxTokens: 512,
      temperature: 0.1,
    });

    setGoalEvalPortFactoryForTests(() => ({
      async complete(_body: ChatCompletionBody, _signal?: AbortSignal) {
        return {
          choices: [
            {
              message: {
                role: 'assistant',
                content: '',
                reasoning_content: 'YES: condition satisfied.',
              },
            },
          ],
        };
      },
    }));

    const result = await evaluateGoal(chat);
    assert.equal(result.met, true);
    assert.equal(result.reason, 'condition satisfied.');
  });
});
