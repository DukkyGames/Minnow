import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  formatTrayAgentLabel,
  formatTrayModelsLabel,
} from '../../electron/tray-status.ts';

describe('tray status labels', () => {
  test('formats agent count', () => {
    assert.equal(formatTrayAgentLabel(2), 'Agents running: 2');
    assert.equal(formatTrayAgentLabel(-1), 'Agents running: 0');
  });

  test('formats model count without names', () => {
    assert.equal(formatTrayModelsLabel(0, []), 'Local models loaded: 0');
  });

  test('formats model names with overflow', () => {
    const label = formatTrayModelsLabel(4, ['a', 'b', 'c', 'd']);
    assert.match(label, /Local models loaded: 4 — a, b, c, \+1 more/);
  });
});
