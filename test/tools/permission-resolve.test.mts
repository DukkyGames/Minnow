/**
 * Tests for layered tool permission resolution (patterns, per-agent, default).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { defaultToolConfig } from '../../src/config/defaults.ts';
import {
  isLegacyFlatPermissions,
  normalizePermissionsFromStored,
  normalizeToolConfig,
} from '../../src/tools/config.ts';
import {
  findMatchingApprovalPattern,
  getArgValueAtPath,
  resolveEffectivePermission,
  resolveToolAgentKey,
} from '../../src/tools/permission-resolve.ts';
import type { ToolConfig } from '../../src/tools/tool-settings-types.ts';

function cloneConfig(base: ToolConfig): ToolConfig {
  return {
    enabled: { ...base.enabled },
    permissions: {
      default: { ...base.permissions.default },
      perAgent: JSON.parse(JSON.stringify(base.permissions.perAgent)),
      patterns: base.permissions.patterns.map((p) => ({ ...p })),
    },
    keys: { ...base.keys },
  };
}

describe('isLegacyFlatPermissions', () => {
  test('detects flat map', () => {
    assert.equal(isLegacyFlatPermissions({ execute_command: 'ask' }), true);
  });

  test('rejects v2 shape', () => {
    assert.equal(
      isLegacyFlatPermissions({ default: { execute_command: 'ask' }, perAgent: {}, patterns: [] }),
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
    assert.deepEqual(out.perAgent, {});
    assert.deepEqual(out.patterns, []);
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
    assert.deepEqual(config.permissions.perAgent, {});
    assert.deepEqual(config.permissions.patterns, []);
  });
});

describe('resolveToolAgentKey', () => {
  test('sub-agent wins over work agent', () => {
    assert.equal(
      resolveToolAgentKey({ subAgentType: 'shell', workAgentId: 'builder' }),
      'sub-agent:shell',
    );
  });

  test('work agent when set on main loop', () => {
    assert.equal(resolveToolAgentKey({ workAgentId: 'builder' }), 'work-agent:builder');
  });

  test('main when neither set', () => {
    assert.equal(resolveToolAgentKey({}), 'main');
  });
});

describe('findMatchingApprovalPattern', () => {
  test('startsWith on command', () => {
    const config = cloneConfig(defaultToolConfig());
    config.permissions.default.execute_command = 'ask';
    config.permissions.patterns.push({
      id: 'pattern-11111111-1111-1111-1111-111111111111',
      toolId: 'execute_command',
      agentScope: '*',
      argPath: 'command',
      match: 'startsWith',
      value: 'git status',
    });

    const match = findMatchingApprovalPattern(
      config,
      'execute_command',
      { command: 'git status -sb' },
      'main',
    );
    assert.ok(match);
    assert.equal(match.value, 'git status');
  });

  test('no match for dangerous command', () => {
    const config = cloneConfig(defaultToolConfig());
    config.permissions.default.execute_command = 'ask';
    config.permissions.patterns.push({
      id: 'pattern-11111111-1111-1111-1111-111111111111',
      toolId: 'execute_command',
      agentScope: '*',
      argPath: 'command',
      match: 'startsWith',
      value: 'git status',
    });

    const match = findMatchingApprovalPattern(
      config,
      'execute_command',
      { command: 'rm -rf /' },
      'main',
    );
    assert.equal(match, null);
  });
});

describe('resolveEffectivePermission', () => {
  test('pattern auto-approves when global is ask', () => {
    const config = cloneConfig(defaultToolConfig());
    config.permissions.default.execute_command = 'ask';
    config.permissions.patterns.push({
      id: 'pattern-11111111-1111-1111-1111-111111111111',
      toolId: 'execute_command',
      agentScope: '*',
      argPath: 'command',
      match: 'startsWith',
      value: 'git status',
    });

    const resolved = resolveEffectivePermission(
      config,
      'execute_command',
      { command: 'git status' },
      {},
    );
    assert.equal(resolved.mode, 'full');
    assert.ok(resolved.matchedPattern);
  });

  test('per-agent full overrides global ask', () => {
    const config = cloneConfig(defaultToolConfig());
    config.permissions.default.execute_command = 'ask';
    config.permissions.perAgent['sub-agent:shell'] = { execute_command: 'full' };

    const resolved = resolveEffectivePermission(
      config,
      'execute_command',
      { command: 'rm -rf /' },
      { subAgentType: 'shell' },
    );
    assert.equal(resolved.mode, 'full');
    assert.equal(resolved.agentKey, 'sub-agent:shell');
  });

  test('global off is hard off', () => {
    const config = cloneConfig(defaultToolConfig());
    config.permissions.default.execute_command = 'off';
    config.permissions.perAgent['sub-agent:shell'] = { execute_command: 'full' };
    config.permissions.patterns.push({
      id: 'pattern-11111111-1111-1111-1111-111111111111',
      toolId: 'execute_command',
      agentScope: '*',
      argPath: 'command',
      match: 'startsWith',
      value: 'git status',
    });

    const resolved = resolveEffectivePermission(
      config,
      'execute_command',
      { command: 'git status' },
      { subAgentType: 'shell' },
    );
    assert.equal(resolved.mode, 'off');
  });
});

describe('getArgValueAtPath', () => {
  test('reads nested path', () => {
    assert.equal(getArgValueAtPath({ options: { cwd: '/tmp' } }, 'options.cwd'), '/tmp');
  });
});
