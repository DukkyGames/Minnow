/**
 * Close-vs-hide lifecycle decisions for the Electron shell.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  shouldHideMainWindowOnClose,
  shouldKeepAppAliveWhenAllWindowsClosed,
} from '../../electron/close-behavior.ts';

describe('shouldHideMainWindowOnClose', () => {
  test('hides when close-to-tray is on and quit is not explicit', () => {
    assert.equal(shouldHideMainWindowOnClose({ closeToTray: true, explicitQuit: false }), true);
  });

  test('quits normally when close-to-tray is off', () => {
    assert.equal(shouldHideMainWindowOnClose({ closeToTray: false, explicitQuit: false }), false);
  });

  test('explicit quit bypasses hide-to-tray', () => {
    assert.equal(shouldHideMainWindowOnClose({ closeToTray: true, explicitQuit: true }), false);
  });
});

describe('shouldKeepAppAliveWhenAllWindowsClosed', () => {
  test('macOS stays alive by default', () => {
    assert.equal(
      shouldKeepAppAliveWhenAllWindowsClosed({
        closeToTray: false,
        platform: 'darwin',
        explicitQuit: false,
      }),
      true,
    );
  });

  test('Windows quits when close-to-tray is off', () => {
    assert.equal(
      shouldKeepAppAliveWhenAllWindowsClosed({
        closeToTray: false,
        platform: 'win32',
        explicitQuit: false,
      }),
      false,
    );
  });

  test('Windows stays alive when close-to-tray is on', () => {
    assert.equal(
      shouldKeepAppAliveWhenAllWindowsClosed({
        closeToTray: true,
        platform: 'win32',
        explicitQuit: false,
      }),
      true,
    );
  });

  test('explicit quit always allows process exit', () => {
    assert.equal(
      shouldKeepAppAliveWhenAllWindowsClosed({
        closeToTray: true,
        platform: 'win32',
        explicitQuit: true,
      }),
      false,
    );
  });
});
