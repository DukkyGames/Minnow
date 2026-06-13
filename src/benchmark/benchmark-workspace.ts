/**
 * Benchmark tools suite: ensure ~/.minnow/benchmark-workspace is ready and clean stale fixtures.
 */

import { getBenchmarkWorkspacePath } from '../lib/benchmark-workspace.ts';
import { executeBenchmarkTool } from './execute-tool-sandbox.ts';
import { BENCHMARK_FIXTURE_DIR } from './suites/file-tool-fixtures.ts';

export interface BenchmarkWorkspaceContext {
  workspaceRoot: string;
  fixtureDir: string;
  fixturePath: string;
}

/** Remove leftover `.minnow-bench/` from an aborted prior run (idempotent). */
export async function cleanupBenchmarkFixtureDir(workspaceRoot: string): Promise<void> {
  try {
    await executeBenchmarkTool('delete_path', { path: BENCHMARK_FIXTURE_DIR }, { workspaceRoot });
  } catch {
    /* fixture dir may not exist */
  }
}

/**
 * Resolve benchmark workspace path and return shared fixture paths for file-tool probes.
 */
export async function ensureBenchmarkWorkspaceReady(): Promise<BenchmarkWorkspaceContext> {
  const workspaceRoot = await getBenchmarkWorkspacePath();
  if (!workspaceRoot) {
    throw new Error('Benchmark workspace unavailable (run npm start)');
  }
  await cleanupBenchmarkFixtureDir(workspaceRoot);
  return {
    workspaceRoot,
    fixtureDir: BENCHMARK_FIXTURE_DIR,
    fixturePath: `${BENCHMARK_FIXTURE_DIR}/fixture.txt`,
  };
}
