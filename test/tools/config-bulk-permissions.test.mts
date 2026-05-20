/**
 * Bulk built-in tool permission helpers (feature 29).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { defaultToolConfig } from '../../src/config/defaults.ts';
import { BUILT_IN_TOOLS } from '../../src/tools/definitions.ts';
import {
  applyAllBuiltInToolPermissions,
  applyDefaultBuiltInPermissions,
  getToolPermissionForId,
} from '../../src/tools/config.ts';
import type { ToolConfig } from '../../src/tools/tool-settings-types.ts';

function cloneConfig(base: ToolConfig): ToolConfig {
  return {
    enabled: { ...base.enabled },
    permissions: { ...base.permissions },
    keys: { ...base.keys },
  };
}

describe('applyAllBuiltInToolPermissions', () => {
  test('sets every built-in id to full with enabled mirror', () => {
    const config = cloneConfig(defaultToolConfig());
    applyAllBuiltInToolPermissions(config, 'full');

    for (const tool of BUILT_IN_TOOLS) {
      assert.equal(config.permissions[tool.id], 'full');
      assert.equal(config.enabled[tool.id], true);
    }
  });
});

describe('applyDefaultBuiltInPermissions', () => {
  test('restores built-in map from defaultToolConfig', () => {
    const config = cloneConfig(defaultToolConfig());
    applyAllBuiltInToolPermissions(config, 'full');
    applyDefaultBuiltInPermissions(config);

    const defaults = defaultToolConfig();
    for (const tool of BUILT_IN_TOOLS) {
      assert.equal(config.permissions[tool.id], defaults.permissions[tool.id]);
      assert.equal(config.enabled[tool.id], defaults.enabled[tool.id]);
    }
  });

  test('preserves braveApiKey and mcp__ permission entries', () => {
    const config = cloneConfig(defaultToolConfig());
    config.keys.braveApiKey = 'test-key';
    config.permissions['mcp__test'] = 'full';
    config.enabled['mcp__test'] = true;

    applyAllBuiltInToolPermissions(config, 'full');
    applyDefaultBuiltInPermissions(config);

    assert.equal(config.keys.braveApiKey, 'test-key');
    assert.equal(config.permissions['mcp__test'], 'full');
  });

  test('web_search is full after bulk full apply', () => {
    const config = cloneConfig(defaultToolConfig());
    applyAllBuiltInToolPermissions(config, 'full');
    assert.equal(getToolPermissionForId(config, 'web_search'), 'full');
  });
});
