import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { normalizeLaunchAtStartup } from '../../electron/login-item-normalize.ts';

describe('normalizeLaunchAtStartup', () => {
  test('only literal true is enabled', () => {
    assert.equal(normalizeLaunchAtStartup(true), true);
    assert.equal(normalizeLaunchAtStartup(false), false);
    assert.equal(normalizeLaunchAtStartup(1), false);
    assert.equal(normalizeLaunchAtStartup('true'), false);
    assert.equal(normalizeLaunchAtStartup(null), false);
  });
});
