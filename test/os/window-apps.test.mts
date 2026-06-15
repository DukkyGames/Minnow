import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  initAppHost,
  resetAppHostForTests,
  syncAppHostForTests,
} from '../../src/os/app-host.ts';
import {
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

const WINDOW_APPS = ['settings', 'models', 'bench', 'compare', 'experts', 'calendar'] as const;

const CONTENT_BY_APP: Record<(typeof WINDOW_APPS)[number], string> = {
  settings: 'settingsView',
  models: 'modelsView',
  bench: 'benchmarkView',
  compare: 'compareView',
  experts: 'expertsView',
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
    <main id="benchmarkView" class="benchmark-page mn-os-app-layer" data-os-app="bench"></main>
    <main id="compareView" class="compare-page mn-os-app-layer" data-os-app="compare"></main>
    <main id="expertsView" class="experts-page mn-os-app-layer" data-os-app="experts"></main>
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

  test('mini-previews skip window-mounted apps', () => {
    const mount = document.createElement('div');
    renderMiniPreviews(
      mount,
      {
        view: 'desktop',
        foregroundId: 'inst-code',
        instances: [
          { id: 'inst-settings', appId: 'settings', unread: 0, msg: '' },
          { id: 'inst-code', appId: 'code', unread: 0, msg: '' },
        ],
      },
      loadDesktopPrefs(),
      () => {},
      () => {},
    );

    const text = mount.textContent ?? '';
    assert.match(text, /Code/i);
    assert.doesNotMatch(text, /Settings/i);
  });

  test('WINDOW_MOUNTED_APPS includes all window presentation apps', () => {
    for (const appId of WINDOW_APPS) {
      assert.equal(WINDOW_MOUNTED_APPS.has(appId), true);
    }
  });
});
