import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('settings-sections', () => {
  test('exports refreshSettingsSection for settings page wiring', async () => {
    const mod = await import('../../src/ui/settings-sections.ts');
    assert.equal(typeof mod.refreshSettingsSection, 'function');
  });
});
