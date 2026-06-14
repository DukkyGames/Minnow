/**
 * STT stream session helper tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { joinTranscript } from '../../server/stt/stream-session.js';

describe('stream-session helpers', () => {
  test('joinTranscript merges segments with spacing', () => {
    assert.equal(joinTranscript('Hello', 'world'), 'Hello world');
    assert.equal(joinTranscript('', 'first'), 'first');
    assert.equal(joinTranscript('Hello ', 'world'), 'Hello world');
  });
});
