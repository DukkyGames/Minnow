import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

/** Nav section ids must match panels in index.html (settings-page-types SETTINGS_SECTIONS). */
const SETTINGS_SECTION_IDS = [
  'general',
  'providers',
  'usage',
  'model-routing',
  'sampler',
  'thinking',
  'prompting',
  'rules',
  'memory',
  'modes',
  'experts',
  'work-agents',
  'agent-packs',
  'sub-agents',
  'tools',
  'mcp',
  'lsp',
  'editor',
  'skills',
  'features',
  'evals',
];

/** Sections populated by refreshSettingsSection via clearMount(). */
const DYNAMIC_SECTION_BODY_IDS = [
  'settingsGeneralBody',
  'settingsModelRoutingBody',
  'settingsSamplerBody',
  'settingsModesBody',
  'settingsExpertsBody',
  'settingsWorkAgentsBody',
  'settingsAgentPacksBody',
  'settingsSubAgentsBody',
  'settingsToolsBody',
  'settingsSkillsBody',
  'settingsUsageBody',
  'settingsEditorBody',
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

  test('providers add form exists in index.html', () => {
    assert.match(html, /id="settingsProvidersAddForm"/);
    assert.match(html, /id="settingsProvidersAddId"/);
    assert.match(html, /id="settingsProvidersAddBaseUrl"/);
    assert.match(html, /id="settingsProvidersAddModelsPath"/);
    assert.match(html, /id="settingsProvidersAddChatPath"/);
    assert.match(html, /id="settingsProvidersList"/);
  });

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

  test('settings global search finder exists in header', () => {
    assert.match(html, /id="settingsSearchFinder"/);
    assert.match(html, /id="settingsSearchInput"/);
    assert.match(html, /id="settingsSearchResults"/);
    assert.match(html, /class="settings-page-header"/);
    assert.match(html, /id="btnSettingsPageBack"/);
    assert.match(html, /id="settingsPromptTokenEstimate"/);
  });

  test('SETTINGS_SECTION_IDS matches canonical section count', () => {
    assert.equal(SETTINGS_SECTION_IDS.length, 21);
  });

  test('prompts hub mount exists in index.html', () => {
    assert.match(html, /id="settingsPromptsHubMount"/);
    assert.match(html, /class="settings-prompts-hub-mount"/);
  });

  test('user rules section controls exist in index.html', () => {
    assert.match(html, /id="settingsSection-rules"/);
    assert.match(html, /id="settingsRulesEnabled"/);
    assert.match(html, /id="settingsRulesText"/);
    assert.match(html, /id="settingsRulesSave"/);
    assert.match(html, /data-settings-nav="rules"/);
  });

  test('composer tools button and popover exist in index.html', () => {
    assert.match(html, /id="btnComposerTools"/);
    assert.match(html, /id="composerToolsPopover"/);
    assert.match(html, /id="composerToolsList"/);
    assert.match(html, /id="composerToolsServerBanner"/);
    assert.match(html, /id="composerToolsOpenSettings"/);
    assert.match(html, /class="tools-list tools-list--composer"/);
  });
});
