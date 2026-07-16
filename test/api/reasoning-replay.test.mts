/**
 * DeepSeek thinking-mode tool-loop replay fields.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  modelRequiresReasoningContentReplay,
  outboundReasoningReplayFields,
} from '../../src/api/reasoning.ts';

describe('reasoning replay helpers', () => {
  test('modelRequiresReasoningContentReplay matches DeepSeek ids', () => {
    assert.equal(modelRequiresReasoningContentReplay('deepseek/deepseek-v4-flash'), true);
    assert.equal(modelRequiresReasoningContentReplay('deepseek-chat'), true);
    assert.equal(modelRequiresReasoningContentReplay('gpt-4o-mini'), false);
  });

  test('outboundReasoningReplayFields uses reasoning_content for DeepSeek', () => {
    assert.deepEqual(
      outboundReasoningReplayFields('deepseek-v4-pro', 'chain of thought'),
      { reasoning_content: 'chain of thought' },
    );
  });

  test('outboundReasoningReplayFields uses reasoning for other models', () => {
    assert.deepEqual(
      outboundReasoningReplayFields('claude-sonnet-4-5', 'thought', 'sig-1'),
      { reasoning: 'thought', reasoning_signature: 'sig-1' },
    );
  });

  test('outboundReasoningReplayFields includes empty reasoning_content on DeepSeek tool turns', () => {
    assert.deepEqual(
      outboundReasoningReplayFields('deepseek-v4-pro', '', undefined, {
        toolCallTurn: true,
      }),
      { reasoning_content: '' },
    );
  });
});
