/**
 * Local model tray filtering and status snapshot builder.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildTrayStatusSnapshot } from '../../src/local-models/tray-status-snapshot.ts';

describe('buildTrayStatusSnapshot', () => {
  test('clamps negative agent counts to zero', () => {
    const snapshot = buildTrayStatusSnapshot(-3, []);
    assert.equal(snapshot.runningAgentCount, 0);
    assert.deepEqual(snapshot.loadedLocalModels, []);
  });

  test('passes through loaded model rows', () => {
    const rows = [{ id: 'lm:p:m', label: 'Model A', source: 'lm-studio' as const }];
    const snapshot = buildTrayStatusSnapshot(1, rows);
    assert.equal(snapshot.runningAgentCount, 1);
    assert.deepEqual(snapshot.loadedLocalModels, rows);
  });
});
