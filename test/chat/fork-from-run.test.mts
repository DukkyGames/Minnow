import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mergeSnapshotOverrides } from '../../src/chat/fork-from-run.ts';
import type { TurnSnapshot } from '../../src/types.ts';

const BASE: TurnSnapshot = {
  forkHistoryIndex: 0,
  userContent: 'hi',
  skillId: null,
  providerId: 'prov-a',
  modelId: 'model-a',
  temperature: 0.7,
  maxTokens: 4096,
  modeId: 'build',
  workAgentId: null,
  workAgentAuto: true,
  composedSystemPrompt: 'SYS',
  enabledToolNames: [],
  maxToolTurns: 25,
  historyPrefixHash: 'hash',
};

describe('fork-from-run helpers', () => {
  test('mergeSnapshotOverrides applies model and provider', () => {
    const merged = mergeSnapshotOverrides(BASE, {
      providerId: 'prov-b',
      modelId: 'model-b',
      temperature: 0.2,
    });
    assert.equal(merged.providerId, 'prov-b');
    assert.equal(merged.modelId, 'model-b');
    assert.equal(merged.temperature, 0.2);
    assert.equal(merged.maxTokens, 4096);
  });
});
