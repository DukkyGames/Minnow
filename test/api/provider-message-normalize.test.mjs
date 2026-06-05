/**
 * LM Studio / Qwen Jinja compatibility: fold assistant-before-user preambles.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { foldLeadingAssistantPreamble } from '../../src/api/provider-message-normalize.ts';

describe('foldLeadingAssistantPreamble', () => {
  it('folds assistant greeting before the first user turn into system', () => {
    const input = [
      { role: 'system', content: 'You are a writer.' },
      { role: 'assistant', content: 'Hi — I am **Creative writer**.' },
      { role: 'user', content: 'write a story about a cat' },
    ];
    const out = foldLeadingAssistantPreamble(input);
    assert.equal(out.length, 2);
    assert.equal(out[0].role, 'system');
    assert.match(out[0].content, /Creative writer/);
    assert.match(out[0].content, /greeted the user/);
    assert.deepEqual(out[1], { role: 'user', content: 'write a story about a cat' });
  });

  it('leaves normal user-first histories unchanged', () => {
    const input = [
      { role: 'system', content: 'Base' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    assert.deepEqual(foldLeadingAssistantPreamble(input), input);
  });
});
