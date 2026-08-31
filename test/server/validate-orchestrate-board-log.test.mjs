/**
 * Validator — orchestrate board log round-trip and sanitization.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateSessionState } from '../../server/config/validators.js';

const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const PLAN_PATH = 'documentation/plans/board-log-validator.md';

function basePayload(log) {
  return {
    version: 5,
    activeId: PLANNER_ID,
    sidebarCollapsed: false,
    chats: [
      {
        id: PLANNER_ID,
        name: 'Planner',
        workspacePath: '/tmp/ws',
        modelId: 'm1',
        modeId: 'orchestrate',
        history: [],
        updatedAt: 1,
        boardGroupId: GROUP_ID,
      },
    ],
    groups: [
      {
        id: GROUP_ID,
        name: 'Board',
        workspacePath: '/tmp/ws',
        collapsed: false,
        order: 0,
        createdAt: 1,
        plannerChatId: PLANNER_ID,
        orchestratePlanPath: PLAN_PATH,
        orchestrateBoard: {
          planPath: PLAN_PATH,
          status: 'stopped',
          startedAt: 1,
          lastUpdatedAt: 2,
          tasks: [
            {
              id: 'W1-A',
              title: 'Task',
              wave: 'W1',
              category: 'build',
              status: 'planned',
            },
          ],
          waves: [{ id: 'W1', status: 'planned' }],
          log,
        },
      },
    ],
  };
}

describe('validateSessionState board log', () => {
  it('round-trips valid log events', () => {
    const log = [
      {
        id: '1710000001000-0',
        ts: 1710000001000,
        type: 'task_status',
        level: 'info',
        taskId: 'W1-A',
        message: 'W1-A: planned → in_progress',
        detail: { from: 'planned', to: 'in_progress' },
      },
      {
        id: '1710000001000-1',
        ts: 1710000001000,
        type: 'tool_call',
        level: 'error',
        taskId: 'W1-A',
        message: 'W1-A: read_file',
        detail: {
          toolName: 'read_file',
          argsPreview: '{"path":"src/a.ts"}',
          resultPreview: 'Error: not found',
        },
      },
    ];
    const out = validateSessionState(basePayload(log));
    assert.deepEqual(out.groups[0].orchestrateBoard.log, log);
  });

  it('drops malformed events and strips unknown detail keys', () => {
    const log = [
      null,
      { id: 'x', ts: 'bad', type: 'task_status', message: 'nope' },
      {
        id: '1710000001000-2',
        ts: 1710000001000,
        type: 'not_a_real_type',
        level: 'info',
        message: 'bad type',
      },
      {
        id: '1710000001000-3',
        ts: 1710000001000,
        type: 'merge_result',
        level: 'info',
        taskId: 'W1-A',
        message: 'ok',
        detail: { outcome: 'merged', branch: 'task/w1-a', hacker: 'drop-me' },
      },
    ];
    const out = validateSessionState(basePayload(log));
    assert.deepEqual(out.groups[0].orchestrateBoard.log, [
      {
        id: '1710000001000-3',
        ts: 1710000001000,
        type: 'merge_result',
        level: 'info',
        taskId: 'W1-A',
        message: 'ok',
        detail: { outcome: 'merged', branch: 'task/w1-a' },
      },
    ]);
  });

  it('round-trips quarantine, nudge, and Phase-2 durable evidence', () => {
    const rows = [
      ['task_quarantined', { from: 'testing', to: 'quarantined', cause: 'root', category: 'code' }],
      ['nudge', { attempt: 2, attemptKind: 'nudge', reason: 'missing report' }],
      ['phase_start', { phaseId: 'phase-1', phase: 'build', lifecycleRun: 3, ownerId: 'chat-1' }],
      ['phase_end', { phaseId: 'phase-1', phase: 'build', lifecycleRun: 3, durationMs: 42 }],
      ['slot_acquire', { slotId: 'slot-1', phase: 'build', ownerId: 'chat-1' }],
      ['slot_release', { slotId: 'slot-1', reason: 'phase complete' }],
      ['hold_acquire', { holdId: 'hold-1', holdKind: 'merge', ownerId: 'run-1' }],
      ['hold_release', { holdId: 'hold-1', holdKind: 'merge' }],
      ['hold_expiry', { holdId: 'hold-2', holdKind: 'fixer', reason: 'ttl' }],
      ['concurrency_observation', {
        activeSlots: 1,
        activeHolds: 1,
        activeTotal: 2,
        concurrencyCap: 3,
      }],
      ['lifecycle_owner_set', {
        lifecycleRun: 3,
        ownerId: 'chat-1',
        ownerKind: 'chat',
      }],
      ['lifecycle_owner_clear', {
        lifecycleRun: 3,
        ownerId: 'chat-1',
        ownerKind: 'chat',
      }],
      ['board_terminal', { terminalOutcome: 'blocked', reason: 'bounded quarantine' }],
      ['planner_report', { reportId: 'report-1', summary: 'done' }],
      ['completion_notification', { notificationId: 'notification-1' }],
      ['interaction_required', { interactionKind: 'approval', reason: 'permission ask' }],
    ].map(([type, detail], index) => ({
      id: `1710000002000-${index}`,
      ts: 1710000002000 + index,
      type,
      level: 'info',
      ...(type === 'board_terminal' ? {} : { taskId: 'W1-A' }),
      message: String(type),
      detail,
    }));

    const out = validateSessionState(basePayload(rows));
    assert.deepEqual(out.groups[0].orchestrateBoard.log, rows);
  });

  it('truncates oversized log on load and long detail strings', () => {
    const long = 'x'.repeat(3000);
    const log = Array.from({ length: 510 }, (_, i) => ({
      id: `1710000001000-${i}`,
      ts: 1710000001000 + i,
      type: 'tool_call',
      level: 'info',
      message: `row-${i}`,
      detail: { summary: long },
    }));
    const out = validateSessionState(basePayload(log));
    const saved = out.groups[0].orchestrateBoard.log;
    assert.equal(saved.length, 500);
    assert.equal(saved[0].id, '1710000001000-10');
    assert.ok(saved[0].detail.summary.length <= 2001);
    assert.ok(saved[0].detail.summary.endsWith('…'));
  });
});
