/**
 * Orchestrate board + viewMode persistence via ensureChatShape.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ensureChatShape } from '../../src/state/sessions.ts';

const CHAT_ID = '11111111-1111-1111-1111-111111111111';
const FIXED_UPDATED_AT = 1710000000000;
const FIXED_BOARD_STARTED = 1710000001000;

/** Valid board blob persisted on chat (static fixture). */
const VALID_ORCHESTRATE_BOARD = {
  planPath: 'documentation/plans/shiny-minsky-board-view.md',
  tasks: [
    {
      id: 'W1-A',
      title: 'Implement board store',
      wave: 'W1',
      category: 'build',
      status: 'planned',
    },
    {
      id: 'W1-B',
      title: 'Wire board tools',
      wave: 'W1',
      category: 'test',
      status: 'in_progress',
    },
  ],
  waves: [
    { id: 'W1', status: 'in_progress', taskCount: 2, completeCount: 0 },
    { id: 'W2', status: 'planned' },
  ],
  startedAt: FIXED_BOARD_STARTED,
  lastUpdatedAt: FIXED_BOARD_STARTED,
  activeParentTurnId: 'parent-turn-0001',
};

function baseChatFixture(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: CHAT_ID,
    name: 'Orchestrate Board',
    modelId: 'test-model',
    modeId: 'orchestrate',
    history: [],
    lastStats: null,
    modelInfo: {},
    updatedAt: FIXED_UPDATED_AT,
    ...overrides,
  };
}

describe('ensureChatShape orchestrate board', () => {
  test('preserves orchestrateBoard with tasks[] and waves[]', () => {
    const raw = baseChatFixture({ orchestrateBoard: VALID_ORCHESTRATE_BOARD });
    const chat = ensureChatShape(raw);
    assert.ok(chat.orchestrateBoard);
    assert.equal(
      chat.orchestrateBoard.planPath,
      'documentation/plans/shiny-minsky-board-view.md',
    );
    assert.equal(chat.orchestrateBoard.tasks.length, 2);
    assert.equal(chat.orchestrateBoard.tasks[0].id, 'W1-A');
    assert.equal(chat.orchestrateBoard.waves.length, 2);
    assert.equal(chat.orchestrateBoard.waves[0].id, 'W1');
    assert.equal(chat.orchestrateBoard.activeParentTurnId, 'parent-turn-0001');

    const json = JSON.stringify(chat);
    const parsed = ensureChatShape(JSON.parse(json));
    assert.deepEqual(parsed.orchestrateBoard, chat.orchestrateBoard);
  });

  test("accepts viewMode 'chat' | 'board' and strips invalid viewMode", () => {
    const chatMode = ensureChatShape(baseChatFixture({ viewMode: 'chat' }));
    assert.equal(chatMode.viewMode, 'chat');

    const boardMode = ensureChatShape(baseChatFixture({ viewMode: 'board' }));
    assert.equal(boardMode.viewMode, 'board');

    const stripped = ensureChatShape(baseChatFixture({ viewMode: 'kanban' }));
    assert.equal(stripped.viewMode, undefined);

    const strippedEmpty = ensureChatShape(baseChatFixture({ viewMode: '' }));
    assert.equal(strippedEmpty.viewMode, undefined);
  });

  test('strips malformed orchestrateBoard missing tasks array', () => {
    const malformed = baseChatFixture({
      orchestrateBoard: {
        planPath: 'documentation/plans/shiny-minsky-board-view.md',
        waves: [{ id: 'W1', status: 'planned' }],
        startedAt: FIXED_BOARD_STARTED,
        lastUpdatedAt: FIXED_BOARD_STARTED,
      },
    });
    const chat = ensureChatShape(malformed);
    assert.equal(chat.orchestrateBoard, undefined);
  });
});
