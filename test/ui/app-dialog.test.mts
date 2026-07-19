import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { MinnowElectronBridge } from '../../src/electron.d.ts';
import { resetChromePopoverRegistryForTests } from '../../src/ui/preview-electron-visibility.ts';

describe('app dialog', () => {
  let win: import('happy-dom').Window;
  const prevDocument = globalThis.document;
  const prevWindow = globalThis.window;
  const prevRaf = globalThis.requestAnimationFrame;

  beforeEach(async () => {
    resetChromePopoverRegistryForTests();
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    }) as typeof requestAnimationFrame;

    const { Window } = await import('happy-dom');
    win = new Window();
    (globalThis as { document: Document }).document = win.document as unknown as Document;
    (globalThis as { window: Window }).window = win as unknown as Window & typeof globalThis.window;

    (win as unknown as { minnow: MinnowElectronBridge }).minnow = {
      preview: {
        show: async () => {},
        hide: async () => {},
      } as MinnowElectronBridge['preview'],
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
        onMaximizedChanged: () => () => {},
      },
    };

    const { resetAppDialogForTests } = await import('../../src/ui/app-dialog.ts');
    resetAppDialogForTests();
  });

  afterEach(async () => {
    resetChromePopoverRegistryForTests();
    const { resetAppDialogForTests } = await import('../../src/ui/app-dialog.ts');
    resetAppDialogForTests();
    globalThis.requestAnimationFrame = prevRaf;
    (globalThis as { document: Document }).document = prevDocument;
    (globalThis as { window: Window }).window = prevWindow;
  });

  test('installAppDialogs replaces native dialog functions in Electron', async () => {
    win.alert = () => {};
    win.confirm = () => true;
    win.prompt = () => null;
    const nativeConfirm = win.confirm;
    const { installAppDialogs } = await import('../../src/ui/app-dialog.ts');
    installAppDialogs(win as unknown as Window);
    assert.notEqual(win.confirm, nativeConfirm);
  });

  test('appConfirm resolves true when confirmed', async () => {
    const { appConfirm, isAppDialogOpen } = await import('../../src/ui/app-dialog.ts');
    const resultPromise = appConfirm('Delete branch?');
    await Promise.resolve();

    assert.equal(isAppDialogOpen(), true);
    const confirmBtn = win.document.querySelector<HTMLButtonElement>(
      '[data-dialog-action="confirm"]',
    );
    assert.ok(confirmBtn);
    confirmBtn.click();

    assert.equal(await resultPromise, true);
    assert.equal(isAppDialogOpen(), false);
  });

  test('appConfirm resolves false when cancelled', async () => {
    const { appConfirm } = await import('../../src/ui/app-dialog.ts');
    const resultPromise = appConfirm('Discard changes?');
    await Promise.resolve();

    const cancelBtn = win.document.querySelector<HTMLButtonElement>(
      '[data-dialog-action="cancel"]',
    );
    assert.ok(cancelBtn);
    cancelBtn.click();

    assert.equal(await resultPromise, false);
  });
});
