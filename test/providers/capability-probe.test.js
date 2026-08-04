/**
 * capability-probe unit tests (no HTTP — integration lives in capability-probe-server.test.js).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prioritizeModelIds } from '../../server/providers/capability-probe.js';

describe('prioritizeModelIds', () => {
  it('orders selected, loaded, then alphabetical and caps at 8', () => {
    const ids = [
      'm-h',
      'm-b',
      'm-a',
      'm-c',
      'm-d',
      'm-e',
      'm-f',
      'm-g',
      'm-i',
      'm-selected',
    ];
    const catalog = [
      { id: 'm-b', state: 'loaded' },
      { id: 'm-a', state: 'not loaded' },
    ];
    const out = prioritizeModelIds(ids, 'm-selected', catalog);
    assert.equal(out[0], 'm-selected');
    assert.equal(out[1], 'm-b');
    assert.equal(out.length, 8);
    assert.ok(out.includes('m-a'));
  });
});
