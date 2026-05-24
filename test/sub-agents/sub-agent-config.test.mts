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

  test('types include per-type maxToolTurns defaults', () => {
    const merged = mergeSubAgentConfig(DEFAULTS as never, null);
    assert.equal(merged.types.generalPurpose.maxToolTurns, 16);
    assert.equal(merged.types.explore.maxToolTurns, 12);
    assert.equal(merged.defaultMaxToolTurns, 12);
  });

  test('user override can raise maxToolTurns for a type', () => {
    const merged = mergeSubAgentConfig(DEFAULTS as never, {
      types: { explore: { maxToolTurns: 24 } },
    });
    assert.equal(merged.types.explore.maxToolTurns, 24);
    assert.equal(merged.types.generalPurpose.maxToolTurns, 16);
  });

  test('researcher type is registered with read-only allow list', () => {
    const merged = mergeSubAgentConfig(DEFAULTS as never, null);
    const r = merged.types.researcher;
    assert.ok(r);
    assert.equal(r.label, 'Research worker');
    assert.equal(r.maxToolTurns, 16);
    assert.equal(r.maxConcurrent, 5);
    assert.equal(r.timeoutMs, 420000);
    assert.ok(r.allowedTools?.includes('web_search'));
    assert.ok(r.deniedTools.includes('save_file'));
    assert.ok(r.deniedTools.includes('spawn_sub_agent'));
  });
});
