import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_META } from '../../server/config/home.js';

describe('editor Intent mode meta', () => {
  test('DEFAULT_META seeds editorIntentMode with safe defaults', () => {
    assert.equal(DEFAULT_META.editorIntentMode?.enabledByDefault, false);
    assert.equal(DEFAULT_META.editorIntentMode?.autoRecheckDefault, false);
    assert.equal(DEFAULT_META.editorIntentMode?.debounceMs, 450);
    assert.equal(DEFAULT_META.editorIntentMode?.contextWindow, 5);
    assert.equal(DEFAULT_META.editorIntentMode?.recheckDelayMs, 600);
    assert.equal(DEFAULT_META.editorIntentMode?.maxRecheckPasses, 8);
  });
});
