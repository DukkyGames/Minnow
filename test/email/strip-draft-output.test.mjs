/**
 * Email draft output — strip reasoning/thinking from LLM completions.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { stripDraftOutput } from '../../server/research/strip-thinking.js';

describe('stripDraftOutput', () => {
  test('removes tagged thinking blocks', () => {
    const raw =
      'The user wants a brief yes.\n\nHi Alex,\n\nSounds good — see you then.';
    assert.equal(
      stripDraftOutput(raw),
      'Hi Alex,\n\nSounds good — see you then.',
    );
  });

  test('removes Thinking Process preamble before email salutation', () => {
    const raw = `Thinking Process:
The user asked me to confirm the meeting. I should keep it brief.

Hi Alex,

Sounds good — I'll be there at 3pm.`;
    assert.equal(
      stripDraftOutput(raw),
      `Hi Alex,

Sounds good — I'll be there at 3pm.`,
    );
  });

  test('removes leading reasoning paragraphs before reply', () => {
    const raw = `The user wants a polite decline.

I need to keep it short and professional.

Dear Sam,

Thank you for the invitation. I won't be able to attend this time.`;
    assert.equal(
      stripDraftOutput(raw),
      `Dear Sam,

Thank you for the invitation. I won't be able to attend this time.`,
    );
  });
});
