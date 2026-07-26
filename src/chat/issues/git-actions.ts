/**
 * Side-effecting Git actions for Issues detail (MIN-261 Phase 4).
 * Uses /api/git, /api/worktree open_workspace_pr, and execute_command for grep/gh detect.
 */

import { appendIssueLinks } from '../../state/issues-store.ts';
import { gitCheckout, gitPush, gitRemoteUrl } from '../../state/git-api.ts';
import { openWorkspacePr } from '../../state/worktree-service.ts';
import { commitUrl, githubIssueWebUrl, pullRequestUrl } from '../../lib/git-remote-url.ts';
import { executeTool } from '../../tools/client.ts';
import type { IssueCard, IssueGitLink } from '../../types.ts';
import {
  buildIssueCommitGrepCommand,
  buildIssuePrBody,
  buildIssuePrTitle,
  draftIssueGitLink,
  extractFirstHttpUrl,
  normalizeCommitSha,
  parseGhVersionAvailable,
  parseGitHubIssueOrPrUrl,
  parseGitLogOneline,
  resolveIssueBranchName,
  type GitOnelineCommit,
} from './git-helpers.ts';

/** Cached `gh --version` probe (session lifetime). */
let ghAvailableCache: boolean | null = null;

export type IssueGitActionResult =
  | { ok: true; message?: string; url?: string; branch?: string }
  | { ok: false; error: string };

/** Reset gh cache (tests). */
export function resetGhAvailableCache(): void {
  ghAvailableCache = null;
}

/** Detect GitHub CLI once; hide PR actions when false. */
export async function detectGhAvailable(force = false): Promise<boolean> {
  if (!force && ghAvailableCache != null) return ghAvailableCache;
  try {
    const { content } = await executeTool('execute_command', { command: 'gh --version' });
    ghAvailableCache = parseGhVersionAvailable(content);
  } catch {
    ghAvailableCache = false;
  }
  return ghAvailableCache;
}

/** Create/checkout `issue/iss-n-<slug>` and append a branch git link. */
export async function createBranchFromIssue(issue: IssueCard): Promise<IssueGitActionResult> {
  const branch = resolveIssueBranchName(issue);
  const existing = (issue.gitLinks ?? []).some((l) => l.kind === 'branch' && l.ref === branch);
  const result = await gitCheckout({ branch, create: !existing });
  if (!result.ok) {
    // Branch may already exist — retry checkout without create.
    if (!existing) {
      const retry = await gitCheckout({ branch, create: false });
      if (!retry.ok) {
        return { ok: false, error: retry.error ?? result.error ?? 'Could not create or checkout branch' };
      }
    } else {
      return { ok: false, error: result.error ?? 'Could not checkout branch' };
    }
  }

  appendIssueLinks(issue.id, {
    gitLinks: [draftIssueGitLink('branch', branch, { title: branch })],
  });
  return { ok: true, message: `On ${branch}`, branch };
}

/** Link a commit sha to the issue (manual). */
export async function linkCommitToIssue(
  issueId: string,
  shaInput: string,
): Promise<IssueGitActionResult> {
  const sha = normalizeCommitSha(shaInput);
  if (!sha) return { ok: false, error: 'Enter a valid commit sha (7–40 hex chars)' };

  let url: string | undefined;
  const remote = await gitRemoteUrl();
  if (remote.ok && remote.url) {
    url = commitUrl(remote.url, sha) ?? undefined;
  }

  appendIssueLinks(issueId, {
    gitLinks: [draftIssueGitLink('commit', sha, { url, title: sha.slice(0, 7) })],
  });
  return { ok: true, message: `Linked ${sha.slice(0, 7)}`, url };
}

/** Paste a GitHub issue/PR URL → git link chip. */
export async function linkGitHubUrlToIssue(
  issueId: string,
  urlInput: string,
): Promise<IssueGitActionResult> {
  const parsed = parseGitHubIssueOrPrUrl(urlInput);
  if (!parsed) {
    return { ok: false, error: 'Paste a GitHub issue or pull request URL' };
  }
  appendIssueLinks(issueId, {
    gitLinks: [
      draftIssueGitLink(parsed.kind, parsed.ref, { url: parsed.url, title: parsed.title }),
    ],
  });
  return { ok: true, message: `Linked ${parsed.kind === 'pr' ? 'PR' : 'issue'} #${parsed.ref}`, url: parsed.url };
}

