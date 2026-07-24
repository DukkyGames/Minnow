/**
 * App-gated tool catalog filtering (MIN-472).
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { isAppEnabled, resetAppPreferencesForTests, setAppEnabled } from '../../src/os/app-preferences.ts';
import { BUILT_IN_TOOLS } from '../../src/tools/definitions.ts';
import {
  getEnabledToolCatalogEntries,
  getEnabledToolDefinitionsForMode,
} from '../../src/tools/client.ts';
import {
  defaultToolConfig,
  invalidateToolConfigCache,
  setLocalServerAvailable,
  TOOL_CONFIG_STORAGE_KEY,
} from '../../src/tools/config.ts';
import { fillToolsSection } from '../../src/ui/tools-list.ts';

const EMAIL_TOOL_IDS = [
  'list_mail',
  'search_mail',
  'get_thread',
  'draft_reply',
  'summarize_inbox',
  'generate_reply_variants',
  'email_action',
] as const;

let testWindow: Window | null = null;

function setupDom(): void {
  testWindow = new Window();
  const g = globalThis as typeof globalThis & {
    window: Window;
    document: Document;
    localStorage: Storage;
    HTMLElement: typeof HTMLElement;
    HTMLInputElement: typeof HTMLInputElement;
    HTMLSelectElement: typeof HTMLSelectElement;
    HTMLLabelElement: typeof HTMLLabelElement;
    Event: typeof Event;
  };
  g.window = testWindow as unknown as Window & typeof globalThis.window;
  g.document = testWindow.document;
  g.localStorage = testWindow.localStorage;
  g.HTMLElement = testWindow.HTMLElement;
  g.HTMLInputElement = testWindow.HTMLInputElement;
  g.HTMLSelectElement = testWindow.HTMLSelectElement;
  g.HTMLLabelElement = testWindow.HTMLLabelElement;
  g.Event = testWindow.Event;
  testWindow.localStorage.clear();
  resetAppPreferencesForTests();

  const config = defaultToolConfig();
  invalidateToolConfigCache();
  localStorage.setItem(TOOL_CONFIG_STORAGE_KEY, JSON.stringify(config));
  setLocalServerAvailable(true);
}

function catalogIds(): Set<string> {
  return new Set(getEnabledToolCatalogEntries().map((tool) => tool.id));
}

function modelIdsForGeneralMode(): Set<string> {
  return new Set(
    getEnabledToolDefinitionsForMode('general').map((def) => def.function.name),
  );
}

describe('app-gated tool bindings', () => {
  test('calendar and email tools declare appId', () => {
    const manageCalendar = BUILT_IN_TOOLS.find((tool) => tool.id === 'manage_calendar');
    assert.equal(manageCalendar?.appId, 'calendar');

    for (const id of EMAIL_TOOL_IDS) {
      const tool = BUILT_IN_TOOLS.find((entry) => entry.id === id);
      assert.equal(tool?.appId, 'email', `${id} should bind to email app`);
    }
  });

  test('non-app tools omit appId', () => {
    assert.equal(BUILT_IN_TOOLS.find((tool) => tool.id === 'calculate')?.appId, undefined);
    assert.equal(BUILT_IN_TOOLS.find((tool) => tool.id === 'get_datetime')?.appId, undefined);
  });
});

describe('app-gated tool catalog filtering', () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(() => {
    resetAppPreferencesForTests();
    invalidateToolConfigCache();
    testWindow?.close();
    testWindow = null;
  });

  test('hidden email and calendar apps omit their tools from model catalog', () => {
    assert.equal(isAppEnabled('email'), false);
    assert.equal(isAppEnabled('calendar'), false);

    const ids = catalogIds();
    assert.equal(ids.has('manage_calendar'), false);
    for (const id of EMAIL_TOOL_IDS) {
      assert.equal(ids.has(id), false, `${id} should be hidden when email app is unavailable`);
    }
    assert.equal(ids.has('calculate'), true);
  });

  test('getEnabledToolDefinitionsForMode applies app gating before mode policy', () => {
    const names = modelIdsForGeneralMode();
    assert.equal(names.has('list_mail'), false);
    assert.equal(names.has('manage_calendar'), false);
    assert.equal(names.has('read_file'), true);
  });

  test('disabling scheduler does not hide unrelated utility tools', () => {
    setAppEnabled('scheduler', false);
    assert.equal(isAppEnabled('scheduler'), false);

    const ids = catalogIds();
    assert.equal(ids.has('calculate'), true);
    assert.equal(ids.has('get_datetime'), true);
  });

  test('Settings tools list omits app-gated tools while apps are hidden', () => {
    document.body.innerHTML = '<div id="settingsToolsList"></div>';
    fillToolsSection('settingsToolsList', { variant: 'settings' });

    const list = document.getElementById('settingsToolsList');
    assert.ok(list, 'settings tools list container');
    assert.equal(
      list.querySelector('[data-tool-id="manage_calendar"]'),
      null,
      'manage_calendar row should be hidden',
    );
    assert.equal(
      list.querySelector('[data-tool-id="list_mail"]'),
      null,
      'list_mail row should be hidden',
    );
    assert.ok(
      list.querySelector('[data-tool-id="calculate"]'),
      'calculate row should remain visible',
    );
  });
});
