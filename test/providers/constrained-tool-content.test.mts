import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  mergeContentJsonToolCalls,
  tryParseToolCallsFromAssistantContent,
} from '../../src/providers/constrained-tool-content.ts';

describe('constrained-tool-content', () => {
  test('tryParseToolCallsFromAssistantContent parses Minnow constrained shape', () => {
    const body = `{"tool_calls":[{"name":"read_file","arguments":{"path":"README.md"}}]}`;
    const calls = tryParseToolCallsFromAssistantContent(body);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].function.name, 'read_file');
    assert.ok(calls[0].function.arguments.includes('README.md'));
  });

  test('tryParseToolCallsFromAssistantContent parses OpenAI-style nested function', () => {
    const body = `{"tool_calls":[{"function":{"name":"list_directory","arguments":"{}"}}]}`;
    const calls = tryParseToolCallsFromAssistantContent(body);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].function.name, 'list_directory');
  });

  test('tryParseToolCallsFromAssistantContent returns empty for prose', () => {
    assert.equal(
      tryParseToolCallsFromAssistantContent('I will read the file next.').length,
      0,
    );
  });

  test('mergeContentJsonToolCalls keeps streamed tool_calls when present', () => {
    const streamed = [
      {
        id: 'call_1',
        type: 'function' as const,
        function: { name: 'read_file', arguments: '{}' },
      },
    ];
    const merged = mergeContentJsonToolCalls('ignored json', streamed);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, 'call_1');
  });

  test('mergeContentJsonToolCalls falls back to content JSON when stream empty', () => {
    const text = '{"tool_calls":[{"name":"get_datetime","arguments":{}}]}';
    const merged = mergeContentJsonToolCalls(text, []);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].function.name, 'get_datetime');
  });
});
