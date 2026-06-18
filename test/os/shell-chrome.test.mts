import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { initDockLauncher } from '../../src/os/dock-launcher.ts';
import {
  launchInstance,
  resetInstancesForTests,
} from '../../src/os/instances.ts';
import {
  initOsPageBridge,
  resetOsPageBridgeForTests,
} from '../../src/os/page-bridge.ts';
import { shouldSuppressDesktopChrome } from '../../src/os/shell-chrome.ts';
import { resetWindowManagerForTests, windowManager } from '../../src/os/window-manager.ts';

describe('shell chrome suppression', () => {
  let dockCleanup: (() => void) | undefined;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      HTMLElement: typeof HTMLElement;
      localStorage: Storage;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.HTMLElement = win.HTMLElement;
    g.localStorage = win.localStorage;
    win.document.body.innerHTML = `
      <div id="osStage" class="mn-os-stage"></div>
      <div id="osDesktopLayer"></div>
      <div id="osDockLayer"></div>
      <div id="osWindowsLayer"></div>
    `;
    resetInstancesForTests();
    resetWindowManagerForTests();
    resetOsPageBridgeForTests();
    initOsPageBridge();
    dockCleanup = initDockLauncher(document.getElementById('osDockLayer')!);
  });

  afterEach(() => {
    dockCleanup?.();
    dockCleanup = undefined;
    resetInstancesForTests();
    resetWindowManagerForTests();
    resetOsPageBridgeForTests();
  });

  test('suppresses chrome for fullscreen presentation apps', () => {
    launchInstance('code');

    assert.equal(shouldSuppressDesktopChrome(), true);
    assert.equal(
      document.getElementById('osDesktopLayer')?.classList.contains('is-suppressed-by-fullscreen-app'),
      true,
    );
    assert.equal(document.querySelector('.mn-os-dock-shell')?.hasAttribute('hidden'), true);
  });

  test('suppresses chrome when a window is maximized', () => {
    launchInstance('brain');
    const windowId = windowManager.open('brain', { instanceId: 'inst-1' });
    windowManager.toggleMaximize(windowId);

    assert.equal(shouldSuppressDesktopChrome(), true);
    assert.equal(document.querySelector('.mn-os-dock-shell')?.hasAttribute('hidden'), true);
  });

  test('restores chrome on desktop with a restored window', () => {
    launchInstance('brain');
    const windowId = windowManager.open('brain', { instanceId: 'inst-1' });
    windowManager.toggleMaximize(windowId);
    assert.equal(shouldSuppressDesktopChrome(), true);

    windowManager.toggleMaximize(windowId);

    assert.equal(shouldSuppressDesktopChrome(), false);
    assert.equal(document.querySelector('.mn-os-dock-shell')?.hasAttribute('hidden'), false);
  });
});
