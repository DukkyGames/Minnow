/**
 * Opt-in replay of prior-turn reasoning on plain assistant rows.
 *
 * Tool-call rows always replay their reasoning (Anthropic pairs it with the
 * signature); a finished prose turn only does so when `features.replayPriorReasoning`
 * is on, and never for providers that reject the fields.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildApiMessages } from '../../src/chat/build-api-messages.ts';
import {
  estimateHistoryTokens,
  historyToApiMessagesForEstimate,
} from '../../src/chat/prompts/token-estimate-core.ts';
import type { ApiAssistantMessage, ApiMessage, Chat, Message } from '../../src/types.ts';

const THINKING = ['First I checked the sampler defaults.', 'They use presence_penalty.'];
const JOINED = THINKING.join('\n\n');

const HISTORY: Message[] = [
  { role: 'user', content: 'Which penalty do we use?' },
  { role: 'assistant', content: 'presence_penalty.', thinking: THINKING },
  { role: 'user', content: 'Why?' },
];

function chat(): Chat {
  return {
    id: 'chat-reasoning-1',
    name: 'Reasoning replay',
    workspacePath: '/tmp/ws',
    modelId: 'test-model',
    modeId: 'build',
    history: [...HISTORY],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
  };
}

function firstAssistant(messages: ApiMessage[]): ApiAssistantMessage {
  const found = messages.find((m) => m.role === 'assistant');
  assert.ok(found, 'no assistant message in payload');
  return found as ApiAssistantMessage;
}

describe('buildApiMessages prior-reasoning replay', () => {
  test('is omitted by default', () => {
    const messages = buildApiMessages(chat(), '', { modelId: 'gpt-4o', attachments: [] });
    const assistant = firstAssistant(messages);
    assert.equal(assistant.reasoning, undefined);
    assert.equal(assistant.reasoning_content, undefined);
  });

  test('replays reasoning when the feature is on', () => {
    const messages = buildApiMessages(chat(), '', {
      modelId: 'gpt-4o',
      attachments: [],
      replayPriorReasoning: true,
    });
    const assistant = firstAssistant(messages);
    assert.equal(assistant.content, 'presence_penalty.');
    assert.equal(assistant.reasoning, JOINED);
  });

  test('uses reasoning_content for DeepSeek', () => {
    const messages = buildApiMessages(chat(), '', {
      modelId: 'deepseek-chat',
      attachments: [],
      replayPriorReasoning: true,
    });
    const assistant = firstAssistant(messages);
    assert.equal(assistant.reasoning_content, JOINED);
    assert.equal(assistant.reasoning, undefined);
  });

  test('sends nothing for providers that reject the fields', () => {
    const messages = buildApiMessages(chat(), '', {
      modelId: 'kimi-k2',
      attachments: [],
      replayPriorReasoning: true,
    });
    const assistant = firstAssistant(messages);
    assert.equal(assistant.reasoning, undefined);
    assert.equal(assistant.reasoning_content, undefined);
  });

  test('a reply with no reasoning is unchanged', () => {
    const plain = chat();
    plain.history = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    const messages = buildApiMessages(plain, '', {
      modelId: 'gpt-4o',
      attachments: [],
      replayPriorReasoning: true,
    });
    assert.deepEqual(firstAssistant(messages), { role: 'assistant', content: 'hello' });
  });
});

describe('token estimate mirrors the replay', () => {
  test('estimate payload carries the same reasoning field', () => {
    const messages = historyToApiMessagesForEstimate(HISTORY, {
      replayPriorReasoning: true,
      modelId: 'gpt-4o',
    });
    assert.equal(firstAssistant(messages).reasoning, JOINED);
  });

  test('replayed reasoning raises the history token count', () => {
    const base = estimateHistoryTokens(HISTORY);
    const withReplay = estimateHistoryTokens(HISTORY, {
      replayPriorReasoning: true,
      modelId: 'gpt-4o',
    });
    assert.ok(withReplay > base, 'replay did not add tokens to the estimate');
  });

  test('a rejecting provider does not inflate the estimate', () => {
    assert.equal(
      estimateHistoryTokens(HISTORY, { replayPriorReasoning: true, modelId: 'kimi-k2' }),
      estimateHistoryTokens(HISTORY),
    );
  });
});
