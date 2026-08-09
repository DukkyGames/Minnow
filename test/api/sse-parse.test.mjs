/**
 * SSE parse helpers — event boundaries, glued JSON, completion body fallback.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSseEventBuffer,
  extractFirstJsonValue,
  feedSseEventBuffer,
  flushSseEventBuffer,
  parseCompletionResponseBody,
  parseSseEventBlock,
} from '../../src/api/sse-parse.ts';
import { extractStreamErrorMessage } from '../../src/api/chat.ts';

describe('extractStreamErrorMessage', () => {
  it('reads string error payloads', () => {
    assert.equal(
      extractStreamErrorMessage({ error: 'rate limited' }),
      'rate limited',
    );
  });

  it('reads object error payloads', () => {
    assert.equal(
      extractStreamErrorMessage({ error: { message: 'bad key', code: 401 } }),
      'bad key',
    );
  });

  it('maps finish_reason error to a generic message', () => {
    assert.equal(
      extractStreamErrorMessage({
        choices: [{ finish_reason: 'error', delta: {} }],
      }),
      'The provider reported a stream error.',
    );
  });
});

describe('parseSseEventBlock', () => {
  it('parses a standard OpenAI SSE event', () => {
    const chunks = [];
    parseSseEventBlock(
      'data: {"choices":[{"delta":{"content":"hi"}}]}\n',
      (c) => chunks.push(c),
    );
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].choices[0].delta.content, 'hi');
  });

  it('joins multi-line data fields before JSON.parse', () => {
    const chunks = [];
    parseSseEventBlock(
      'data: {\n' + 'data:   "choices":[{"delta":{"content":"x"}}]\n' + 'data: }\n',
      (c) => chunks.push(c),
    );
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].choices[0].delta.content, 'x');
  });

  it('emits every object when two JSON values are glued in one data line', () => {
    const glued =
      '{"choices":[{"delta":{"content":"a"}}]}{"choices":[{"delta":{"content":"b"}}]}';
    const chunks = [];
    parseSseEventBlock(`data: ${glued}\n`, (c) => chunks.push(c));
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].choices[0].delta.content, 'a');
    assert.equal(chunks[1].choices[0].delta.content, 'b');
  });
});

describe('feedSseEventBuffer', () => {
  it('accumulates glued per-token payloads into full completion text', () => {
    const glued =
      '{"choices":[{"delta":{"content":"Hel"}}]}{"choices":[{"delta":{"content":"lo"}}]}';
    let full = '';
    const state = createSseEventBuffer();
    const onChunk = (chunk) => {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === 'string') full += delta;
    };
    feedSseEventBuffer(state, `data: ${glued}\n\n`, onChunk);
    flushSseEventBuffer(state, onChunk);
    assert.equal(full, 'Hello');
  });

  it('splits events on blank lines across chunk boundaries', () => {
    const state = createSseEventBuffer();
    const chunks = [];
    const onChunk = (c) => chunks.push(c);

    feedSseEventBuffer(state, 'data: {"choices":[{"delta":{"content":"1"}}]}\n\ndata: ', onChunk);
    assert.equal(chunks.length, 1);

    feedSseEventBuffer(
      state,
      '{"choices":[{"delta":{"content":"2"}}]}\n\n',
      onChunk,
    );
    flushSseEventBuffer(state, onChunk);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[1].choices[0].delta.content, '2');
  });
});

describe('parseCompletionResponseBody', () => {
  it('parses a plain JSON completion object', () => {
    const body = JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    });
    const parsed = parseCompletionResponseBody(body);
    assert.equal(parsed.choices[0].message.content, 'ok');
  });

  it('parses SSE bytes without calling Response.json', () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
      'data: [DONE]\n\n';
    const parsed = parseCompletionResponseBody(sse);
    assert.ok(parsed.choices);
  });

  it('does not throw on glued JSON after a valid object (fallback path)', () => {
    const first = '{"choices":[{"message":{"role":"assistant","content":"done"}}]}';
    const second = '{"choices":[{"delta":{"content":"tail"}}]}';
    const parsed = parseCompletionResponseBody(first + second);
    assert.equal(parsed.choices[0].message.content, 'done');
  });

  it('prefers message.parsed over trailing generation end events', () => {
    const structured = {
      choices: [
        {
          message: {
            content: '',
            parsed: { summary: 'Done.', findings: [], artifacts: [] },
          },
          finish_reason: 'stop',
        },
      ],
    };
    const sse =
      `data: ${JSON.stringify(structured)}\n\n` +
      `event: end\ndata: ${JSON.stringify({ status: 'complete' })}\n\n`;
    const parsed = parseCompletionResponseBody(sse);
    assert.deepEqual(parsed.choices[0].message.parsed, structured.choices[0].message.parsed);
  });
});

describe('extractFirstJsonValue', () => {
  it('returns null for non-JSON text', () => {
    assert.equal(extractFirstJsonValue('data: hello'), null);
  });
});
