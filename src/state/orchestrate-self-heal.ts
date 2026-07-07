/**
 * Self-heal escalation loop for AFK board tasks (MIN-285 Phase 2).
 *
 * Uses dependency-injection to avoid circular imports with
 * orchestrate-board-actions. All board-state mutations and chat launches
 * are performed via the provided callbacks.
 *
 * Decision table (checked in order):
 *  1. selfHealRound >= max → quarantine (unconditional cap, GAP-2)
 *  2. infra & envFixAttempts < max → spawn env-fixer sub-agent on the task
 *     worktree (installs missing deps, starts services, …) then re-runs the
 *     failed phase. AFK never dead-ends an env failure at the user.
 *  3. infra & envFixAttempts exhausted → quarantine (env-fixer could not heal it)
 *  4. stall & lastHealCategory !== 'stall' → nudge + autoDelegateNext
 *  5. stall & lastHealCategory === 'stall' (recurrence) → treat as code
 *  6. code → existing reseed retry; if exhausted → quarantine
 *  7. merge → startMergeConflictFixer; attempts exhausted → quarantine
 *
 * Every non-return path ends with autoDelegateNext so independent siblings
 * keep being driven.
 */

import type { BoardTask, Chat, ChatGroup, UnresolvedIssue } from '../types.ts';
import { type FailureCategory } from './orchestrate-failure-classify.ts';
import { isBoardRunning, updateTask } from './orchestrate-board-store.ts';
import { scheduleSaveSessions } from './sessions.ts';

export interface SelfHealDeps {
  /**
   * Spawn an environment/setup fixer sub-agent on the task's own worktree to
   * repair an infra failure (missing deps, unstarted services, missing config),
   * then re-run `phase` to verify. Mirrors {@link startMergeConflictFixer}.
   */
  startEnvFixer(
    group: ChatGroup,
    task: BoardTask,
    plannerChat: Chat,
    phase: 'build' | 'test',
    summary: string,
  ): Promise<void>;

  applyTaskBuildFailureState(
    group: ChatGroup,
    task: BoardTask,
    plannerChat: Chat,
    summary: string,
  ): 'failed' | 'retry';

  applyTaskTestFailureState(
    group: ChatGroup,
    task: BoardTask,
    plannerChat: Chat,
    summary: string,
  ): 'blocked' | 'retry';

  buildBuildRetrySeedMessage(
    task: BoardTask,
    attempt: number,
    summary: string,
  ): string;

  buildRetryBuilderSeedMessage(
    task: BoardTask,
    attempt: number,
    summary: string,
  ): string;

  startTask(group: ChatGroup, taskId: string, plannerChat: Chat): Promise<void>;

  startTaskTesting(group: ChatGroup, taskId: string, plannerChat: Chat): Promise<void>;

  startMergeConflictFixer(
    group: ChatGroup,
    task: BoardTask,
    plannerChat: Chat,
    conflictedFiles: string[],
    integrationSha?: string,
  ): Promise<void>;

  runTaskChatNudge(
    group: ChatGroup,
    taskId: string,
    plannerChat: Chat,
    error?: string,
  ): Promise<void>;

  autoDelegateNext(group: ChatGroup, plannerChat: Chat): Promise<void>;

  quarantineTaskAndDependents(
    group: ChatGroup,
    taskId: string,
    issue: BoardTask['quarantine'],
    plannerChat?: Chat,
  ): void;

  resolveSelfHealMaxRounds(): number;

  resolveMaxEnvFixAttempts(): number;

  resolveAfkAutoRestartStalls(): boolean;

  resolveMaxMergeFixerAttempts(): number;
}

export interface SelfHealOptions {
  phase: 'build' | 'test' | 'merge';
  category: FailureCategory;
  summary: string;
  /** Conflicted files when phase === 'merge'. */
  conflictedFiles?: string[];
  integrationSha?: string;
}

/** Per-category resolution steps for quarantine reports and task payloads. */
export function resolutionStepsForCategory(
  category: FailureCategory | UnresolvedIssue['category'],
  service?: string,
): string[] {
  switch (category) {
    case 'infra':
      return [
        `ensure \`${service ?? '<service>'}\` running, e.g. \`docker compose up -d ${service ?? '<svc>'}\`, then Requeue`,
      ];
    case 'merge':
      return ['resolve conflicts manually on the task branch, then Requeue'];
    case 'stall':
      return ['agent stalled repeatedly; inspect the task chat, then Requeue'];
    default:
      return ['review the failure summary; fix and Requeue'];
  }
}

