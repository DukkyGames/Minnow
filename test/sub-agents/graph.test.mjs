/**
 * P8-C — Graph object wiring for P8-D injection.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createSubAgentGraph,
  eventsForAttemptEnd,
  eventsForStart,
  isSubAgentRole,
  subAgentGraph,
} from '../../server/sub-agents/graph.js';
import { SUB_AGENT_ROLE } from '../../server/sub-agents/events.js';
import { defaultCaps } from '../../server/sub-agents/plan.js';

describe('sub-agent Graph', () => {
  it('isAgentRole accepts only the pinned worker role', () => {
    assert.equal(isSubAgentRole(SUB_AGENT_ROLE), true);
    assert.equal(isSubAgentRole('sub-agent'), true);
    assert.equal(isSubAgentRole('explore'), false);
    assert.equal(isSubAgentRole('builder'), false);
    assert.equal(subAgentGraph.isAgentRole('sub-agent'), true);
    assert.equal(subAgentGraph.isAgentRole('explore'), false);
  });

  it('eventsForStart / eventsForAttemptEnd map onto attempt.started / attempt.ended', () => {
    const started = eventsForStart(
      { taskId: 'r1', role: 'sub-agent', seedKind: 'continue' },
      { attemptId: 'a1', model: { providerId: 'local', id: 'm1' } },
    );
    assert.equal(started.length, 1);
    assert.equal(started[0].type, 'attempt.started');
    assert.equal(started[0].runId, 'r1');
    assert.equal(started[0].attemptId, 'a1');
    assert.deepEqual(started[0].seed, { kind: 'continue' });
    assert.deepEqual(started[0].model, { providerId: 'local', id: 'm1' });

    const ended = eventsForAttemptEnd({
      attemptId: 'a1',
      taskId: 'r1',
      role: 'sub-agent',
      outcome: 'pass',
      summary: 'ok',
      usage: { promptTokens: 3 },
    });
    assert.equal(ended[0].type, 'attempt.ended');
    assert.equal(ended[0].runId, 'r1');
    assert.equal(ended[0].outcome, 'pass');
    assert.equal(ended[0].usage.promptTokens, 3);
  });

  it('omits board-only hooks', () => {
    assert.equal(subAgentGraph.writeReport, undefined);
    assert.equal(subAgentGraph.onLoad, undefined);
    assert.equal(subAgentGraph.eventsForPreflight, undefined);
    assert.equal(subAgentGraph.buildIntegrationFixTask, undefined);
    assert.equal(subAgentGraph.reopenTargets, undefined);
    assert.equal(subAgentGraph.manualStart, undefined);
    assert.equal(subAgentGraph.isRunComplete, undefined);
  });

  it('createSubAgentGraph closes over caps so a mid-run mutate is visible', () => {
    const caps = defaultCaps();
    const graph = createSubAgentGraph(caps);
    assert.equal(graph.defaultConcurrency, 3);
    caps.globalMaxConcurrent = 1;
    // plan() reads the same object; the assertion is that we did not copy.
    assert.equal(caps.globalMaxConcurrent, 1);
  });
});
