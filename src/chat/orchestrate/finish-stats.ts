/**
 * Finish-dashboard stats: elapsed time, token rollup, and integration git diff (MIN-208).
 */

import { getOrchestrateBoardElapsedMs } from '../../state/orchestrate-board-store.ts';
import { findChatById } from '../../state/sessions.ts';
import { workspaceLandingStats } from '../../state/worktree-service.ts';
import type { Chat, OrchestrateBoardState, Usage } from '../../types.ts';
import { sumUsageSegments } from './stats-math.ts';

/** Local + async git stats shown on the finish dashboard. */
export interface FinishBoardStats {
  elapsedMs: number;
  totalTokens: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  filesTouched: number | null;
  additions: number | null;
  deletions: number | null;
  hasRemote: boolean;
  hasGh: boolean;
  /** True when the integration branch is already merged into the workspace HEAD. */
  alreadyLanded?: boolean;
  gitStatsLoading: boolean;
  gitStatsError?: string;
}

function collectUsageFromChat(chat: Chat | undefined): Usage[] {
  if (!chat) return [];
  const segments: Usage[] = [];
  for (const msg of chat.history) {
    if (msg.role === 'assistant' && msg.usage) segments.push(msg.usage);
  }
  const ls = chat.lastStats;
  if (
    ls &&
    (ls.prompt_tokens != null || ls.completion_tokens != null || ls.total_tokens != null)
  ) {
    segments.push({
      prompt_tokens: ls.prompt_tokens ?? undefined,
      completion_tokens: ls.completion_tokens ?? undefined,
      total_tokens: ls.total_tokens ?? undefined,
    });
  }
  return segments;
}

/** Gather usage segments from the planner chat and all linked task/test chats. */
export function collectBoardUsageSegments(
  plannerChat: Chat,
  board: OrchestrateBoardState,
): Usage[] {
  const segments: Usage[] = collectUsageFromChat(plannerChat);
  const seen = new Set<string>([plannerChat.id]);

  for (const task of board.tasks) {
    for (const chatId of [task.chatId, task.testChatId, task.fixerChatId]) {
      if (!chatId || seen.has(chatId)) continue;
      seen.add(chatId);
      segments.push(...collectUsageFromChat(findChatById(chatId)));
    }
  }

  const finalChatId = board.finalTest?.chatId;
  if (finalChatId && !seen.has(finalChatId)) {
    segments.push(...collectUsageFromChat(findChatById(finalChatId)));
  }

  return segments;
}

function formatElapsedMs(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const mRem = min % 60;
  return mRem > 0 ? `${hr}h ${mRem}m` : `${hr}h`;
}

function shortPlanLabel(planPath: string): string {
  const trimmed = planPath.trim();
  if (!trimmed) return 'Orchestrate plan';
  const base = trimmed.split('/').pop() ?? trimmed;
  return base.replace(/\.md$/i, '') || trimmed;
}

/** Placeholder replaced asynchronously by {@link enrichFinishReportWithRecommendations}. */
export const FINISH_REPORT_RECOMMENDATIONS_PLACEHOLDER =
  '_Generating recommendations from the plan…_';

/** Swap the recommendations placeholder for LLM output (or a fallback line). */
export function mergeFinishReportRecommendations(
  report: string,
  recommendationsMarkdown: string,
): string {
  const body = recommendationsMarkdown.trim() || '_No follow-up recommendations._';
  if (report.includes(FINISH_REPORT_RECOMMENDATIONS_PLACEHOLDER)) {
    return report.replace(FINISH_REPORT_RECOMMENDATIONS_PLACEHOLDER, body);
  }
  return report;
}

/**
 * Deterministic finish report markdown (cached on {@link OrchestrateBoardState.finishReport}).
 * Recommendations are filled in asynchronously from the plan via the generations API.
 */
