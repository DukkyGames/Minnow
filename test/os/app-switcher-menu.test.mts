/**
 * Menubar app switcher catalog: Desktop first, then the same apps as the dock.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  APP_SWITCHER_DESKTOP_ID,
  listAppSwitcherItems,
} from '../../src/os/app-switcher-menu.ts';
import {
  listDockApps,
  resetAppPreferencesForTests,
} from '../../src/os/app-preferences.ts';

describe('app switcher menu items', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const win = new Window();
    const g = globalThis as typeof globalThis & {
      window: Window;
      document: Document;
      localStorage: Storage;
    };
    g.window = win as unknown as Window & typeof globalThis.window;
    g.document = win.document;
    g.localStorage = win.localStorage;
    win.localStorage.clear();
    resetAppPreferencesForTests();
  });

  afterEach(() => {
    resetAppPreferencesForTests();
  });

  test('leads with Desktop, then mirrors listDockApps order', () => {
    const items = listAppSwitcherItems({
      osView: 'app',
      foregroundAppId: 'code',
    });
    const dockIds = listDockApps().map((app) => app.id);

    assert.equal(items[0]?.id, APP_SWITCHER_DESKTOP_ID);
    assert.equal(items[0]?.name, 'Desktop');
    assert.equal(items[0]?.icon, 'minnow-glyph');
    assert.deepEqual(
      items.slice(1).map((item) => item.id),
      dockIds,
    );
    // Chat lives on the desktop surface, not in the dock or switcher grid.
    assert.equal(items.some((item) => item.id === 'chat'), false);
  });

  test('marks the foreground app active while in an app view', () => {
    const items = listAppSwitcherItems({
      osView: 'app',
      foregroundAppId: 'brain',
    });
    const brain = items.find((item) => item.id === 'brain');
    const desktop = items.find((item) => item.id === APP_SWITCHER_DESKTOP_ID);

    assert.equal(brain?.active, true);
    assert.equal(desktop?.active, false);
  });

  test('marks Desktop active on the desktop view', () => {
    const items = listAppSwitcherItems({
      osView: 'desktop',
      foregroundAppId: 'code',
    });

    assert.equal(items[0]?.active, true);
    assert.equal(
      items.slice(1).every((item) => item.active === false),
      true,
    );
  });
});
