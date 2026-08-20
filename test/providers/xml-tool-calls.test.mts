/**
 * XML-tagged tool calls in assistant content (Qwen via mlx-lm / llama.cpp).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  ContentToolCallRouter,
  hasXmlToolCallMarkup,
  stripXmlToolCallBlocks,
  tryParseXmlToolCallsFromText,
} from '../../src/providers/xml-tool-calls.ts';
import { mergeContentJsonToolCalls } from '../../src/providers/constrained-tool-content.ts';

const READ_FILE = '<tool_call>\n{"name": "read_file", "arguments": {"path": "src/a.ts"}}\n</tool_call>';

function streamThrough(router: ContentToolCallRouter, chunks: readonly string[]): string {
  let prose = '';
  for (const chunk of chunks) {
    prose += router.feed(chunk);
  }
  return prose + router.flush();
}

describe('tryParseXmlToolCallsFromText', () => {
  test('parses a Qwen tool_call block', () => {
    const calls = tryParseXmlToolCallsFromText(READ_FILE);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].function.name, 'read_file');
    assert.deepEqual(JSON.parse(calls[0].function.arguments), { path: 'src/a.ts' });
  });

  test('parses several blocks and drops duplicates', () => {
    const calls = tryParseXmlToolCallsFromText(
      `${READ_FILE}\n${READ_FILE}\n<tool_use>{"name":"grep","parameters":{"q":"foo"}}</tool_use>`,
    );
    assert.deepEqual(
      calls.map((call) => call.function.name),
      ['read_file', 'grep'],
    );
    assert.deepEqual(JSON.parse(calls[1].function.arguments), { q: 'foo' });
  });

  test('parses a block whose closing tag never arrived', () => {
    const calls = tryParseXmlToolCallsFromText('<tool_call>\n{"name":"read_file","arguments":{}}');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].function.name, 'read_file');
  });

  test('ignores prose and malformed payloads', () => {
    assert.deepEqual(tryParseXmlToolCallsFromText('Just a reply about <tool_call> tags.'), []);
    assert.deepEqual(tryParseXmlToolCallsFromText('<tool_call>not json</tool_call>'), []);
    assert.deepEqual(tryParseXmlToolCallsFromText('<tool_call>{"arguments":{}}</tool_call>'), []);
    assert.equal(hasXmlToolCallMarkup('plain reply'), false);
  });

  test('strips blocks from prose', () => {
    assert.equal(stripXmlToolCallBlocks(`Reading it.\n${READ_FILE}`), 'Reading it.');
  });
});

describe('ContentToolCallRouter', () => {
  test('withholds a tool_call block from visible prose', () => {
    const router = new ContentToolCallRouter();
    const prose = streamThrough(router, ['I will read it.\n', READ_FILE]);
    assert.equal(prose, 'I will read it.\n');
    assert.equal(tryParseXmlToolCallsFromText(router.getToolCallParseText()).length, 1);
    assert.equal(router.hasCapturedToolCalls(), true);
  });

  test('handles tags split across deltas', () => {
    const router = new ContentToolCallRouter();
    const prose = streamThrough(router, [
      'Reading.',
      '<tool',
      '_call>{"name":"read_file",',
      '"arguments":{"path":"a.ts"}}</tool',
      '_call>',
    ]);
    assert.equal(prose, 'Reading.');
    const calls = tryParseXmlToolCallsFromText(router.getToolCallParseText());
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].function.arguments), { path: 'a.ts' });
  });

  test('captures an unterminated block instead of leaking it as prose', () => {
    const router = new ContentToolCallRouter();
    const prose = streamThrough(router, ['<tool_call>{"name":"read_file","arguments":{}}']);
    assert.equal(prose, '');
    assert.equal(tryParseXmlToolCallsFromText(router.getToolCallParseText()).length, 1);
  });

  test('passes ordinary prose through untouched, including angle brackets', () => {
    const router = new ContentToolCallRouter();
    const prose = streamThrough(router, ['Use <div> when a < b', ' and </tool', 'tip> is fine.']);
    assert.equal(prose, 'Use <div> when a < b and </tooltip> is fine.');
    assert.equal(router.hasCapturedToolCalls(), false);
  });

  test('keeps non-tool-call markup visible (model explaining the format)', () => {
    const router = new ContentToolCallRouter();
    const prose = streamThrough(router, [
      'Qwen emits `<tool_call>',
      '{ "name": ... }',
      '</tool_call>` blocks.',
    ]);
    assert.equal(prose, 'Qwen emits `<tool_call>{ "name": ... }</tool_call>` blocks.');
    assert.equal(router.hasCapturedToolCalls(), false);
  });

  test('closes an unterminated block when the next opener arrives', () => {
    const router = new ContentToolCallRouter();
    streamThrough(router, [
      '<tool_call>{"name":"read_file","arguments":{"path":"a.ts"}}',
      '<tool_call>{"name":"grep","arguments":{"q":"x"}}</tool_call>',
    ]);
    assert.deepEqual(
      tryParseXmlToolCallsFromText(router.getToolCallParseText()).map((c) => c.function.name),
      ['read_file', 'grep'],
    );
  });
});

describe('mergeContentJsonToolCalls with xmlParseText', () => {
  test('recovers tool calls when SSE tool_calls were empty', () => {
    const calls = mergeContentJsonToolCalls('', [], { xmlParseText: READ_FILE });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].function.name, 'read_file');
  });

  test('parses blocks left in content when nothing routed them', () => {
    const calls = mergeContentJsonToolCalls(`Reading.\n${READ_FILE}`, []);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].function.name, 'read_file');
  });

  test('keeps streamed tool calls but fills empty arguments from content', () => {
    const streamed = [
      { id: 'call_1', type: 'function' as const, function: { name: 'read_file', arguments: '{}' } },
    ];
    const calls = mergeContentJsonToolCalls('', streamed, { xmlParseText: READ_FILE });
    assert.equal(calls[0].id, 'call_1');
    assert.deepEqual(JSON.parse(calls[0].function.arguments), { path: 'src/a.ts' });
  });

  test('leaves plain replies without tool calls', () => {
    assert.deepEqual(mergeContentJsonToolCalls('Hello there.', []), []);
  });
});
