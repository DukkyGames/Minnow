/**
 * Minnow Calendar app registration, window shell, and markup contract.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  APPS,
  getAppById,
  isAppId,
} from '../../src/os/app-registry.ts';
import {
  initAppHost,
  resetAppHostForTests,
  syncAppHostForTests,
} from '../../src/os/app-host.ts';
import { installHappyDomGlobals } from './dom-helpers.mts';
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
  openEventEditorWindow,
  resetEventEditorWindowForTests,
} from '../../src/ui/calendar/event-editor-overlay.ts';

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

  test('isAppId accepts calendar', () => {
    assert.equal(isAppId('calendar'), true);
  });
});

describe('calendar router', () => {
  test('legacy #/calendar redirects to workspaces while Calendar app is release-hidden', () => {
    const legacy = resolveLegacyHash('#/calendar');
    assert.equal(legacy.hash, '#/workspaces');
  });

  test('parseOsHash resolves calendar app route', () => {
    const route = parseOsHash('#/app/calendar');
    assert.equal(route.view, 'app');
    assert.equal(route.appId, 'calendar');
  });
});

describe('calendar CalDAV UI', () => {
  test('calendar panel exposes CalDAV account setup in the rail', () => {
    const source = fs.readFileSync(
      new URL('../../src/ui/calendar/calendar-panel.ts', import.meta.url),
      'utf8',
    );
    assert.match(source, /CalDAV accounts/);
    assert.doesNotMatch(source, /mountOAuthConnectPanel/);
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
    win.location.href = 'http://127.0.0.1/#/workspaces';
    const calendarFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('/api/calendar/calendars')) {
        return Response.json({ calendars: [] });
      }
      if (url.includes('/api/calendar/events')) {
        return Response.json({ events: [] });
      }
      if (url.includes('/api/calendar/caldav')) {
        return Response.json({ accounts: [] });
      }
      return Response.json({});
    };
    installHappyDomGlobals(win, { fetch: calendarFetch });
    setupCalendarDom(win);
    resetInstancesForTests();
    resetOsRouterForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
    resetEventEditorWindowForTests();
    initOsPageBridge();
    initAppHost();
  });

  afterEach(() => {
    resetInstancesForTests();
    resetOsRouterForTests();
    resetOsPageBridgeForTests();
    resetAppHostForTests();
    resetEventEditorWindowForTests();
  });

  test('launchInstance(calendar) mounts content in the apps layer', async () => {
    markCalendarOpen();
    launchInstance('calendar');
    syncAppHostForTests();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snap = getInstanceSnapshot();
    assert.equal(snap.view, 'app');
    assert.ok(snap.foregroundId);
    assert.equal(snap.instances.some((i) => i.appId === 'calendar'), true);

    const stage = document.getElementById('osStage');
    assert.equal(stage?.classList.contains('is-in-app-fullscreen'), true);

    const content = document.getElementById('calendarView');
    assert.ok(content?.classList.contains('is-open'));
    assert.equal(content?.parentElement?.id, 'osAppsLayer');
  });

  test('launchApp(calendar) blocks hidden app and returns to workspaces', async () => {
    initOsRouter();
    markCalendarOpen();
    launchInstance('calendar');
    syncAppHostForTests();
    await new Promise((resolve) => setTimeout(resolve, 0));

    launchApp('calendar');
    syncAppHostForTests();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(window.location.hash, '#/workspaces');
    assert.equal(getInstanceSnapshot().view, 'workspaces');
  });

  test('openEventEditorWindow opens an in-app overlay', async () => {
    markCalendarOpen();
    launchInstance('calendar');
    syncAppHostForTests();
    await new Promise((resolve) => setTimeout(resolve, 0));

    openEventEditorWindow({ event: null, calendars: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const overlay = document.querySelector('.calendar-event-editor-overlay');
    assert.ok(overlay);
  });
});
