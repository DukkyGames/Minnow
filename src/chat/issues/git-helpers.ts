/**
 * Pure Git helpers for Issues app (MIN-261 Phase 4).
 * Side-effect free so unit tests can assert branch names, URL parse, and log parse.
 */

import type { IssueCard, IssueGitLink } from '../../types.ts';

const DEFAULT_SLUG_MAX = 48;

/** Lowercase hyphenated slug from an issue title (Linear-style branch segment). */
export function slugifyIssueTitle(title: string, maxLen = DEFAULT_SLUG_MAX): string {
  const raw = title
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!raw) return 'issue';
  const sliced = raw.slice(0, Math.max(1, maxLen)).replace(/-+$/g, '');
  return sliced || 'issue';
}

/**
 * Branch name for an issue: `issue/iss-42-<slug>` (id lowercased).
 */
export function issueBranchName(issueId: string, title: string): string {
  const id = issueId.trim().toLowerCase();
  if (!id) return `issue/issue-${slugifyIssueTitle(title)}`;
  return `issue/${id}-${slugifyIssueTitle(title)}`;
}

/** Commit-message needle for `git log --fixed-strings --grep`, e.g. `[ISS-42]`. */
export function issueCommitGrepNeedle(issueId: string): string {
  const id = issueId.trim();
  return id ? `[${id}]` : '';
}

/** One line from `git log --oneline`. */
export type GitOnelineCommit = {
  sha: string;
  subject: string;
};

/**
 * Parse `git log --oneline` stdout into sha + subject rows.
 * Skips tool error lines and `(exit N)` footers from execute_command.
 */
export function parseGitLogOneline(stdout: string): GitOnelineCommit[] {
  const out: GitOnelineCommit[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('Error:')) continue;
    if (/^\(exit -?\d+\)/.test(line)) continue;
    const m = /^([0-9a-f]{7,40})\s+(.+)$/i.exec(line);
    if (!m) continue;
    out.push({ sha: m[1], subject: m[2].trim() });
  }
  return out;
}

/** Normalize a pasted commit sha; null when not a plausible hex sha. */
export function normalizeCommitSha(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(s)) return null;
  return s;
}

/** Parsed GitHub issue or pull request URL for git link chips. */
export type ParsedGitHubIssueOrPr = {
  kind: 'pr' | 'github-issue';
  ref: string;
  url: string;
  title: string;
};

/**
 * Parse a GitHub issue or PR URL into an IssueGitLink-shaped payload (no API).
 * Accepts github.com and github enterprise hosts with /pull/N or /issues/N.
 */
export function parseGitHubIssueOrPrUrl(input: string): ParsedGitHubIssueOrPr | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  // github.com, *.github.com, and GHES hosts whose hostname contains "github".
  const isGithubHost =
    host === 'github.com' || host.endsWith('.github.com') || host.includes('github');
  if (!isGithubHost) return null;

  const parts = url.pathname.split('/').filter(Boolean);
  // owner / repo / pull|issues / number
  if (parts.length < 4) return null;
  const kindSeg = parts[2]?.toLowerCase();
  const num = parts[3];
  if (!num || !/^\d+$/.test(num)) return null;

  const owner = parts[0];
  const repo = parts[1];
  let kind: 'pr' | 'github-issue';
  let pathSeg: string;
  if (kindSeg === 'pull' || kindSeg === 'pulls') {
    kind = 'pr';
    pathSeg = 'pull';
  } else if (kindSeg === 'issues' || kindSeg === 'issue') {
    kind = 'github-issue';
    pathSeg = 'issues';
  } else {
    return null;
  }

  const canonical = `${url.protocol}//${url.host}/${owner}/${repo}/${pathSeg}/${num}`;
  const title =
    kind === 'pr' ? `${owner}/${repo}#${num}` : `${owner}/${repo}#${num}`;

  return { kind, ref: num, url: canonical, title };
}

/** Shell-safe `git log` command that lists commits mentioning the issue id. */
export function buildIssueCommitGrepCommand(issueId: string, count = 40): string {
  const needle = issueCommitGrepNeedle(issueId);
  const n = Math.max(1, Math.min(200, Math.floor(count)));
  // fixed-strings avoids regex escaping for [ISS-n]; double-quote for win/posix shells.
  return `git log --oneline -n ${n} --fixed-strings --grep="${needle}"`;
}

/** PR title: `ISS-42: Fix the flaky test`. */
export function buildIssuePrTitle(issue: Pick<IssueCard, 'id' | 'title'>): string {
  const title = issue.title?.trim() || 'Untitled';
  return `${issue.id}: ${title}`;
}

/** Generated PR body from issue fields (no network). */
export function buildIssuePrBody(issue: IssueCard): string {
  const lines = [
    `## ${issue.id}: ${issue.title?.trim() || 'Untitled'}`,
    '',
    issue.description?.trim() || '_No description._',
    '',
    '---',
    `Opened from Minnow Issues · type \`${issue.type}\` · priority \`${issue.priority}\``,
  ];
  if (issue.planPath?.trim()) {
    lines.push('', `Plan: \`${issue.planPath.trim()}\``);
  }
  const refs = (issue.codeRefs ?? [])
    .map((r) => {
      const path = r.path?.trim();
      if (!path) return '';
      if (r.startLine != null) {
        const end = r.endLine ?? r.startLine;
        return end !== r.startLine ? `- \`${path}:${r.startLine}-${end}\`` : `- \`${path}:${r.startLine}\``;
      }
      return `- \`${path}\``;
    })
    .filter(Boolean);
  if (refs.length) {
    lines.push('', '### Code links', ...refs);
  }
  return lines.join('\n');
}

/** Whether execute_command output indicates `gh` is installed. */
export function parseGhVersionAvailable(content: string): boolean {
  if (!content || content.trimStart().startsWith('Error:')) return false;
  const exit = content.match(/\(exit (-?\d+)\)/);
  if (exit && exit[1] !== '0') return false;
  if (/gh version/i.test(content)) return true;
  // Some shells only echo the version line without a clear footer.
  return exit?.[1] === '0' && !/not (found|recognized)|command not found|is not recognized/i.test(content);
}

/** Extract first http(s) URL from `gh pr create` (or similar) stdout. */
export function extractFirstHttpUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s)]+/i);
  return m ? m[0].replace(/[.,;]+$/, '') : null;
}

/** Prefer an existing branch git link; else derive from title. */
export function resolveIssueBranchName(issue: IssueCard): string {
  const linked = (issue.gitLinks ?? []).find((l) => l.kind === 'branch');
  if (linked?.ref?.trim()) return linked.ref.trim();
  return issueBranchName(issue.id, issue.title || 'issue');
}

/** Build a draft git link for storage (caller sets addedAt via store normalize). */
export function draftIssueGitLink(
  kind: IssueGitLink['kind'],
  ref: string,
  extras?: { url?: string; title?: string },
): Omit<IssueGitLink, 'addedAt'> {
  const out: Omit<IssueGitLink, 'addedAt'> = { kind, ref };
  if (extras?.url?.trim()) out.url = extras.url.trim();
  if (extras?.title?.trim()) out.title = extras.title.trim();
  return out;
}
