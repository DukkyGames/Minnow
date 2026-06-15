/**
 * Tests for catalog-only tool permission resolution.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { defaultToolConfig } from '../../src/config/defaults.ts';
import {
  applyAllBuiltInToolPermissions,
  isLegacyFlatPermissions,
  normalizePermissionsFromStored,
  normalizeToolConfig,
} from '../../src/tools/config.ts';
import { resolveEffectivePermission } from '../../src/tools/permission-resolve.ts';
import type { ToolConfig } from '../../src/tools/tool-settings-types.ts';

function cloneConfig(base: ToolConfig): ToolConfig {
  return {
    enabled: { ...base.enabled },
    permissions: {
      default: { ...base.permissions.default },
    },
    keys: { ...base.keys },
    webSearchProvider: base.webSearchProvider,
    toolCache: base.toolCache ? { ...base.toolCache } : undefined,
  };
}

describe('isLegacyFlatPermissions', () => {
  test('detects flat map', () => {
    assert.equal(isLegacyFlatPermissions({ execute_command: 'ask' }), true);
  });

  test('rejects v2 shape', () => {
    assert.equal(
      isLegacyFlatPermissions({ default: { execute_command: 'ask' } }),
      false,
    );
  });
});

describe('normalizePermissionsFromStored', () => {
  test('migrates legacy flat to default', () => {
    const seed = defaultToolConfig().permissions.default;
    const out = normalizePermissionsFromStored({ read_file: 'full', execute_command: 'ask' }, seed);
    assert.equal(out.default.read_file, 'full');
    assert.equal(out.default.execute_command, 'ask');
  });

  test('reads default map from v2 shape and ignores legacy perAgent/patterns', () => {
    const seed = defaultToolConfig().permissions.default;
    const out = normalizePermissionsFromStored(
      {
        default: { read_file: 'full' },
        perAgent: { main: { execute_command: 'full' } },
        patterns: [{ id: 'x', toolId: 'execute_command', agentScope: '*', argPath: 'command', match: 'equals', value: 'ls' }],
      },
      seed,
    );
    assert.equal(out.default.read_file, 'full');
    assert.equal(out.default.execute_command, seed.execute_command);
  });
});

describe('normalizeToolConfig', () => {
  test('loads legacy flat permissions unchanged in memory', () => {
    const config = normalizeToolConfig({
      enabled: { execute_command: true },
      permissions: { execute_command: 'ask' },
      keys: { braveApiKey: '' },
    });
    assert.equal(config.permissions.default.execute_command, 'ask');
  });
});

describe('resolveEffectivePermission', () => {
  test('returns catalog default for build mode', () => {
    const config = cloneConfig(defaultToolConfig());
    config.permissions.default.read_file = 'full';

    const resolved = resolveEffectivePermission(
      config,
      'read_file',
      { path: 'src/foo.ts' },
      { modeId: 'build' },
    );
    assert.equal(resolved.mode, 'full');
  });

  test('general mode honors global full', () => {
    const config = cloneConfig(defaultToolConfig());
    config.permissions.default.execute_command = 'full';

    const resolved = resolveEffectivePermission(
      config,
      'execute_command',
      { command: 'echo hi' },
      { modeId: 'general' },
    );
    assert.equal(resolved.mode, 'full');
  });

  test('general mode honors global ask', () => {
    const config = cloneConfig(defaultToolConfig());
    config.permissions.default.execute_command = 'ask';

    const resolved = resolveEffectivePermission(
      config,
      'execute_command',
      { command: 'echo hi' },
      { modeId: 'general' },
    );
    assert.equal(resolved.mode, 'ask');
  });

  test('global off is hard off', () => {
    const config = cloneConfig(defaultToolConfig());
    config.permissions.default.execute_command = 'off';

    const resolved = resolveEffectivePermission(
      config,
      'execute_command',
      { command: 'echo hi' },
      { modeId: 'general' },
    );
    assert.equal(resolved.mode, 'off');
  });

  test('bulk all-full sets full for every built-in', () => {
    const config = cloneConfig(defaultToolConfig());
    applyAllBuiltInToolPermissions(config, 'full');

    const resolved = resolveEffectivePermission(
      config,
      'execute_command',
      { command: 'echo hi' },
      { subAgentType: 'shell' },
    );
    assert.equal(resolved.mode, 'full');
  });
});
