/**
 * Orchestrator last-activity labels for the board header chip.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { deriveOrchestratorLastActivity } = await import(
  '../../src/chat/orchestrate/last-activity.ts'
);

describe('deriveOrchestratorLastActivity', () => {
  test('returns tool label from pending turn while streaming', () => {
    const chat = {
      history: [],
      pendingTurn: {
        role: 'assistant',
        content: '',
        startedAt: 1,
        phase: 'tools',
        toolCalls: [
          {
            id: 'tc-1',
            type: 'function',
            function: { name: 'board_get_state', arguments: '{}' },
          },
        ],
      },
    };
    const activity = deriveOrchestratorLastActivity(chat, true);
    assert.equal(activity?.kind, 'tool');
    assert.equal(activity?.text, 'Board get state');
  });

  test('returns last assistant message from history when idle', () => {
    const chat = {
      history: [
        { role: 'user', content: 'Go' },
        {
          role: 'assistant',
          content: 'Continuing with wave two of the plan.',
        },
      ],
      pendingTurn: null,
    };
    const activity = deriveOrchestratorLastActivity(chat, false);
    assert.equal(activity?.kind, 'message');
    assert.match(activity?.text ?? '', /wave two/);
  });
});
