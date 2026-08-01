/**
 * Top-bar model <select> composite value encoding (multi-provider catalog).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyModelSelectValueToChat,
  copyChatModelBinding,
  decodeModelSelectKey,
  encodeModelSelectKey,
  findFirstSelectKeyForCanonicalModelId,
  MODEL_SELECT_KEY_SEP,
  resolveModelSelectValueForChat,
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

  test('resolveModelSelectValueForChat prefers composite provider+model key', () => {
    const keyA = encodeModelSelectKey('prov-a', 'model-x');
    const keyB = encodeModelSelectKey('prov-b', 'model-x');
    const resolved = resolveModelSelectValueForChat(
      { providerId: 'prov-b', modelId: 'model-x' },
      [keyA, keyB],
    );
    assert.equal(resolved, keyB);
  });

  test('applyModelSelectValueToChat clears provider for legacy plain model id', () => {
    const chat = { providerId: 'old-prov', modelId: 'old-model' };
    applyModelSelectValueToChat(chat, 'plain-model');
    assert.equal(chat.modelId, 'plain-model');
    assert.equal(chat.providerId, undefined);
  });

  test('copyChatModelBinding copies provider and model onto target chat', () => {
    const source = { providerId: 'lm-studio', modelId: 'qwen-35b' };
    const target = { providerId: 'other', modelId: 'gpt' };
    copyChatModelBinding(source, target);
    assert.equal(target.modelId, 'qwen-35b');
    assert.equal(target.providerId, 'lm-studio');
  });

  test('copyChatModelBinding is a no-op when source has no model id', () => {
    const target = { providerId: 'keep', modelId: 'keep-model' };
    copyChatModelBinding({ modelId: '' }, target);
    assert.equal(target.modelId, 'keep-model');
    assert.equal(target.providerId, 'keep');
  });
});
