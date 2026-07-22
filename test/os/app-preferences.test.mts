/**
 * App availability policy + preference persistence.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  APPS,
  isCoreApp,
  isDeveloperReleased,
  isOptionalApp,
  listCoreReleasedApps,
  listOptionalReleasedApps,
  listReleasedApps,
} from '../../src/os/app-registry.ts';
import {
  getAppUnavailableReason,
  isAppAvailable,
  isAppEnabled,
  listDockApps,
  listEnabledOptionalAppIds,
  loadDisabledAppIds,
  normalizeDisabledAppIds,
  resetAppPreferencesForTests,
  saveDisabledAppIds,
  setAppEnabled,
  setEnabledOptionalApps,
  subscribeAppPreferences,
} from '../../src/os/app-preferences.ts';

let testWindow: Window | null = null;

function setupDom(): void {
  testWindow = new Window();
  const g = globalThis as typeof globalThis & {
    window: Window;
    document: Document;
    localStorage: Storage;
  };
  g.window = testWindow as unknown as Window & typeof globalThis.window;
  g.document = testWindow.document;
  g.localStorage = testWindow.localStorage;
  testWindow.localStorage.clear();
  resetAppPreferencesForTests();
}

describe('app registry availability invariants', () => {
  test('core apps are chat, models, brain, settings', () => {
    const coreIds = listCoreReleasedApps().map((app) => app.id).sort();
    assert.deepEqual(coreIds, ['brain', 'chat', 'models', 'settings']);
    for (const id of coreIds) {
      assert.equal(isCoreApp(id), true);
      assert.equal(isOptionalApp(id), false);
    }
  });

  test('optional released apps are the eight selectable apps', () => {
    const optionalIds = listOptionalReleasedApps().map((app) => app.id).sort();
    assert.deepEqual(optionalIds, [
      'bench',
      'calendar',
      'code',
      'compare',
      'email',
      'experts',
      'research',
      'scheduler',
    ]);
  });

  test('every app has availability + releaseState; all current apps are released', () => {
    assert.equal(APPS.length, 12);
    assert.equal(listReleasedApps().length, 12);
    for (const app of APPS) {
      assert.ok(app.availability === 'core' || app.availability === 'optional');
      assert.ok(app.releaseState === 'released' || app.releaseState === 'hidden');
      assert.equal(isDeveloperReleased(app.id), app.releaseState === 'released');
    }
  });
});

describe('app preferences', () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(() => {
    resetAppPreferencesForTests();
    testWindow?.close();
    testWindow = null;
  });

  test('missing storage defaults to all released optional apps enabled', () => {
    assert.equal(loadDisabledAppIds().size, 0);
    assert.equal(listEnabledOptionalAppIds().length, listOptionalReleasedApps().length);
    assert.equal(isAppEnabled('code'), true);
    assert.equal(isAppAvailable('settings'), true);
  });

  test('normalizeDisabledAppIds drops core, unknown, and duplicates', () => {
    assert.deepEqual(
      normalizeDisabledAppIds(['code', 'chat', 'code', 'not-an-app', 12, 'bench']),
      ['code', 'bench'],
    );
  });

  test('setAppEnabled cannot disable core apps', () => {
    setAppEnabled('chat', false);
    setAppEnabled('settings', false);
    assert.equal(isAppEnabled('chat'), true);
    assert.equal(isAppEnabled('settings'), true);
    assert.equal(loadDisabledAppIds().size, 0);
  });

  test('disabling an optional app removes it from dock list and persists', () => {
    setAppEnabled('compare', false);
    assert.equal(isAppEnabled('compare'), false);
    assert.equal(getAppUnavailableReason('compare'), 'user-disabled');
    assert.equal(
      listDockApps().some((app) => app.id === 'compare'),
      false,
    );
    assert.equal(localStorage.getItem('minnow.os.disabledApps'), JSON.stringify(['compare']));

    resetAppPreferencesForTests();
    assert.equal(isAppEnabled('compare'), false);
  });

  test('setEnabledOptionalApps writes the inverse disabled set', () => {
    setEnabledOptionalApps(['code', 'research']);
    const disabled = [...loadDisabledAppIds()].sort();
    assert.deepEqual(disabled, [
      'bench',
      'calendar',
      'compare',
      'email',
      'experts',
      'scheduler',
    ]);
  });

  test('re-enabling clears storage when nothing remains disabled', () => {
    saveDisabledAppIds(['email']);
    setAppEnabled('email', true);
    assert.equal(localStorage.getItem('minnow.os.disabledApps'), null);
  });

  test('subscribers fire on preference changes', () => {
    let calls = 0;
    const unsub = subscribeAppPreferences(() => {
      calls += 1;
    });
    setAppEnabled('bench', false);
    assert.equal(calls, 1);
    unsub();
    setAppEnabled('bench', true);
    assert.equal(calls, 1);
  });
});
