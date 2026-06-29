/**
 * Email agent batching and triage retry cooldown tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  prioritizeAgentBatch,
  shouldSkipTriageRetry,
  MAX_AGENT_MESSAGES_PER_SYNC,
  TRIAGE_RETRY_COOLDOWN_MS,
} from '../../server/email/agent.js';

describe('prioritizeAgentBatch', () => {
  test('returns newest UIDs first and caps batch size', () => {
    const incoming = [
      { id: 'INBOX:10', uid: '10' },
      { id: 'INBOX:99', uid: '99' },
      { id: 'INBOX:50', uid: '50' },
    ];
    const batch = prioritizeAgentBatch(incoming, 2);
    assert.equal(batch.length, 2);
    assert.deepEqual(
      batch.map((row) => row.id),
      ['INBOX:99', 'INBOX:50'],
    );
  });

  test('default limit matches MAX_AGENT_MESSAGES_PER_SYNC', () => {
    const rows = Array.from({ length: MAX_AGENT_MESSAGES_PER_SYNC + 3 }, (_v, i) => ({
      id: `INBOX:${i}`,
      uid: String(i),
    }));
    assert.equal(prioritizeAgentBatch(rows).length, MAX_AGENT_MESSAGES_PER_SYNC);
  });
});

describe('shouldSkipTriageRetry', () => {
  const now = Date.parse('2026-06-28T12:00:00.000Z');

  test('skips when triage summary already exists', () => {
    assert.equal(
      shouldSkipTriageRetry({ triage: { summary: 'Done' } }, now),
      true,
    );
  });

  test('skips during cooldown after failure', () => {
    const failedAt = new Date(now - TRIAGE_RETRY_COOLDOWN_MS + 60_000).toISOString();
    assert.equal(shouldSkipTriageRetry({ triage: { failedAt } }, now), true);
  });

  test('allows retry after cooldown expires', () => {
    const failedAt = new Date(now - TRIAGE_RETRY_COOLDOWN_MS - 1).toISOString();
    assert.equal(shouldSkipTriageRetry({ triage: { failedAt } }, now), false);
  });

  test('processes messages with no triage metadata', () => {
    assert.equal(shouldSkipTriageRetry({}), false);
  });
});
