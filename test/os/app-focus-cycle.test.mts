/**
 * Ctrl+Tab MRU app surface cycling.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { APP_SWITCHER_DESKTOP_ID } from '../../src/os/surface-id.ts';
import {
  cycleAppSurfaces,
  getAppSurfaceMruForTests,
  getCurrentAppSurfaceId,
  listCycleableAppSurfaces,
  recordAppSurfaceFocus,
  resetAppFocusCycleForTests,
} from '../../src/os/app-focus-cycle.ts';
import {
  resetAppPreferencesForTests,
  setAppEnabled,
} from '../../src/os/app-preferences.ts';
import {
  getForegroundAppId,
  getOsView,
  launchInstance,
  resetInstancesForTests,
  showDesktop,
} from '../../src/os/instances.ts';
import { resetDesktopStateForTests } from '../../src/os/desktop-state.ts';
import { resetOsPageBridgeForTests } from '../../src/os/page-bridge.ts';
import {
  initOsRouter,
  launchApp,
  resetOsRouterForTests,
  syncOsRouteFromHashForTests,
} from '../../src/os/router.ts';

describe('app focus cycle', () => {
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
    win.document.body.innerHTML = `
      <header class="topbar"></header>
      <div id="osDesktopLayer" class="mn-os-desktop-layer"></div>
      <div id="appBody"></div>
    `;
    win.location.hash = '#/desktop';
    resetAppPreferencesForTests();
    resetInstancesForTests();
    resetDesktopStateForTests();
    resetOsPageBridgeForTests();
    resetOsRouterForTests();
    resetAppFocusCycleForTests();
    showDesktop();
    initOsRouter();
  });

  afterEach(() => {
    resetAppFocusCycleForTests();
    resetOsRouterForTests();
    resetInstancesForTests();
    resetDesktopStateForTests();
    resetOsPageBridgeForTests();
    resetAppPreferencesForTests();
  });

  test('recordAppSurfaceFocus keeps most recent surfaces first without duplicates', () => {
    recordAppSurfaceFocus('code');
    recordAppSurfaceFocus('brain');
    recordAppSurfaceFocus('code');

    assert.deepEqual(getAppSurfaceMruForTests(), ['code', 'brain', APP_SWITCHER_DESKTOP_ID]);
  });

  test('listCycleableAppSurfaces omits user-disabled apps', () => {
    recordAppSurfaceFocus('code');
    recordAppSurfaceFocus('compare');
    setAppEnabled('compare', false);

    assert.deepEqual(listCycleableAppSurfaces(), ['code', APP_SWITCHER_DESKTOP_ID]);
  });

  test('getCurrentAppSurfaceId uses foreground window apps on the desktop view', () => {
    launchInstance('settings');

    assert.equal(getOsView(), 'desktop');
    assert.equal(getCurrentAppSurfaceId(), 'settings');
  });

  test('cycleAppSurfaces forward moves to the next MRU surface', () => {
    launchApp('code');
    launchApp('brain');
    syncOsRouteFromHashForTests();

    assert.equal(getForegroundAppId(), 'brain');

    cycleAppSurfaces('forward');
    syncOsRouteFromHashForTests();

    assert.equal(getForegroundAppId(), 'code');
  });

  test('cycleAppSurfaces backward wraps to the least recent surface', () => {
    launchApp('code');
    launchApp('brain');
    syncOsRouteFromHashForTests();

    cycleAppSurfaces('backward');
    syncOsRouteFromHashForTests();

    assert.equal(getOsView(), 'desktop');
    assert.equal(getForegroundAppId(), null);
  });
});
