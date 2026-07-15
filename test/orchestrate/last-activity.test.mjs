/**
 * Orchestrator last-activity labels for the board header chip.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

const { deriveOrchestratorLastActivity } = await import(
  '../../src/chat/orchestrate/last-activity.ts'
);
const { emitMainTurnActivity, resetMainTurnActivity } = await import(
  '../../src/chat/main-turn-activity.ts'
);

describe('deriveOrchestratorLastActivity', () => {
  afterEach(() => {
    resetMainTurnActivity();
  });

  test('returns generating label while streaming', () => {
    const chat = { history: [] };
    const activity = deriveOrchestratorLastActivity(chat, true);
    assert.equal(activity?.kind, 'waiting');
    assert.equal(activity?.text, 'Generating…');
  });

  test('returns thinking label while streaming in thinking phase', () => {
    const chat = { id: 'chat-thinking', history: [] };
    emitMainTurnActivity({
      chatId: chat.id,
      phase: 'thinking',
      currentTool: null,
      workAgentLabel: 'Orchestrator',
      modelId: 'm',
      providerId: 'p',
      startedAtMs: 1,
    });
    const activity = deriveOrchestratorLastActivity(chat, true);
    assert.equal(activity?.kind, 'thinking');
    assert.equal(activity?.text, 'Thinking…');
  });

  test('returns tool label while streaming during tool phase', () => {
    const chat = { id: 'chat-tools', history: [] };
    emitMainTurnActivity({
      chatId: chat.id,
      phase: 'tools',
      currentTool: 'read_file',
      workAgentLabel: 'Orchestrator',
      modelId: 'm',
      providerId: 'p',
      startedAtMs: 1,
    });
    const activity = deriveOrchestratorLastActivity(chat, true);
    assert.equal(activity?.kind, 'tool');
    assert.match(activity?.text ?? '', /read/i);
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
