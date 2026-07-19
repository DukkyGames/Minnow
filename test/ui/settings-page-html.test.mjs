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
  'notifications',
  'appearance',
  'audio',
  'providers',
  'usage',
  'model-routing',
  'sampler',
  'thinking',
  'agent-center',
  'rules',
  'agent-packs',
  'autopilot',
  'search',
  'deep-research',
  'servers',
  'tools',
  'mcp',
  'lsp',
  'editor',
  'skills',
  'webhooks',
  'features',
  'diagnostics',
  'evals',
  'about',
];

/** Sections populated by refreshSettingsSection via clearMount(). */
const DYNAMIC_SECTION_BODY_IDS = [
  'settingsGeneralBody',
  'settingsNotificationsBody',
  'settingsAudioBody',
  'settingsModelRoutingBody',
  'settingsSamplerBody',
  'settingsAgentCenterBody',
  'settingsRulesBody',
  'settingsAgentPacksBody',
  'settingsSearchBody',
  'settingsDeepResearchBody',
  'settingsServersBody',
  'settingsToolsBody',
  'settingsSkillsBody',
  'settingsWebhooksBody',
  'settingsUsageBody',
  'settingsProvidersBody',
  'settingsEditorBody',
  'settingsDiagnosticsBody',
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

  test('providers section mount exists in index.html', () => {
    assert.match(html, /id="settingsProvidersBody"/);
    assert.match(html, /id="settingsSection-providers"/);
  });

  test('MCP add-server form exists in index.html', () => {
    assert.match(html, /id="settingsMcpAddForm"/);
    assert.match(html, /id="settingsMcpAddId"/);
    assert.match(html, /id="settingsMcpAddCommand"/);
  });

  test('memory UI moved to Brain app (not in settings)', () => {
    assert.doesNotMatch(html, /id="settingsSection-memory"/);
    assert.doesNotMatch(html, /id="settingsMemoryList"/);
    assert.match(html, /id="brainSection-memories"/);
    assert.match(html, /id="brainMemoryList"/);
    assert.match(html, /data-brain-nav="memories"/);
  });

  test('prompt token estimate elements exist in index.html', () => {
    assert.match(html, /id="settingsPromptTokenEstimate"/);
    assert.match(html, /id="settingsPromptTokenBreakdown"/);
    assert.match(html, /class="settings-prompt-estimate"/);
  });

  test('settings global search finder exists in header slot', () => {
    assert.match(html, /id="settingsSearchFinderSlot"/);
    assert.match(html, /id="settingsSearchFinder"/);
    assert.match(html, /id="settingsSearchInput"/);
    assert.match(html, /id="settingsSearchResults"/);
    assert.match(html, /class="settings-page-header"/);
    assert.match(html, /id="btnSettingsPageBack"/);
    assert.match(html, /id="settingsPromptTokenEstimate"/);
  });

  test('settings unified sidebar nav exists', () => {
    assert.match(html, /class="settings-nav"/);
    assert.match(html, /data-settings-nav-area="general"/);
    assert.match(html, /data-settings-nav-hub="web-research"/);
    assert.match(html, /data-settings-category="models"/);
    assert.match(html, /data-settings-category="agents"/);
    assert.doesNotMatch(html, /data-category="knowledge"/);
    assert.doesNotMatch(html, /class="settings-category-subnav"/);
  });

  test('SETTINGS_SECTION_IDS matches canonical section count', () => {
    assert.equal(SETTINGS_SECTION_IDS.length, 26);
  });

  test('agents center mount exists in index.html', () => {
    assert.match(html, /id="settingsAgentCenterBody"/);
    assert.match(html, /data-settings-nav-area="agent-center"/);
  });

  test('user rules section matches other general-style settings mounts', () => {
    const rulesBlock = html.slice(
      html.indexOf('id="settingsSection-rules"'),
      html.indexOf('id="settingsSection-agent-packs"'),
    );
    assert.match(rulesBlock, /id="settingsRulesBody"/);
    assert.doesNotMatch(rulesBlock, /class="settings-lead"/);
    assert.doesNotMatch(rulesBlock, /id="settingsRulesEnabled"/);
  });

  test('notifications settings section exists in index.html', () => {
    assert.match(html, /id="settingsSection-notifications"/);
    assert.match(html, /id="settingsNotificationsBody"/);
    assert.match(html, /data-settings-nav-area="notifications"/);
    assert.match(html, /data-area="notifications"/);
  });

  test('audio settings section exists in index.html', () => {
    assert.match(html, /id="settingsSection-audio"/);
    assert.match(html, /id="settingsAudioBody"/);
    assert.match(html, /data-area="audio"/);
  });

  test('health and diagnostics section exists under advanced in index.html', () => {
    assert.match(html, /id="settingsSection-diagnostics"/);
    assert.match(html, /id="settingsDiagnosticsBody"/);
    assert.match(html, /data-area="diagnostics"/);
    assert.match(html, /data-settings-nav-area="diagnostics"/);
    assert.match(html, /Health &amp; diagnostics/);
  });

  test('diagnostics section matches other general-style settings mounts', () => {
    const diagnosticsBlock = html.slice(
      html.indexOf('id="settingsSection-diagnostics"'),
      html.indexOf('id="settingsSection-evals"'),
    );
    assert.match(diagnosticsBlock, /id="settingsDiagnosticsBody"/);
    assert.doesNotMatch(diagnosticsBlock, /class="settings-lead"/);
  });

  test('about section matches other general settings mounts', () => {
    const aboutBlock = html.slice(
      html.indexOf('id="settingsSection-about"'),
      html.indexOf('id="settingsSection-appearance"'),
    );
    assert.match(aboutBlock, /id="settingsAboutBody"/);
    assert.doesNotMatch(aboutBlock, /class="settings-lead"/);
  });

  test('voice settings redirect notice in index.html', () => {
    assert.match(html, /id="settingsSection-voice"/);
    assert.match(html, /Models → Voice/);
    assert.match(html, /id="modelsSection-voice"/);
    assert.match(html, /id="modelsVoiceBody"/);
  });

  test('composer tools button and popover exist in index.html', () => {
    assert.match(html, /id="btnComposerTools"/);
    assert.match(html, /id="composerToolsPopover"/);
    assert.match(html, /id="composerToolsList"/);
    assert.match(html, /id="composerToolsServerBanner"/);
    assert.match(html, /id="composerToolsOpenSettings"/);
    assert.match(html, /class="tools-list tools-list--composer"/);
  });

  test('integrations category uses four hub containers', () => {
    assert.match(html, /id="settingsHub-web-research"/);
    assert.match(html, /id="settingsHub-tools-skills"/);
    assert.match(html, /id="settingsHub-dev-stack"/);
    assert.match(html, /id="settingsHub-external"/);
    assert.match(html, /data-hub-jump="web-research"/);
    assert.match(html, /settings-hub is-active[^"]*" id="settingsHub-web-research"/);
    assert.match(html, /class="settings-hub__lead"/);
    assert.doesNotMatch(html, /settings-hub__title/);
    assert.doesNotMatch(html, /data-area-jump="mcp"/);
    assert.match(html, /data-settings-nav-hub="dev-stack"/);
  });

  test('general section suppresses duplicate section title', () => {
    assert.match(
      html,
      /id="settingsSection-general"[^>]*settings-area--title-suppressed/,
    );
  });

  test('settings nav markup avoids aria-current=false', () => {
    const settingsBlock = html.slice(
      html.indexOf('id="settingsView"'),
      html.indexOf('id="welcomeView"'),
    );
    assert.doesNotMatch(settingsBlock, /aria-current="false"/);
  });

  test('prompt token estimate has accessible label', () => {
    assert.match(html, /id="settingsPromptTokenEstimate"[^>]*aria-label="Approximate prompt config token estimate"/);
  });
});
