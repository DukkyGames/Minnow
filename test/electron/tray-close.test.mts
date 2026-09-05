import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  decideWindowClose,
  normalizeWindowCloseAction,
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

describe('shouldHideWindowOnClose forceClose', () => {
  test('never hides a window something already decided to close', () => {
    assert.equal(
      shouldHideWindowOnClose({
        closeToTrayEnabled: true,
        explicitQuit: false,
        quitInProgress: false,
        forceClose: true,
      }),
      false,
    );
  });
});

describe('decideWindowClose', () => {
  const base = {
    closeToTrayEnabled: true,
    explicitQuit: false,
    quitInProgress: false,
    forceClose: false,
  };

  test('backgrounds the last window without asking — that is close-to-tray', () => {
    assert.equal(
      decideWindowClose({ ...base, openWindowCount: 1, preference: 'ask' }),
      'background',
    );
  });

  test('asks when one of several windows closes', () => {
    assert.equal(
      decideWindowClose({ ...base, openWindowCount: 2, preference: 'ask' }),
      'prompt',
    );
  });

  test('honours a remembered answer instead of asking again', () => {
    assert.equal(
      decideWindowClose({ ...base, openWindowCount: 3, preference: 'close' }),
      'close',
    );
    assert.equal(
      decideWindowClose({ ...base, openWindowCount: 3, preference: 'background' }),
      'background',
    );
  });

  test('never asks during a quit, an explicit close, or with close-to-tray off', () => {
    assert.equal(
      decideWindowClose({ ...base, quitInProgress: true, openWindowCount: 4, preference: 'ask' }),
      'close',
    );
    assert.equal(
      decideWindowClose({ ...base, forceClose: true, openWindowCount: 4, preference: 'ask' }),
      'close',
    );
    assert.equal(
      decideWindowClose({
        ...base,
        closeToTrayEnabled: false,
        openWindowCount: 4,
        preference: 'ask',
      }),
      'close',
    );
  });
});

describe('normalizeWindowCloseAction', () => {
  test('keeps the three known answers and falls back to asking', () => {
    assert.equal(normalizeWindowCloseAction('close'), 'close');
    assert.equal(normalizeWindowCloseAction('background'), 'background');
    assert.equal(normalizeWindowCloseAction('ask'), 'ask');
    for (const junk of [undefined, null, '', 'nope', 7, {}]) {
      assert.equal(normalizeWindowCloseAction(junk), 'ask');
    }
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
