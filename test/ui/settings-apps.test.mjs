/**
 * Settings → Apps section rendering and catalog wiring.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

const { SETTINGS_CATEGORIES, categoryForArea, fieldByKey } = await import(
  '../../src/ui/settings-catalog.ts'
);
const { SETTINGS_SECTION_LABELS, SETTINGS_SECTIONS } = await import(
  '../../src/ui/settings-page-types.ts'
);
const { renderAppsSettingsSection } = await import('../../src/ui/settings-apps.ts');
const {
  isAppEnabled,
  resetAppPreferencesForTests,
  setAppEnabled,
} = await import('../../src/os/app-preferences.ts');
const { listOptionalReleasedApps } = await import('../../src/os/app-registry.ts');

let testWindow = null;

function setupDom() {
  testWindow = new Window();
  globalThis.window = testWindow;
  globalThis.document = testWindow.document;
  globalThis.HTMLElement = testWindow.HTMLElement;
  globalThis.localStorage = testWindow.localStorage;
  testWindow.localStorage.clear();
  resetAppPreferencesForTests();
  document.body.innerHTML = '<div id="settingsAppsBody"></div>';
}

describe('settings apps catalog + html', () => {
  test('apps is a top-level settings category and section', () => {
    assert.ok(SETTINGS_CATEGORIES.includes('apps'));
    assert.equal(SETTINGS_SECTION_LABELS.apps, 'Apps');
    assert.ok(SETTINGS_SECTIONS.includes('apps'));
    assert.equal(categoryForArea('apps'), 'apps');
    assert.ok(fieldByKey('apps.visibility'));
    assert.ok(fieldByKey('apps.optional.code'));
  });

  test('index.html includes Apps nav and section mount', () => {
    assert.match(html, /data-settings-nav-group="apps"/);
    assert.match(html, /data-area-jump="apps"/);
    assert.match(html, /id="settingsSection-apps"/);
    assert.match(html, /id="settingsAppsBody"/);
    assert.match(html, /data-category="apps"/);
  });
});

describe('settings apps renderer', () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(() => {
    resetAppPreferencesForTests();
    testWindow?.close();
    testWindow = null;
  });

  test('renders optional cards, core note, and bulk actions', () => {
    const mount = document.getElementById('settingsAppsBody');
    renderAppsSettingsSection(mount);
    assert.equal(
      mount.querySelectorAll('.mn-app-picker-card').length,
      listOptionalReleasedApps().length,
    );
    assert.equal(mount.querySelectorAll('.mn-app-picker-card.is-always-on').length, 0);
    assert.ok(mount.querySelector('.mn-app-picker-core'));
    assert.match(mount.querySelector('.mn-app-picker-core')?.textContent ?? '', /Always included/);
    assert.ok(mount.querySelector('[data-settings-search-key="apps.core.chat"]'));
    assert.ok(mount.querySelector('[data-settings-search-key="apps.visibility"]'));
    assert.ok(mount.querySelector('.mn-app-picker-toolbar'));
  });

  test('toggling an optional card updates preferences immediately', () => {
    const mount = document.getElementById('settingsAppsBody');
    renderAppsSettingsSection(mount);
    const card = mount.querySelector('.mn-app-picker-card[data-app-id="scheduler"]');
    assert.ok(card);
    assert.equal(isAppEnabled('scheduler'), true);
    card.click();
    assert.equal(isAppEnabled('scheduler'), false);
    assert.equal(card.classList.contains('is-off'), true);
    card.click();
    assert.equal(isAppEnabled('scheduler'), true);
    assert.equal(card.classList.contains('is-selected'), true);
  });

  test('disable all and enable all update preferences', () => {
    const mount = document.getElementById('settingsAppsBody');
    renderAppsSettingsSection(mount);
    const buttons = [...mount.querySelectorAll('.mn-app-picker-toolbar__btn')];
    const disableAll = buttons.find((btn) => btn.textContent === 'Disable all');
    const enableAll = buttons.find((btn) => btn.textContent === 'Enable all');
    assert.ok(disableAll);
    assert.ok(enableAll);

    disableAll.click();
    for (const app of listOptionalReleasedApps()) {
      assert.equal(isAppEnabled(app.id), false);
    }
    assert.equal(mount.querySelectorAll('.mn-app-picker-card.is-off').length, listOptionalReleasedApps().length);

    enableAll.click();
    for (const app of listOptionalReleasedApps()) {
      assert.equal(isAppEnabled(app.id), true);
    }
    assert.equal(mount.querySelectorAll('.mn-app-picker-card.is-selected').length, listOptionalReleasedApps().length);
  });

  test('disabled optional apps still render so they can be restored', () => {
    setAppEnabled('experts', false);
    const mount = document.getElementById('settingsAppsBody');
    renderAppsSettingsSection(mount);
    const experts = mount.querySelector('.mn-app-picker-card[data-app-id="experts"]');
    assert.ok(experts);
    assert.equal(experts.classList.contains('is-selected'), false);
    assert.equal(experts.classList.contains('is-off'), true);
  });
});
