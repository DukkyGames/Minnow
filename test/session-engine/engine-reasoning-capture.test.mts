/**
 * Engine reasoning capture for persisted Chat.history thinking fields.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EngineReasoningCapture,
  engineReasoningHistoryFields,
} from '../../src/session-engine/engine-reasoning-capture.ts';
import type { ChatCompletionChunk } from '../../src/types.ts';

function chunkWithReasoning(text: string): ChatCompletionChunk {
  return {
    choices: [{ delta: { reasoning: text } }],
  } as ChatCompletionChunk;
}

function chunkWithProse(text: string): ChatCompletionChunk {
  return {
    choices: [{ delta: { content: text } }],
  } as ChatCompletionChunk;
}

function chunkWithSignature(signature: string): ChatCompletionChunk {
  return {
    choices: [{ delta: { reasoning_signature: signature } }],
  } as ChatCompletionChunk;
}

describe('EngineReasoningCapture', () => {
  it('splits reasoning into segments and tracks duration across prose', () => {
    const capture = new EngineReasoningCapture();
    capture.onChunk(chunkWithReasoning('First thought.\n\nSecond thought.'));
    capture.onChunk(chunkWithProse('Hello'));

    const result = capture.finalize();
    assert.deepEqual(result.segments, ['First thought.', 'Second thought.']);
    assert.equal(result.durationMs >= 0, true);
    assert.equal(result.thinkingSignature, undefined);
  });

  it('captures Anthropic thinking signatures for tool-loop replay', () => {
    const capture = new EngineReasoningCapture();
    capture.onChunk(chunkWithReasoning('Planning tools'));
    capture.onChunk(chunkWithSignature('sig-abc'));

    const fields = engineReasoningHistoryFields(capture.finalize());
    assert.deepEqual(fields.thinking, ['Planning tools']);
    assert.equal(fields.thinkingSignature, 'sig-abc');
  });

  it('omits empty thinking keys from history fields', () => {
    const fields = engineReasoningHistoryFields({
      segments: [],
      durationMs: 0,
    });
    assert.deepEqual(fields, {});
  });
});
