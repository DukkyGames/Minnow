import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { SETTINGS_INTEGRATIONS_HUBS, hubForArea } = await import(
  '../../src/ui/settings-page-types.ts'
);

describe('settings integrations hubs', () => {
  test('hubForArea maps legacy integration areas', () => {
    assert.equal(hubForArea('search'), 'web-research');
    assert.equal(hubForArea('deep-research'), 'deep-research');
    assert.equal(hubForArea('servers'), 'servers');
    assert.equal(hubForArea('tools'), 'tools');
    assert.equal(hubForArea('skills'), 'skills');
    assert.equal(hubForArea('browser'), 'browser');
    assert.equal(hubForArea('mcp'), 'mcp');
    assert.equal(hubForArea('lsp'), 'lsp');
    assert.equal(hubForArea('editor'), 'editor');
    assert.equal(hubForArea('webhooks'), 'external');
  });

  test('every integration area belongs to exactly one hub', () => {
    const integrationAreas = [
      'search',
      'deep-research',
      'servers',
      'tools',
      'skills',
      'browser',
      'mcp',
      'lsp',
      'editor',
      'webhooks',
    ];
    for (const area of integrationAreas) {
      assert.ok(hubForArea(area), `missing hub for ${area}`);
    }
    const hubAreaCount = SETTINGS_INTEGRATIONS_HUBS.reduce(
      (sum, hub) => sum + hub.areas.length,
      0,
    );
    assert.equal(hubAreaCount, integrationAreas.length);
  });
});
