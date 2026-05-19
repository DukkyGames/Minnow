/**
 * Chat modeId shape and persistence defaults.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ensureChatShape } from '../../src/state/sessions.ts';

describe('chat modeId persistence', () => {
  test('ensureChatShape defaults modeId to build', () => {
    const chat = ensureChatShape({});
    assert.equal(chat.modeId, 'build');
  });

  test('round-trip preserves orchestrate', () => {
    const raw = {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Test',
      modelId: 'm1',
      modeId: 'orchestrate',
      history: [],
      updatedAt: 1710000000000,
    };
    const chat = ensureChatShape(raw);
    assert.equal(chat.modeId, 'orchestrate');
    const json = JSON.stringify(chat);
    const parsed = ensureChatShape(JSON.parse(json));
    assert.equal(parsed.modeId, 'orchestrate');
  });
});
