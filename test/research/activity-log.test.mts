/**
 * Activity log formatters and buffer behavior.
 */
import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';

import {
  ActivityLogBuffer,
  entriesFromResearchProgress,
  formatActivityLogLine,
  formatActivityTimestamp,
  resetActivityLogIdsForTests,
} from '../../src/research/activity-log.ts';

beforeEach(() => {
  resetActivityLogIdsForTests();
});

describe('activity-log', () => {
  test('formatActivityTimestamp uses zero-padded clock', () => {
    const atMs = Date.UTC(2026, 0, 15, 12, 4, 32);
    const formatted = formatActivityTimestamp(atMs);
    assert.match(formatted, /^\d{2}:\d{2}:\d{2}$/);
  });

  test('entriesFromResearchProgress formats searching with query list', () => {
    const rows = entriesFromResearchProgress(
      {
        phase: 'searching',
        round: 2,
        queryList: ['alpha query', 'beta query'],
        queryCount: 2,
        totalSources: 4,
      },
      1_700_000_000_000,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.label, 'Searching');
    assert.equal(rows[0]!.detail, 'round 2 · 2 queries');
    assert.deepEqual(rows[0]!.queries, ['alpha query', 'beta query']);
  });

  test('formatActivityLogLine joins timestamp, label, and detail', () => {
    const atMs = new Date(2026, 0, 15, 12, 4, 32).getTime();
    const line = formatActivityLogLine({
      id: 'al-1',
      atMs,
      kind: 'phase',
      label: 'Planning',
      detail: 'Sub-questions listed',
    });
    assert.match(line, /^\d{2}:\d{2}:\d{2} · Planning · Sub-questions listed$/);
  });

  test('ActivityLogBuffer caps entries at configured limit', () => {
    const buffer = new ActivityLogBuffer(3);
    for (let i = 0; i < 5; i += 1) {
      buffer.appendFromResearchProgress({
        phase: 'warning',
        message: `warn-${i}`,
      });
    }
    const entries = buffer.getEntries();
    assert.equal(entries.length, 3);
    assert.equal(entries[0]!.detail, 'warn-2');
    assert.equal(entries[2]!.detail, 'warn-4');
  });
});
