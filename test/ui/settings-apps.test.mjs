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

  test('renders twelve cards with four always-on', () => {
    const mount = document.getElementById('settingsAppsBody');
    renderAppsSettingsSection(mount);
    assert.equal(mount.querySelectorAll('.mn-app-picker-card').length, 12);
    assert.equal(mount.querySelectorAll('.mn-app-picker-card.is-always-on').length, 4);
    assert.ok(mount.querySelector('[data-settings-search-key="apps.visibility"]'));
  });

  test('toggling an optional card updates preferences immediately', () => {
    const mount = document.getElementById('settingsAppsBody');
    renderAppsSettingsSection(mount);
    const card = mount.querySelector('.mn-app-picker-card[data-app-id="scheduler"]');
    assert.ok(card);
    assert.equal(isAppEnabled('scheduler'), true);
    card.click();
    assert.equal(isAppEnabled('scheduler'), false);
    card.click();
    assert.equal(isAppEnabled('scheduler'), true);
  });

  test('core cards do not disable when clicked', () => {
    const mount = document.getElementById('settingsAppsBody');
    renderAppsSettingsSection(mount);
    const chat = mount.querySelector('.mn-app-picker-card[data-app-id="chat"]');
    assert.ok(chat);
    chat.click();
    assert.equal(isAppEnabled('chat'), true);
    assert.equal(chat.classList.contains('is-always-on'), true);
  });

  test('disabled optional apps still render so they can be restored', () => {
    setAppEnabled('experts', false);
    const mount = document.getElementById('settingsAppsBody');
    renderAppsSettingsSection(mount);
    const experts = mount.querySelector('.mn-app-picker-card[data-app-id="experts"]');
    assert.ok(experts);
    assert.equal(experts.classList.contains('is-selected'), false);
  });
});
