import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  isEmptyToolArgumentsJson,
  mergeContentJsonToolCalls,
  toolArgumentsRichnessScore,
  tryParseToolCallsFromAssistantContent,
} from '../../src/providers/constrained-tool-content.ts';
import {
  normalizeHarmonyToolName,
  tryParseHarmonyToolCallsFromText,
} from '../../src/providers/harmony-tool-calls.ts';

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

  test('toolArgumentsRichnessScore ranks a full spawn_sub_agent payload above task-only', () => {
    const partial = '{"task":"Explore the auth module"}';
    const full = JSON.stringify({
      task: 'Explore the auth module',
      type: 'explore',
      wait: true,
    });
    assert.ok(toolArgumentsRichnessScore(full) > toolArgumentsRichnessScore(partial));
  });

  test('mergeContentJsonToolCalls prefers content when streamed spawn_sub_agent is partial', () => {
    const streamed = [
      {
        id: 'call_1',
        type: 'function' as const,
        function: {
          name: 'spawn_sub_agent',
          arguments: '{"task":"Explore the auth module"}',
        },
      },
    ];
    const text = JSON.stringify({
      tool_calls: [
        {
          name: 'spawn_sub_agent',
          arguments: {
            task: 'Explore the auth module',
            type: 'explore',
            wait: true,
          },
        },
      ],
    });
    const merged = mergeContentJsonToolCalls(text, streamed);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, 'call_1');
    const args = JSON.parse(merged[0].function.arguments) as {
      type?: string;
      wait?: boolean;
    };
    assert.equal(args.type, 'explore');
    assert.equal(args.wait, true);
  });

  test('normalizeHarmonyToolName strips functions and repo_browser namespaces', () => {
    assert.equal(normalizeHarmonyToolName('functions.read_file'), 'read_file');
    assert.equal(normalizeHarmonyToolName('repo_browser.list_directory'), 'list_directory');
  });

  test('tryParseHarmonyToolCallsFromText parses commentary channel code variant', () => {
    const text =
      '<|channel|>commentary to=repo_browser.list_directory code{ "path": "." }';
    const calls = tryParseHarmonyToolCallsFromText(text);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].function.name, 'list_directory');
    assert.deepEqual(JSON.parse(calls[0].function.arguments), { path: '.' });
  });

  test('tryParseHarmonyToolCallsFromText parses canonical harmony message JSON', () => {
    const text =
      '<|channel|>commentary to=functions.read_file <|constrain|>json<|message|>{"path":"README.md"}<|call|>';
    const calls = tryParseHarmonyToolCallsFromText(text);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].function.name, 'read_file');
    assert.deepEqual(JSON.parse(calls[0].function.arguments), { path: 'README.md' });
  });

  test('mergeContentJsonToolCalls recovers harmony tool calls when SSE is empty', () => {
    const harmony =
      ' to=functions.list_directory <|constrain|>json<|message|>{"path":"."}';
    const merged = mergeContentJsonToolCalls('', [], { harmonyParseText: harmony });
    assert.equal(merged.length, 1);
    assert.equal(merged[0].function.name, 'list_directory');
  });

  test('mergeContentJsonToolCalls recovers constrained JSON from the thinking haystack', () => {
    const merged = mergeContentJsonToolCalls('', [], {
      thinkingXmlParseText: '{"tool_calls":[{"name":"get_datetime","arguments":{}}]}',
    });
    assert.equal(merged.length, 1);
    assert.equal(merged[0].function.name, 'get_datetime');
  });
});
