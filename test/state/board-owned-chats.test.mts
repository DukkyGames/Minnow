/**
 * Board chats live in the Orchestrate screen, not the chats panel.
 *
 * Covers the ownership predicates the sidebar and Code overview filter on, and
 * the rail's chat-level row model (planner first, then task chats by wave).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  isBoardOwnedChat,
  isBoardOwnedGroup,
} from '../../src/state/chat-groups.ts';
import { listBoardChatRailRows } from '../../src/ui/orchestrate-page-shell.ts';
import { createEmptyChatObject } from '../../src/state/sessions.ts';
import type { BoardTask, Chat, ChatGroup } from '../../src/types.ts';

const WS = 'C:\\workspace\\board-owned';

function chat(name: string, boardGroupId?: string): Chat {
  const c = createEmptyChatObject('', WS);
  c.name = name;
  if (boardGroupId) c.boardGroupId = boardGroupId;
  return c;
}

function task(overrides: Partial<BoardTask> & Pick<BoardTask, 'id'>): BoardTask {
  return {
    title: overrides.id,
    wave: 'w1',
    category: 'build',
    status: 'planned',
    ...overrides,
  } as BoardTask;
}

function boardGroup(tasks: BoardTask[], plannerChatId?: string): ChatGroup {
  return {
    id: 'grp_board',
    name: 'rpg-makeover',
    workspacePath: WS,
    order: 0,
    createdAt: 1,
    plannerChatId,
    orchestrateBoard: {
      tasks,
      waves: [{ id: 'w1', status: 'planned' }, { id: 'w2', status: 'planned' }],
    },
  } as unknown as ChatGroup;
}

describe('board-owned chats', () => {
  test('a chat is board-owned only when it carries boardGroupId', () => {
    assert.equal(isBoardOwnedChat(chat('Plain chat')), false);
    assert.equal(isBoardOwnedChat(chat('Task chat', 'grp_board')), true);
  });

  test('whitespace-only boardGroupId does not count as owned', () => {
    const c = chat('Odd chat');
    c.boardGroupId = '   ';
    assert.equal(isBoardOwnedChat(c), false);
  });

  test('a folder with a board is board-owned; a plain folder is not', () => {
    assert.equal(isBoardOwnedGroup(boardGroup([])), true);
    const plain = {
      id: 'grp_plain',
      name: 'Notes',
      workspacePath: WS,
      order: 0,
      createdAt: 1,
    } as unknown as ChatGroup;
    assert.equal(isBoardOwnedGroup(plain), false);
  });
});

describe('orchestrate chat rail rows', () => {
  test('planner sorts first and is labelled Orchestrator', () => {
    const planner = chat('rpg-makeover parse', 'grp_board');
    const build = chat('Task W1-A', 'grp_board');
    const group = boardGroup(
      [task({ id: 'W1-A', wave: 'w1', chatId: build.id })],
      planner.id,
    );

    const rows = listBoardChatRailRows(group, [build, planner]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.chatId, planner.id);
    assert.equal(rows[0]!.title, 'Orchestrator');
    assert.equal(rows[0]!.isPlanner, true);
    assert.equal(rows[1]!.isPlanner, false);
  });

  test('build, tester and fixer chats each get a role in their meta', () => {
    const build = chat('build', 'grp_board');
    const tester = chat('tester', 'grp_board');
    const fixer = chat('fixer', 'grp_board');
    const group = boardGroup([
      task({
        id: 'W1-A',
        wave: 'w1',
        chatId: build.id,
        testChatId: tester.id,
        fixerChatId: fixer.id,
        fixerKind: 'env',
      }),
    ]);

    const rows = listBoardChatRailRows(group, [build, tester, fixer]);
    assert.deepEqual(
      rows.map((r) => r.meta),
      ['W1-A · build', 'W1-A · tester', 'W1-A · env fix'],
    );
    assert.deepEqual(rows.map((r) => r.wave), ['w1', 'w1', 'w1']);
  });

  test('rows carry their wave so the rail can group them', () => {
    const a = chat('a', 'grp_board');
    const b = chat('b', 'grp_board');
    const group = boardGroup([
      task({ id: 'W1-A', wave: 'w1', chatId: a.id }),
      task({ id: 'W2-A', wave: 'w2', chatId: b.id }),
    ]);

    const rows = listBoardChatRailRows(group, [a, b]);
    assert.deepEqual(rows.map((r) => r.wave), ['w1', 'w2']);
  });

  test('tasks with no chat yet contribute no rows', () => {
    const group = boardGroup([task({ id: 'W1-A', wave: 'w1' })]);
    assert.deepEqual(listBoardChatRailRows(group, []), []);
  });

  test('a chat referenced by the board but absent from state is skipped', () => {
    const group = boardGroup([task({ id: 'W1-A', wave: 'w1', chatId: 'gone' })]);
    assert.deepEqual(listBoardChatRailRows(group, []), []);
  });

  test('the final integration test gets its own row, outside any wave', () => {
    const finalChat = chat('final', 'grp_board');
    const group = boardGroup([]);
    group.orchestrateBoard!.finalTest = { chatId: finalChat.id } as never;

    const rows = listBoardChatRailRows(group, [finalChat]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.meta, 'final test');
    assert.equal(rows[0]!.wave, undefined);
  });

  test('a chat linked twice is listed once', () => {
    const shared = chat('shared', 'grp_board');
    const group = boardGroup([
      task({ id: 'W1-A', wave: 'w1', chatId: shared.id }),
      task({ id: 'W1-B', wave: 'w1', chatId: shared.id }),
    ]);

    const rows = listBoardChatRailRows(group, [shared]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.meta, 'W1-A · build');
  });

  test('a board still in setup (no board state) lists only its planner', () => {
    const planner = chat('planner', 'grp_setup');
    const group = {
      id: 'grp_setup',
      name: 'setup',
      workspacePath: WS,
      order: 0,
      createdAt: 1,
      plannerChatId: planner.id,
    } as unknown as ChatGroup;

    const rows = listBoardChatRailRows(group, [planner]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.isPlanner, true);
  });
});
