/**
 * consumeReefArtifactEditsForPrompt clears pending edits for the model appendix.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { consumeReefArtifactEditsForPrompt } from '../../../src/chat/reef/artifact-context.ts';
import type { Chat } from '../../../src/types.ts';

const STATIC_CHAT: Chat = {
  id: '00000000-0000-0000-0000-000000000010',
  name: 'Reef artifact roundtrip',
  workspacePath: '',
  modelId: '',
  history: [],
  lastStats: null,
  modelInfo: {},
  updatedAt: 0,
  pendingReefArtifactEdits: [
    {
      artifactId: '11111111-artifact-test',
      version: 2,
      summary: 'user edit',
      path: '@minnow/reef/artifacts/11111111-artifact-test',
      at: '2026-05-22T12:00:00.000Z',
    },
  ],
};

describe('artifact round-trip prompt', () => {
  test('consumeReefArtifactEditsForPrompt includes artifact id and clears queue', () => {
    const block = consumeReefArtifactEditsForPrompt(STATIC_CHAT);
    assert.match(block, /11111111-artifact-test/);
    assert.match(block, /User edited reef artifacts/);
    assert.equal(STATIC_CHAT.pendingReefArtifactEdits?.length ?? 0, 0);

    const again = consumeReefArtifactEditsForPrompt(STATIC_CHAT);
    assert.equal(again, '');
  });
});
