import {
  getSubAgentRun,
  spawnSubAgent,
  waitForSubAgent,
} from '../../agents/orchestrator.ts';
import { isSubAgentRunSuccessful } from '../../agents/sub-agent-outcome.ts';
import { ensureBackgroundChat } from '../../state/background-chat.ts';
import {
  appendIssueLinks,
  requireIssueStatusForRole,
  updateIssue,
} from '../../state/issues-store.ts';
import { upsertPrReview } from '../../state/pr-review-store.ts';
import { getWorkspacePath } from '../../state/workspace.ts';
import { buildPrReviewTask, fetchPrReviewContext } from './pr-review-context.ts';
import { prReviewKey } from './pr-review-target.ts';

export interface StartPrReviewInput {
  cwd?: string;
  repo: string;
  number: number;
  issueId?: string;
}

export type StartPrReviewResult =
  | { ok: true; key: string; chatId: string; runId: string }
  | { ok: false; error: string };

/** Fetch the PR, spawn the reviewer, persist the record as it settles. */
export async function startPrReview(input: StartPrReviewInput): Promise<StartPrReviewResult> {
  const cwd = input.cwd?.trim() || getWorkspacePath();
  const repo = input.repo.trim();
  if (!repo) return { ok: false, error: 'Repository is unknown' };
  if (!Number.isFinite(input.number) || input.number <= 0) {
    return { ok: false, error: 'Pull request number is missing' };
  }

  const fetched = await fetchPrReviewContext({ cwd, number: input.number });
  if (!fetched.ok) return { ok: false, error: fetched.error };

  const { pr, patch } = fetched.ctx;
  const key = prReviewKey(repo, pr.number);
  const chat = ensureBackgroundChat({
    key: `pr-review:${key}`,
    name: `Review PR #${pr.number}: ${pr.title.slice(0, 48)}`,
    workspacePath: cwd || undefined,
    modeId: 'build',
  });
  if (!chat) return { ok: false, error: 'Could not open a review chat' };

  const headSha = pr.commits[0]?.sha ?? '';
  upsertPrReview({
    key,
    repo,
    number: pr.number,
    url: pr.url,
    headRef: pr.headRef,
    baseRef: pr.baseRef,
    headSha,
    issueId: input.issueId,
    chatId: chat.id,
    runId: '',
    status: 'running',
    summary: '',
    findings: [],
    artifacts: [],
    startedAt: Date.now(),
  });

  let runId: string;
  try {
    const spawned = await spawnSubAgent({
      type: 'pr-reviewer',
      task: buildPrReviewTask({ pr, patch, cwd }),
      wait: false,
      parentChatId: chat.id,
      parentTurnId: null,
      category: 'research',
    });
    runId = 'runId' in spawned && typeof spawned.runId === 'string' ? spawned.runId : '';
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    upsertPrReview({ key, status: 'failed', error, endedAt: Date.now() });
    return { ok: false, error };
  }

  if (!runId) {
    upsertPrReview({ key, status: 'failed', error: 'Failed to spawn PR reviewer', endedAt: Date.now() });
    return { ok: false, error: 'Failed to spawn PR reviewer' };
  }

  upsertPrReview({ key, runId, chatId: chat.id, status: 'running' });

  if (input.issueId) {
    appendIssueLinks(input.issueId, { chatId: chat.id });
    updateIssue(input.issueId, { status: requireIssueStatusForRole('review') });
  }

  void settlePrReview(key, runId);
  return { ok: true, key, chatId: chat.id, runId };
}

/** Wait for the run, then stamp the structured outcome onto the store. */
async function settlePrReview(key: string, runId: string): Promise<void> {
  try {
    const settled = await waitForSubAgent(runId);
    const run = getSubAgentRun(runId);
    const outcome = run?.structuredOutcome ?? settled.outcome;
    const ok = run ? isSubAgentRunSuccessful(run) : settled.status === 'completed';
    if (!ok) {
      upsertPrReview({
        key,
        status: 'failed',
        error: settled.error?.trim() || settled.summary?.trim() || 'Review failed',
        summary: settled.summary ?? '',
        findings: outcome?.findings ?? [],
        artifacts: outcome?.artifacts ?? [],
        endedAt: Date.now(),
      });
      return;
    }
    upsertPrReview({
      key,
      status: 'done',
      summary: outcome?.summary ?? settled.summary ?? '',
      findings: outcome?.findings ?? [],
      artifacts: outcome?.artifacts ?? [],
      endedAt: Date.now(),
    });
  } catch (err) {
    upsertPrReview({
      key,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      endedAt: Date.now(),
    });
  }
}
