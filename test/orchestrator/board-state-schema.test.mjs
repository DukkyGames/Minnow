/**
 * P3-E — V2 BoardState is a status enum plus a concurrency integer.
 *
 * PRD §6 deleted six V1 flags that could contradict each other. Those names
 * must not appear on the derived state. V1 struct field removal is P4-F.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
  DEFAULT_BOARD_CONCURRENCY,
  emptyState,
} from '../../server/orchestrator/core/derive.js';
import { stateToJSON } from '../../server/orchestrator/core/snapshot.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const V1_AUTONOMY_FIELDS = [
  'executionMode',
  'handsOff',
  'pendingAfk',
  'autoRunning',
  'systemPaused',
  'userStopped',
];

describe('V2 BoardState autonomy shape', () => {
  it('is status + concurrency, never the V1 flag set', () => {
    const state = emptyState();
    assert.equal(state.status, 'created');
    assert.equal(typeof state.concurrency, 'number');
    assert.equal(state.concurrency, 1);
    assert.equal(DEFAULT_BOARD_CONCURRENCY, 2);

    for (const key of V1_AUTONOMY_FIELDS) {
      assert.equal(Object.hasOwn(state, key), false, key);
    }

    const json = /** @type {Record<string, unknown>} */ (stateToJSON(state));
    for (const key of V1_AUTONOMY_FIELDS) {
      assert.equal(Object.hasOwn(json, key), false, `json.${key}`);
    }
    assert.ok(['created', 'running', 'stopped'].includes(String(json.status)));
    assert.equal(typeof json.concurrency, 'number');
  });

  it('does not declare the V1 flags on BoardState in types.d.ts', () => {
    const src = fs.readFileSync(
      path.join(ROOT, 'server', 'orchestrator', 'core', 'types.d.ts'),
      'utf8',
    );
    const start = src.indexOf('export interface BoardState');
    assert.ok(start >= 0);
    const next = src.indexOf('export interface', start + 'export interface BoardState'.length);
    const body = src.slice(start, next === -1 ? undefined : next).replace(/\/\*\*[\s\S]*?\*\//g, '');
    for (const key of V1_AUTONOMY_FIELDS) {
      assert.equal(new RegExp(`\\b${key}\\s*:`).test(body), false, `BoardState still declares ${key}`);
    }
    assert.match(body, /status:\s*BoardStatus/);
    assert.match(body, /concurrency:\s*number/);
  });

  it('V2 board UI has no V1 autonomy toggles', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'orchestrator', 'boards-view.ts'), 'utf8');
    // The file header names the deleted fields on purpose. Live controls must not.
    const withoutHeader = src.replace(/\/\*\*[\s\S]*?\*\//, '');
    assert.equal(withoutHeader.includes('handsOff'), false);
    assert.equal(withoutHeader.includes('pendingAfk'), false);
    assert.equal(withoutHeader.includes('autoRunning'), false);
    assert.equal(withoutHeader.includes('systemPaused'), false);
    assert.equal(withoutHeader.includes('userStopped'), false);
    assert.equal(withoutHeader.includes('executionMode'), false);
    assert.match(src, /Running/);
    assert.match(src, /Stopped/);
  });
});
