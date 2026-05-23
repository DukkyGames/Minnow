/**
 * Supervisor rule priority (R9 before R6-style signals when both apply).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import type { Chat, OrchestrateBoardState } from '../../src/types.ts';
import type { SubAgentRun } from '../../src/agents/types.ts';
import { DEFAULT_SUPERVISOR_CONFIG } from '../../src/agents/supervisor/defaults.ts';
import {
  detectMissedOrchestratorHeartbeat,
  detectParentSilenceAfterTool,
} from '../../src/agents/supervisor/detector.ts';
import { pickSupervisorDecision, scanTickDetectors } from '../../src/agents/supervisor/rules.ts';
import type { DetectorContext } from '../../src/agents/supervisor/detector.ts';
import {
  getSupervisorChatState,
  resetSupervisorStateForTests,
} from '../../src/agents/supervisor/state.ts';

const CHAT_ID = '22222222-2222-2222-2222-222222222222';
const NOW = 2_000_000_000_000;

afterEach(() => {
  resetSupervisorStateForTests();
});

function ctx(overrides: Partial<DetectorContext> & Pick<DetectorContext, 'board' | 'sup'>): DetectorContext {
  const chat = {
    id: CHAT_ID,
    modeId: 'orchestrate',
  } as Chat;
  return {
    nowMs: NOW,
    cfg: { ...DEFAULT_SUPERVISOR_CONFIG, repetition: { ...DEFAULT_SUPERVISOR_CONFIG.repetition } },
    chat,
    listRuns: () => [],
    isStreaming: () => false,
    ...overrides,
  };
}

describe('scanTickDetectors + pickSupervisorDecision', () => {
  test('R9 budget beats lower-priority rules when task retries exhausted', () => {
    const board: OrchestrateBoardState = {
      planPath: 'p.md',
      startedAt: NOW - 120_000,
      lastUpdatedAt: NOW,
      waves: [{ id: 'W1', status: 'in_progress' }],
      tasks: [
        {
          id: 'T1',
          title: 't',
          wave: 'W1',
          category: 'build',
          status: 'failed',
          retryCount: DEFAULT_SUPERVISOR_CONFIG.maxRetriesPerTask,
        },
      ],
    };
    const sup = getSupervisorChatState(CHAT_ID);
    sup.awaitingUserDecision = false;
    sup.recoveryInFlight = false;
    const c = ctx({ board, sup });
    const hit = scanTickDetectors(c);
    assert.ok(hit);
    assert.equal(hit?.rule, 'R9');
    const decision = pickSupervisorDecision(c, hit);
    assert.equal(decision.action, 'escalate_user');
  });

  test('scanTickDetectors skips all rules when user stopped the orchestrator', () => {
    const board: OrchestrateBoardState = {
      planPath: 'p.md',
      startedAt: NOW - 600_000,
      lastUpdatedAt: NOW,
      waves: [{ id: 'W1', status: 'in_progress' }],
      tasks: [{ id: 'T1', title: 't', wave: 'W1', category: 'build', status: 'planned' }],
    };
    const sup = getSupervisorChatState(CHAT_ID);
    sup.awaitingUserDecision = false;
    sup.recoveryInFlight = false;
    sup.lastTerminalAt = NOW - 120_000;
    sup.lastOrchestratorProgressAt = NOW - 120_000;
    const chat = {
      id: CHAT_ID,
      modeId: 'orchestrate',
      orchestrateBoard: board,
      history: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: 'partial', stopped: true },
      ],
    } as Chat;
    const c = ctx({ board, sup, chat });
    assert.equal(detectMissedOrchestratorHeartbeat(c)?.rule, 'R7');
    assert.equal(scanTickDetectors(c), null);
  });

  test('R7 does not fire on idle board with only startedAt (new chat / reload)', () => {
    const board: OrchestrateBoardState = {
      planPath: 'p.md',
      startedAt: NOW - 600_000,
      lastUpdatedAt: NOW,
      waves: [{ id: 'W1', status: 'planned' }],
      tasks: [{ id: 'T1', title: 't', wave: 'W1', category: 'build', status: 'planned' }],
    };
    const sup = getSupervisorChatState(CHAT_ID);
    sup.awaitingUserDecision = false;
    sup.recoveryInFlight = false;
    const c = ctx({ board, sup });
    assert.equal(detectMissedOrchestratorHeartbeat(c), null);
    assert.equal(scanTickDetectors(c), null);
  });

  test('all-complete board does not tick inject_resume when R7 would match', () => {
    const board: OrchestrateBoardState = {
      planPath: 'p.md',
      startedAt: NOW - 600_000,
      lastUpdatedAt: NOW,
      waves: [{ id: 'W1', status: 'complete' }],
      tasks: [
        { id: 'T1', title: 'a', wave: 'W1', category: 'build', status: 'complete' },
        { id: 'T2', title: 'b', wave: 'W1', category: 'test', status: 'complete' },
      ],
    };
    const sup = getSupervisorChatState(CHAT_ID);
    sup.awaitingUserDecision = false;
    sup.recoveryInFlight = false;
    sup.lastReportAt = NOW - 600_000;
    sup.lastOrchestratorProgressAt = NOW - 600_000;
    const c = ctx({ board, sup });
    assert.equal(detectMissedOrchestratorHeartbeat(c)?.rule, 'R7');
    assert.equal(scanTickDetectors(c), null);
    const silence = detectParentSilenceAfterTool({
      ...c,
      sup: {
        ...sup,
        lastParentStreamEndedAt: NOW - 120_000,
        lastParentToolResultAt: NOW - 130_000,
      },
    });
    assert.equal(silence?.rule, 'R4');
    assert.equal(scanTickDetectors({ ...c, sup: { ...sup, lastParentStreamEndedAt: NOW - 120_000, lastParentToolResultAt: NOW - 130_000 } }), null);
  });

  test('pickSupervisorDecision downgrades inject_resume when board is complete', () => {
    const board: OrchestrateBoardState = {
      planPath: 'p.md',
      startedAt: NOW - 120_000,
      lastUpdatedAt: NOW,
      waves: [{ id: 'W1', status: 'complete' }],
      tasks: [{ id: 'T1', title: 't', wave: 'W1', category: 'build', status: 'complete' }],
    };
    const c = ctx({ board, sup: getSupervisorChatState(CHAT_ID) });
    const decision = pickSupervisorDecision(c, { rule: 'R7' });
    assert.equal(decision.action, 'none');
  });

  test('flags block tick evaluation', () => {
    const board: OrchestrateBoardState = {
      planPath: 'p.md',
      startedAt: NOW - 120_000,
      lastUpdatedAt: NOW,
      waves: [{ id: 'W1', status: 'in_progress' }],
      tasks: [{ id: 'T1', title: 't', wave: 'W1', category: 'build', status: 'failed' }],
    };
    const sup = getSupervisorChatState(CHAT_ID);
    sup.awaitingUserDecision = true;
    const c = ctx({ board, sup });
    assert.equal(scanTickDetectors(c), null);
  });
});
