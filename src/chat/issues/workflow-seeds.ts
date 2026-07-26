/**
 * Pure seed/task builders for Issues workflow toolbar (MIN-261 Phase 3).
 * Keep side-effect free so unit tests can assert envelopes without DOM/agents.
 */

import type { IssueCard, IssueCodeRef } from '../../types.ts';

/** Canonical plan path for an issue id (mirrors issues-store.defaultIssuePlanPath). */
export function issuePlanPathForId(issueId: string): string {
  return `documentation/plans/issues/${issueId}.md`;
}

/** Launch-shaped code ref for Code composer attachments. */
export type IssueLaunchCodeRef = {
  path: string;
  startLine?: number;
  endLine?: number;
  text?: string;
};

/** Format one code ref for seed text (path + optional line range). */
export function formatIssueCodeRefLine(ref: IssueCodeRef): string {
  const path = ref.path.trim().replace(/\\/g, '/');
  if (!path) return '';
  if (ref.startLine != null) {
    const end = ref.endLine ?? ref.startLine;
    if (end !== ref.startLine) return `${path}:${ref.startLine}-${end}`;
    return `${path}:${ref.startLine}`;
  }
  return path;
}

/** Map issue codeRefs → LaunchOptions.codeRefs (snippet or path placeholder as text). */
export function issueCodeRefsToLaunch(issue: IssueCard): IssueLaunchCodeRef[] {
  const refs = issue.codeRefs ?? [];
  const out: IssueLaunchCodeRef[] = [];
  for (const ref of refs) {
    const path = ref.path?.trim().replace(/\\/g, '/');
    if (!path) continue;
    const label = formatIssueCodeRefLine(ref) || path;
    const text = ref.snippet?.trim() || `(code reference: ${label})`;
    out.push({
      path,
      startLine: ref.startLine,
      endLine: ref.endLine ?? ref.startLine,
      text,
    });
  }
  return out;
}

/** Shared issue context block for Plan / Debug / Investigate seeds. */
export function buildIssueContextBlock(issue: IssueCard): string {
  const lines = [
    `Issue: ${issue.id}`,
    `Type: ${issue.type}`,
    `Priority: ${issue.priority}`,
    `Status: ${issue.status}`,
    `Title: ${issue.title}`,
    '',
    'Description:',
    issue.description?.trim() || '(none)',
  ];
  if (issue.notes?.trim()) {
    lines.push('', 'Notes:', issue.notes.trim());
  }
  const refs = (issue.codeRefs ?? [])
    .map((r) => formatIssueCodeRefLine(r))
    .filter(Boolean);
  if (refs.length) {
    lines.push('', 'Code links:', ...refs.map((r) => `- ${r}`));
  }
  if (issue.severity) {
    lines.push('', `Severity: ${issue.severity}`);
  }
  return lines.join('\n');
}

/** Debugger sub-agent task (Investigate). */
export function buildIssueInvestigateTask(issue: IssueCard): string {
  return [
    'Investigate this issue and narrow the root cause.',
    '',
    buildIssueContextBlock(issue),
    '',
    'Reproduce if possible, gather logs and relevant code paths.',
    'Return a concise summary for the issue card (symptoms, likely cause, suggested next steps).',
  ].join('\n');
}

/** Background planner sub-agent task (Plan in background). */
export function buildIssuePlanBackgroundTask(issue: IssueCard, planPath: string): string {
  return [
    'Write an implementation plan for this issue.',
    '',
    buildIssueContextBlock(issue),
    '',
    `Save the plan to: ${planPath}`,
    '',
    'Use documentation/plans/issues/ structure with Context, Key Files, Waves, and todos front-matter.',
    'Do not implement the fix — plan only.',
    '',
    'This is unattended background work — the user is not watching this chat.',
    'Do not ask clarifying questions, call ask_question, or propose_mode_switch.',
    'Explore the codebase as needed, save the plan file, then stop with a one-line summary of the path.',
  ].join('\n');
}

/** Seed for interactive Plan-mode Code chat. */
export function buildIssuePlanSeed(issue: IssueCard, planPath?: string): string {
  const path = planPath?.trim() || issuePlanPathForId(issue.id);
  return [
    'Plan work for this issue. Stay in Plan mode — do not implement.',
    '',
    buildIssueContextBlock(issue),
    '',
    `Save the executable plan to exactly \`${path}\` (create documentation/plans/issues/ if needed).`,
    'Use planner structure with Context, Key Files, Waves, and todos front-matter.',
    'When the plan is saved, stop and summarize the path.',
  ].join('\n');
}

