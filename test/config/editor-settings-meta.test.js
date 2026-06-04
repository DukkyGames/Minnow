import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_META } from '../../server/config/home.js';

describe('editor settings meta', () => {
  test('DEFAULT_META seeds editorSettings defaults', () => {
    assert.equal(DEFAULT_META.editorSettings?.fontSize, 13);
    assert.equal(DEFAULT_META.editorSettings?.tabSize, 2);
    assert.equal(DEFAULT_META.editorSettings?.wordWrap, false);
    assert.equal(DEFAULT_META.editorSettings?.renderWhitespace, false);
  });
});
