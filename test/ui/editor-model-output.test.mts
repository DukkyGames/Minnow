/**
 * Editor model output sanitization (thinking strip + interleaved dedup).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { sanitizeQuickEditText } from '../../src/ui/editor-quick-edit/diff-apply.ts';
import {
  stripEditorModelOutput,
  stripInterleavedOriginalLines,
} from '../../src/ui/editor-model-output.ts';
import { sanitizeCompletionText } from '../../src/ui/editor-ai-completion-prompt.ts';

const RT_OPEN = '<' + 'redacted_thinking>';
const RT_CLOSE = '</' + 'redacted_thinking>';

describe('stripEditorModelOutput', () => {
  test('removes closed redacted_thinking block', () => {
    const input = `${RT_OPEN}The user wants me to improve this.${RT_CLOSE}\n  <main>`;
    assert.equal(stripEditorModelOutput(input), '<main>');
  });

  test('removes dangling unclosed thinking block', () => {
    const input = `${RT_OPEN}still thinking…`;
    assert.equal(stripEditorModelOutput(input), '');
  });
});

describe('stripInterleavedOriginalLines', () => {
  test('drops original line when followed by replacement', () => {
    const original = [
      '<form class="w-full max-w-640">',
      '<span class="icon">🔍</span>',
    ].join('\n');
    const output = [
      '<form class="w-full max-w-640">',
      '<form class="w-full max-w-2xl" role="search">',
      '<span class="icon">🔍</span>',
      '<label for="search-input">🔍</label>',
    ].join('\n');
    const cleaned = stripInterleavedOriginalLines(output, original);
    assert.equal(
      cleaned,
      [
        '<form class="w-full max-w-2xl" role="search">',
        '<label for="search-input">🔍</label>',
      ].join('\n'),
    );
  });
});

describe('sanitizeQuickEditText', () => {
  test('strips thinking then interleaved originals', () => {
    const original = '        <form class="max-w-640">';
    const model = [
      RT_OPEN,
      'The user wants me to improve this code.',
      RT_CLOSE,
      '        <form class="max-w-640">',
      '        <form class="max-w-2xl" role="search">',
    ].join('\n');
    const cleaned = sanitizeQuickEditText(model, original);
    assert.equal(cleaned, '<form class="max-w-2xl" role="search">');
    assert.doesNotMatch(cleaned, /redacted_thinking/);
  });
});

describe('sanitizeCompletionText', () => {
  test('strips thinking from ghost completion', () => {
    const cleaned = sanitizeCompletionText(`${RT_OPEN}hmm${RT_CLOSE}code();`);
    assert.equal(cleaned, 'code();');
  });
});
