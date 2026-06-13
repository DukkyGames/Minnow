/**
 * Client helper for the ~/.minnow/benchmark-workspace sandbox (Bench file-tool probes).
 */

import { normalizeWorkspacePath } from './normalize-workspace-path';

export interface BenchmarkWorkspaceInfo {
  ok?: boolean;
  path: string;
  error?: string;
}

let cachedBenchmarkWorkspacePath: string | null = null;

/** Clear cached benchmark workspace path (tests or server restart). */
export function resetBenchmarkWorkspacePathCache(): void {
  cachedBenchmarkWorkspacePath = null;
}

/** Cached absolute benchmark workspace path from the last successful API fetch. */
export function getCachedBenchmarkWorkspacePath(): string | null {
  return cachedBenchmarkWorkspacePath;
}

/** True when a tool workspace path is the benchmark sandbox. */
export function isBenchmarkWorkspacePath(
  workspacePath: string,
  benchmarkWorkspacePath?: string | null,
): boolean {
  const benchPath = benchmarkWorkspacePath ?? cachedBenchmarkWorkspacePath;
  if (!benchPath) return false;
  return normalizeWorkspacePath(workspacePath) === normalizeWorkspacePath(benchPath);
}

/**
 * Fetch benchmark workspace metadata from GET /api/benchmark-workspace.
 * Caches the absolute path for subsequent calls.
 */
export async function getBenchmarkWorkspacePath(): Promise<string | null> {
  if (cachedBenchmarkWorkspacePath) {
    return cachedBenchmarkWorkspacePath;
  }

  try {
    const res = await fetch('/api/benchmark-workspace', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as BenchmarkWorkspaceInfo;
    if (!data?.path || typeof data.path !== 'string') return null;
    cachedBenchmarkWorkspacePath = data.path;
    return cachedBenchmarkWorkspacePath;
  } catch {
    return null;
  }
}