function quarantineWithIssue(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
  category: FailureCategory,
  summary: string,
  deps: SelfHealDeps,
): void {
  const board = group.orchestrateBoard;
  const resolvedCategory: UnresolvedIssue['category'] =
    category === 'unknown' ? 'code' : category;
  const resolutionSteps = resolutionStepsForCategory(resolvedCategory);
  const issue: BoardTask['quarantine'] = {
    category: category === 'unknown' ? 'unknown' : category,
    summary,
    resolutionSteps,
    at: Date.now(),
  };
  deps.quarantineTaskAndDependents(group, task.id, issue, plannerChat);
  if (board) {
    const record: UnresolvedIssue = {
      taskId: task.id,
      title: task.title,
      category: resolvedCategory,
      summary,
      resolutionSteps,
      ...(issue.logRef ? { logRef: issue.logRef } : {}),
      createdAt: Date.now(),
      attempts: task.selfHealRound ?? task.buildAttempts,
    };
    const prev = board.unresolvedIssues ?? [];
    board.unresolvedIssues = [
      ...prev.filter((u) => u.taskId !== task.id),
      record,
    ];
    scheduleSaveSessions();
  }
}

/**
 * Route a task failure through the bounded self-heal loop.
 * All outcomes call autoDelegateNext at the end so independent siblings keep running.
 */
