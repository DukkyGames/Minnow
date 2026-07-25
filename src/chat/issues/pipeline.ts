/**
 * Issues agent pipelines (MIN-261).
 * Phase 2: Expand with agent (issue-writer).
 * Phase 3: Investigate / Plan / Debug / Send to board workflows.
 */

import {
  getSubAgentRun,
  spawnSubAgent,
  waitForSubAgent,
} from '../../agents/orchestrator.ts';
import { isSubAgentRunSuccessful } from '../../agents/sub-agent-outcome.ts';
import { decodeModelSelectKey } from '../../lib/model-select-key.ts';
import {
  appendIssueLinks,
  defaultIssuePlanPath,
  findIssueById,
  updateIssue,
} from '../../state/issues-store.ts';
import {
  createEmptyChatObject,
  findChatById,
  scheduleSaveSessions,
  sessionState,
  touchChat,
} from '../../state/sessions.ts';
import type { Chat, IssueCard } from '../../types.ts';
import { buildIssueExpandTask, canExpandIssueWithAgent } from './expand-task.ts';
import {
  buildIssueDebugSeed,
  buildIssueInvestigateTask,
  buildIssuePlanBackgroundTask,
  buildIssuePlanSeed,
  canInvestigateIssue,
  canRunIssueWorkflow,
  canSendIssueToBoard,
  issueCodeRefsToLaunch,
  resolveIssuePlanPath,
} from './workflow-seeds.ts';

export { buildIssueExpandTask, canExpandIssueWithAgent } from './expand-task.ts';
export { markIssuesReviewForBoardComplete } from './board-review.ts';
export {
  buildIssueContextBlock,
  buildIssueDebugSeed,
  buildIssueInvestigateTask,
  buildIssuePlanBackgroundTask,
  buildIssuePlanSeed,
  canInvestigateIssue,
  canRunIssueWorkflow,
  canSendIssueToBoard,
  issueActivityChip,
  issueCodeRefsToLaunch,
  resolveIssuePlanPath,
} from './workflow-seeds.ts';

/**
 * Spawn issue-writer for a triage note; settle leaves status as triage.
 * The writer updates the card via issue_update / issue_link; we only refresh notes on failure.
 */
