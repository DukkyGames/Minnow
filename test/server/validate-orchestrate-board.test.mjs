/**
 * Server session validator — orchestrate board running state survives PUT round-trip.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mergeConfigMeta, validateSessionState } from '../../server/config/validators.js';

const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const PLAN_PATH = 'documentation/plans/reload-persist.md';

describe('validateSessionState orchestrate board', () => {
  it('preserves autoRunning, sequential mode, and task chat links on save', () => {
    const out = validateSessionState({
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
            executionMode: 'sequential',
            autoRunning: true,
            startedAt: 1,
            lastUpdatedAt: 2,
            tasks: [
              {
                id: 'W1-A',
                title: 'Task',
                wave: 'W1',
                category: 'build',
                status: 'in_progress',
                chatId: '22222222-2222-2222-2222-222222222222',
                testChatId: '33333333-3333-3333-3333-333333333333',
              },
            ],
            waves: [{ id: 'W1', status: 'in_progress' }],
            finalTest: { status: 'pending' },
          },
        },
      ],
    });

    const board = out.groups[0].orchestrateBoard;
    assert.equal(board.executionMode, 'sequential');
    assert.equal(board.autoRunning, true);
    assert.equal(board.tasks[0].chatId, '22222222-2222-2222-2222-222222222222');
    assert.equal(board.tasks[0].testChatId, '33333333-3333-3333-3333-333333333333');
    assert.equal(board.finalTest?.status, 'pending');
  });

  it('preserves afk executionMode on save', () => {
    const out = validateSessionState({
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
            executionMode: 'afk',
            autoRunning: true,
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
          },
        },
      ],
    });

    const board = out.groups[0].orchestrateBoard;
    assert.equal(board.executionMode, 'afk');
    assert.equal(board.autoRunning, true);
  });

  it('coerces junk executionMode to manual', () => {
    const out = validateSessionState({
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
            executionMode: 'turbo',
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
          },
        },
      ],
    });

    assert.equal(out.groups[0].orchestrateBoard.executionMode, 'manual');
  });

  it('preserves pendingAfk on save', () => {
    const out = validateSessionState({
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
            executionMode: 'manual',
            pendingAfk: true,
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
          },
        },
      ],
    });

    const board = out.groups[0].orchestrateBoard;
    assert.equal(board.executionMode, 'manual');
    assert.equal(board.pendingAfk, true);
  });

  it('quarantined status round-trips through validator', () => {
    const out = validateSessionState({
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
            startedAt: 1,
            lastUpdatedAt: 2,
            tasks: [
              {
                id: 'W1-A',
                title: 'Task',
                wave: 'W1',
                category: 'build',
                status: 'quarantined',
                quarantine: {
                  category: 'infra',
                  summary: 'infra failed',
                  resolutionSteps: ['Restart the service'],
                  at: 1000,
                  logRef: 'log-abc',
                },
                selfHealRound: 2,
                lastHealCategory: 'infra',
                buildOutcome: 'failure',
              },
            ],
            waves: [{ id: 'W1', status: 'planned' }],
          },
        },
      ],
    });

    const task = out.groups[0].orchestrateBoard.tasks[0];
    assert.equal(task.status, 'quarantined');
    assert.equal(task.quarantine.category, 'infra');
    assert.equal(task.quarantine.summary, 'infra failed');
    assert.deepEqual(task.quarantine.resolutionSteps, ['Restart the service']);
    assert.equal(task.quarantine.at, 1000);
    assert.equal(task.quarantine.logRef, 'log-abc');
    assert.equal(task.selfHealRound, 2);
    assert.equal(task.lastHealCategory, 'infra');
    assert.equal(task.buildOutcome, 'failure');
  });

  it('malformed quarantine payload is dropped, task status still accepted', () => {
    const out = validateSessionState({
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
            startedAt: 1,
            lastUpdatedAt: 2,
            tasks: [
              {
                id: 'W1-A',
                title: 'Task',
                wave: 'W1',
                category: 'build',
                status: 'quarantined',
                // malformed: missing required fields category, summary, at
                quarantine: { resolutionSteps: [] },
              },
            ],
            waves: [{ id: 'W1', status: 'planned' }],
          },
        },
      ],
    });

    const task = out.groups[0].orchestrateBoard.tasks[0];
    assert.equal(task.status, 'quarantined');
    assert.equal(task.quarantine, undefined, 'malformed quarantine is dropped');
  });

  it('board-level provisioning fields round-trip', () => {
    const out = validateSessionState({
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
            startedAt: 1,
            lastUpdatedAt: 2,
            provisionState: 'ready',
            provisionedSignatures: ['sha256:abc', 'sha256:def'],
            unresolvedIssues: ['ISSUE-1', 'ISSUE-2'],
            tasks: [
              { id: 'W1-A', title: 'Task', wave: 'W1', category: 'build', status: 'planned' },
            ],
            waves: [{ id: 'W1', status: 'planned' }],
          },
        },
      ],
    });

    const board = out.groups[0].orchestrateBoard;
    assert.equal(board.provisionState, 'ready');
    assert.deepEqual(board.provisionedSignatures, ['sha256:abc', 'sha256:def']);
    assert.deepEqual(board.unresolvedIssues, ['ISSUE-1', 'ISSUE-2']);
  });
});

describe('mergeConfigMeta autopilot', () => {
  it('defaults autopilot block when patch provides empty object', () => {
    const merged = mergeConfigMeta({}, { autopilot: {} });
    assert.equal(merged.autopilot.defaultExecutionMode, 'manual');
    assert.equal(merged.autopilot.maxConcurrentTasks, 3);
    assert.equal(merged.autopilot.isolationMode, 'auto');
    assert.equal(merged.autopilot.maxTestAttempts, 3);
    assert.equal(merged.autopilot.maxBuildAttempts, 2);
    assert.equal(merged.autopilot.maxFinalTestAttempts, 3);
    assert.equal(merged.autopilot.heartbeatIntervalMs, 7000);
    assert.equal(merged.autopilot.progressStallMs, 90000);
    assert.equal(merged.autopilot.heartbeatDeadMs, 30000);
  });

  it('clamps autopilot numeric fields', () => {
    const merged = mergeConfigMeta({}, {
      autopilot: {
        maxConcurrentTasks: 99,
        maxTestAttempts: 0,
        maxBuildAttempts: 0,
        maxFinalTestAttempts: 20,
        heartbeatIntervalMs: 500,
        progressStallMs: 5_000,
        heartbeatDeadMs: 600_000,
      },
    });
    assert.equal(merged.autopilot.maxConcurrentTasks, 20);
    assert.equal(merged.autopilot.maxTestAttempts, 1);
    assert.equal(merged.autopilot.maxBuildAttempts, 1);
    assert.equal(merged.autopilot.maxFinalTestAttempts, 10);
    assert.equal(merged.autopilot.heartbeatIntervalMs, 1000);
    assert.equal(merged.autopilot.progressStallMs, 10000);
    assert.equal(merged.autopilot.heartbeatDeadMs, 300000);
  });

  it('validates execution and isolation mode enums', () => {
    const merged = mergeConfigMeta(
      { autopilot: { defaultExecutionMode: 'auto', isolationMode: 'per-task' } },
      {
        autopilot: {
          defaultExecutionMode: 'not-a-mode',
          isolationMode: 'invalid',
        },
      },
    );
    assert.equal(merged.autopilot.defaultExecutionMode, 'auto');
    assert.equal(merged.autopilot.isolationMode, 'per-task');
  });

  it('partial patch updates only provided autopilot fields', () => {
    const merged = mergeConfigMeta(
      {
        autopilot: {
          defaultExecutionMode: 'manual',
          maxConcurrentTasks: 3,
          isolationMode: 'auto',
          maxTestAttempts: 3,
          maxFinalTestAttempts: 3,
          heartbeatIntervalMs: 7000,
          progressStallMs: 90000,
          heartbeatDeadMs: 30000,
          plannerProviderId: 'p1',
          plannerModelId: 'm1',
        },
      },
      { autopilot: { maxConcurrentTasks: 7, plannerModelId: 'm2' } },
    );
    assert.equal(merged.autopilot.maxConcurrentTasks, 7);
    assert.equal(merged.autopilot.plannerProviderId, 'p1');
    assert.equal(merged.autopilot.plannerModelId, 'm2');
    assert.equal(merged.autopilot.defaultExecutionMode, 'manual');
  });
});