export async function runSelfHeal(
  group: ChatGroup,
  task: BoardTask,
  plannerChat: Chat,
  options: SelfHealOptions,
  deps: SelfHealDeps,
): Promise<void> {
  const { phase, category, summary } = options;
  const board = group.orchestrateBoard;
  const freshTask = board?.tasks.find((t) => t.id === task.id) ?? task;

  // ── 0. Board stopped/paused → record the failure, spawn nothing ───────────
  // Stop kills chats, whose stream-ends run finalizers, which route here —
  // healing (env fixers, reseeds, quarantine) must not fire on a stopped board.
  if (!isBoardRunning(group)) {
    updateTask(group, freshTask.id, { error: summary }, plannerChat);
    return;
  }

  // ── 1. Global self-heal ceiling above per-category attempt caps (GAP-2) ───
  // Per-category caps (buildAttempts, fixerAttempts, envFixAttempts, …) are the
  // primary bounds; selfHealRound is a secondary safety ceiling on total heal work.
  const maxRounds = deps.resolveSelfHealMaxRounds();
  if ((freshTask.selfHealRound ?? 0) >= maxRounds) {
    quarantineWithIssue(group, freshTask, plannerChat, category, summary, deps);
    await deps.autoDelegateNext(group, plannerChat);
    return;
  }

  // ── 2 & 3. Infra path → env-fixer sub-agent (AFK never dead-ends here) ──────
  if (category === 'infra') {
    // Merge-phase infra is anomalous: a worktree env fix can't help an
    // integration merge → quarantine to avoid corrupting merge state.
    if (phase === 'merge') {
      quarantineWithIssue(group, freshTask, plannerChat, 'infra', summary, deps);
      await deps.autoDelegateNext(group, plannerChat);
      return;
    }

    const envFixAttempts = freshTask.envFixAttempts ?? 0;
    if (envFixAttempts >= deps.resolveMaxEnvFixAttempts()) {
      // Env-fixer exhausted its attempts and the environment is still broken.
      quarantineWithIssue(group, freshTask, plannerChat, 'infra', summary, deps);
      await deps.autoDelegateNext(group, plannerChat);
      return;
    }

    // Spawn an env-fixer on the task worktree. Bumps envFixAttempts and
    // selfHealRound (the global ceiling still bounds total heal work).
    const newRound = (freshTask.selfHealRound ?? 0) + 1;
    updateTask(
      group,
      freshTask.id,
      {
        envFixAttempts: envFixAttempts + 1,
        selfHealRound: newRound,
        lastHealCategory: 'infra',
      },
      plannerChat,
    );
    await deps.startEnvFixer(group, freshTask, plannerChat, phase, summary);
    await deps.autoDelegateNext(group, plannerChat);
    return;
  }

  // ── 4 & 5. Stall path ─────────────────────────────────────────────────────
  if (category === 'stall') {
    if (freshTask.lastHealCategory === 'stall') {
      // Recurring stall → treat as code failure to avoid infinite nudge loop.
      return runSelfHeal(
        group,
        freshTask,
        plannerChat,
        { ...options, category: 'code' },
        deps,
      );
    }
    if (!deps.resolveAfkAutoRestartStalls()) {
      quarantineWithIssue(group, freshTask, plannerChat, 'stall', summary, deps);
      await deps.autoDelegateNext(group, plannerChat);
      return;
    }
    const stallRound = (freshTask.selfHealRound ?? 0) + 1;
    updateTask(
      group,
      freshTask.id,
      { selfHealRound: stallRound, lastHealCategory: 'stall' },
      plannerChat,
    );
    await deps.runTaskChatNudge(group, freshTask.id, plannerChat, summary);
    await deps.autoDelegateNext(group, plannerChat);
    return;
  }

  // ── 6. Code path ─────────────────────────────────────────────────────────
  if (category === 'code') {
    if (phase === 'build') {
      const route = deps.applyTaskBuildFailureState(group, freshTask, plannerChat, summary);
      if (route === 'retry') {
        const after = board?.tasks.find((t) => t.id === freshTask.id) ?? freshTask;
        const seed = deps.buildBuildRetrySeedMessage(after, after.buildAttempts ?? 1, summary);
        const codeRound = (freshTask.selfHealRound ?? 0) + 1;
        updateTask(
          group,
          freshTask.id,
          { pendingBuildSeed: seed, selfHealRound: codeRound, lastHealCategory: 'code' },
          plannerChat,
        );
        await deps.startTask(group, freshTask.id, plannerChat);
      } else {
        // 'failed' — attempts exhausted, escalate to quarantine.
        quarantineWithIssue(group, freshTask, plannerChat, 'code', summary, deps);
      }
    } else if (phase === 'test') {
      const route = deps.applyTaskTestFailureState(group, freshTask, plannerChat, summary);
      if (route === 'retry') {
        const after = board?.tasks.find((t) => t.id === freshTask.id) ?? freshTask;
        const seed = deps.buildRetryBuilderSeedMessage(after, after.testAttempts ?? 1, summary);
        const codeRound = (freshTask.selfHealRound ?? 0) + 1;
        updateTask(
          group,
          freshTask.id,
          { pendingBuildSeed: seed, selfHealRound: codeRound, lastHealCategory: 'code' },
          plannerChat,
        );
        await deps.startTask(group, freshTask.id, plannerChat);
      } else {
        // 'blocked' — attempts exhausted, escalate to quarantine.
        quarantineWithIssue(group, freshTask, plannerChat, 'code', summary, deps);
      }
    } else {
      // merge phase, code category → unusual; fall through to merge handler
      quarantineWithIssue(group, freshTask, plannerChat, 'code', summary, deps);
    }
    await deps.autoDelegateNext(group, plannerChat);
    return;
  }

  // ── 7. Merge path ─────────────────────────────────────────────────────────
  if (category === 'merge' || phase === 'merge') {
    const attempts = (freshTask.fixerAttempts ?? 0);
    if (attempts >= deps.resolveMaxMergeFixerAttempts()) {
      quarantineWithIssue(group, freshTask, plannerChat, 'merge', summary, deps);
      await deps.autoDelegateNext(group, plannerChat);
      return;
    }
    const mergeRound = (freshTask.selfHealRound ?? 0) + 1;
    updateTask(
      group,
      freshTask.id,
      { selfHealRound: mergeRound, lastHealCategory: 'merge' },
      plannerChat,
    );
    await deps.startMergeConflictFixer(
      group,
      freshTask,
      plannerChat,
      options.conflictedFiles ?? [],
      options.integrationSha,
    );
    await deps.autoDelegateNext(group, plannerChat);
    return;
  }

  // ── Unknown category → quarantine safely ─────────────────────────────────
  quarantineWithIssue(group, freshTask, plannerChat, 'unknown', summary, deps);
  await deps.autoDelegateNext(group, plannerChat);
}
