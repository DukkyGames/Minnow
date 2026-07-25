/**
 * SSRF-guarded GitHub fetch helpers for Skills Library install (MIN-475).
 */

import { isPrivateUrl } from '../../webhooks/ssrf.js';
import {
  SKILLS_LIBRARY_GITHUB_HOSTS,
  SKILLS_LIBRARY_MAX_BYTES_PER_FILE,
  SKILLS_LIBRARY_MAX_BYTES_PER_SKILL,
  SKILLS_LIBRARY_MAX_FILES_PER_SKILL,
  SKILLS_LIBRARY_USER_AGENT,
} from './constants.js';

const COMMIT_SHA_RE = /^[0-9a-f]{40}$/i;

/**
 * @param {string} urlString
 * @returns {Promise<URL>}
 */
export async function assertAllowedGitHubUrl(urlString) {
  const trimmed = typeof urlString === 'string' ? urlString.trim() : '';
  if (!trimmed) {
    throw new Error('URL is required');
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('URL must use https');
  }

  if (!SKILLS_LIBRARY_GITHUB_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `Host not allowed: ${parsed.hostname}. Only GitHub hosts are permitted for skill installs.`,
    );
  }

  if (await isPrivateUrl(trimmed)) {
    throw new Error('URL must not point to private or internal addresses');
  }

  return parsed;
}

/**
 * @param {string} repoUrl GitHub repo or tree/blob URL.
 * @returns {{ repo: string, ref: string | null, subpath: string }}
 */
export function parseGitHubRepoUrl(repoUrl) {
  let parsed;
  try {
    parsed = new URL(repoUrl.trim());
  } catch {
    throw new Error('Invalid GitHub URL');
  }

  if (parsed.hostname !== 'github.com') {
    throw new Error('repoUrl must be a github.com URL');
  }

  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error('repoUrl must include owner and repository');
  }

  const owner = parts[0];
  const repoName = parts[1];
  const repo = `${owner}/${repoName}`;

  if (parts[2] === 'tree' || parts[2] === 'blob') {
    const ref = parts[3] ?? null;
    let subpath = parts.slice(4).join('/');
    if (parts[2] === 'blob' && subpath.endsWith('/SKILL.md')) {
      subpath = subpath.replace(/\/SKILL\.md$/, '');
    } else if (parts[2] === 'blob' && subpath.endsWith('SKILL.md')) {
      subpath = subpath.replace(/SKILL\.md$/, '').replace(/\/$/, '');
    }
    return { repo, ref, subpath };
  }

  return { repo, ref: null, subpath: '' };
}

/**
 * @param {string} repo owner/repo
 * @param {string} ref branch, tag, or commit
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<string>}
 */
export async function resolveCommitSha(repo, ref, fetchImpl = fetch) {
  const encodedRef = encodeURIComponent(ref);
  const url = `https://api.github.com/repos/${repo}/commits/${encodedRef}`;
  await assertAllowedGitHubUrl(url);

  const res = await fetchImpl(url, {
    headers: { 'User-Agent': SKILLS_LIBRARY_USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`Failed to resolve ref "${ref}" for ${repo} (${res.status})`);
  }

  const data = await res.json();
  if (!data.sha || typeof data.sha !== 'string' || !COMMIT_SHA_RE.test(data.sha)) {
    throw new Error(`Unexpected commit payload for ${repo}`);
  }
  return data.sha.toLowerCase();
}

/**
 * @param {string} repo owner/repo
 * @param {string} commit
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<Array<{ path: string, type: string, size?: number }>>}
 */
export async function fetchRepoTree(repo, commit, fetchImpl = fetch) {
  const url = `https://api.github.com/repos/${repo}/git/trees/${commit}?recursive=1`;
  await assertAllowedGitHubUrl(url);

  const res = await fetchImpl(url, {
    headers: { 'User-Agent': SKILLS_LIBRARY_USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`GitHub tree failed for ${repo}@${commit.slice(0, 7)} (${res.status})`);
  }

  const data = await res.json();
  if (!Array.isArray(data.tree)) {
    throw new Error(`Unexpected tree payload for ${repo}`);
  }
  return data.tree;
}

/**
 * @param {string} repo
 * @param {string} commit
 * @param {string} filePath
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<string>}
 */
export async function fetchRawFile(repo, commit, filePath, fetchImpl = fetch) {
  const url = `https://raw.githubusercontent.com/${repo}/${commit}/${filePath}`;
  await assertAllowedGitHubUrl(url);

  const res = await fetchImpl(url, {
    headers: { 'User-Agent': SKILLS_LIBRARY_USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${filePath} (${res.status})`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > SKILLS_LIBRARY_MAX_BYTES_PER_FILE) {
    throw new Error(`File ${filePath} exceeds size limit`);
  }
  return buffer.toString('utf8');
}

/**
 * Collect blob paths under a skill subpath and enforce install caps.
 * @param {Array<{ path: string, type: string, size?: number }>} tree
 * @param {string} subpath
 * @returns {string[]}
 */
export function listSkillBlobPaths(tree, subpath) {
  const normalized = subpath.replace(/^\/+|\/+$/g, '');
  const skillMd = `${normalized}/SKILL.md`;
  const hasSkillMd = tree.some((entry) => entry.type === 'blob' && entry.path === skillMd);
  if (!hasSkillMd) {
    throw new Error(`No SKILL.md found at ${normalized || '(repo root)'}`);
  }

  const prefix = normalized ? `${normalized}/` : '';
  const paths = tree
    .filter((entry) => entry.type === 'blob')
    .map((entry) => entry.path)
    .filter((repoPath) => repoPath === skillMd || (prefix && repoPath.startsWith(prefix)))
    .sort((a, b) => a.localeCompare(b));

  if (paths.length > SKILLS_LIBRARY_MAX_FILES_PER_SKILL) {
    throw new Error(`Skill exceeds file count limit (${SKILLS_LIBRARY_MAX_FILES_PER_SKILL})`);
  }

  const declaredSize = paths.reduce((sum, repoPath) => {
    const entry = tree.find((row) => row.path === repoPath);
    return sum + (typeof entry?.size === 'number' ? entry.size : 0);
  }, 0);
  if (declaredSize > SKILLS_LIBRARY_MAX_BYTES_PER_SKILL) {
    throw new Error(`Skill exceeds total size limit (${SKILLS_LIBRARY_MAX_BYTES_PER_SKILL} bytes)`);
  }

  return paths;
}

/**
 * Fetch all text files for a skill directory at a pinned commit.
 * @param {string} repo
 * @param {string} commit
 * @param {string} subpath
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<Array<{ relPath: string, content: string }>>}
 */
export async function fetchSkillDirectoryFiles(repo, commit, subpath, fetchImpl = fetch) {
  const tree = await fetchRepoTree(repo, commit, fetchImpl);
  const blobPaths = listSkillBlobPaths(tree, subpath);

  /** @type {Array<{ relPath: string, content: string }>} */
  const files = [];
  let totalBytes = 0;

  for (const repoPath of blobPaths) {
    const content = await fetchRawFile(repo, commit, repoPath, fetchImpl);
    totalBytes += Buffer.byteLength(content, 'utf8');
    if (totalBytes > SKILLS_LIBRARY_MAX_BYTES_PER_SKILL) {
      throw new Error(`Skill exceeds total size limit (${SKILLS_LIBRARY_MAX_BYTES_PER_SKILL} bytes)`);
    }

    const relPath = subpath
      ? repoPath.slice(subpath.length + (subpath.endsWith('/') ? 0 : 1))
      : repoPath;
    files.push({ relPath, content });
  }

  return files;
}
