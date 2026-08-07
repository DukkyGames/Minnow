/**
 * Menubar app switcher catalog mirrors the left app rail.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { listAppSwitcherItems } from '../../src/os/app-switcher-menu.ts';
import {
  listRailApps,
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

  test('lists the same apps as listRailApps in order', () => {
    const items = listAppSwitcherItems({
      osView: 'app',
      foregroundAppId: 'code',
    });
    const railIds = listRailApps().map((app) => app.id);

    assert.deepEqual(
      items.map((item) => item.id),
      railIds,
    );
    assert.equal(items.some((item) => item.id === 'chat'), false);
    assert.equal(items.some((item) => item.id === 'desktop'), false);
  });

  test('marks the foreground app active while in an app view', () => {
    const items = listAppSwitcherItems({
      osView: 'app',
      foregroundAppId: 'brain',
    });
    const brain = items.find((item) => item.id === 'brain');
    const code = items.find((item) => item.id === 'code');

    assert.equal(brain?.active, true);
    assert.equal(code?.active, false);
  });

  test('marks no rail app active on the workspaces view', () => {
    const items = listAppSwitcherItems({
      osView: 'workspaces',
      foregroundAppId: 'code',
    });

    assert.equal(
      items.every((item) => item.active === false),
      true,
    );
  });
});
