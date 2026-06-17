import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  initAppHost,
  resetAppHostForTests,
  syncAppHostForTests,
} from '../../src/os/app-host.ts';
import {
  closeInstance,
  focusInstance,
  getInstanceSnapshot,
  launchInstance,
  resetInstancesForTests,
} from '../../src/os/instances.ts';
import { initOsPageBridge, resetOsPageBridgeForTests } from '../../src/os/page-bridge.ts';
import { resetOsRouterForTests } from '../../src/os/router.ts';
import { renderMiniPreviews } from '../../src/os/mini-previews.ts';
import { loadDesktopPrefs } from '../../src/os/desktop-prefs.ts';
import {
  requestCloseWindowApp,
  WINDOW_MOUNTED_APPS,
} from '../../src/os/window-mounted-apps.ts';
import {
  resetWindowManagerForTests,
  windowManager,
} from '../../src/os/window-manager.ts';

const WINDOW_APPS = ['settings', 'models', 'brain', 'bench', 'compare', 'calendar'] as const;

const CONTENT_BY_APP: Record<(typeof WINDOW_APPS)[number], string> = {
  settings: 'settingsView',
  models: 'modelsView',
  brain: 'brainView',
  bench: 'benchmarkView',
  compare: 'compareView',
  calendar: 'calendarView',
};

function setupWindowAppsDom(win: import('happy-dom').Window): void {
  win.document.body.innerHTML = `
    <header class="topbar"></header>
    <div id="osStage" class="mn-os-stage" style="width:1200px;height:800px;position:relative">
      <div id="osAppsLayer" class="mn-os-apps-layer"></div>
      <div id="osWindowsLayer" class="mn-os-windows-layer"></div>
    </div>
    <div id="appBody"></div>
    <main id="settingsView" class="settings-page mn-os-app-layer" data-os-app="settings"></main>
    <main id="modelsView" class="models-page mn-os-app-layer" data-os-app="models"></main>
    <main id="brainView" class="brain-page mn-os-app-layer" data-os-app="brain"></main>
    <main id="benchmarkView" class="benchmark-page mn-os-app-layer" data-os-app="bench"></main>
    <main id="compareView" class="compare-page mn-os-app-layer" data-os-app="compare"></main>
    <main id="calendarView" class="calendar-page mn-os-app-layer" data-os-app="calendar"></main>
  `;
}

/** Mark page layer open without importing full page modules (avoids CSS in node tests). */
function markWindowAppOpen(appId: (typeof WINDOW_APPS)[number]): void {
  document.getElementById(CONTENT_BY_APP[appId])?.classList.add('is-open');
}

