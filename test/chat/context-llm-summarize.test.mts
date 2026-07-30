/**
 * LLM summarize fallback when provider unavailable.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { summarizeDroppedTurns } from '../../src/chat/context/llm-summarize.ts';

describe('summarizeDroppedTurns', () => {
  test('falls back to extractive summary without provider ids', async () => {
    const result = await summarizeDroppedTurns({
      droppedText: 'alpha '.repeat(200),
      providerId: '',
      modelId: '',
      summaryReserveTokens: 64,
    });
    assert.equal(result.usedLlm, false);
    assert.ok(result.summaryBody.length > 0);
  });

  test('returns empty for blank input', async () => {
    const result = await summarizeDroppedTurns({
      droppedText: '   ',
      providerId: 'p',
      modelId: 'm',
      summaryReserveTokens: 64,
    });
    assert.equal(result.summaryBody, '');
    assert.equal(result.usedLlm, false);
  });
});
