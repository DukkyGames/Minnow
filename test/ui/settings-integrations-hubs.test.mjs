import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { SETTINGS_INTEGRATIONS_HUBS, hubForArea } = await import(
  '../../src/ui/settings-page-types.ts'
);

describe('settings integrations hubs', () => {
  test('hubForArea maps legacy integration areas', () => {
    assert.equal(hubForArea('search'), 'web-research');
    assert.equal(hubForArea('mcp'), 'dev-stack');
    assert.equal(hubForArea('webhooks'), 'external');
    assert.equal(hubForArea('skills'), 'tools-skills');
  });

  test('every integration area belongs to exactly one hub', () => {
    const integrationAreas = [
      'search',
      'deep-research',
      'servers',
      'tools',
      'skills',
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
