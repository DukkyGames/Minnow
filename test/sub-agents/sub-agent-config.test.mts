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

  test('shipped defaults include checkInNudgeMs', () => {
    const merged = mergeSubAgentConfig(DEFAULTS as never, null);
    assert.equal(merged.checkInNudgeMs, 120_000);
  });

  test('user checkInNudgeMs clamped and zero disables', () => {
    const disabled = mergeSubAgentConfig(DEFAULTS as never, { checkInNudgeMs: 0 });
    assert.equal(disabled.checkInNudgeMs, 0);
    const high = mergeSubAgentConfig(DEFAULTS as never, { checkInNudgeMs: 9_999_999 });
    assert.equal(high.checkInNudgeMs, 1_800_000);
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
    assert.equal(getSubAgentsMaxToolTurns(merged), 100);
    assert.equal(merged.types.generalPurpose.maxToolTurns, 100);
    assert.equal(merged.types.explore.maxToolTurns, 100);
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

  test('user thinkingBudgetTokens clamped on merge', () => {
    const merged = mergeSubAgentConfig(DEFAULTS as never, {
      types: {
        explore: { thinkingBudgetTokens: 100 },
      },
    });
    assert.equal(merged.types.explore.thinkingBudgetTokens, 100);
    const zero = mergeSubAgentConfig(DEFAULTS as never, {
      types: { explore: { thinkingBudgetTokens: 0 } },
    });
    assert.equal(zero.types.explore.thinkingBudgetTokens, 0);
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
    assert.equal(r.maxToolTurns, 100);
    assert.equal(r.maxConcurrent, 5);
    assert.equal(r.timeoutMs, 420000);
    assert.ok(r.allowedTools?.includes('web_search'));
    assert.ok(r.deniedTools.includes('save_file'));
    assert.ok(r.deniedTools.includes('spawn_sub_agent'));
  });

  test('plan-reviewer type is registered with read-only allow list', () => {
    const merged = mergeSubAgentConfig(DEFAULTS as never, null);
    const r = merged.types['plan-reviewer'];
    assert.ok(r);
    assert.equal(r.label, 'Plan reviewer');
    assert.equal(r.maxConcurrent, 2);
    assert.equal(r.summarySchema, 'minnow.sub-agent.v1');
    assert.ok(r.allowedTools?.includes('read_file'));
    assert.ok(r.allowedTools?.includes('grep'));
    assert.ok(r.allowedTools?.includes('git_log'));
    assert.ok(r.allowedTools?.includes('web_search'));
    assert.ok(!r.allowedTools?.includes('execute_command'));
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
    assert.equal(merged.types.explore.sampler?.topP, 0.8);
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

  test('migrates legacy lm-studio-local provider to inherit when model is empty', () => {
    const merged = mergeSubAgentConfig(DEFAULTS as never, {
      types: {
        explore: { providerId: 'lm-studio-local', modelId: '' },
      },
    });
    assert.equal(merged.types.explore.providerId, '');
  });

  test('keeps explicit lm-studio-local when model is set', () => {
    const merged = mergeSubAgentConfig(DEFAULTS as never, {
      types: {
        explore: { providerId: 'lm-studio-local', modelId: 'local-model' },
      },
    });
    assert.equal(merged.types.explore.providerId, 'lm-studio-local');
    assert.equal(merged.types.explore.modelId, 'local-model');
  });

  test('shipped defaults use empty provider for inheritance', () => {
    const merged = mergeSubAgentConfig(DEFAULTS as never, null);
    assert.equal(merged.types.explore.providerId, '');
    assert.equal(merged.types.generalPurpose.providerId, '');
  });
});
