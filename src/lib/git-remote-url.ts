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

/** Build a web URL for viewing a commit, or null when the remote is not parseable. */
export function commitUrl(remoteUrl: string, sha: string): string | null {
  const parsed = parseGitRemoteUrl(remoteUrl);
  if (!parsed || !sha.trim()) return null;

  const { host, owner, repo } = parsed;
  const hash = sha.trim();

  if (host === 'github.com' || host.endsWith('.github.com')) {
    return `https://${host}/${owner}/${repo}/commit/${hash}`;
  }

  if (host.includes('.')) {
    return `https://${host}/${owner}/${repo}/commit/${hash}`;
  }

  return null;
}
