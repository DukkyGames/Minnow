/**
 * Voice play button rendering contract.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { extractSpeechText } from '../../src/ui/voice-controls.ts';

describe('voice-controls', () => {
  test('extractSpeechText strips code fences and markdown', () => {
    const plain = extractSpeechText('Hello **world**\n```js\nconst x=1\n```');
    assert.equal(plain, 'Hello world');
  });

  test('extractSpeechText removes thinking blocks', () => {
    const plain = extractSpeechText(
      '<thinking>secret</thinking>Visible answer.',
    );
    assert.equal(plain, 'Visible answer.');
  });
});
