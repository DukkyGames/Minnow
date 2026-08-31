/**
 * Server session validator — orchestrate board running state survives PUT round-trip.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mergeConfigMeta, normalizeSuperPlanConfig, validateSessionState } from '../../server/config/validators.js';

const GROUP_ID = 'grp_11111111-1111-1111-1111-111111111111';
const PLANNER_ID = '11111111-1111-1111-1111-111111111111';
const PLAN_PATH = 'documentation/plans/reload-persist.md';

describe('validateSessionState orchestrate board', () => {
  it('migrates legacy sequential to concurrency 1 and keeps task chat links', () => {
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
    assert.equal(board.status, 'running');
    assert.equal(board.maxConcurrentTasks, 1);
    assert.equal(board.autoRunning, undefined);
    assert.equal(board.executionMode, undefined);
    assert.equal(board.tasks[0].chatId, '22222222-2222-2222-2222-222222222222');
    assert.equal(board.tasks[0].testChatId, '33333333-3333-3333-3333-333333333333');
    assert.equal(board.finalTest?.status, 'pending');
  });

  it('migrates leftover AFK onto Running and drops the stale flags', () => {
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
    assert.equal(board.status, 'running');
    assert.equal(board.executionMode, undefined);
    assert.equal(board.handsOff, undefined);
    assert.equal(board.autoRunning, undefined);
  });

  it('drops junk executionMode without inventing a concurrency', () => {
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

    const junkBoard = out.groups[0].orchestrateBoard;
    assert.equal(junkBoard.executionMode, undefined);
    assert.equal(junkBoard.handsOff, undefined);
    assert.equal(junkBoard.status, undefined);
    assert.equal(junkBoard.maxConcurrentTasks, undefined);
  });

  it('maps leftover Manual onto Stopped and drops pending-AFK', () => {
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
    assert.equal(board.status, 'stopped');
    assert.equal(board.executionMode, undefined);
    assert.equal(board.maxConcurrentTasks, 1);
    assert.equal(board.autoRunning, undefined);
    assert.equal(board.pendingAfk, undefined);
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
            unresolvedIssues: [
              { taskId: 'ISSUE-1', title: 'Task A', category: 'code', summary: 'Build failed', resolutionSteps: ['fix and requeue'], createdAt: 1000 },
              { taskId: 'ISSUE-2', title: 'Task B', category: 'infra', summary: 'DB down', resolutionSteps: ['start db'], createdAt: 2000 },
            ],
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
    assert.equal(board.unresolvedIssues.length, 2);
    assert.equal(board.unresolvedIssues[0].taskId, 'ISSUE-1');
    assert.equal(board.unresolvedIssues[0].category, 'code');
    assert.equal(board.unresolvedIssues[1].taskId, 'ISSUE-2');
    assert.equal(board.unresolvedIssues[1].category, 'infra');
  });
});

describe('mergeConfigMeta autopilot', () => {
  it('defaults autopilot block when patch provides empty object', () => {
    const merged = mergeConfigMeta({}, { autopilot: {} });
    assert.equal(merged.autopilot.defaultStatus, 'stopped');
    assert.equal(merged.autopilot.defaultHandsOff, undefined);
    assert.equal(merged.autopilot.maxConcurrentTasks, 3);
    assert.equal(merged.autopilot.isolationMode, 'auto');
    assert.equal(merged.autopilot.maxTestAttempts, 3);
    assert.equal(merged.autopilot.maxBuildAttempts, 2);
    assert.equal(merged.autopilot.maxFinalTestAttempts, 3);
    assert.equal(merged.autopilot.heartbeatIntervalMs, 10000);
    assert.equal(merged.autopilot.progressStallMs, 300000);
    assert.equal(merged.autopilot.heartbeatDeadMs, 90000);
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
    assert.equal(merged.autopilot.heartbeatIntervalMs, 500);
    assert.equal(merged.autopilot.progressStallMs, 5_000);
    assert.equal(merged.autopilot.heartbeatDeadMs, 600_000);
  });

  it('validates execution and isolation mode enums', () => {
    const merged = mergeConfigMeta(
      { autopilot: { defaultHandsOff: true, isolationMode: 'per-task' } },
      {
        autopilot: {
          defaultHandsOff: 'not-a-boolean',
          isolationMode: 'invalid',
        },
      },
    );
    assert.equal(merged.autopilot.defaultStatus, 'running');
    assert.equal(merged.autopilot.defaultHandsOff, undefined);
    assert.equal(merged.autopilot.isolationMode, 'per-task');
  });

  it('partial patch updates only provided autopilot fields', () => {
    const merged = mergeConfigMeta(
      {
        autopilot: {
          defaultHandsOff: false,
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
    assert.equal(merged.autopilot.defaultStatus, 'stopped');
    assert.equal(merged.autopilot.defaultHandsOff, undefined);
  });
});

describe('normalizeSuperPlanConfig', () => {
  it('defaults match Phase 6 spec', () => {
    const cfg = normalizeSuperPlanConfig({});
    assert.equal(cfg.reviewRounds, 2);
    assert.equal(cfg.grillQuestionBudget, 20);
    assert.equal(cfg.impeccable, 'auto');
    assert.equal(cfg.researchScope, 'both');
    assert.equal(cfg.researchMaxRounds, 0);
    assert.equal(cfg.researchDepth, 'auto');
  });

  it('mergeConfigMeta persists planning.superPlan', () => {
    const merged = mergeConfigMeta(
      {},
      {
        planning: {
          superPlan: {
            reviewRounds: 1,
            grillQuestionBudget: 12,
            impeccable: 'never',
            researchScope: 'web',
          },
        },
      },
    );
    assert.equal(merged.planning.superPlan.reviewRounds, 1);
    assert.equal(merged.planning.superPlan.grillQuestionBudget, 12);
    assert.equal(merged.planning.superPlan.impeccable, 'never');
    assert.equal(merged.planning.superPlan.researchScope, 'web');
  });
});
