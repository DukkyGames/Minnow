/**
 * Git commit message generation preferences from config.json meta (MIN-412).
 */

import { detectConfigServer } from './storage-mode';

export interface GitCommitMessageConfig {
  /** Prefix subjects with gitmoji (✨ feat, 🐛 fix, …). */
  useGitmoji: boolean;
}

const STORAGE_KEY = 'minnow.gitCommitMessage';

export const DEFAULT_GIT_COMMIT_MESSAGE_CONFIG: GitCommitMessageConfig = {
  useGitmoji: true,
};

let cached: GitCommitMessageConfig | null = null;

/** Parse a partial meta block into a full config object. */
export function parseGitCommitMessageBlock(raw: unknown): GitCommitMessageConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_GIT_COMMIT_MESSAGE_CONFIG };
  }
  const block = raw as Record<string, unknown>;
  return {
    useGitmoji: block.useGitmoji !== false,
  };
}

function readLocal(): GitCommitMessageConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_GIT_COMMIT_MESSAGE_CONFIG };
    return parseGitCommitMessageBlock(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_GIT_COMMIT_MESSAGE_CONFIG };
  }
}

function writeLocal(config: GitCommitMessageConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

async function fetchFromServer(): Promise<GitCommitMessageConfig> {
  const res = await fetch('/api/config/meta', { cache: 'no-store' });
  if (!res.ok) return readLocal();
  const meta = (await res.json()) as Record<string, unknown>;
  return parseGitCommitMessageBlock(meta.gitCommitMessage);
}

/** Load git commit message config (cached until reset). */
export async function loadGitCommitMessageConfig(): Promise<GitCommitMessageConfig> {
  if (cached) return cached;
  const serverUp = await detectConfigServer();
  cached = serverUp ? await fetchFromServer() : readLocal();
  writeLocal(cached);
  return cached;
}

/** Synchronous read of last loaded or local fallback. */
export function getGitCommitMessageConfigSync(): GitCommitMessageConfig {
  return cached ?? readLocal();
}

/** Clear cache (tests). */
export function resetGitCommitMessageConfigCache(): void {
  cached = null;
}

/** Override cache for tests. */
export function setGitCommitMessageConfigForTests(
  config: GitCommitMessageConfig,
): void {
  cached = config;
}
