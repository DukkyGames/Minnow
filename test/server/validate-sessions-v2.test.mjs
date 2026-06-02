/**
 * Server session validator — v1 input persists as current SESSION_SCHEMA_VERSION.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { validateSessionState } from '../../server/config/validators.js';

describe('validateSessionState workspace schema', () => {
  it('accepts v1 input and returns version 5 with workspacePath', () => {
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

    assert.equal(out.version, 5);
    assert.equal(out.chats[0].workspacePath, '');
    assert.deepEqual(out.lastActiveChatIdByWorkspace, {});
    assert.deepEqual(out.groups, []);
  });

  it('accepts v5 input with sidebar groups', () => {
    const out = validateSessionState({
      version: 5,
      activeId: 'chat-1',
      sidebarCollapsed: false,
      activeBoardGroupId: 'grp-1',
      groups: [
        {
          id: 'grp-1',
          name: 'Plan A',
          workspacePath: 'C:/demo',
          collapsed: false,
          order: 0,
          createdAt: 1,
        },
      ],
      chats: [
        {
          id: 'chat-1',
          name: 'Planner',
          workspacePath: 'C:/demo',
          modelId: '',
          boardGroupId: 'grp-1',
          history: [],
          updatedAt: 1,
        },
      ],
    });

    assert.equal(out.version, 5);
    assert.equal(out.activeBoardGroupId, 'grp-1');
    assert.equal(out.groups[0].name, 'Plan A');
    assert.equal(out.chats[0].boardGroupId, 'grp-1');
  });

  it('rejects unknown session versions', () => {
    assert.throws(
      () =>
        validateSessionState({
          version: 99,
          activeId: 'x',
          chats: [],
        }),
      /Invalid session version/,
    );
  });
});
