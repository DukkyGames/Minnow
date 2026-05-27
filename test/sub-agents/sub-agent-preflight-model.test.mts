/**
 * Preflight: sub-agent run fails when no model can be resolved (type + parent chat).
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { resetSubAgentOrchestrator, spawnSubAgent } from '../../src/agents/orchestrator.ts';
import {
  resetSubAgentConfigCache,
  setRuntimeSubAgentOverrides,
} from '../../src/agents/sub-agent-config.ts';
import {
  resetSubAgentRunIdFactory,
  setSubAgentRunIdFactory,
} from '../../src/agents/sub-agent-run-id.ts';
import { resetSubAgentRunnerFactory } from '../../src/agents/sub-agent-runner.ts';
import { FIXED_RUN_ID } from './test-helpers.mts';

describe('sub-agent preflight model binding', () => {
  beforeEach(() => {
    resetSubAgentOrchestrator();
    resetSubAgentConfigCache();
    resetSubAgentRunnerFactory();
    resetSubAgentRunIdFactory();
    setSubAgentRunIdFactory(() => FIXED_RUN_ID);
    setRuntimeSubAgentOverrides(null);
  });

  test('wait spawn fails fast when model id is empty and parent chat omits model', async () => {
    setRuntimeSubAgentOverrides({
      types: {
        explore: {
          modelId: '',
          providerId: 'lm-studio-local',
        },
      },
    });

    const result = await spawnSubAgent({
      type: 'explore',
      task: 'read only probe',
      wait: true,
      parentTurnId: 'preflight-no-model',
      parentChatId: undefined,
      modeId: 'orchestrate',
    });

    assert.equal(result.status, 'failed');
    assert.match(result.error ?? '', /No model selected for sub-agent/);
  });
});
