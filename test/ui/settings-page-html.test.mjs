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
  'rules',
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

  test('memory entry list mount exists in index.html', () => {
    assert.match(html, /id="settingsMemoryList"/);
  });

  test('memory add form exists in index.html', () => {
    assert.match(html, /id="settingsMemoryAddForm"/);
    assert.match(html, /id="settingsMemoryAddTitle"/);
    assert.match(html, /id="settingsMemoryAddBody"/);
    assert.match(html, /id="settingsMemoryAddTags"/);
    assert.match(html, /id="settingsMemoryAddPanel"/);
  });

  test('prompt token estimate elements exist in index.html', () => {
    assert.match(html, /id="settingsPromptTokenEstimate"/);
    assert.match(html, /id="settingsPromptTokenBreakdown"/);
    assert.match(html, /class="settings-prompt-estimate"/);
  });

  test('user rules section controls exist in index.html', () => {
    assert.match(html, /id="settingsSection-rules"/);
    assert.match(html, /id="settingsRulesEnabled"/);
    assert.match(html, /id="settingsRulesText"/);
    assert.match(html, /id="settingsRulesSave"/);
    assert.match(html, /data-settings-nav="rules"/);
  });
});
