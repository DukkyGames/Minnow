/**
 * Background execute_command, read_command_log, list_running_commands, stop_command.
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureMinnowLayout } from '../../server/config/home.js';
import { initWorkspaceRoot, setWorkspaceRoot } from '../../server/workspace/root.js';
import { rmTestHome, setTestHome } from '../config/test-helpers.js';
import {
  createBackgroundRun,
  listActiveRuns,
  readCommandLogSnapshot,
  stopActiveRun,
} from '../../server/terminal-runner.js';
import { toolStopBackgroundCommand } from '../../server/dev-server/manager.js';
import { executeServerTool } from '../../server/runtime/tools-middleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
/** Long-running command (platform-specific). */
function longRunningCommand() {
  if (process.platform === 'win32') {
    return 'powershell -NoProfile -Command "Start-Sleep -Seconds 120"';
  }
  return 'sleep 120';
}

describe('execute_command background lifecycle', () => {
  let homeDir;

  before(async () => {
    homeDir = setTestHome(process.env, 'minnow-test-exec-bg');
    await ensureMinnowLayout();
    await initWorkspaceRoot();
    await setWorkspaceRoot(repoRoot);
  });

  after(async () => {
    await rmTestHome(homeDir);
  });

  it('background spawn returns quickly and stop_command ends the process', async () => {
    const isWin = process.platform === 'win32';
    const command = isWin
      ? 'powershell -NoProfile -Command "Start-Sleep -Seconds 120"'
      : 'sleep 120';

    const started = await createBackgroundRun({
      command,
      cwd: repoRoot,
      shell: isWin,
      source: 'agent',
      logSubdir: 'terminal',
    });

    assert.ok(started.runId);
    const listed = listActiveRuns({ source: 'agent' });
    assert.ok(listed.some((r) => r.runId === started.runId));

    const snapshot = await readCommandLogSnapshot(started.runId);
    assert.equal(snapshot.finished, false);

    const stopped = await stopActiveRun(started.runId);
    assert.equal(stopped.ok, true);

    await new Promise((r) => setTimeout(r, 500));
    const after = await readCommandLogSnapshot(started.runId);
    assert.equal(after.finished, true);
  });

  it('executeServerTool background + read_command_log + list_running_commands', async () => {
    const startOut = await executeServerTool('execute_command', {
      command: longRunningCommand(),
      background: true,
      cwd: '.',
    });
    assert.ok(!startOut.result.startsWith('Error'));
    const payload = JSON.parse(startOut.result);
    assert.equal(payload.ok, true);
    assert.equal(payload.background, true);
    assert.ok(payload.runId);

    const listOut = await executeServerTool('list_running_commands', {});
    const listPayload = JSON.parse(listOut.result);
    assert.ok(listPayload.runs.some((r) => r.runId === payload.runId));

    const logOut = await executeServerTool('read_command_log', {
      run_id: payload.runId,
    });
    const logPayload = JSON.parse(logOut.result);
    assert.equal(logPayload.runId, payload.runId);
    assert.equal(logPayload.finished, false);

    const stopOut = await executeServerTool('stop_command', { run_id: payload.runId });
    const stopPayload = JSON.parse(stopOut.result);
    assert.equal(stopPayload.ok, true);
  });

  it('stop_background_command still stops terminal background runs', async () => {
    const isWin = process.platform === 'win32';
    const command = isWin
      ? 'powershell -NoProfile -Command "Start-Sleep -Seconds 90"'
      : 'sleep 90';

    const started = await createBackgroundRun({
      command,
      cwd: repoRoot,
      shell: isWin,
      source: 'agent',
      logSubdir: 'terminal',
    });

    const out = await toolStopBackgroundCommand({ run_id: started.runId });
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.runId, started.runId);
  });

});
