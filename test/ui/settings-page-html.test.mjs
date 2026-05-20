import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

/** Nav section ids must match panels in index.html (settings-page.ts SECTIONS). */
const SETTINGS_SECTION_IDS = [
  'general',
  'prompting',
  'providers',
  'modes',
  'experts',
  'work-agents',
  'sub-agents',
  'memory',
  'features',
  'tools',
  'mcp',
  'lsp',
  'skills',
];

/** Sections populated by refreshSettingsSection via clearMount(). */
const DYNAMIC_SECTION_BODY_IDS = [
  'settingsGeneralBody',
  'settingsProvidersBody',
  'settingsModesBody',
  'settingsExpertsBody',
  'settingsWorkAgentsBody',
  'settingsSubAgentsBody',
  'settingsToolsBody',
  'settingsSkillsBody',
];

describe('settings page HTML', () => {
  for (const id of SETTINGS_SECTION_IDS) {
    test(`settingsSection-${id} exists in index.html`, () => {
      assert.match(html, new RegExp(`id="settingsSection-${id}"`));
    });
  }

  for (const id of DYNAMIC_SECTION_BODY_IDS) {
    test(`${id} mount exists in index.html`, () => {
      assert.match(html, new RegExp(`id="${id}"`));
    });
  }

  test('MCP add-server form exists in index.html', () => {
    assert.match(html, /id="settingsMcpAddForm"/);
    assert.match(html, /id="settingsMcpAddId"/);
    assert.match(html, /id="settingsMcpAddCommand"/);
  });
});