export function buildDeterministicFinishReport(
  plannerChat: Chat,
  board: OrchestrateBoardState,
): string {
  const planPath =
    plannerChat.orchestratePlanPath?.trim() || board.planPath?.trim() || '';
  const planName = shortPlanLabel(planPath);
  const elapsed = formatElapsedMs(getOrchestrateBoardElapsedMs(board));
  const total = board.tasks.length;
  const waves = board.waves.length;
  const branch = board.integrationBranch?.trim() || '(not set)';
  const usage = sumUsageSegments(collectBoardUsageSegments(plannerChat, board));
  const tokenLine =
    usage.total_tokens != null
      ? `${usage.total_tokens.toLocaleString()} tokens across planner and task chats`
      : 'Token usage unavailable';

  const completeCount = board.tasks.filter((t) => t.status === 'complete').length;
  const completedTasks = board.tasks
    .filter((t) => t.status === 'complete')
    .map((t) => `- **${t.id}** — ${t.title}`)
    .join('\n');

  const lines = [
    `## Summary`,
    '',
    `**${planName}** finished with ${completeCount}/${total} tasks across ${waves} wave${waves === 1 ? '' : 's'} in **${elapsed}**.`,
    '',
    `- Integration branch: \`${branch}\``,
    `- ${tokenLine}`,
    '',
    `## Next steps`,
    '',
    '1. Review the integration branch diff and run the project locally.',
    '2. Use **Commit & push** to merge the integration branch into your current branch, then push.',
    '3. Start a follow-up chat if you want the assistant to continue from this board.',
    '',
    `## Completed tasks`,
    '',
    completedTasks || '_No tasks marked complete._',
    '',
    `## Recommended next tasks`,
    '',
    FINISH_REPORT_RECOMMENDATIONS_PLACEHOLDER,
  ];

  const issues = board.unresolvedIssues;
  if (issues && issues.length > 0) {
    lines.push('', `## Unresolved / quarantined (${issues.length})`, '');
    for (const issue of issues) {
      lines.push(`- **${issue.title}** (${issue.category}) — ${issue.summary}`);
      for (const step of issue.resolutionSteps) {
        lines.push(`  - ${step}`);
      }
    }
  }

  lines.push(
    '',
    `## How to run`,
    '',
    'From the workspace root (or the integration worktree):',
    '',
    '```bash',
    'npm install',
    'npm start',
    '```',
    '',
    planPath
      ? `_Plan reference: \`${planPath}\`_`
      : '_Set a plan path on the board for project-specific run instructions._',
  );

  return lines.join('\n');
}

/** Synchronous stats (elapsed + tokens) for immediate dashboard render. */
export function computeLocalFinishStats(
  plannerChat: Chat,
  board: OrchestrateBoardState,
): Pick<
  FinishBoardStats,
  'elapsedMs' | 'totalTokens' | 'promptTokens' | 'completionTokens'
> {
  const usage = sumUsageSegments(collectBoardUsageSegments(plannerChat, board));
  return {
    elapsedMs: getOrchestrateBoardElapsedMs(board),
    totalTokens: usage.total_tokens ?? null,
    promptTokens: usage.prompt_tokens ?? null,
    completionTokens: usage.completion_tokens ?? null,
  };
}

/** Fetch git diff stats and remote/gh capability flags for landing into workspace. */
export async function fetchGitFinishStats(
  integrationBranch: string,
): Promise<
  Pick<
    FinishBoardStats,
    | 'filesTouched'
    | 'additions'
    | 'deletions'
    | 'hasRemote'
    | 'hasGh'
    | 'alreadyLanded'
    | 'gitStatsError'
  >
> {
  const branch = integrationBranch.trim();
  if (!branch) {
    return {
      filesTouched: null,
      additions: null,
      deletions: null,
      hasRemote: false,
      hasGh: false,
      gitStatsError: 'No integration branch',
    };
  }
  const res = await workspaceLandingStats({ branch });
  if (!res.ok) {
    return {
      filesTouched: null,
      additions: null,
      deletions: null,
      hasRemote: false,
      hasGh: false,
      gitStatsError: res.error ?? res.output ?? 'Git stats unavailable',
    };
  }
  return {
    filesTouched: res.fileCount ?? null,
    additions: res.additions ?? null,
    deletions: res.deletions ?? null,
    hasRemote: res.hasRemote === true,
    hasGh: res.hasGh === true,
    alreadyLanded: res.alreadyLanded === true,
  };
}
