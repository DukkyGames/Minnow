/**
 * Top-bar model <select> composite value encoding (multi-provider catalog).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  decodeModelSelectKey,
  encodeModelSelectKey,
  findFirstSelectKeyForCanonicalModelId,
  MODEL_SELECT_KEY_SEP,
} from '../../src/lib/model-select-key.ts';
import { buildTopBarModelOptionHtml } from '../../src/lib/format-model-label.ts';

describe('model-select-key', () => {
  test('round-trips provider and model id', () => {
    const key = encodeModelSelectKey('p-1', 'my-model-id');
    assert.ok(key.includes(MODEL_SELECT_KEY_SEP));
    assert.equal(decodeModelSelectKey(key)?.providerId, 'p-1');
    assert.equal(decodeModelSelectKey(key)?.modelId, 'my-model-id');
  });

  test('returns null for plain legacy model id values', () => {
    assert.equal(decodeModelSelectKey('gpt-4o'), null);
  });

  test('findFirstSelectKeyForCanonicalModelId picks first matching cache key', () => {
    const keys = [encodeModelSelectKey('a', 'm1'), encodeModelSelectKey('b', 'm1')];
    assert.equal(findFirstSelectKeyForCanonicalModelId(keys, 'm1'), keys[0]);
  });

  test('buildTopBarModelOptionHtml includes provider label and data attributes', () => {
    const html = buildTopBarModelOptionHtml({
      value: encodeModelSelectKey('prov', 'mid'),
      providerId: 'prov',
      providerLabel: 'Local LM',
      supportsModelLoadUnload: true,
      model: { id: 'mid', quantization: 'Q4', state: 'not_loaded' },
    });
    assert.match(html, /data-provider-id="prov"/);
    assert.match(html, /data-supports-load-unload="1"/);
    assert.match(html, /— Local LM/);
  });
});
