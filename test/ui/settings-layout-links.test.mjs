/**
 * Inline settings cross-links must call openSettings (not hash-only) so Minnow
 * can switch sections while the Settings window is already open.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import { Window } from 'happy-dom';

let openSettingsCalls = [];
let openModelsCalls = [];

mock.module('../../src/ui/settings-page.ts', {
  namedExports: {
    openSettings(section) {
      openSettingsCalls.push(section);
    },
  },
});

mock.module('../../src/ui/models-page.ts', {
  namedExports: {
    openModels(section) {
      openModelsCalls.push(section);
    },
  },
});

const { linkToSettingsSection } = await import('../../src/ui/settings-layout.ts');

describe('linkToSettingsSection', () => {
  beforeEach(() => {
    openSettingsCalls = [];
    openModelsCalls = [];
    const window = new Window();
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    window.location.hash = '#/app/settings';
  });

  afterEach(() => {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.HTMLElement;
  });

  test('calls openSettings for a Settings section instead of relying on hash', async () => {
    const btn = linkToSettingsSection('Advanced → Health & diagnostics', 'diagnostics');
    assert.equal(btn.className, 'settings-inline-link');
    btn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(openSettingsCalls, ['diagnostics']);
    assert.equal(window.location.hash, '#/app/settings');
    assert.deepEqual(openModelsCalls, []);
  });

  test('opens Models app for provider/routing sections', async () => {
    const btn = linkToSettingsSection('Providers', 'providers');
    btn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(openModelsCalls, ['providers']);
    assert.deepEqual(openSettingsCalls, []);
  });
});
