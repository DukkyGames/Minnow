import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import type { ChatCompletionBody } from '../../src/api/chat.ts';
import type { ChatCompletionChunk } from '../../src/types.ts';
import {
  runGoalEvalAgent,
  setGoalEvalAgentImplForTests,
  setGoalEvalPortFactoryForTests,
} from '../../src/chat/goal/eval-agent.ts';
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

describe('runGoalEvalAgent', () => {
  afterEach(() => {
    setGoalEvalPortFactoryForTests(null);
    setGoalEvalAgentImplForTests(null);
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

    const controller = new AbortController();
    const result = await runGoalEvalAgent(chat, CONDITION, controller.signal);
    assert.match(result.raw, /^YES:/);
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

    const controller = new AbortController();
    const result = await runGoalEvalAgent(chat, CONDITION, controller.signal);
    assert.match(result.raw, /^YES:/);
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

    const controller = new AbortController();
    const result = await runGoalEvalAgent(chat, CONDITION, controller.signal);
    assert.match(result.raw, /^YES: condition satisfied\./);
  });

  test('re-prompts when evaluator returns analysis without YES or NO', async () => {
    const chat = seedChat('chat-provider');
    setGoalEvalConfigForTests({
      modelId: 'eval-model',
      providerId: '',
      maxTokens: 512,
      temperature: 0.1,
    });

    let calls = 0;
    setGoalEvalPortFactoryForTests(() => ({
      async complete(_body: ChatCompletionBody, _signal?: AbortSignal) {
        calls += 1;
        if (calls === 1) {
          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content:
                    '- Nav: `h-[52px]` (matches `topbar-h: "52px"`), `bg-[var(--mn-bg)]`',
                },
              },
            ],
          };
        }
        return YES_CHUNK;
      },
    }));

    const controller = new AbortController();
    const result = await runGoalEvalAgent(chat, CONDITION, controller.signal);
    assert.equal(calls, 2);
    assert.match(result.raw, /^YES:/);
  });
});
