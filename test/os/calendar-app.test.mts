/**
 * MinnowOS Calendar app registration, window shell, and markup contract.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  APPS,
  getAppById,
  getPresentationMode,
  isAppId,
} from '../../src/os/app-registry.ts';
import { CALENDAR_EVENT_EDITOR_INSTANCE_ID } from '../../src/os/calendar-constants.ts';
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
import {
  initOsRouter,
  launchApp,
  parseOsHash,
  resetOsRouterForTests,
  resolveLegacyHash,
} from '../../src/os/router.ts';
import {
  resetWindowManagerForTests,
  windowManager,
} from '../../src/os/window-manager.ts';
import {
  openEventEditorWindow,
  resetEventEditorWindowForTests,
} from '../../src/ui/calendar/event-editor-window.ts';

function setupCalendarDom(win: import('happy-dom').Window): void {
  win.document.body.innerHTML = `
    <div id="osStage" class="mn-os-stage" style="width:1200px;height:800px;position:relative">
      <div id="osAppsLayer" class="mn-os-apps-layer"></div>
      <div id="osWindowsLayer" class="mn-os-windows-layer"></div>
    </div>
    <main id="calendarView" class="calendar-page mn-os-app-layer" data-os-app="calendar">
      <header class="calendar-hdr">
        <span id="calendarPageIcon"></span>
        <div class="calendar-hdr-txt"><h2>Calendar</h2></div>
      </header>
      <div id="calendarAppBody" class="calendar-body">
        <p id="calendarStatus" class="calendar-status"></p>
        <div id="calendarPanelMount" class="calendar-panel-mount"></div>
      </div>
    </main>
  `;
}

/** Mark calendar open without importing calendar-page (avoids CSS in node tests). */
function markCalendarOpen(): void {
  document.getElementById('calendarView')?.classList.add('is-open');
}

describe('calendar app registry', () => {
  test('calendar is a registered launcher app', () => {
    assert.ok(APPS.some((app) => app.id === 'calendar'));
    const calendar = getAppById('calendar');
    assert.ok(calendar);
    assert.match(calendar.tag, /CalDAV|ICS/i);
  });

  test('calendar uses window presentation mode', () => {
    assert.equal(getPresentationMode('calendar'), 'window');
  });

  test('isAppId accepts calendar', () => {
    assert.equal(isAppId('calendar'), true);
  });
});

describe('calendar router', () => {
  test('legacy #/calendar redirects to #/app/calendar', () => {
    const legacy = resolveLegacyHash('#/calendar');
    assert.equal(legacy.hash, '#/app/calendar');
  });

  test('parseOsHash resolves calendar app route', () => {
    const route = parseOsHash('#/app/calendar');
    assert.equal(route.view, 'app');
    assert.equal(route.appId, 'calendar');
  });
});

describe('calendar markup contract', () => {
  test('index.html defines calendarView shell', () => {
    const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    assert.match(html, /id="calendarView"/);
    assert.match(html, /id="calendarPanelMount"/);
    assert.match(html, /id="calendarStatus"/);
  });
});

describe('calendar window shell', () => {
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
    setupCalendarDom(win);
    resetWindowManagerForTests();
    resetInstancesForTests();
    resetOsRouterForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
    resetEventEditorWindowForTests();
    initOsPageBridge();
    initAppHost();
  });

  afterEach(() => {
    resetWindowManagerForTests();
    resetInstancesForTests();
    resetOsRouterForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
    resetEventEditorWindowForTests();
  });

  test('launchInstance(calendar) mounts content in a floating window', async () => {
    markCalendarOpen();
    launchInstance('calendar');
    syncAppHostForTests();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snap = getInstanceSnapshot();
    assert.equal(snap.view, 'desktop');
    assert.ok(snap.foregroundId);
    assert.equal(snap.instances.some((i) => i.appId === 'calendar'), true);

    const osWin = windowManager.findWindowByInstance(snap.foregroundId!);
    assert.ok(osWin);
    assert.equal(osWin.appId, 'calendar');
    assert.equal(osWin.bounds.width, 960);
    assert.equal(osWin.bounds.height, 640);

    const stage = document.getElementById('osStage');
    assert.equal(stage?.classList.contains('is-in-app-fullscreen'), false);

    const content = document.getElementById('calendarView');
    assert.ok(content?.classList.contains('is-open'));
    const frameBody = windowManager.getBodyForInstance(snap.foregroundId!);
    assert.equal(content?.parentElement, frameBody);
  });

  test('launchApp(calendar) focuses an existing calendar window', async () => {
    initOsRouter();
    markCalendarOpen();
    launchApp('calendar');
    syncAppHostForTests();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const firstId = windowManager.getWindows()[0]?.id;
    assert.ok(firstId);

    launchApp('calendar');
    syncAppHostForTests();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(windowManager.getWindows().length, 1);
    assert.equal(windowManager.getFocusedWindowId(), firstId);
  });

  test('openEventEditorWindow opens a child editor window', async () => {
    markCalendarOpen();
    launchInstance('calendar');
    syncAppHostForTests();
    await new Promise((resolve) => setTimeout(resolve, 0));

    openEventEditorWindow({ event: null, calendars: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const windows = windowManager.getWindows();
    assert.equal(windows.length, 2);
    const editor = windows.find((w) => w.instanceId === CALENDAR_EVENT_EDITOR_INSTANCE_ID);
    assert.ok(editor);
    assert.equal(editor.manageInstance, false);
    assert.equal(editor.title, 'New event');
  });
});
