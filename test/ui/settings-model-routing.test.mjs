import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

describe('settings model routing HTML', () => {
  test('model-routing section and nav exist', () => {
    assert.match(html, /id="settingsSection-model-routing"/);
    assert.match(html, /id="settingsModelRoutingBody"/);
    assert.match(html, /data-settings-nav="model-routing"/);
    assert.match(html, />Model routing</);
  });
});

describe('settings model routing types', () => {
  test('SETTINGS_SECTIONS includes model-routing', async () => {
    const { SETTINGS_SECTIONS } = await import('../../src/ui/settings-page-types.ts');
    assert.ok(SETTINGS_SECTIONS.includes('model-routing'));
    const providersIdx = SETTINGS_SECTIONS.indexOf('providers');
    const routingIdx = SETTINGS_SECTIONS.indexOf('model-routing');
    const modesIdx = SETTINGS_SECTIONS.indexOf('modes');
    assert.ok(providersIdx >= 0 && routingIdx > providersIdx && modesIdx > routingIdx);
  });
});
