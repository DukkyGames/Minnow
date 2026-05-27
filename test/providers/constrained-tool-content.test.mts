import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  isEmptyToolArgumentsJson,
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

  test('isEmptyToolArgumentsJson treats {} and blank as empty', () => {
    assert.equal(isEmptyToolArgumentsJson(''), true);
    assert.equal(isEmptyToolArgumentsJson('{}'), true);
    assert.equal(isEmptyToolArgumentsJson('{"path":"a.ts"}'), false);
  });

  test('mergeContentJsonToolCalls prefers content arguments when streamed args are {}', () => {
    const streamed = [
      {
        id: 'call_1',
        type: 'function' as const,
        function: { name: 'save_file', arguments: '{}' },
      },
    ];
    const text =
      '{"tool_calls":[{"name":"save_file","arguments":{"path":"out.txt","content":"hello"}}]}';
    const merged = mergeContentJsonToolCalls(text, streamed);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, 'call_1');
    assert.ok(merged[0].function.arguments.includes('out.txt'));
    assert.ok(merged[0].function.arguments.includes('hello'));
  });

  test('mergeContentJsonToolCalls keeps streamed args when content is empty', () => {
    const streamed = [
      {
        id: 'call_1',
        type: 'function' as const,
        function: { name: 'read_file', arguments: '{"path":"README.md"}' },
      },
    ];
    const merged = mergeContentJsonToolCalls('ignored json', streamed);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, 'call_1');
    assert.ok(merged[0].function.arguments.includes('README.md'));
  });

  test('mergeContentJsonToolCalls falls back to content JSON when stream empty', () => {
    const text = '{"tool_calls":[{"name":"get_datetime","arguments":{}}]}';
    const merged = mergeContentJsonToolCalls(text, []);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].function.name, 'get_datetime');
  });
});
