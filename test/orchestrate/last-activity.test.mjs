/**
 * Orchestrator last-activity labels for the board header chip.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { deriveOrchestratorLastActivity } = await import(
  '../../src/chat/orchestrate/last-activity.ts'
);

describe('deriveOrchestratorLastActivity', () => {
  test('returns generating label while streaming', () => {
    const chat = { history: [] };
    const activity = deriveOrchestratorLastActivity(chat, true);
    assert.equal(activity?.kind, 'waiting');
    assert.equal(activity?.text, 'Generating…');
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
    };
    const activity = deriveOrchestratorLastActivity(chat, false);
    assert.equal(activity?.kind, 'message');
    assert.match(activity?.text ?? '', /wave two/);
  });
});
