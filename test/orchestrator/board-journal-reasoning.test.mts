/**
 * V2 board.model.set reasoning ↔ Orchestrate header fields.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  fieldsFromJournalReasoning,
  isBoardJournalReasoning,
  journalReasoningFromFields,
  mergeReasoningPatch,
} from '../../src/orchestrator/board-journal-reasoning.ts';

describe('board journal reasoning', () => {
  test('accepts the header effort vocabulary', () => {
    assert.equal(isBoardJournalReasoning('medium'), true);
    assert.equal(isBoardJournalReasoning('turbo'), false);
  });

  test('round-trips low/medium/high and off', () => {
    assert.deepEqual(fieldsFromJournalReasoning('high'), { reasoningEffort: 'high' });
    assert.equal(
      journalReasoningFromFields(fieldsFromJournalReasoning('high')),
      'high',
    );
    assert.equal(journalReasoningFromFields({ reasoningEffort: 'off' }), 'off');
    assert.equal(journalReasoningFromFields({ thinkingMode: 'on' }), 'on');
    assert.equal(journalReasoningFromFields({}), '');
  });

  test('a header patch onto a journaled binding produces the next journal string', () => {
    const current = fieldsFromJournalReasoning('on');
    const next = mergeReasoningPatch(current, {
      reasoningEffort: 'low',
      clearThinkingMode: true,
    });
    assert.equal(journalReasoningFromFields(next), 'low');
  });
});
