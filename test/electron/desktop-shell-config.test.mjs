import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { normalizeDesktopShellConfig } from '../../server/config/validators.js';

describe('normalizeDesktopShellConfig', () => {
  test('defaults missing values to closeToTray true', () => {
    assert.deepEqual(normalizeDesktopShellConfig(null), { closeToTray: true });
    assert.deepEqual(normalizeDesktopShellConfig({}), { closeToTray: true });
    assert.deepEqual(normalizeDesktopShellConfig({ closeToTray: 'yes' }), { closeToTray: true });
  });

  test('preserves explicit false', () => {
    assert.deepEqual(normalizeDesktopShellConfig({ closeToTray: false }), { closeToTray: false });
  });
});
