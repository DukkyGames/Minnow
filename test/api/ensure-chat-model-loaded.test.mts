import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { modelCache } from '../../src/app-state.ts';
import { encodeModelSelectKey } from '../../src/lib/model-select-key.ts';
import { chatTurnNeedsModelLoad } from '../../src/api/ensure-chat-model-loaded.ts';
import { setStorageModeForTests } from '../../src/config/storage-mode.ts';

describe('ensure-chat-model-loaded', () => {
  test('chatTurnNeedsModelLoad uses provider-scoped cache rows only', () => {
    setStorageModeForTests('server');
    modelCache.clear();
    const provider = {
      id: 'lm-local',
      name: 'LM Studio',
      apiKind: 'lm-studio-v0',
      enabled: true,
    };
    const topBarKey = encodeModelSelectKey('lm-local', 'top-bar-model');
    const chatKey = encodeModelSelectKey('lm-local', 'chat-model');
    modelCache.set(topBarKey, { id: 'top-bar-model', state: 'loaded' });
    modelCache.set(chatKey, { id: 'chat-model', state: 'not-loaded' });

    assert.equal(
      chatTurnNeedsModelLoad(provider, 'chat-model'),
      true,
      'unloaded chat model must not inherit loaded state from another model on the same provider',
    );
    assert.equal(chatTurnNeedsModelLoad(provider, 'top-bar-model'), false);
  });
});
