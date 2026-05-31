import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_META } from '../../server/config/home.js';

describe('editor AI completion meta', () => {
  test('DEFAULT_META seeds editorAiCompletion disabled by default', () => {
    assert.equal(DEFAULT_META.editorAiCompletion?.enabled, false);
    assert.equal(DEFAULT_META.editorAiCompletion?.debounceMs, 450);
    assert.equal(DEFAULT_META.editorAiCompletion?.maxTokens, 128);
    assert.equal(DEFAULT_META.editorAiCompletion?.useChatModel, true);
  });
});
