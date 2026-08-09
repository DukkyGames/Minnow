/**
 * classifyStreamEnd — stream termination reasons for the tool loop.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyClassifiedStreamEnd,
  classifyStreamEnd,
} from '../../src/api/stream-end.ts';
import {
  EMPTY_POST_TOOL_CONTINUE_INSTRUCTION,
  hasPostToolTail,
  MAX_EMPTY_POST_TOOL_RETRIES,
  resolveFinalAssistantContent,
  resolveTurnContinuation,
} from '../../src/tools/turn-continuation.ts';
import type { Message } from '../../src/types.ts';

describe('classifyStreamEnd', () => {
  test('provider_error when streamError is set', () => {
    const out = classifyStreamEnd({
      finishReason: undefined,
      toolCallsCount: 0,
      textLength: 0,
      streamError: 'upstream blew up',
    });
    assert.equal(out.kind, 'provider_error');
    assert.equal(out.message, 'upstream blew up');
  });

  test('aborted when endStatus is cancelled', () => {
    const out = classifyStreamEnd({
      finishReason: 'stop',
      toolCallsCount: 0,
      textLength: 10,
      endStatus: 'cancelled',
    });
    assert.equal(out.kind, 'aborted');
  });

  test('truncated when finish_reason is length', () => {
    const out = classifyStreamEnd({
      finishReason: 'length',
      toolCallsCount: 0,
      textLength: 50,
    });
    assert.equal(out.kind, 'truncated');
  });

  test('complete when finish_reason is stop', () => {
    const out = classifyStreamEnd({
      finishReason: 'stop',
      toolCallsCount: 0,
      textLength: 3,
    });
    assert.equal(out.kind, 'complete');
  });

  test('incomplete when stream ends with no reason and no tools', () => {
    const out = classifyStreamEnd({
      finishReason: undefined,
      toolCallsCount: 0,
      textLength: 0,
      endStatus: 'complete',
    });
    assert.equal(out.kind, 'incomplete');
  });
});

describe('applyClassifiedStreamEnd', () => {
  test('throws on incomplete empty stream without post-tool tail', () => {
    assert.throws(
      () =>
        applyClassifiedStreamEnd(
          { kind: 'incomplete' },
          { hasPostToolTail: false, textLength: 0 },
        ),
      /no output/,
    );
  });

  test('allows incomplete empty when post-tool tail remains', () => {
    const out = applyClassifiedStreamEnd(
      { kind: 'incomplete' },
      { hasPostToolTail: true, textLength: 0 },
    );
    assert.equal(out.truncated, false);
  });
});

describe('resolveTurnContinuation', () => {
  test('continueTools when finish_reason is tool_calls with calls', () => {
    assert.equal(
      resolveTurnContinuation({
        finishReason: 'tool_calls',
        toolCallsCount: 2,
        fullTextLength: 0,
        hasPostToolTail: true,
        emptyPostToolRetries: 0,
      }),
      'continueTools',
    );
  });

  test('retryEmpty after tools when prose is empty and retries remain', () => {
    assert.equal(
      resolveTurnContinuation({
        finishReason: 'stop',
        toolCallsCount: 0,
        fullTextLength: 0,
        hasPostToolTail: true,
        emptyPostToolRetries: 0,
      }),
      'retryEmpty',
    );
  });

  test('finalize when empty but no post-tool tail', () => {
    assert.equal(
      resolveTurnContinuation({
        finishReason: 'stop',
        toolCallsCount: 0,
        fullTextLength: 0,
        hasPostToolTail: false,
        emptyPostToolRetries: 0,
      }),
      'finalize',
    );
  });

  test('finalize when empty post-tool retries exhausted', () => {
    assert.equal(
      resolveTurnContinuation({
        finishReason: 'stop',
        toolCallsCount: 0,
        fullTextLength: 0,
        hasPostToolTail: true,
        emptyPostToolRetries: MAX_EMPTY_POST_TOOL_RETRIES,
      }),
      'finalize',
    );
  });

  test('finalize when tool_calls finish but zero calls (filtered)', () => {
    assert.equal(
      resolveTurnContinuation({
        finishReason: 'tool_calls',
        toolCallsCount: 0,
        fullTextLength: 0,
        hasPostToolTail: true,
        emptyPostToolRetries: 0,
      }),
      'retryEmpty',
    );
  });
});

describe('resolveFinalAssistantContent', () => {
  test('prefers trimmed prose', () => {
    const out = resolveFinalAssistantContent('  hello  ', ['thought']);
    assert.equal(out.content, 'hello');
    assert.equal(out.usedThinkingAsContent, false);
  });

  test('uses thinking segments when prose empty', () => {
    const out = resolveFinalAssistantContent('', ['Step A', 'Step B']);
    assert.equal(out.content, 'Step A\n\nStep B');
    assert.equal(out.usedThinkingAsContent, true);
  });

  test('placeholder when prose and thinking empty', () => {
    const out = resolveFinalAssistantContent('', []);
    assert.equal(out.content, 'The model returned no text.');
    assert.equal(out.usedThinkingAsContent, false);
  });
});

describe('hasPostToolTail', () => {
  test('true when last row is tool', () => {
    const history: Message[] = [
      { role: 'user', content: 'Go' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'tc1',
            type: 'function',
            function: { name: 'read_file', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'tc1', content: '{"ok":true}' },
    ];
    assert.equal(hasPostToolTail(history), true);
  });

  test('true when last row is assistant with tool_calls only', () => {
    const history: Message[] = [
      { role: 'user', content: 'Go' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'tc1',
            type: 'function',
            function: { name: 'read_file', arguments: '{}' },
          },
        ],
      },
    ];
    assert.equal(hasPostToolTail(history), true);
  });

  test('false when last row is assistant prose', () => {
    const history: Message[] = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Done.' },
    ];
    assert.equal(hasPostToolTail(history), false);
  });
});

describe('EMPTY_POST_TOOL_CONTINUE_INSTRUCTION', () => {
  test('is non-empty guidance for the model', () => {
    assert.ok(EMPTY_POST_TOOL_CONTINUE_INSTRUCTION.includes('tool results'));
  });
});
