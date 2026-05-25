import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  getSubAgentsMaxToolTurns,
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

  test('all types share global maxToolTurns', () => {
    const merged = mergeSubAgentConfig(DEFAULTS as never, null);
    assert.equal(getSubAgentsMaxToolTurns(merged), 12);
    assert.equal(merged.types.generalPurpose.maxToolTurns, 12);
    assert.equal(merged.types.explore.maxToolTurns, 12);
  });

  test('user global maxToolTurns applies to every type', () => {
    const merged = mergeSubAgentConfig(DEFAULTS as never, {
      maxToolTurns: 24,
      types: { explore: { maxToolTurns: 4 } },
    });
    assert.equal(getSubAgentsMaxToolTurns(merged), 24);
    assert.equal(merged.types.explore.maxToolTurns, 24);
    assert.equal(merged.types.generalPurpose.maxToolTurns, 24);
  });

  test('migrates legacy defaultMaxToolTurns', () => {
    const merged = mergeSubAgentConfig(DEFAULTS as never, {
      defaultMaxToolTurns: 20,
    });
    assert.equal(getSubAgentsMaxToolTurns(merged), 20);
  });

  test('researcher type is registered with read-only allow list', () => {
    const merged = mergeSubAgentConfig(DEFAULTS as never, null);
    const r = merged.types.researcher;
    assert.ok(r);
    assert.equal(r.label, 'Research worker');
    assert.equal(r.maxToolTurns, 12);
    assert.equal(r.maxConcurrent, 5);
    assert.equal(r.timeoutMs, 420000);
    assert.ok(r.allowedTools?.includes('web_search'));
    assert.ok(r.deniedTools.includes('save_file'));
    assert.ok(r.deniedTools.includes('spawn_sub_agent'));
  });

  test('user override merges sampler fields on a type', () => {
    const merged = mergeSubAgentConfig(DEFAULTS as never, {
      types: {
        explore: { sampler: { temperature: 0.6 } },
      },
    });
    assert.equal(merged.types.explore.sampler?.temperature, 0.6);
    assert.equal(merged.types.explore.sampler?.topP, 0.92);
  });

  test('user override can set maxInputTokens and context policy', () => {
    const merged = mergeSubAgentConfig(DEFAULTS as never, {
      types: {
        explore: {
          maxInputTokens: 32000,
          contextEnforcementPolicy: 'summarize',
        },
      },
    });
    assert.equal(merged.types.explore.maxInputTokens, 32000);
    assert.equal(merged.types.explore.contextEnforcementPolicy, 'summarize');
  });

  test('merge applies default summarySchema to types', () => {
    const merged = mergeSubAgentConfig(DEFAULTS as never, null);
    assert.equal(merged.types.explore.summarySchema, 'minnow.sub-agent.explore');
    assert.equal(merged.types['reef-widget'].summarySchema, 'minnow.sub-agent.lite');
    assert.equal(merged.defaultSummarySchema, 'minnow.sub-agent.v1');
  });

  test('user override can set summarySchema per type', () => {
    const merged = mergeSubAgentConfig(DEFAULTS as never, {
      types: { shell: { summarySchema: 'minnow.sub-agent.lite' } },
    });
    assert.equal(merged.types.shell.summarySchema, 'minnow.sub-agent.lite');
  });
});
