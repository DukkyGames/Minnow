/**
 * Preflight: sub-agent run fails when no model can be resolved (type + parent chat).
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  resetSubAgentOrchestrator,
  setSubAgentApiFetchForTests,
  setSubAgentOpenStreamForTests,
  spawnSubAgent,
} from '../../src/agents/orchestrator.ts';
import {
  resetSubAgentConfigCache,
} from '../../src/agents/sub-agent-config.ts';
import {
  resetSubAgentRunIdFactory,
  setSubAgentRunIdFactory,
} from '../../src/agents/sub-agent-run-id.ts';
import { FIXED_RUN_ID } from './test-helpers.mts';

describe('sub-agent preflight model binding', () => {
  beforeEach(() => {
    resetSubAgentOrchestrator();
    resetSubAgentConfigCache();
    resetSubAgentRunIdFactory();
    setSubAgentRunIdFactory(() => FIXED_RUN_ID);
    setSubAgentOpenStreamForTests(() => ({ addEventListener() {}, close() {} }));
    setSubAgentApiFetchForTests(async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error:
            'no model bound for this attempt: set Settings → Autopilot planner model, or select a model in the menubar',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  });

  test('wait spawn fails fast when model id is empty and parent chat omits model', async () => {
    await assert.rejects(
      () =>
        spawnSubAgent({
          type: 'explore',
          task: 'read only probe',
          wait: true,
          parentTurnId: 'preflight-no-model',
          parentChatId: undefined,
          modeId: 'orchestrate',
        }),
      /no model bound for this attempt/,
    );
  });
});
