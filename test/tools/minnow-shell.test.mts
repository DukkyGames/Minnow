import assert from 'node:assert/strict';
import { describe, test, afterEach } from 'node:test';
import {
  isElectronPreviewAvailable,
  isMinnowElectronShell,
  isPreviewAutomationReady,
} from '../../src/tools/minnow-shell.ts';

describe('minnow-shell', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
  });

  test('isMinnowElectronShell is false in a plain browser tab', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {},
      configurable: true,
      writable: true,
    });
    assert.equal(isMinnowElectronShell(), false);
    assert.equal(isElectronPreviewAvailable(), false);
  });

  test('isMinnowElectronShell is true when preload marked isElectron', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        minnow: {
          app: { isElectron: true, platform: 'linux', openExternal: async () => {} },
          preview: { show: async () => {} },
        },
      },
      configurable: true,
      writable: true,
    });
    assert.equal(isMinnowElectronShell(), true);
    assert.equal(isElectronPreviewAvailable(), true);
    assert.equal(isPreviewAutomationReady(), false);
  });

  test('isPreviewAutomationReady when automation IPC is present', () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        minnow: {
          app: { isElectron: true, platform: 'linux', openExternal: async () => {} },
          preview: {
            execJs: async () => {},
            navigateAndWait: async () => ({ ok: true, url: '', title: '' }),
            capturePage: async () => '',
          },
        },
      },
      configurable: true,
      writable: true,
    });
    assert.equal(isPreviewAutomationReady(), true);
  });
});
