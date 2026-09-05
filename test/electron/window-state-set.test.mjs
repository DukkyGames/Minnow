import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { parseWindowSet } from '../../electron/window-state-schema.ts';

describe('window-state v1 → v2', () => {
  test('reads a v1 blob as one unnamed window, keeping its geometry', () => {
    const set = parseWindowSet({ width: 1600, height: 900, x: 40, y: 20, isMaximized: true });
    assert.equal(set.version, 2);
    assert.equal(set.windows.length, 1);
    assert.deepEqual(set.windows[0], {
      width: 1600,
      height: 900,
      x: 40,
      y: 20,
      isMaximized: true,
      workspacePath: '',
    });
  });

  test('round-trips a multi-window v2 set', () => {
    const raw = {
      version: 2,
      windows: [
        { width: 1280, height: 800, x: 0, y: 0, workspacePath: '/repo/a' },
        { width: 1000, height: 700, x: 100, y: 50, workspacePath: '/repo/b', isMaximized: true },
      ],
    };
    const set = parseWindowSet(raw);
    assert.equal(set.windows.length, 2);
    assert.equal(set.windows[0].workspacePath, '/repo/a');
    assert.equal(set.windows[1].workspacePath, '/repo/b');
    assert.equal(set.windows[1].isMaximized, true);
  });

  test('falls back to one default window for junk, empty sets, and nothing at all', () => {
    for (const raw of [null, undefined, 'nope', { version: 2, windows: [] }]) {
      const set = parseWindowSet(raw);
      assert.equal(set.version, 2);
      assert.equal(set.windows.length, 1);
      assert.equal(set.windows[0].width, 1280);
      assert.equal(set.windows[0].height, 800);
    }
  });

  test('repairs a window entry with unusable dimensions', () => {
    const set = parseWindowSet({
      version: 2,
      windows: [{ width: 'wide', height: 0, workspacePath: 42 }],
    });
    assert.equal(set.windows[0].width, 1280);
    assert.equal(set.windows[0].height, 800);
    assert.equal(set.windows[0].workspacePath, '');
  });
});
