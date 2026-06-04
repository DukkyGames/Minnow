/**
 * LSP hover contents normalization (shared by hover-client + AI prompts).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { hoverContentsToPlainText } from '../../src/lsp/hover-contents.ts';

describe('hoverContentsToPlainText', () => {
  test('reads markdown MarkupContent', () => {
    const text = hoverContentsToPlainText({
      kind: 'markdown',
      value: '**Fake hover** — test',
    });
    assert.match(text, /Fake hover/);
  });

  test('reads string contents', () => {
    assert.equal(hoverContentsToPlainText('plain hover'), 'plain hover');
  });

  test('reads MarkupContent array', () => {
    const text = hoverContentsToPlainText([
      { kind: 'markdown', value: 'line one' },
      'line two',
    ]);
    assert.match(text, /line one/);
    assert.match(text, /line two/);
  });
});
