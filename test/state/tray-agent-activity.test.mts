import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildAgentActivitySnapshot } from '../../src/state/agent-activity-registry.ts';

describe('tray agent activity snapshot', () => {
  test('counts engine-only generation via currentGenerationId fallback', () => {
    const now = 1_700_000_000_000;
    const rows = buildAgentActivitySnapshot({
      nowMs: now,
      chats: [
        {
          id: 'chat-1',
          name: 'Busy chat',
          workspacePath: '',
          modelId: 'model-a',
          providerId: 'lm-studio-local',
          history: [],
          currentGenerationId: 'gen-1',
          updatedAt: now - 5_000,
        },
      ],
      mainTurns: [],
      subAgents: [],
      titleJobs: [],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.kind, 'main_turn');
    assert.equal(rows[0]?.chatId, 'chat-1');
  });
});
