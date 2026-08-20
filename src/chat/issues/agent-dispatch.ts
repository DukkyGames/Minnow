/**
 * Assign an issue to an agent: the whole round trip, with no Orchestrator visit.
 *
 * The runtime is the Orchestrator, exactly as the brief locks it — **no second
 * agent runtime**. An issue becomes a one-task board: Issues writes a one-task
 * plan, hands it to `launchBoardFromPlan`, records the resulting group on the
 * issue's `agent` slot, and then only ever *reads* the board back. Waves, slots,
 * quarantine and integration branches stay where they belong.
 *
 * **Open question 1 is closed: one board group per issue, not a shared one.**
 * Board groups are already keyed by plan path, and the plan path is already
 * per-issue (`documentation/plans/issues/<ID>.md`), so per-issue groups fall
 * out of the existing design rather than being imposed on it. It also makes
 * cancel and cleanup a single group teardown, and keeps each issue clear of the
 * board's 100-entry log cap, which one shared "Issues" group would burn through.
 *
 * Phase 4 of `documentation/plans/issues-app-v2.md`.
 */

import { executeTool } from '../../tools/client.ts';
import {
  findIssueById,
  requireIssueStatusForRole,
  scheduleSaveIssues,
  startIssueAgentRun,
  updateIssue,
  updateIssueAgentRun,
} from '../../state/issues-store.ts';
import { resolveIssuePlanPath } from './workflow-seeds.ts';
import { pushNotification } from '../../notifications/push.ts';
import type { IssueCard } from '../../types.ts';

export interface DispatchResult {
  ok: boolean;
  error?: string;
  planPath?: string;
  boardChatId?: string;
}

function yamlQuote(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function codeRefLines(issue: IssueCard): string[] {
  const refs = issue.codeRefs ?? [];
  if (refs.length === 0) return [];
  return [
    '## Key files',
    '',
    ...refs.map((ref) => {
      const range = ref.startLine
        ? `:${ref.startLine}${ref.endLine && ref.endLine !== ref.startLine ? `-${ref.endLine}` : ''}`
        : '';
      return `- \`${ref.path}${range}\``;
    }),
    '',
  ];
}

/**
 * A one-task executable plan for a single issue.
 *
 * Deliberately minimal. The board's own planner writes rich multi-wave plans;
 * this exists so "assign an agent" is one keystroke instead of "go write a
 * plan first", and the agent reads the issue body for the actual detail.
 */
export function buildSingleTaskPlan(issue: IssueCard): string {
  const title = issue.title.trim() || issue.id;
  const body = issue.description.trim();

  return [
    '---',
    `name: ${yamlQuote(`${issue.id} ${title}`)}`,
    `overview: ${yamlQuote(`Single-task board for issue ${issue.id}. Opened from the Issues app.`)}`,
    'todos:',
    '  - id: t1',
    `    content: ${yamlQuote(title)}`,
    '    status: pending',
    '---',
    '',
    `# ${issue.id} — ${title}`,
    '',
    '## Context',
    '',
    body || '_No description was written on the issue._',
    '',
    ...codeRefLines(issue),
    '## Wave 1',
    '',
    `### t1 — ${title}`,
    '',
    '**Build**',
    '',
    `Implement the change this issue describes. Work only in this task's worktree.`,
    '',
    '**Test**',
    '',
    'Run the project test suite for the areas you touched and fix what you broke.',
    '',
    '## Handoff',
    '',
    'Commit the work, push the branch, and open a pull request with `gh`. Do not',
    'merge it — the user always does the merge.',
    '',
  ].join('\n');
}

/** Write the plan file through the tool layer (same path an agent would use). */
async function writePlanFile(planPath: string, contents: string): Promise<string | null> {
  try {
    const result = await executeTool('write_file', { path: planPath, content: contents });
    const text = typeof result.content === 'string' ? result.content : '';
    if (text.startsWith('Error:')) return text.slice(6).trim();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Assign an issue to a work agent and start it.
 *
 * Idempotent against an already-running slot: re-dispatching a running issue is
 * almost always a mis-click, and silently spawning a second worktree for the
 * same issue is expensive to undo.
 */
export async function dispatchIssueToAgent(
  issueId: string,
  options?: { agentId?: string },
): Promise<DispatchResult> {
  const issue = findIssueById(issueId);
  if (!issue) return { ok: false, error: 'Issue not found' };
  if (issue.agent?.phase === 'running' || issue.agent?.phase === 'awaiting_input') {
    return { ok: false, error: 'An agent is already working this issue' };
  }

  const planPath = resolveIssuePlanPath(issue);

  // Reuse a plan the user or a Plan-mode run already wrote; only synthesize one
  // when the issue has none, so "assign" never overwrites real planning work.
  if (!issue.planPath?.trim()) {
    const failure = await writePlanFile(planPath, buildSingleTaskPlan(issue));
    if (failure) return { ok: false, error: failure, planPath };
    updateIssue(issueId, { planPath });
  }

  try {
    const { launchApp } = await import('../../os/router.ts');
    // Boards live in Code; open it so the board chrome is mounted before launch.
    launchApp('code', { codeSection: 'chat', workspacePath: issue.workspacePath });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const { launchBoardFromPlan } = await import('../../ui/orchestrate-launch.ts');
    launchBoardFromPlan(planPath);

    const { sessionState } = await import('../../state/sessions.ts');
    // `activeId` is nullable; normalize to undefined so the optional fields below
    // stay optional rather than explicitly null on disk.
    const boardChatId = sessionState?.activeId ?? undefined;
    const group = boardChatId
      ? (sessionState?.groups ?? []).find((g) => g.plannerChatId === boardChatId)
      : undefined;

    startIssueAgentRun(issueId, {
      agentId: options?.agentId ?? 'builder',
      step: 'Planning the board',
      chatId: boardChatId,
      boardGroupId: group?.id,
    });
    updateIssue(issueId, {
      status: requireIssueStatusForRole('in_progress'),
      ...(boardChatId ? { boardChatId } : {}),
    });
    scheduleSaveIssues();

    pushNotification({
      kind: 'issue_agent_started',
      title: `${issue.id} ${issue.title}`,
      preview: 'Agent started — working in its own worktree',
      chatId: boardChatId,
      appId: 'issues',
      dedupeKey: `issue-agent-start:${issueId}:${Date.now()}`,
    });

    return { ok: true, planPath, boardChatId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateIssueAgentRun(issueId, { phase: 'failed', error: message, envBlocked: true });
    scheduleSaveIssues();
    return { ok: false, error: message, planPath };
  }
}

/** Stop the run and clear the slot back to unassigned. */
export async function cancelIssueAgent(issueId: string): Promise<boolean> {
  const issue = findIssueById(issueId);
  if (!issue?.agent) return false;

  const groupId = issue.agent.boardGroupId;
  updateIssueAgentRun(issueId, { phase: 'canceled', step: undefined });
  scheduleSaveIssues();

  if (!groupId) return true;
  try {
    const { sessionState } = await import('../../state/sessions.ts');
    const group = (sessionState?.groups ?? []).find((g) => g.id === groupId);
    if (!group) return true;
    const actions = await import('../../state/orchestrate-board-actions.ts');
    actions.cleanupBoardIsolation(group);
    return true;
  } catch {
    // The slot is already canceled as far as Issues is concerned; a worktree
    // left behind is a cleanup chore, not a broken state.
    return true;
  }
}
