import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { thinkingToCompletionBody } from '../../src/agents/thinking-to-body.ts';

describe('thinkingToCompletionBody', () => {
  test('openai-v1 on enables thinking without enable_thinking (Kimi compat)', () => {
    const { body } = thinkingToCompletionBody('on', 'openai-v1', {
      vision: false,
      tools: null,
      streaming: null,
      grammar: null,
      reasoning: true,
      contextLength: null,
      loadState: null,
    });
    assert.deepEqual(body, { thinking: { type: 'enabled' } });
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(body.enable_thinking, undefined);
  });

  test('openai-v1 off disables DeepSeek thinking without reasoning_effort none', () => {
    const { body } = thinkingToCompletionBody('off', 'openai-v1', {
      vision: false,
      tools: null,
      streaming: null,
      grammar: null,
      reasoning: true,
      contextLength: null,
      loadState: null,
    });
    assert.deepEqual(body, { thinking: { type: 'disabled' } });
    assert.equal(body.reasoning_effort, undefined);
  });

  test('lm-studio-v0 on includes enable_thinking and medium effort', () => {
    const patch = thinkingToCompletionBody('on', 'lm-studio-v0', {
      vision: false,
      tools: null,
      streaming: null,
      grammar: null,
      reasoning: true,
      contextLength: null,
      loadState: null,
    });
    assert.equal(patch.body.reasoning_effort, 'medium');
    assert.deepEqual(patch.body.reasoning, { effort: 'medium' });
    assert.equal(patch.body.enable_thinking, true);
    assert.equal(patch.hint?.bestEffort, true);
  });

  test('lm-studio-v0 off includes none effort and best-effort hint', () => {
    const patch = thinkingToCompletionBody('off', 'lm-studio-v0', {
      vision: false,
      tools: null,
      streaming: null,
      grammar: null,
      reasoning: true,
      contextLength: null,
      loadState: null,
    });
    assert.equal(patch.body.reasoning_effort, 'none');
    assert.equal(patch.hint?.bestEffort, true);
  });

  test('respects reasoningAllowedOptions', () => {
    const { body } = thinkingToCompletionBody('on', 'openai-v1', {
      vision: false,
      tools: null,
      streaming: null,
      grammar: null,
      reasoning: true,
      reasoningAllowedOptions: ['off'],
      contextLength: null,
      loadState: null,
    });
    assert.deepEqual(body, {});
  });
});
