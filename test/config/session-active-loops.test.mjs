import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { validateSessionState } from '../../server/config/validators.js';

describe('validateSessionState activeLoops', () => {
  test('round-trips activeLoops and nextLoopId on chats', () => {
    const raw = {
      version: 6,
      activeId: 'chat-1',
      sidebarCollapsed: false,
      chats: [
        {
          id: 'chat-1',
          name: 'Loop chat',
          workspacePath: '',
          modelId: '',
          modeId: 'build',
          history: [],
          updatedAt: 1_700_000_000_000,
          activeLoops: [
            {
              id: 1,
              promptText: 'check deploy',
              kind: 'interval',
              intervalMs: 300_000,
              dueAt: 1_700_000_100_000,
              createdAt: 1_700_000_000_000,
              expiresAt: 1_760_480_000_000,
              runCount: 2,
              paused: true,
              pausedRemainingMs: 45_000,
            },
          ],
          nextLoopId: 2,
        },
      ],
    };

    const validated = validateSessionState(raw);
    const chat = validated.chats.find((c) => c.id === 'chat-1');
    assert.ok(chat);
    assert.equal(chat.nextLoopId, 2);
    assert.equal(chat.activeLoops?.length, 1);
    assert.equal(chat.activeLoops?.[0]?.promptText, 'check deploy');
    assert.equal(chat.activeLoops?.[0]?.intervalMs, 300_000);
    assert.equal(chat.activeLoops?.[0]?.paused, true);
    assert.equal(chat.activeLoops?.[0]?.pausedRemainingMs, 45_000);
  });
});
