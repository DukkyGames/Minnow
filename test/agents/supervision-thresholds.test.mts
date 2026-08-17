/**
 * Supervision thresholds resolve from one store, so the sub-agent watchdog and
 * orchestrate boards can never disagree about the shared heartbeat singleton.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  resetSubAgentConfigCache,
  setRuntimeSubAgentOverrides,
} from '../../src/agents/sub-agent-config.ts';
import {
  resetAutopilotMetaCache,
  setAutopilotMetaForTests,
} from '../../src/config/autopilot-meta.ts';
import {
  DEFAULT_SUPERVISION_THRESHOLDS,
  resolveSupervisionThresholds,
} from '../../src/config/supervision-thresholds.ts';

describe('supervision thresholds', () => {
  beforeEach(() => {
    resetSubAgentConfigCache();
    resetAutopilotMetaCache();
  });

  afterEach(() => {
    resetSubAgentConfigCache();
    resetAutopilotMetaCache();
  });

  test('falls back to shipped defaults', () => {
    setRuntimeSubAgentOverrides(null);
    setAutopilotMetaForTests({});
    assert.deepEqual(resolveSupervisionThresholds(), DEFAULT_SUPERVISION_THRESHOLDS);
  });

  test('sub-agents overrides apply', () => {
    setRuntimeSubAgentOverrides({
      progressStallMs: 600_000,
      heartbeatDeadMs: 120_000,
      heartbeatIntervalMs: 15_000,
    });
    setAutopilotMetaForTests({});

    const resolved = resolveSupervisionThresholds();
    assert.equal(resolved.progressStallMs, 600_000);
    assert.equal(resolved.heartbeatDeadMs, 120_000);
    assert.equal(resolved.heartbeatIntervalMs, 15_000);
  });

  test('legacy autopilot values still apply when sub-agents has no override', () => {
    setRuntimeSubAgentOverrides(null);
    setAutopilotMetaForTests({ progressStallMs: 300_000, heartbeatDeadMs: 90_000 });

    const resolved = resolveSupervisionThresholds();
    assert.equal(resolved.progressStallMs, 300_000);
    assert.equal(resolved.heartbeatDeadMs, 90_000);
    // Untouched autopilot fields must not shadow the shipped default.
    assert.equal(
      resolved.heartbeatIntervalMs,
      DEFAULT_SUPERVISION_THRESHOLDS.heartbeatIntervalMs,
    );
  });

  test('sub-agents override beats the legacy autopilot value', () => {
    setRuntimeSubAgentOverrides({ progressStallMs: 600_000 });
    setAutopilotMetaForTests({ progressStallMs: 300_000 });
    assert.equal(resolveSupervisionThresholds().progressStallMs, 600_000);
  });

  test('out-of-range values are preserved; zero disables', () => {
    setRuntimeSubAgentOverrides({
      progressStallMs: 999_999_999,
      heartbeatDeadMs: 0,
      heartbeatIntervalMs: 999_999,
    });
    setAutopilotMetaForTests({});

    const resolved = resolveSupervisionThresholds();
    assert.equal(resolved.progressStallMs, 999_999_999);
    assert.equal(resolved.heartbeatDeadMs, 0);
    assert.equal(resolved.heartbeatIntervalMs, 999_999);
  });
});