export async function runIssueExpandWithAgent(
  issueId: string,
): Promise<{ ok: boolean; error?: string; runId?: string }> {
  const issue = findIssueById(issueId);
  if (!issue) return { ok: false, error: 'Issue not found' };
  if (!canExpandIssueWithAgent(issue)) {
    return { ok: false, error: 'Expand with agent is only available in triage' };
  }

  const parentChatId = sessionState?.activeId ?? null;

  try {
    const result = await spawnSubAgent({
      type: 'issue-writer',
      task: buildIssueExpandTask(issue),
      wait: false,
      parentChatId,
      parentTurnId: null,
      category: 'research',
    });

    const runId =
      'runId' in result && typeof result.runId === 'string' ? result.runId : null;
    if (!runId) return { ok: false, error: 'Failed to spawn issue-writer' };

    // Track run on the card without changing status.
    updateIssue(issueId, { investigateRunId: runId });

    const settled = await waitForSubAgent(runId);
    const ok = settled.status === 'completed' && !settled.cancelled;
    if (!ok) {
      const err = settled.error?.trim() || settled.summary?.trim() || 'Expand failed';
      return { ok: false, error: err, runId };
    }

    // Ensure status stayed triage even if the model tried to move it.
    const latest = findIssueById(issueId);
    if (latest && latest.status !== 'triage') {
      updateIssue(issueId, { status: 'triage' });
    }

    return { ok: true, runId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/** Create or reuse a workflow chat linked on the issue (Investigate / background Plan). */
function ensureIssueWorkflowChat(issue: IssueCard, namePrefix: string): Chat | null {
  const existingId = issue.chatIds?.length
    ? issue.chatIds[issue.chatIds.length - 1]
    : undefined;
  if (existingId) {
    const existing = findChatById(existingId);
    if (existing) return existing;
  }
  if (!sessionState) return null;

  const modelSelect = document.getElementById('modelSelect') as HTMLSelectElement | null;
  const rawSel = modelSelect?.value?.trim() ?? '';
  const parsed = decodeModelSelectKey(rawSel);
  const modelId = parsed?.modelId ?? rawSel;
  const chat = createEmptyChatObject(modelId, issue.workspacePath);
  if (parsed) chat.providerId = parsed.providerId;
  chat.name = `${namePrefix}: ${issue.title.slice(0, 48)}`;
  chat.modeId = 'build';

  sessionState.chats.unshift(chat);
  sessionState.activeId = chat.id;
  touchChat(chat);
  appendIssueLinks(issue.id, { chatId: chat.id });
  scheduleSaveSessions();

  void import('../../ui/sidebar.ts').then((m) => {
    m.renderSidebar();
    m.syncModelSelectForActiveChat();
  });
  void import('../../ui/messages.ts').then((m) => m.renderChatFromHistory(chat));

  return chat;
}

/** Foreground Code (no seed) then apply seeded launch; returns new chat id when created. */
async function launchCodeSeededChat(options: {
  modeId: 'plan' | 'debug';
  seed: string;
  workspacePath?: string;
  codeRefs?: ReturnType<typeof issueCodeRefsToLaunch>;
}): Promise<{ chatId?: string }> {
  const { launchApp } = await import('../../os/router.ts');
  const { applyCodeLaunchOptions } = await import('../../os/code-launch.ts');

  // Open Code without consuming the seed so we control applyCodeLaunchOptions.
  launchApp('code', {
    codeSection: 'chat',
    workspacePath: options.workspacePath,
  });
  // Let hash/route settle before creating the seeded chat.
  await new Promise((r) => setTimeout(r, 0));

  return applyCodeLaunchOptions({
    modeId: options.modeId,
    seed: options.seed,
    autoRun: true,
    workspacePath: options.workspacePath,
    codeRefs: options.codeRefs,
  });
}

/**
 * Investigate: spawn debugger sub-agent, link chat, notes on settle; status → in_progress.
 */
export async function runIssueInvestigate(
  issueId: string,
): Promise<{ ok: boolean; error?: string; chatId?: string }> {
  const issue = findIssueById(issueId);
  if (!issue) return { ok: false, error: 'Issue not found' };
  if (!canInvestigateIssue(issue)) {
    return { ok: false, error: 'Issue is closed' };
  }

  const chat = ensureIssueWorkflowChat(issue, 'Investigate');
  if (!chat) return { ok: false, error: 'Could not create investigation chat' };

  updateIssue(issueId, { status: 'in_progress' });
  appendIssueLinks(issueId, { chatId: chat.id });

  try {
    const result = await spawnSubAgent({
      type: 'debugger',
      task: buildIssueInvestigateTask(issue),
      wait: false,
      parentChatId: chat.id,
      parentTurnId: null,
      category: 'fix',
    });

    const runId =
      'runId' in result && typeof result.runId === 'string' ? result.runId : null;
    if (!runId) return { ok: false, error: 'Failed to spawn debugger', chatId: chat.id };

    updateIssue(issueId, { investigateRunId: runId, status: 'in_progress' });

    const settled = await waitForSubAgent(runId);
    const run = getSubAgentRun(runId);
    const ok = run ? isSubAgentRunSuccessful(run) : settled.status === 'completed';
    const summary = settled.summary?.trim() || settled.error?.trim() || '(no summary)';

    updateIssue(issueId, {
      notes: summary.slice(0, 4000),
      status: 'in_progress',
    });

    return {
      ok,
      error: ok ? undefined : summary,
      chatId: chat.id,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, chatId: chat.id };
  }
}

/**
 * Interactive Plan: Code Plan-mode chat seeded with issue context + codeRef attachments.
 * Sets planPath + status planned; appends chat id.
 */
export async function runIssuePlanChat(
  issueId: string,
): Promise<{ ok: boolean; error?: string; chatId?: string; planPath?: string }> {
  const issue = findIssueById(issueId);
  if (!issue) return { ok: false, error: 'Issue not found' };
  if (!canRunIssueWorkflow(issue)) {
    return { ok: false, error: 'Issue is closed' };
  }

  const planPath = resolveIssuePlanPath(issue);
  const seed = buildIssuePlanSeed(issue, planPath);
  const codeRefs = issueCodeRefsToLaunch(issue);

  updateIssue(issueId, { planPath, status: 'planned' });

  try {
    const { chatId } = await launchCodeSeededChat({
      modeId: 'plan',
      seed,
      workspacePath: issue.workspacePath,
      codeRefs,
    });
    if (chatId) appendIssueLinks(issueId, { chatId });
    return { ok: true, chatId, planPath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, planPath };
  }
}

/**
 * Plan in background: bug-planner-style sub-agent writing documentation/plans/issues/<id>.md.
 */
export async function runIssuePlanBackground(
  issueId: string,
): Promise<{ ok: boolean; planPath?: string; error?: string }> {
  const issue = findIssueById(issueId);
  if (!issue) return { ok: false, error: 'Issue not found' };
  if (!canRunIssueWorkflow(issue)) {
    return { ok: false, error: 'Issue is closed' };
  }

  const chat = ensureIssueWorkflowChat(issue, 'Plan');
  if (!chat) return { ok: false, error: 'Could not create planning chat' };

  const planPath = resolveIssuePlanPath(issue);

  try {
    const result = await spawnSubAgent({
      type: 'bug-planner',
      task: buildIssuePlanBackgroundTask(issue, planPath),
      wait: false,
      parentChatId: chat.id,
      parentTurnId: null,
      category: 'fix',
    });

    const runId =
      'runId' in result && typeof result.runId === 'string' ? result.runId : null;
    if (!runId) return { ok: false, error: 'Failed to spawn planner' };

    updateIssue(issueId, { planRunId: runId, planPath, status: 'in_progress' });

    const settled = await waitForSubAgent(runId);
    const run = getSubAgentRun(runId);
    const ok = run ? isSubAgentRunSuccessful(run) : settled.status === 'completed';

    if (ok) {
      const notes = issue.notes
        ? `${issue.notes}\n\n---\nPlan: ${planPath}`
        : `Plan ready: ${planPath}`;
      updateIssue(issueId, {
        status: 'planned',
        planPath,
        notes,
      });
      return { ok: true, planPath };
    }
    return {
      ok: false,
      error: settled.summary?.trim() || settled.error || 'Plan failed',
      planPath,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message, planPath };
  }
}

/**
 * Debug chat: Code Debug-mode seeded with full issue context; status → in_progress.
 */
export async function runIssueDebugChat(
  issueId: string,
): Promise<{ ok: boolean; error?: string; chatId?: string }> {
  const issue = findIssueById(issueId);
  if (!issue) return { ok: false, error: 'Issue not found' };
  if (!canRunIssueWorkflow(issue)) {
    return { ok: false, error: 'Issue is closed' };
  }

  const seed = buildIssueDebugSeed(issue);
  const codeRefs = issueCodeRefsToLaunch(issue);

  updateIssue(issueId, { status: 'in_progress' });

  try {
    const { chatId } = await launchCodeSeededChat({
      modeId: 'debug',
      seed,
      workspacePath: issue.workspacePath,
      codeRefs,
    });
    if (chatId) appendIssueLinks(issueId, { chatId });
    return { ok: true, chatId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Send to board: requires planPath; launchBoardFromPlan; store boardChatId; status → in_progress.
 */
export async function runIssueSendToBoard(
  issueId: string,
): Promise<{ ok: boolean; error?: string; boardChatId?: string }> {
  const issue = findIssueById(issueId);
  if (!issue) return { ok: false, error: 'Issue not found' };
  if (!canSendIssueToBoard(issue)) {
    return { ok: false, error: 'Save a plan first (Plan or Plan in background)' };
  }

  const planPath = issue.planPath!.trim();

  try {
    const { launchApp } = await import('../../os/router.ts');
    // Orchestrate boards live in Code; open it first so board chrome mounts.
    launchApp('code', { codeSection: 'chat', workspacePath: issue.workspacePath });
    await new Promise((r) => setTimeout(r, 0));

    const { launchBoardFromPlan } = await import('../../ui/orchestrate-launch.ts');
    launchBoardFromPlan(planPath);

    const boardChatId = sessionState?.activeId;
    updateIssue(issueId, {
      status: 'in_progress',
      ...(boardChatId ? { boardChatId } : {}),
    });

    return { ok: true, boardChatId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/** Path helper re-export for callers that import from pipeline. */
export { defaultIssuePlanPath };
