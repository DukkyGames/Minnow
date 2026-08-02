import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_META } from '../../server/config/home.js';
import { mergeConfigMeta } from '../../server/config/validators.js';

describe('editor Intent mode meta', () => {
  test('DEFAULT_META seeds editorIntentMode with safe defaults', () => {
    assert.equal(DEFAULT_META.editorIntentMode?.enabledByDefault, false);
    assert.equal(DEFAULT_META.editorIntentMode?.debounceMs, 400);
    assert.equal(DEFAULT_META.editorIntentMode?.sigil, '');
    assert.equal(DEFAULT_META.editorIntentMode?.providerId, '');
    assert.equal(DEFAULT_META.editorIntentMode?.modelId, '');
    assert.equal(DEFAULT_META.editorIntentMode?.maxTokens, 768);
  });

  test('DEFAULT_META no longer carries the removed recheck keys', () => {
    assert.equal('autoRecheckDefault' in (DEFAULT_META.editorIntentMode ?? {}), false);
    assert.equal('recheckDelayMs' in (DEFAULT_META.editorIntentMode ?? {}), false);
    assert.equal('maxRecheckPasses' in (DEFAULT_META.editorIntentMode ?? {}), false);
    assert.equal('contextWindow' in (DEFAULT_META.editorIntentMode ?? {}), false);
  });
});

describe('editorIntentMode meta patch', () => {
  test('clamps numeric fields and trims strings', () => {
    const base = {};
    const merged = mergeConfigMeta(base, {
      editorIntentMode: {
        enabledByDefault: true,
        debounceMs: 10_000,
        sigil: '  ??  ',
        providerId: '  lmstudio  ',
        modelId: '  qwen  ',
        maxTokens: 99_999,
      },
    });
    assert.deepEqual(merged.editorIntentMode, {
      enabledByDefault: true,
      debounceMs: 2000,
      sigil: '??',
      providerId: 'lmstudio',
      modelId: 'qwen',
      maxTokens: 4096,
    });
  });

  test('ignores unknown and malformed keys', () => {
    const merged = mergeConfigMeta(
      {},
      {
        editorIntentMode: {
          debounceMs: 'nope',
          autoRecheckDefault: true,
          somethingElse: 1,
        },
      },
    );
    assert.equal(merged.editorIntentMode.debounceMs, 400);
    assert.equal(merged.editorIntentMode.somethingElse, undefined);
  });
});
