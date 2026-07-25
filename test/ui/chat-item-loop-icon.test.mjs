import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { resolveChatItemLoopIconState } = await import('../../src/ui/chat-item-loop-icon.ts');

function chat(overrides) {
  return {
    id: 'chat-a',
    name: 'A',
    workspacePath: '',
    modelId: '',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: 1,
    ...overrides,
  };
}

describe('chat-item-loop-icon resolveChatItemLoopIconState', () => {
  test('no activeLoops is hidden', () => {
    assert.equal(resolveChatItemLoopIconState(chat({})), 'hidden');
    assert.equal(resolveChatItemLoopIconState(chat({ activeLoops: [] })), 'hidden');
  });

  test('unpaused loop is running', () => {
    assert.equal(
      resolveChatItemLoopIconState(
        chat({
          activeLoops: [
            {
              id: 1,
              promptText: 'check deploy',
              kind: 'interval',
              intervalMs: 300_000,
              dueAt: 1_000,
              createdAt: 0,
              expiresAt: 9_999,
              runCount: 0,
            },
          ],
        }),
      ),
      'running',
    );
  });

  test('all paused loops show paused state', () => {
    assert.equal(
      resolveChatItemLoopIconState(
        chat({
          activeLoops: [
            {
              id: 1,
              promptText: 'a',
              kind: 'interval',
              intervalMs: 60_000,
              dueAt: 1_000,
              createdAt: 0,
              expiresAt: 9_999,
              runCount: 0,
              paused: true,
            },
            {
              id: 2,
              promptText: 'b',
              kind: 'auto',
              dueAt: 2_000,
              createdAt: 0,
              expiresAt: 9_999,
              runCount: 0,
              paused: true,
            },
          ],
        }),
      ),
      'paused',
    );
  });

  test('mixed paused and running resolves to running', () => {
    assert.equal(
      resolveChatItemLoopIconState(
        chat({
          activeLoops: [
            {
              id: 1,
              promptText: 'a',
              kind: 'interval',
              intervalMs: 60_000,
              dueAt: 1_000,
              createdAt: 0,
              expiresAt: 9_999,
              runCount: 0,
              paused: true,
            },
            {
              id: 2,
              promptText: 'b',
              kind: 'auto',
              dueAt: 2_000,
              createdAt: 0,
              expiresAt: 9_999,
              runCount: 0,
            },
          ],
        }),
      ),
      'running',
    );
  });
});
