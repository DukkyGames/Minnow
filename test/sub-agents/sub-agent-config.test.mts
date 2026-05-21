import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  loadSubAgentConfig,
  mergeSubAgentConfig,
  resetSubAgentConfigCache,
  setRuntimeSubAgentOverrides,
} from '../../src/agents/sub-agent-config.ts';
import DEFAULTS from '../../src/agents/defaults/sub-agents.json';

describe('sub-agent config', () => {
  beforeEach(() => {
    resetSubAgentConfigCache();
    setRuntimeSubAgentOverrides(null);
  });

  test('merge defaults with user overrides', () => {
    const merged = mergeSubAgentConfig(DEFAULTS as never, {
      globalMaxConcurrent: 1,
      types: {
        explore: { maxConcurrent: 1 },
      },
    });
    assert.equal(merged.globalMaxConcurrent, 1);
    assert.equal(merged.types.explore.maxConcurrent, 1);
    assert.ok(merged.types.generalPurpose);
  });

  test('disabled master flag in merged config', async () => {
    setRuntimeSubAgentOverrides({ enabled: false });
    const config = await loadSubAgentConfig();
    assert.equal(config.enabled, false);
  });

  test('reef-widget type is registered with read-only allow list', () => {
    const merged = mergeSubAgentConfig(DEFAULTS as never, null);
    const reef = merged.types['reef-widget'];
    assert.ok(reef);
    assert.ok(reef.allowedTools?.includes('read_file'));
    assert.ok(reef.deniedTools.includes('save_file'));
  });
});
