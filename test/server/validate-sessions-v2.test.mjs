/**
 * Server session validator — v1 input persists as schema v2.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateSessionState } from '../../server/config/validators.js';

describe('validateSessionState workspace schema', () => {
  it('accepts v1 input and returns version 2 with workspacePath', () => {
    const out = validateSessionState({
      version: 1,
      activeId: 'chat-1',
      sidebarCollapsed: false,
      chats: [
        {
          id: 'chat-1',
          name: 'Old',
          modelId: '',
          history: [],
          updatedAt: 1,
        },
      ],
    });

    assert.equal(out.version, 2);
    assert.equal(out.chats[0].workspacePath, '');
    assert.deepEqual(out.lastActiveChatIdByWorkspace, {});
  });

  it('rejects unknown session versions', () => {
    assert.throws(
      () =>
        validateSessionState({
          version: 3,
          activeId: 'x',
          chats: [],
        }),
      /Invalid session version/,
    );
  });
});
