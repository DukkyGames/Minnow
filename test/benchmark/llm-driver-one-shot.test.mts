import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { appendAssistantToMessages } from '../../src/benchmark/llm-driver.ts';
import type { ApiMessage } from '../../src/types.ts';

describe('appendAssistantToMessages', () => {
  test('includes assistant content in returned messages', () => {
    const input: ApiMessage[] = [{ role: 'user', content: 'Say hi' }];
    const messages = appendAssistantToMessages([...input], 'hello', []);

    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.role, 'user');
    assert.equal(messages[1]?.role, 'assistant');
    assert.equal(messages[1]?.content, 'hello');
  });

  test('includes tool_calls when present', () => {
    const messages = appendAssistantToMessages([{ role: 'user', content: 'x' }], '', [
      {
        id: 'call-1',
        type: 'function',
        function: { name: 'read_file', arguments: '{}' },
      },
    ]);

    const assistant = messages[1];
    assert.equal(assistant?.role, 'assistant');
    assert.ok(assistant && 'tool_calls' in assistant);
    assert.equal(assistant.tool_calls?.[0]?.function.name, 'read_file');
  });

  test('stores reasoning_content separately from prose', () => {
    const messages = appendAssistantToMessages(
      [{ role: 'user', content: 'Solve it.' }],
      'The ball costs $0.05.',
      [],
      '1.10 - 1.00 = 0.10',
    );

    const assistant = messages[1];
    assert.equal(assistant?.content, 'The ball costs $0.05.');
    assert.equal(assistant?.reasoning_content, '1.10 - 1.00 = 0.10');
  });

  test('uses reasoning_content alone when prose is empty', () => {
    const messages = appendAssistantToMessages(
      [{ role: 'user', content: 'Count to three.' }],
      '',
      [],
      'One, two, three.',
    );

    const assistant = messages[1];
    assert.equal(assistant?.content, null);
    assert.equal(assistant?.reasoning_content, 'One, two, three.');
  });
});
