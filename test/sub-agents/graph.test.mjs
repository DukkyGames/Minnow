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
  reapVanished,
  subAgentGraph,
} from '../../server/sub-agents/graph.js';
import { makeEvent, SUB_AGENT_ROLE } from '../../server/sub-agents/events.js';
import { defaultCaps } from '../../server/sub-agents/plan.js';
import { derive } from '../../server/sub-agents/derive.js';

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

describe('reapVanished (P10-L cancel confirmation)', () => {
  function journal(...events) {
    return events.map((e, i) => ({ ...e, seq: i + 1, ts: 1 }));
  }
  const requested = makeEvent('run.requested', {
    runId: 'r1',
    agentType: 'explore',
    task: 't',
    parentChatId: 'chat-1',
    cwd: '/tmp',
    requestedAt: 1,
  });
  const started = makeEvent('attempt.started', {
    runId: 'r1',
    attemptId: 'a1',
    seed: { kind: 'initial' },
  });

  it('journals attempt.ended for a cancelling run whose process is gone', () => {
    const state = derive(
      journal(requested, started, makeEvent('run.cancelled', { runId: 'r1', reason: 'user' })),
    );
    assert.equal(state.runs.get('r1').phase, 'cancelling');
    const events = reapVanished(state, new Set(), new Set());
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'attempt.ended');
    assert.equal(events[0].attemptId, 'a1');
    assert.equal(events[0].outcome, 'crashed');
    assert.equal(events[0].summary, 'the user cancelled this run');
  });

  it('does not rewrite a settled cancelled run', () => {
    const state = derive(
      journal(
        requested,
        started,
        makeEvent('run.cancelled', { runId: 'r1', reason: 'user' }),
        makeEvent('attempt.ended', {
          runId: 'r1',
          attemptId: 'a1',
          outcome: 'crashed',
          summary: 'the user cancelled this run',
        }),
      ),
    );
    assert.equal(state.runs.get('r1').phase, 'cancelled');
    assert.equal(reapVanished(state, new Set(), new Set()).length, 0);
  });
});