/**
 * List commits that mention `[ISS-n]` via git log --grep, merged with manually linked shas.
 */
export async function listIssueCommits(issue: IssueCard): Promise<{
  ok: boolean;
  commits: GitOnelineCommit[];
  error?: string;
}> {
  const cmd = buildIssueCommitGrepCommand(issue.id);
  let grepped: GitOnelineCommit[] = [];
  try {
    const { content } = await executeTool('execute_command', { command: cmd });
    if (content.trimStart().startsWith('Error:')) {
      return { ok: false, commits: [], error: content.replace(/^Error:\s*/i, '').trim() };
    }
    grepped = parseGitLogOneline(content);
  } catch (err) {
    return {
      ok: false,
      commits: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const bySha = new Map<string, GitOnelineCommit>();
  for (const c of grepped) {
    bySha.set(c.sha.toLowerCase(), c);
  }
  for (const link of issue.gitLinks ?? []) {
    if (link.kind !== 'commit') continue;
    const key = link.ref.toLowerCase();
    const already = [...bySha.keys()].some((k) => k.startsWith(key) || key.startsWith(k));
    if (already) continue;
    bySha.set(key, {
      sha: link.ref,
      subject: link.title?.trim() || link.ref.slice(0, 7),
    });
  }

  return { ok: true, commits: [...bySha.values()] };
}

/**
 * Checkout the issue branch (create if needed), push, then `gh pr create` via openWorkspacePr.
 */
export async function createPrFromIssue(issue: IssueCard): Promise<IssueGitActionResult> {
  const hasGh = await detectGhAvailable();
  if (!hasGh) {
    return { ok: false, error: 'GitHub CLI (gh) is not available' };
  }

  const branchResult = await createBranchFromIssue(issue);
  if (!branchResult.ok) return branchResult;

  const push = await gitPush({ setUpstream: true });
  if (!push.ok) {
    const still = push.error ?? 'Push failed';
    // Hard-fail when there is clearly no remote / server; otherwise let gh report.
    if (/server_off|no.?remote|does not appear to be a git|not a git repository/i.test(still)) {
      return { ok: false, error: still };
    }
  }

  const title = buildIssuePrTitle(issue);
  const body = buildIssuePrBody(issue);
  const prRes = await openWorkspacePr({ title, body });
  if (!prRes.ok) {
    const detail = prRes.output?.trim() || prRes.error || 'gh pr create failed';
    return { ok: false, error: detail };
  }

  const url = prRes.url || extractFirstHttpUrl(prRes.output ?? '') || undefined;
  let ref = url ? (url.match(/\/pull\/(\d+)/)?.[1] ?? branchResult.branch ?? issue.id) : branchResult.branch ?? issue.id;
  if (url) {
    const parsed = parseGitHubIssueOrPrUrl(url);
    if (parsed) ref = parsed.ref;
  }

  appendIssueLinks(issue.id, {
    gitLinks: [draftIssueGitLink('pr', ref, { url, title: title.slice(0, 80) })],
  });

  return { ok: true, message: url ? `Opened PR ${url}` : 'Pull request created', url, branch: branchResult.branch };
}

/** Resolve a web URL for a git link chip (stored url, or build from origin). */
export async function resolveGitLinkOpenUrl(link: IssueGitLink): Promise<string | null> {
  if (link.url?.trim()) return link.url.trim();
  const remote = await gitRemoteUrl();
  if (!remote.ok || !remote.url) return null;
  if (link.kind === 'commit') return commitUrl(remote.url, link.ref);
  if (link.kind === 'pr') return pullRequestUrl(remote.url, link.ref);
  if (link.kind === 'github-issue') return githubIssueWebUrl(remote.url, link.ref);
  return null;
}

/** Open commit in the Code git side panel + commit diff (existing graph UX). */
export async function openIssueCommitInGitUi(sha: string, subject?: string): Promise<void> {
  const { openGitSidePanel } = await import('../../ui/git-panel.ts');
  await openGitSidePanel();
  const { openGitCommitDiffPanel } = await import('../../ui/git-commit-diff-panel.ts');
  await openGitCommitDiffPanel({ sha, subject });
}

/** Open a URL via Electron shell or browser tab (same pattern as git-graph context menu). */
export function openExternalGitUrl(url: string): void {
  if (typeof window !== 'undefined' && window.minnow?.app?.openExternal) {
    void window.minnow.app.openExternal(url);
    return;
  }
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
