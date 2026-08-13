/**
 * Outbound histories must never carry an assistant tool_call without a matching
 * tool result — every OpenAI-compatible provider 400s it, which makes the chat
 * permanently unsendable.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  MISSING_TOOL_RESULT_CONTENT,
  repairUnpairedToolCalls,
} from '../../src/api/provider-message-normalize.ts';
import { buildHeadlessApiMessages } from '../../src/headless/build-messages.ts';
import type { ApiMessage, Chat, ToolCall } from '../../src/types.ts';

function call(id: string, name = 'read_file'): ToolCall {
  return { id, type: 'function', function: { name, arguments: '{}' } };
}

function assistantWithCalls(ids: string[]): ApiMessage {
  return { role: 'assistant', content: null, tool_calls: ids.map((id) => call(id)) };
}

function toolRow(id: string, content = 'ok'): ApiMessage {
  return { role: 'tool', tool_call_id: id, content };
}

function toolIds(messages: ApiMessage[]): string[] {
  return messages
    .filter((m) => m.role === 'tool')
    .map((m) => (m as { tool_call_id: string }).tool_call_id);
}

describe('repairUnpairedToolCalls', () => {
  test('leaves a fully paired history untouched', () => {
    const messages: ApiMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'go' },
      assistantWithCalls(['a', 'b']),
      toolRow('a'),
      toolRow('b'),
      { role: 'assistant', content: 'done' },
    ];

    const out = repairUnpairedToolCalls(messages);

    assert.deepEqual(out, messages);
  });

  test('synthesizes a result per unanswered id, in call order', () => {
    const messages: ApiMessage[] = [
      { role: 'user', content: 'go' },
      assistantWithCalls(['a', 'b', 'c']),
      toolRow('b'),
    ];

    const out = repairUnpairedToolCalls(messages);

    assert.deepEqual(toolIds(out), ['b', 'a', 'c']);
    const synthesized = out.filter(
      (m) => m.role === 'tool' && m.content === MISSING_TOOL_RESULT_CONTENT,
    );
    assert.equal(synthesized.length, 2);
  });

  test('repairs an assistant tool_calls row with no results at all', () => {
    const messages: ApiMessage[] = [
      { role: 'user', content: 'go' },
      assistantWithCalls(['a', 'b']),
    ];

    const out = repairUnpairedToolCalls(messages);

    assert.deepEqual(toolIds(out), ['a', 'b']);
    assert.equal(out.length, 4);
  });

  test('repairs every batch in a multi-round history', () => {
    const messages: ApiMessage[] = [
      { role: 'user', content: 'go' },
      assistantWithCalls(['a']),
      toolRow('a'),
      assistantWithCalls(['b', 'c']),
      toolRow('b'),
      { role: 'assistant', content: 'summary' },
    ];

    const out = repairUnpairedToolCalls(messages);

    assert.deepEqual(toolIds(out), ['a', 'b', 'c']);
    assert.equal(out[out.length - 1].content, 'summary');
  });

  test('drops a tool result whose call was never requested', () => {
    const messages: ApiMessage[] = [
      { role: 'user', content: 'go' },
      toolRow('ghost'),
      assistantWithCalls(['a']),
      toolRow('a'),
    ];

    const out = repairUnpairedToolCalls(messages);

    assert.deepEqual(toolIds(out), ['a']);
  });

  test('preserves the original result objects', () => {
    const kept = toolRow('a', 'real output');
    const out = repairUnpairedToolCalls([assistantWithCalls(['a', 'b']), kept]);

    assert.equal(out[1], kept);
  });
});

describe('buildHeadlessApiMessages pairing', () => {
  test('an orphaned tool_calls row is repaired on the send path', () => {
    const chat = {
      history: [
        { role: 'user', content: 'go' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [call('a'), call('b')],
        },
        { role: 'tool', tool_call_id: 'a', content: 'ok' },
      ],
    } as unknown as Chat;

    const messages = buildHeadlessApiMessages(chat, 'sys');

    assert.deepEqual(toolIds(messages), ['a', 'b']);
    assert.equal(messages[messages.length - 1].content, MISSING_TOOL_RESULT_CONTENT);
  });
});
