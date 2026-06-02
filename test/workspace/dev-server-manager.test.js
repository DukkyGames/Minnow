import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ensureMinnowLayout } from '../../server/config/home.js';
import {
  getDevServerStatus,
  toolStartBackgroundCommand,
  toolStopBackgroundCommand,
} from '../../server/dev-server/manager.js';
import { setWorkspaceRoot } from '../../server/workspace/root.js';
import { rmTestHome, setTestHome } from '../config/test-helpers.js';

describe('dev-server manager tools', () => {
  let homeDir;
  let workspaceDir;

  before(async () => {
    homeDir = setTestHome(process.env, 'minnow-test-dev-server-manager');
    await ensureMinnowLayout();
    workspaceDir = path.join(homeDir, 'dev-ws-tool');
    await fs.mkdir(workspaceDir, { recursive: true });
    await setWorkspaceRoot(workspaceDir);
  });

  after(async () => {
    await rmTestHome(homeDir);
  });

  test('toolStartBackgroundCommand registers state when command matches startup.md', async () => {
    const command = 'node -e "setInterval(()=>{}, 60000)"';
    await fs.writeFile(
      path.join(workspaceDir, 'startup.md'),
      `---\ncommand: ${command}\ncwd: .\n---\n`,
      'utf8',
    );

    const raw = await toolStartBackgroundCommand({ command, cwd: '.' });
    const parsed = JSON.parse(raw);
    assert.equal(parsed.ok, true);
    assert.ok(parsed.runId);

    const status = await getDevServerStatus();
    assert.equal(status.status, 'running');
    assert.equal(status.runId, parsed.runId);

    await toolStopBackgroundCommand({ run_id: parsed.runId });
    const afterStop = await getDevServerStatus();
    assert.equal(afterStop.status, 'stopped');
  });

  test('toolStartBackgroundCommand skips registration for unrelated commands', async () => {
    const guideCommand = 'node -e "setInterval(()=>{}, 60000)"';
    await fs.writeFile(
      path.join(workspaceDir, 'startup.md'),
      `---\ncommand: ${guideCommand}\ncwd: .\n---\n`,
      'utf8',
    );

    const raw = await toolStartBackgroundCommand({
      command: 'node -e "setInterval(()=>{}, 30000)"',
      cwd: '.',
    });
    const parsed = JSON.parse(raw);
    assert.equal(parsed.ok, true);

    const status = await getDevServerStatus();
    assert.equal(status.status, 'stopped');

    await toolStopBackgroundCommand({ run_id: parsed.runId });
  });
});
