/**
 * Scheduler workspace paths under MINNOW_HOME (~/.minnow/scheduler-workspace).
 * Default sandbox for scheduled agent jobs when no per-job workspace is set.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';

const SCHEDULER_WORKSPACE_DIR_NAME = 'scheduler-workspace';

const README_BODY = `# Minnow Scheduler Workspace

This directory is the default workspace for scheduled agent jobs.

- Jobs without an explicit workspace run here so file tools stay out of your Code workspace.
- You can point individual jobs at another folder in the Scheduler app.
- Do not store secrets here if you sync or share ~/.minnow.
`;

/** Absolute path to ~/.minnow/scheduler-workspace (created on bootstrap). */
export function getSchedulerWorkspacePath() {
  return path.join(getMinnowHome(), SCHEDULER_WORKSPACE_DIR_NAME);
}

/**
 * Create the scheduler workspace directory and README on first run.
 * @returns {Promise<string>} absolute scheduler workspace path
 */
export async function ensureSchedulerWorkspace() {
  const root = getSchedulerWorkspacePath();
  await fs.mkdir(root, { recursive: true });

  const readmePath = path.join(root, 'README.md');
  try {
    await fs.access(readmePath);
  } catch {
    await fs.writeFile(readmePath, README_BODY, 'utf8');
  }

  return root;
}