/** Seed for Debug-mode Code chat. */
export function buildIssueDebugSeed(issue: IssueCard): string {
  return [
    'Debug this issue. Reproduce, gather evidence, and narrow the root cause.',
    '',
    buildIssueContextBlock(issue),
    '',
    'Prefer read-only exploration first. Propose a fix only after the cause is clear.',
  ].join('\n');
}

/** Composer modes offered in Send to chat. */
export const ISSUE_FOREGROUND_CHAT_MODES = ['general', 'build', 'plan', 'debug'] as const;

export type IssueForegroundChatMode = (typeof ISSUE_FOREGROUND_CHAT_MODES)[number];

/** Background sub-agent modes offered in Send to background. */
export const ISSUE_BACKGROUND_CHAT_MODES = ['debug', 'plan'] as const;

export type IssueBackgroundChatMode = (typeof ISSUE_BACKGROUND_CHAT_MODES)[number];

/** Seed for General / Build foreground chats seeded from an issue. */
export function buildIssueForegroundSeed(
  issue: IssueCard,
  modeId: 'general' | 'build',
): string {
  const lead =
    modeId === 'build'
      ? 'Work on this issue in Build mode.'
      : 'Discuss and triage this issue in General mode.';
  return [lead, '', buildIssueContextBlock(issue)].join('\n');
}

/** Map a foreground mode id to its issue seed text. */
export function buildIssueForegroundModeSeed(
  issue: IssueCard,
  modeId: IssueForegroundChatMode,
  planPath?: string,
): string {
  if (modeId === 'plan') return buildIssuePlanSeed(issue, planPath);
  if (modeId === 'debug') return buildIssueDebugSeed(issue);
  return buildIssueForegroundSeed(issue, modeId);
}

/** Resolve default plan path for an issue (existing or canonical). */
export function resolveIssuePlanPath(issue: IssueCard): string {
  return issue.planPath?.trim() || issuePlanPathForId(issue.id);
}

/** True when Send to board should be enabled. */
export function canSendIssueToBoard(issue: IssueCard): boolean {
  return Boolean(issue.planPath?.trim());
}

/** Investigate is aimed at bugs; still useful on other types when the user insists. */
export function canInvestigateIssue(issue: IssueCard): boolean {
  return issue.status !== 'canceled' && issue.status !== 'done';
}

/** True when Plan / Debug actions should be offered. */
export function canRunIssueWorkflow(issue: IssueCard): boolean {
  return issue.status !== 'canceled' && issue.status !== 'done';
}

/** What the workflow activity chip can open (pure; chat ids resolved at click time). */
export type IssueActivityTarget =
  | { kind: 'sub_agent'; runId: string }
  | { kind: 'board_chat'; chatId: string };

/** Activity chip label derived from linked runs (no extra status enum). */
export function issueActivityChip(issue: IssueCard): string | null {
  if (issue.status === 'review') return 'In review';
  if (issue.boardChatId && issue.status === 'in_progress') return 'On board';
  // Background plan sets in_progress + planRunId until settle → planned.
  if (issue.planRunId && issue.status === 'in_progress' && !issue.boardChatId) {
    return 'Planning…';
  }
  // Investigating until notes land (debugger settle writes notes).
  if (
    issue.investigateRunId &&
    issue.status === 'in_progress' &&
    !issue.notes?.trim() &&
    !issue.boardChatId
  ) {
    return 'Investigating…';
  }
  return null;
}

/** Resolve the activity chip to an openable target (null when the chip is display-only). */
export function issueActivityTarget(issue: IssueCard): IssueActivityTarget | null {
  if (issue.boardChatId && issue.status === 'in_progress') {
    return { kind: 'board_chat', chatId: issue.boardChatId };
  }
  if (issue.planRunId && issue.status === 'in_progress' && !issue.boardChatId) {
    return { kind: 'sub_agent', runId: issue.planRunId };
  }
  if (
    issue.investigateRunId &&
    issue.status === 'in_progress' &&
    !issue.notes?.trim() &&
    !issue.boardChatId
  ) {
    return { kind: 'sub_agent', runId: issue.investigateRunId };
  }
  return null;
}
