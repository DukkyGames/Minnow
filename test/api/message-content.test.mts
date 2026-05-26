/**
 * Message content normalization (string, parts, streaming deltas).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  apiMessageContentToText,
  contentPartsToText,
  StreamingContentAccumulator,
  streamDeltaContentToText,
} from '../../src/api/message-content.ts';
import { extractMessageText, extractStreamDelta } from '../../src/api/chat.ts';

describe('apiMessageContentToText', () => {
  test('joins multimodal text parts', () => {
    const text = apiMessageContentToText([
      { type: 'text', text: 'Describe this image in detail.' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
    ]);
    assert.equal(text, 'Describe this image in detail.[image]');
  });
});

describe('streamDeltaContentToText', () => {
  test('reads text from structured delta parts', () => {
    assert.equal(
      streamDeltaContentToText([{ type: 'text', text: 'Hello' }, { type: 'text', text: ' world' }]),
      'Hello world',
    );
  });

  test('reads text field on part object', () => {
    assert.equal(streamDeltaContentToText({ type: 'text', text: 'fish' }), 'fish');
  });

  test('reads content field on part object', () => {
    assert.equal(streamDeltaContentToText({ type: 'text', content: 'minnow' }), 'minnow');
  });
});

describe('extractStreamDelta with structured content', () => {
  test('accumulates string deltas across chunks', () => {
    let full = '';
    full += extractStreamDelta({ choices: [{ delta: { content: 'One' } }] });
    full += extractStreamDelta({ choices: [{ delta: { content: ' two' } }] });
    assert.equal(full, 'One two');
  });

  test('extracts from array-shaped delta content', () => {
    const chunk = {
      choices: [{ delta: { content: [{ type: 'text', text: 'silver minnow' }] } }],
    };
    assert.equal(extractStreamDelta(chunk), 'silver minnow');
  });
});

describe('extractMessageText with structured message content', () => {
  test('joins message content parts', () => {
    assert.equal(
      extractMessageText({
        content: [{ type: 'text', text: 'Full assistant reply here.' }],
      }),
      'Full assistant reply here.',
    );
  });
});

describe('StreamingContentAccumulator', () => {
  test('merges string deltas across chunks', () => {
    const acc = new StreamingContentAccumulator();
    acc.ingestChoice({ delta: { content: 'Hel' } });
    acc.ingestChoice({ delta: { content: 'lo' } });
    assert.equal(acc.getText(), 'Hello');
  });

  test('replaces cumulative text on the same part index', () => {
    const acc = new StreamingContentAccumulator();
    acc.ingestChoice({
      delta: { content: [{ index: 0, type: 'text', text: 'Hello' }] },
    });
    acc.ingestChoice({
      delta: { content: [{ index: 0, type: 'text', text: 'Hello world' }] },
    });
    assert.equal(acc.getText(), 'Hello world');
  });
});

describe('contentPartsToText', () => {
  test('preserves full prompt text', () => {
    const prompt =
      'Write exactly three short sentences about local LLM inference. No preamble.';
    assert.equal(contentPartsToText([{ type: 'text', text: prompt }]), prompt);
  });
});
