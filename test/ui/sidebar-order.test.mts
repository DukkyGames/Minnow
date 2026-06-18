/**
 * Sidebar interleaves groups and ungrouped chats by activity (MIN-221).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildSortedWorkspaceSidebarEntries } from '../../src/state/chat-groups.ts';
import { createEmptyChatObject } from '../../src/state/sessions.ts';
import type { Chat, ChatGroup } from '../../src/types.ts';

const WS = 'C:\\workspace\\sidebar-order';

function chatWithActivity(name: string, lastMessageAt: number, groupId?: string): Chat {
  const chat = createEmptyChatObject('', WS);
  chat.name = name;
  chat.lastMessageAt = lastMessageAt;
  chat.updatedAt = lastMessageAt;
  if (groupId) chat.groupId = groupId;
  return chat;
}

function groupWithCreatedAt(name: string, createdAt: number): ChatGroup {
  return {
    id: `grp_${name}`,
    name,
    workspacePath: WS,
    collapsed: false,
    order: 0,
    createdAt,
  };
}

describe('buildSortedWorkspaceSidebarEntries', () => {
  test('interleaves groups and chats by newest activity', () => {
    const staleGroup = groupWithCreatedAt('Stale board', 1000);
    const staleMember = chatWithActivity('Planner', 2000, staleGroup.id);

    const freshChat = chatWithActivity('Fresh chat', 9000);
    const midGroup = groupWithCreatedAt('Mid board', 3000);
    const midMember = chatWithActivity('Task', 5000, midGroup.id);

    const workspaceChats = [freshChat, midMember, staleMember];
    const groups = [staleGroup, midGroup];

    const ordered = buildSortedWorkspaceSidebarEntries(groups, workspaceChats);
    assert.deepEqual(
      ordered.map((entry) =>
        entry.kind === 'group' ? `group:${entry.group.name}` : `chat:${entry.chat.name}`,
      ),
      ['chat:Fresh chat', 'group:Mid board', 'group:Stale board'],
    );
  });

  test('empty group falls back to createdAt for ordering', () => {
    const emptyGroup = groupWithCreatedAt('Empty folder', 8000);
    const olderChat = chatWithActivity('Older chat', 4000);

    const ordered = buildSortedWorkspaceSidebarEntries([emptyGroup], [olderChat]);
    assert.equal(ordered[0]?.kind, 'group');
    assert.equal(ordered[1]?.kind, 'chat');
  });
});
