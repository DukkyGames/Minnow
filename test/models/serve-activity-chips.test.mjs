import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  formatQueuedChipLabel,
  serveActivityChipLabels,
} from '../../src/models/serve-activity-chips.ts';

const IDLE = {
  serveId: 'serve-1',
  modelLabel: 'qwen',
  libraryId: 'lib-1',
  updatedAt: 1,
  available: true,
  stale: false,
  queued: 0,
  slots: [
    {
      id: 0,
      taskId: null,
      state: 'idle',
      promptProcessed: 0,
      promptCached: 0,
      decoded: 0,
      remaining: null,
      tokensPerSecond: null,
    },
  ],
};

describe('serve activity chip labels', () => {
  test('idle host is Ready', () => {
    assert.deepEqual(serveActivityChipLabels(IDLE), ['Ready']);
  });

  test('queue depth replaces Ready when the host is backed up', () => {
    assert.deepEqual(serveActivityChipLabels({ ...IDLE, queued: 2 }), ['2 queued']);
    assert.equal(formatQueuedChipLabel(1), '1 queued');
  });

  test('busy slot keeps its chip and appends queue depth', () => {
    const activity = {
      ...IDLE,
      queued: 3,
      slots: [
        {
          id: 0,
          taskId: 9,
          state: 'generating',
          promptProcessed: 100,
          promptCached: 0,
          decoded: 917,
          remaining: 20,
          tokensPerSecond: 40,
        },
      ],
    };
    assert.deepEqual(serveActivityChipLabels(activity), ['0 GEN 917 tok', '3 queued']);
  });

  test('stale idle without a queue still says the reading is old', () => {
    assert.deepEqual(serveActivityChipLabels({ ...IDLE, stale: true }), ['Ready · stale']);
  });
});