describe('window-mounted apps', () => {
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
    win.localStorage.clear();
    win.location.hash = '#/desktop';
    setupWindowAppsDom(win);
    resetWindowManagerForTests();
    resetInstancesForTests();
    resetOsRouterForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
    initOsPageBridge();
    initAppHost();
  });

  afterEach(() => {
    resetWindowManagerForTests();
    resetInstancesForTests();
    resetOsRouterForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
  });

  for (const appId of WINDOW_APPS) {
    test(`launchInstance(${appId}) mounts content in a floating window`, async () => {
      markWindowAppOpen(appId);
      launchInstance(appId);
      syncAppHostForTests();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const snap = getInstanceSnapshot();
      assert.equal(snap.view, 'desktop');
      assert.ok(snap.foregroundId);
      assert.equal(snap.instances.some((i) => i.appId === appId), true);

      const osWin = windowManager.findWindowByInstance(snap.foregroundId!);
      assert.ok(osWin, `expected window for ${appId}`);
      assert.equal(osWin.appId, appId);

      const stage = document.getElementById('osStage');
      assert.equal(stage?.classList.contains('is-in-app-fullscreen'), false);

      const content = document.getElementById(CONTENT_BY_APP[appId]);
      assert.ok(content?.classList.contains('is-open'), `${appId} content should be open`);
      const frameBody = windowManager.getBodyForInstance(snap.foregroundId!);
      assert.equal(content?.parentElement, frameBody);
    });
  }

  test('requestCloseWindowApp closes the foreground instance', async () => {
    markWindowAppOpen('models');
    launchInstance('models');
    syncAppHostForTests();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.ok(getInstanceSnapshot().foregroundId);
    assert.equal(requestCloseWindowApp('models'), true);
    syncAppHostForTests();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snap = getInstanceSnapshot();
    assert.equal(snap.instances.some((i) => i.appId === 'models'), false);
    assert.equal(windowManager.getWindows().length, 0);
    assert.equal(document.getElementById('modelsView')?.classList.contains('is-open'), false);
  });

  test('minimize stays minimized after app-host sync', async () => {
    markWindowAppOpen('settings');
    const instanceId = launchInstance('settings');
    syncAppHostForTests();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const win = windowManager.findWindowByInstance(instanceId);
    assert.ok(win);
    windowManager.minimize(win.id, true);
    syncAppHostForTests();

    assert.equal(windowManager.getWindows()[0]?.minimized, true);
    assert.equal(
      windowManager.getFrame(win.id)?.root.classList.contains('is-minimized'),
      true,
    );
  });

  test('re-launch restores minimized window-mounted app', async () => {
    markWindowAppOpen('settings');
    const instanceId = launchInstance('settings');
    syncAppHostForTests();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const win = windowManager.findWindowByInstance(instanceId);
    assert.ok(win);
    windowManager.minimize(win.id, true);
    syncAppHostForTests();
    assert.equal(windowManager.getWindows()[0]?.minimized, true);

    launchInstance('settings');
    syncAppHostForTests();
    assert.equal(windowManager.getWindows()[0]?.minimized, false);
  });

  test('mini-previews show window-mounted apps only when minimized', () => {
    const mount = document.createElement('div');
    const prefs = loadDesktopPrefs();

    markWindowAppOpen('settings');
    const instanceId = launchInstance('settings');
    syncAppHostForTests();

    renderMiniPreviews(mount, getInstanceSnapshot(), prefs, () => {}, () => {});
    assert.doesNotMatch(mount.textContent ?? '', /Settings/i);

    const win = windowManager.findWindowByInstance(instanceId);
    assert.ok(win);
    windowManager.minimize(win.id, true);

    mount.replaceChildren();
    renderMiniPreviews(mount, getInstanceSnapshot(), prefs, () => {}, () => {});
    const text = mount.textContent ?? '';
    assert.match(text, /Settings/i);
    assert.match(text, /RUNNING · 1/);
  });

  test('WINDOW_MOUNTED_APPS includes all window presentation apps', () => {
    for (const appId of WINDOW_APPS) {
      assert.equal(WINDOW_MOUNTED_APPS.has(appId), true);
    }
  });

  test('closing a window app does not foreground background Code', async () => {
    launchInstance('code');
    assert.equal(getInstanceSnapshot().view, 'app');

    markWindowAppOpen('settings');
    launchInstance('settings');
    syncAppHostForTests();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const settingsId = getInstanceSnapshot().foregroundId;
    assert.ok(settingsId);
    assert.equal(closeInstance(settingsId!), true);
    syncAppHostForTests();

    const snap = getInstanceSnapshot();
    assert.equal(snap.view, 'desktop');
    assert.equal(snap.foregroundId, null);
    assert.equal(snap.instances.some((i) => i.appId === 'code'), true);

    const codeLayer = document.getElementById('osAppLayer-code');
    assert.equal(codeLayer?.classList.contains('is-active'), false);
    const stage = document.getElementById('osStage');
    assert.equal(stage?.classList.contains('is-in-app-fullscreen'), false);
  });

  test('sync keeps foreground window when multiple window apps are open', async () => {
    markWindowAppOpen('settings');
    const settingsId = launchInstance('settings');
    markWindowAppOpen('models');
    launchInstance('models');
    syncAppHostForTests();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const settingsWin = windowManager.findWindowByInstance(settingsId);
    assert.ok(settingsWin);
    windowManager.focus(settingsWin.id);
    focusInstance(settingsId);
    assert.equal(windowManager.getFocusedWindowId(), settingsWin.id);

    syncAppHostForTests();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(windowManager.getFocusedWindowId(), settingsWin.id);
  });
});
