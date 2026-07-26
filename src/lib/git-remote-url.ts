/**
 * Parse git remote URLs and build web commit links (GitHub and generic hosts).
 */

export interface ParsedGitRemote {
  host: string;
  owner: string;
  repo: string;
}

/** Parse common git remote URL formats into host/owner/repo. */
export function parseGitRemoteUrl(remoteUrl: string): ParsedGitRemote | null {
  const trimmed = remoteUrl.trim();
  if (!trimmed) return null;

  // git@github.com:owner/repo.git
  const sshMatch = trimmed.match(/^[^@]+@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return {
      host: sshMatch[1],
      owner: sshMatch[2],
      repo: sshMatch[3].replace(/\.git$/, ''),
    };
  }

  // https://github.com/owner/repo.git or file:// paths with host
  try {
    const normalized = trimmed.replace(/\.git$/, '');
    const url = new URL(normalized.includes('://') ? normalized : `https://${normalized}`);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      return {
        host: url.hostname,
        owner: parts[0],
        repo: parts[1].replace(/\.git$/, ''),
      };
    }
  } catch {
    return null;
  }

  return null;
}

/** Shared host check for GitHub.com / GHES-style remotes. */
function isGithubStyleHost(host: string): boolean {
  return host === 'github.com' || host.endsWith('.github.com') || host.includes('.');
}

/** Build a web URL for viewing a commit, or null when the remote is not parseable. */
export function commitUrl(remoteUrl: string, sha: string): string | null {
  const parsed = parseGitRemoteUrl(remoteUrl);
  if (!parsed || !sha.trim()) return null;

  const { host, owner, repo } = parsed;
  const hash = sha.trim();

  if (!isGithubStyleHost(host)) return null;
  return `https://${host}/${owner}/${repo}/commit/${hash}`;
}

/** Build a web URL for a pull request number, or null when the remote is not parseable. */
export function pullRequestUrl(remoteUrl: string, prNumber: string | number): string | null {
  const parsed = parseGitRemoteUrl(remoteUrl);
  const n = String(prNumber).trim();
  if (!parsed || !/^\d+$/.test(n)) return null;
  if (!isGithubStyleHost(parsed.host)) return null;
  return `https://${parsed.host}/${parsed.owner}/${parsed.repo}/pull/${n}`;
}

/** Build a web URL for a GitHub issue number, or null when the remote is not parseable. */
export function githubIssueWebUrl(remoteUrl: string, issueNumber: string | number): string | null {
  const parsed = parseGitRemoteUrl(remoteUrl);
  const n = String(issueNumber).trim();
  if (!parsed || !/^\d+$/.test(n)) return null;
  if (!isGithubStyleHost(parsed.host)) return null;
  return `https://${parsed.host}/${parsed.owner}/${parsed.repo}/issues/${n}`;
}
