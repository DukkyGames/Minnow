import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window as HappyWindow } from 'happy-dom';
import type { MinnowElectronBridge } from '../../src/electron.d.ts';
import { initNativeDialogFocusRecovery } from '../../src/ui/native-dialog-focus.ts';

function installWindowsElectronBridge(win: HappyWindow, restoreFocus: () => Promise<void>): void {
  (win as unknown as { minnow: MinnowElectronBridge }).minnow = {
    preview: {} as MinnowElectronBridge['preview'],
    app: {
      isElectron: true,
      platform: 'win32',
      openExternal: async () => {},
    },
    window: {
      minimize: async () => {},
      maximize: async () => {},
      close: async () => {},
      isMaximized: async () => false,
      restoreFocus,
      onMaximizedChanged: () => () => {},
    },
  };
}

describe('native dialog focus recovery', () => {
  test('restores Electron focus after alert, confirm, and prompt', () => {
    const win = new HappyWindow();
    let restoreCount = 0;
    const seenMessages: unknown[] = [];

    win.alert = (message?: unknown) => {
      seenMessages.push(message);
    };
    win.confirm = (message?: string) => {
      seenMessages.push(message);
      return true;
    };
    win.prompt = (message?: string, defaultValue?: string) => {
      seenMessages.push([message, defaultValue]);
      return 'entered value';
    };
    installWindowsElectronBridge(win, async () => {
      restoreCount += 1;
    });

    initNativeDialogFocusRecovery(win as unknown as Window);
    initNativeDialogFocusRecovery(win as unknown as Window);

    win.alert('Alert');
    assert.equal(win.confirm('Confirm'), true);
    assert.equal(win.prompt('Prompt', 'Default'), 'entered value');

    assert.deepEqual(seenMessages, ['Alert', 'Confirm', ['Prompt', 'Default']]);
    assert.equal(restoreCount, 3);
  });

  test('does not replace browser dialog functions without the Electron bridge', () => {
    const win = new HappyWindow();
    const nativeConfirm = win.confirm;

    initNativeDialogFocusRecovery(win as unknown as Window);

    assert.equal(win.confirm, nativeConfirm);
  });
});
