import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  clearActiveBenchmarkSession,
  loadActiveBenchmarkSession,
  remainingSuiteIds,
  saveActiveBenchmarkSession,
  type ActiveBenchmarkSession,
} from '../../src/benchmark/active-run-session.ts';
import type { SuiteId } from '../../src/benchmark/types.ts';

const SAMPLE_SESSION: ActiveBenchmarkSession = {
  version: 1,
  runId: '2026-05-25T12-00-00-000Z',
  startedAt: '2026-05-25T12:00:00.000Z',
  preset: 'quick',
  startMode: 'quick',
  suiteIds: ['capability', 'speed'],
  modelId: 'test-model',
  completedSuites: [
    {
      id: 'capability',
      label: 'Capability',
      passed: 2,
      failed: 0,
      skipped: 0,
      score: 1,
      tests: [],
    },
  ],
  completedTests: [],
  status: 'running',
};

describe('active benchmark session', () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    globalThis.sessionStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => storage.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });

  afterEach(() => {
    clearActiveBenchmarkSession();
  });

  test('save and load round-trip', () => {
    saveActiveBenchmarkSession(SAMPLE_SESSION);
    const loaded = loadActiveBenchmarkSession();
    assert.deepEqual(loaded, SAMPLE_SESSION);
  });

  test('remainingSuiteIds skips completed suites', () => {
    const remaining = remainingSuiteIds(SAMPLE_SESSION);
    assert.deepEqual(remaining, ['speed'] as SuiteId[]);
  });

  test('clear removes persisted session', () => {
    saveActiveBenchmarkSession(SAMPLE_SESSION);
    clearActiveBenchmarkSession();
    assert.equal(loadActiveBenchmarkSession(), null);
  });
});
