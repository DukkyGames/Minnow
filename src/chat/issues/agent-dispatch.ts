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

  if (!issue.planPath?.trim()) {
    const failure = await writePlanFile(planPath, buildSingleTaskPlan(issue));
    if (failure) return { ok: false, error: failure, planPath };
    updateIssue(issueId, { planPath });
  }

  try {
    const { launchApp } = await import('../../os/router.ts');
    launchApp('code', { codeSection: 'chat', workspacePath: issue.workspacePath });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const { launchBoardFromPlan } = await import('../../ui/orchestrate-launch.ts');
    const launched = await launchBoardFromPlan(planPath);

    startIssueAgentRun(issueId, {
      agentId: options?.agentId ?? 'builder',
      step: 'Planning the board',
    });
    updateIssue(issueId, {
      status: requireIssueStatusForRole('in_progress'),
    });
    scheduleSaveIssues();

    pushNotification({
      kind: 'issue_agent_started',
      title: `${issue.id} ${issue.title}`,
      preview: 'Agent started — working in its own worktree',
      appId: 'issues',
      dedupeKey: `issue-agent-start:${issueId}:${Date.now()}`,
    });

    return { ok: Boolean(launched), planPath };
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
    return true;
  } catch {
    return true;
  }
}
