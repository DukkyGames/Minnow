/**
 * Benchmark workspace paths under MINNOW_HOME (~/.minnow/benchmark-workspace).
 * Sandboxed storage for benchmark file-tool probes, separate from Code workspace.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';

const BENCHMARK_WORKSPACE_DIR_NAME = 'benchmark-workspace';

const README_BODY = `# Minnow Benchmark Workspace

This directory is a sandbox for benchmark file-tool probes.

- Tools suite file probes read and write only under this folder (not your Code workspace).
- The server allows tool \`workspaceRoot\` overrides for your Code workspace, chats sandbox, or this benchmark folder.
- Fixture files under \`.minnow-bench/\` are created and removed during benchmark runs.
`;

/** Absolute path to ~/.minnow/benchmark-workspace (created on bootstrap). */
export function getBenchmarkWorkspacePath() {
  return path.join(getMinnowHome(), BENCHMARK_WORKSPACE_DIR_NAME);
}

/**
 * Create the benchmark workspace directory and optional README on first run.
 * @returns {Promise<string>} absolute benchmark workspace path
 */
export async function ensureBenchmarkWorkspace() {
  const root = getBenchmarkWorkspacePath();
  await fs.mkdir(root, { recursive: true });

  const readmePath = path.join(root, 'README.md');
  try {
    await fs.access(readmePath);
  } catch {
    await fs.writeFile(readmePath, README_BODY, 'utf8');
  }

  return root;
}
