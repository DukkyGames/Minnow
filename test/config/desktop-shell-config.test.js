import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mergeConfigMeta } from '../../server/config/validators.js';

describe('desktopShell config', () => {
  test('defaults closeToTray to true when missing', () => {
    const merged = mergeConfigMeta({}, {});
    assert.equal(merged.desktopShell?.closeToTray, undefined);
    const patched = mergeConfigMeta(merged, { desktopShell: {} });
    assert.equal(patched.desktopShell.closeToTray, true);
  });

  test('persists explicit closeToTray false', () => {
    const merged = mergeConfigMeta({}, { desktopShell: { closeToTray: false } });
    assert.equal(merged.desktopShell.closeToTray, false);
  });

  test('rejects non-boolean closeToTray values', () => {
    const merged = mergeConfigMeta({ desktopShell: { closeToTray: true } }, {
      desktopShell: { closeToTray: 'no' },
    });
    assert.equal(merged.desktopShell.closeToTray, true);
  });
});
