import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ensureChatShape,
  migrateSessionV5ToV6,
} from '../../../src/state/sessions.ts';
import { defaultSessionState } from '../../../src/config/defaults.ts';

describe('migrateSessionV5ToV6', () => {
  test('copies manual expertSelection into expertId and drops Auto state', () => {
    const state = defaultSessionState();
    state.version = 5;
    state.chats = [
      ensureChatShape({
        id: 'c1',
        kind: 'expert',
        expertSelection: { mode: 'manual', expertId: 'software-engineer' },
        modelId: 'qwen',
        modeId: 'general',
        history: [],
      }),
      ensureChatShape({
        id: 'c2',
        expertSelection: { mode: 'auto', expertId: null },
        modelId: 'qwen',
        history: [],
      }),
    ];

    migrateSessionV5ToV6(state);
    assert.equal(state.version, 6);
    assert.equal(state.chats[0].expertId, 'software-engineer');
    assert.ok(state.chats[0].expertRuntime);
    assert.equal(state.chats[0].expertSelection, undefined);
    assert.equal(state.chats[1].expertId, undefined);
    assert.equal(state.chats[1].expertSelection, undefined);
  });
});
