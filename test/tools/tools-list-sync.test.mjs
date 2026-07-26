/**
 * Contract + runtime tests for multi-list tool permission sync (feature 28).
 * Runtime DOM uses happy-dom; test-loader stubs xterm/css so config UI imports stay light.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';

register('../test-loader.mjs', import.meta.url);

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const { defaultToolConfig } = await import('../../src/config/defaults.ts');
const {
  invalidateToolConfigCache,
  refreshAllToolListUis,
  saveToolConfig,
  setLocalServerAvailable,
  setToolPermission,
  TOOL_CONFIG_STORAGE_KEY,
} = await import('../../src/tools/config.ts');
const { fillToolsSection } = await import('../../src/ui/tools-list.ts');

const LIST_IDS = ['toolsList', 'settingsToolsList', 'composerToolsList', 'chatAppToolsList'];
const SYNC_TOOL_ID = 'calculate';

/** Mount drawer, settings, and composer tool lists in happy-dom. */
function setupThreeToolLists() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLLabelElement = window.HTMLLabelElement;
  globalThis.HTMLInputElement = window.HTMLInputElement;
  globalThis.HTMLSelectElement = window.HTMLSelectElement;
  globalThis.Event = window.Event;
  globalThis.localStorage = window.localStorage;

  document.body.innerHTML = `
    <div id="toolsList"></div>
    <div id="settingsToolsList"></div>
    <div id="composerToolsList"></div>
    <div id="chatAppToolsList"></div>
  `;

  fillToolsSection('toolsList');
  fillToolsSection('settingsToolsList', { variant: 'settings' });
  fillToolsSection('composerToolsList', { variant: 'composer' });
  fillToolsSection('chatAppToolsList', { variant: 'composer' });
}

/** Permission select for one tool row inside a list container. */
function permissionSelect(listId, toolId) {
  const list = document.getElementById(listId);
  const row = list?.querySelector(`[data-tool-id="${toolId}"]`);
  return row?.querySelector('select.tool-permission-select') ?? null;
}

/** Seed localStorage + in-memory cache with calculate disabled. */
function seedCalculateOff() {
  const config = defaultToolConfig();
  config.permissions[SYNC_TOOL_ID] = 'off';
  config.enabled[SYNC_TOOL_ID] = false;
  invalidateToolConfigCache();
  localStorage.setItem(TOOL_CONFIG_STORAGE_KEY, JSON.stringify(config));
  saveToolConfig(config);
}

describe('tools list sync contract', () => {
  test('refreshAllToolListUis refreshes drawer, settings, composer, and chat app lists', () => {
    const src = readFileSync(join(root, 'src/tools/config.ts'), 'utf8');
    assert.match(src, /chatAppToolsList/);
    assert.match(src, /composerToolsList/);
    assert.match(src, /settingsToolsList/);
    assert.match(src, /toolsList/);
    assert.match(src, /function refreshAllToolListUis/);
  });

  test('setToolPermission calls refreshAllToolListUis after save', () => {
    const src = readFileSync(join(root, 'src/tools/config.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export function setToolPermission'));
    assert.match(fn, /refreshAllToolListUis/);
  });

  test('tools-list supports composer variant without descriptions', () => {
    const src = readFileSync(join(root, 'src/ui/tools-list.ts'), 'utf8');
    assert.match(src, /variant === 'composer'/);
    assert.match(src, /variant === 'settings'/);
    assert.match(src, /tools-list--composer/);
    assert.match(src, /tools-list--settings/);
    assert.match(src, /tool-group--collapsible/);
  });
});

describe('tools list sync runtime', { concurrency: false }, () => {
  afterEach(() => {
    invalidateToolConfigCache();
    localStorage.clear();
  });

  test('setToolPermission updates drawer, settings, composer, and chat app selects', () => {
    setupThreeToolLists();
    setLocalServerAvailable(true);
    seedCalculateOff();

    setToolPermission(SYNC_TOOL_ID, 'full', document);

    for (const listId of LIST_IDS) {
      assert.equal(permissionSelect(listId, SYNC_TOOL_ID)?.value, 'full', listId);
    }
  });

  test('change on drawer select syncs settings and composer', () => {
    setupThreeToolLists();
    setLocalServerAvailable(true);
    seedCalculateOff();

    const drawerSelect = permissionSelect('toolsList', SYNC_TOOL_ID);
    assert.ok(drawerSelect);
    drawerSelect.value = 'ask';
    drawerSelect.dispatchEvent(new Event('change', { bubbles: true }));

    assert.equal(permissionSelect('settingsToolsList', SYNC_TOOL_ID)?.value, 'ask');
    assert.equal(permissionSelect('composerToolsList', SYNC_TOOL_ID)?.value, 'ask');
  });

  test('refreshAllToolListUis syncs bulk checkboxes on every list', () => {
    setupThreeToolLists();
    setLocalServerAvailable(true);
    seedCalculateOff();

    setToolPermission(SYNC_TOOL_ID, 'full', document);
    refreshAllToolListUis(document);

    for (const listId of LIST_IDS) {
      const list = document.getElementById(listId);
      const globalBox = list?.querySelector(
        'input[type="checkbox"][data-select-all="global"]',
      );
      assert.ok(globalBox instanceof HTMLInputElement, listId);
      assert.equal(globalBox.checked, false, `${listId} global checked`);
      assert.equal(globalBox.indeterminate, true, `${listId} global indeterminate`);
    }
  });

  test('composer list omits per-tool description paragraphs', () => {
    setupThreeToolLists();

    const drawer = document.getElementById('toolsList');
    const composer = document.getElementById('composerToolsList');
    assert.ok(drawer?.querySelector('.tool-desc'));
    assert.equal(composer?.querySelectorAll('.tool-desc').length, 0);
    assert.ok(composer?.classList.contains('tools-list--composer'));
  });
});
