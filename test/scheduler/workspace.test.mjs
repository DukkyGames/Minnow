/**
 * Scheduler default workspace bootstrap tests.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { resetMinnowHomeCache } from '../../server/config/home.js';
import {
  ensureSchedulerWorkspace,
  getSchedulerWorkspacePath,
} from '../../server/scheduler-workspace/paths.js';
import { resolveJobWorkspacePath } from '../../server/scheduler/workspace.js';

describe('scheduler workspace', () => {
  /** @type {string} */
  let homeDir;

  before(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-scheduler-ws-'));
    process.env.MINNOW_HOME = homeDir;
    resetMinnowHomeCache();
  });

  after(async () => {
    delete process.env.MINNOW_HOME;
    resetMinnowHomeCache();
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  test('ensureSchedulerWorkspace creates directory and README', async () => {
    const root = await ensureSchedulerWorkspace();
    assert.equal(root, getSchedulerWorkspacePath());
    const readme = await fs.readFile(path.join(root, 'README.md'), 'utf8');
    assert.match(readme, /Scheduler Workspace/);
  });

  test('resolveJobWorkspacePath uses default when job has no override', async () => {
    const resolved = await resolveJobWorkspacePath({});
    assert.equal(resolved, getSchedulerWorkspacePath());
  });

  test('resolveJobWorkspacePath keeps per-job override', async () => {
    const custom = path.join(homeDir, 'custom-project');
    await fs.mkdir(custom, { recursive: true });
    const resolved = await resolveJobWorkspacePath({ workspacePath: custom });
    assert.equal(resolved, custom);
  });
});
