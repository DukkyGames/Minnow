/**
 * Minnow Scheduler app registration, routing, and workspace shell.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { APPS, getAppById, isAppId } from '../../src/os/app-registry.ts';
import { resetAppHostForTests } from '../../src/os/app-host.ts';
import {
  getForegroundAppId,
  getOsView,
  resetInstancesForTests,
} from '../../src/os/instances.ts';
import { resetOsPageBridgeForTests } from '../../src/os/page-bridge.ts';
import {
  initOsRouter,
  launchApp,
  parseOsHash,
  resetOsRouterForTests,
  resolveLegacyHash,
  syncOsRouteFromHashForTests,
} from '../../src/os/router.ts';
import { SCHEDULER_EDITOR_INSTANCE_ID } from '../../src/os/scheduler-constants.ts';
import {
  initSchedulerSidePanel,
  isSchedulerSidePanelOpen,
  resetSchedulerSidePanelForTests,
} from '../../src/os/scheduler-side-panel.ts';
import {
  resetWindowManagerForTests,
  windowManager,
} from '../../src/os/window-manager.ts';
import { teardownHappyDomAsync } from '../os/dom-helpers.mts';

function setupSchedulerDom(win: import('happy-dom').Window): void {
  win.document.body.innerHTML = `
    <div id="osStage" class="mn-os-stage" style="width:1200px;height:800px;position:relative">
      <div id="osAppsLayer" class="mn-os-apps-layer"></div>
      <div id="osDesktopLayer" class="mn-os-desktop-layer"></div>
      <div id="osWindowsLayer" class="mn-os-windows-layer"></div>
      <div id="osSidePanelsLayer" class="mn-os-side-panels-layer"></div>
    </div>
    <main id="schedulerView" class="scheduler-page">
      <div id="schedulerPanelMount"></div>
    </main>
  `;
}

describe('scheduler app registry', () => {
  test('scheduler is a registered launcher app', () => {
    assert.ok(APPS.some((app) => app.id === 'scheduler'));
    const scheduler = getAppById('scheduler');
    assert.ok(scheduler);
    assert.match(scheduler.tag, /recurring/i);
  });

  test('isAppId accepts scheduler', () => {
    assert.equal(isAppId('scheduler'), true);
  });
});

describe('scheduler router', () => {
  test('legacy #/scheduler redirects to #/app/scheduler', () => {
    const legacy = resolveLegacyHash('#/scheduler');
    assert.equal(legacy.hash, '#/app/scheduler');
  });

  test('parseOsHash resolves scheduler app route', () => {
    const route = parseOsHash('#/app/scheduler');
    assert.equal(route.view, 'app');
    assert.equal(route.appId, 'scheduler');
  });
});

describe('scheduler markup contract', () => {
  test('index.html defines schedulerView shell', () => {
    const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    assert.match(html, /id="schedulerView"/);
    assert.match(html, /id="schedulerPanelMount"/);
  });
});

describe('scheduler workspace shell', () => {
  let happyDomWindow: import('happy-dom').Window | undefined;
  let fetchMock: typeof globalThis.fetch;

  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    happyDomWindow = win;
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
    setupSchedulerDom(win);
    win.location.hash = '#/desktop';
    resetInstancesForTests();
    resetOsRouterForTests();
    resetAppHostForTests();
    resetWindowManagerForTests();
    resetOsPageBridgeForTests();
    resetSchedulerSidePanelForTests();
    initOsRouter();
    initSchedulerSidePanel();
    fetchMock = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/scheduler/jobs')) {
        return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
      }
      if (url.includes('/api/scheduler/runs')) {
        return new Response(JSON.stringify({ runs: [] }), { status: 200 });
      }
      if (url.includes('/api/scheduler/default-workspace')) {
        return new Response(JSON.stringify({ path: '/tmp' }), { status: 200 });
      }
      return fetchMock(input);
    };
  });

  afterEach(async () => {
    globalThis.fetch = fetchMock;
    resetSchedulerSidePanelForTests();
    resetInstancesForTests();
    resetOsRouterForTests();
    resetAppHostForTests();
    resetWindowManagerForTests();
    resetOsPageBridgeForTests();
    if (happyDomWindow) {
      await teardownHappyDomAsync(happyDomWindow);
      happyDomWindow = undefined;
    }
  });

  test('launchApp(scheduler) foregrounds scheduler in app view', () => {
    launchApp('scheduler');
    syncOsRouteFromHashForTests();
    assert.equal(getForegroundAppId(), 'scheduler');
    assert.equal(getOsView(), 'app');
    assert.equal(isSchedulerSidePanelOpen(), false);
  });

  test('hash route #/app/scheduler foregrounds scheduler in app view', () => {
    window.location.hash = '#/app/scheduler';
    syncOsRouteFromHashForTests();
    assert.equal(getForegroundAppId(), 'scheduler');
    assert.equal(getOsView(), 'app');
  });

  test('scheduler job editor opens as auxiliary window', () => {
    windowManager.ensureLayer();
    const windowId = windowManager.open('scheduler', {
      instanceId: SCHEDULER_EDITOR_INSTANCE_ID,
      title: 'Add scheduled job',
      bounds: { x: 100, y: 80, width: 480, height: 560 },
      persistBounds: false,
      manageInstance: false,
    });
    assert.ok(windowId);
    const record = windowManager.getWindows().find((w) => w.id === windowId);
    assert.ok(record);
    assert.equal(record?.instanceId, SCHEDULER_EDITOR_INSTANCE_ID);
    assert.equal(record?.manageInstance, false);
    assert.equal(record?.persistBounds, false);
    assert.equal(record?.bounds.width, 480);
    assert.equal(record?.bounds.height, 560);
    windowManager.close(windowId);
    assert.equal(getForegroundAppId(), null);
  });
});
