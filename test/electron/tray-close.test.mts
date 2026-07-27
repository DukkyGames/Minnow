import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  shouldHideWindowOnClose,
  shouldQuitOnWindowAllClosed,
} from '../../electron/tray-close.ts';

describe('shouldHideWindowOnClose', () => {
  test('hides when close-to-tray is enabled and quit is not in progress', () => {
    assert.equal(
      shouldHideWindowOnClose({
        closeToTrayEnabled: true,
        explicitQuit: false,
        quitInProgress: false,
      }),
      true,
    );
  });

  test('does not hide on explicit quit', () => {
    assert.equal(
      shouldHideWindowOnClose({
        closeToTrayEnabled: true,
        explicitQuit: true,
        quitInProgress: true,
      }),
      false,
    );
  });

  test('does not hide when preference is off', () => {
    assert.equal(
      shouldHideWindowOnClose({
        closeToTrayEnabled: false,
        explicitQuit: false,
        quitInProgress: false,
      }),
      false,
    );
  });
});

describe('shouldQuitOnWindowAllClosed', () => {
  test('skips auto-quit when close-to-tray keeps the process alive', () => {
    assert.equal(shouldQuitOnWindowAllClosed(true), false);
  });

  test('quits when close-to-tray is disabled', () => {
    assert.equal(shouldQuitOnWindowAllClosed(false), true);
  });
});
