/**
 * Board state → the issue's agent slot.
 *
 * Progress on an issue is a *fact* read from the board, not the guess derived
 * from status + run-id presence that `issueActivityChip` made. Issues never
 * writes board state here; it only translates it into the five things the brief
 * allows Issues to show: running, asked a question, opened a PR, failed, done.
 *
 * Phase 4 of `documentation/plans/issues-app-v2.md`.
 */

import { subscribeAllBoardChanges } from '../../state/orchestrate-board-events.ts';
import {
  findIssueById,
  listIssuesWithActiveAgents,
  scheduleSaveIssues,
  updateIssue,
  updateIssueAgentRun,
} from '../../state/issues-store.ts';
import { requireIssueStatusForRole } from '../../state/issues-store.ts';
import { pushNotification } from '../../notifications/push.ts';
import type { BoardTask, ChatGroup, IssueAgentPhase, IssueCard } from '../../types.ts';

/** Board task statuses that mean the agent is actively working. */
const RUNNING_STATUSES = new Set(['in_progress', 'testing', 'merging']);

/** Human-readable step from a board task, without leaking board vocabulary. */
export function stepLabelForTask(task: BoardTask | undefined): string | undefined {
  if (!task) return undefined;
  switch (task.status) {
    case 'in_progress':
      return 'Building';
    case 'testing':
      return 'Running tests';
    case 'merging':
      return 'Merging';
    case 'planned':
      return 'Queued';
    default:
      return undefined;
  }
}

/**
 * Collapse a whole board into one phase.
 *
 * A single-task board makes this nearly trivial, but a user who pointed a
 * multi-task plan at an issue still gets a sane answer: any failure wins,
 * then any running task, then all-complete.
 */
export function phaseForBoardTasks(tasks: readonly BoardTask[]): IssueAgentPhase | null {
  if (tasks.length === 0) return null;
  if (tasks.some((task) => task.status === 'failed' || task.status === 'quarantined')) {
    return 'failed';
  }
  if (tasks.some((task) => RUNNING_STATUSES.has(task.status))) return 'running';
  if (tasks.every((task) => task.status === 'complete')) return 'review';
  return 'running';
}

/** The first error message on the board, for the "in plain words" failure line. */
export function failureReasonForTasks(tasks: readonly BoardTask[]): string | undefined {
  for (const task of tasks) {
    const error = task.error?.trim();
    if (error) return error;
  }
  return undefined;
}

function issuesForGroup(group: ChatGroup): IssueCard[] {
  return listIssuesWithActiveAgents().filter(
    (issue) =>
      issue.agent?.boardGroupId === group.id ||
      (Boolean(group.plannerChatId) && issue.boardChatId === group.plannerChatId),
  );
}

function applyBoardToIssue(issue: IssueCard, group: ChatGroup): void {
  const board = group.orchestrateBoard;
  if (!board) return;

  const tasks = board.tasks ?? [];
  const phase = phaseForBoardTasks(tasks);
  if (!phase) return;

  const previous = issue.agent?.phase;
  const active = tasks.find((task) => RUNNING_STATUSES.has(task.status)) ?? tasks[0];

  const patch: Parameters<typeof updateIssueAgentRun>[1] = {
    phase,
    step: stepLabelForTask(active),
    boardGroupId: group.id,
  };
  if (active?.chatId) patch.chatId = active.chatId;
  if (phase === 'failed') {
    patch.error = failureReasonForTasks(tasks) ?? 'The agent stopped without finishing.';
    // A board that never produced a worktree failed to start, not to build.
    patch.envBlocked = !issue.agent?.worktreePath;
  }

  if (previous === phase && issue.agent?.step === patch.step) return;
  updateIssueAgentRun(issue.id, patch);

  if (phase === 'review' && previous !== 'review') {
    updateIssue(issue.id, { status: requireIssueStatusForRole('review') });
    pushNotification({
      kind: 'issue_agent_pr',
      title: `${issue.id} ${issue.title}`,
      preview: 'Agent finished — ready for review',
      chatId: issue.agent?.chatId,
      appId: 'issues',
      dedupeKey: `issue-agent-review:${issue.id}`,
      os: true,
    });
    void stampIssuePrFromWatcher(issue.id);
  }

  if (phase === 'failed' && previous !== 'failed') {
    pushNotification({
      kind: 'issue_agent_failed',
      title: `${issue.id} ${issue.title}`,
      preview: patch.error ?? 'The agent failed.',
      chatId: issue.agent?.chatId,
      appId: 'issues',
      dedupeKey: `issue-agent-failed:${issue.id}`,
      os: true,
    });
  }

  scheduleSaveIssues();
}

/** Resolve the PR the board opened and write the previously unused agent fields. */
async function stampIssuePrFromWatcher(issueId: string): Promise<void> {
  try {
    const issue = findIssueById(issueId);
    if (!issue) return;
    const { resolveIssuePrNumber } = await import('./git-actions.ts');
    const resolved = await resolveIssuePrNumber(issue);
    if (!resolved) return;
    const current = findIssueById(issueId);
    if (!current?.agent) return;
    updateIssueAgentRun(issueId, {
      prNumber: resolved.number,
      prUrl: resolved.url,
    });
    scheduleSaveIssues();
  } catch {
    // A missing PR must not take the board watcher down.
  }
}

/**
 * Mark an issue as waiting on the user.
 *
 * This is the strongest state in the app, so it is the one place that always
 * raises a desktop notification when the window is unfocused: an agent blocked
 * on a question you never saw is the worst outcome the dispatch loop has.
 */
export function markIssueAwaitingInput(chatId: string, questionId?: string): boolean {
  const issue = listIssuesWithActiveAgents().find(
    (card) => card.agent?.chatId === chatId || card.boardChatId === chatId,
  );
  if (!issue) return false;

  updateIssueAgentRun(issue.id, {
    phase: 'awaiting_input',
    step: 'Waiting on you',
    pendingQuestionId: questionId,
  });
  scheduleSaveIssues();

  pushNotification({
    kind: 'issue_agent_question',
    title: `${issue.id} ${issue.title}`,
    preview: 'The agent asked a question and is waiting.',
    chatId,
    appId: 'issues',
    dedupeKey: `issue-agent-question:${issue.id}:${questionId ?? chatId}`,
    os: true,
  });
  return true;
}

/** Clear the waiting state once the question is answered. */
export function clearIssueAwaitingInput(chatId: string): boolean {
  const issue = listIssuesWithActiveAgents().find(
    (card) => card.agent?.chatId === chatId || card.boardChatId === chatId,
  );
  if (!issue || issue.agent?.phase !== 'awaiting_input') return false;
  updateIssueAgentRun(issue.id, {
    phase: 'running',
    step: 'Building',
    pendingQuestionId: undefined,
  });
  scheduleSaveIssues();
  return true;
}

let bound = false;

/** Subscribe to board changes. Safe to call on every boot. */
export function initIssueAgentWatcher(): void {
  if (bound) return;
  bound = true;

  subscribeAllBoardChanges((groupId) => {
    void (async () => {
      try {
        const { sessionState } = await import('../../state/sessions.ts');
        const group = (sessionState?.groups ?? []).find((g) => g.id === groupId);
        if (!group?.orchestrateBoard) return;
        for (const issue of issuesForGroup(group)) {
          const current = findIssueById(issue.id);
          if (current) applyBoardToIssue(current, group);
        }
      } catch {
        // A board update must never take the shell down with it.
      }
    })();
  });
}

/** Reset module state (tests). */
export function resetIssueAgentWatcherForTests(): void {
  bound = false;
}
