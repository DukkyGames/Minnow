/**
 * MIN-553 Phase 2 — close side doors that bypassed applyAgentShellSandbox.
 *
 * - Background createBackgroundRun shares the wrap chokepoint (assert argv).
 * - run_javascript / run_python must go through createRun (terminal log + wrap shape).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ensureMinnowLayout, resetMinnowHomeCache } from '../../../server/config/home.js';
import {
  createBackgroundRun,
  getRun,
  stopActiveRun,
} from '../../../server/terminal-runner.js';
import {
  applyAgentShellSandbox,
  SANDBOX_EXEC_PATH,
} from '../../../server/terminal/sandbox/index.js';
import { resolveOneShotSpawn } from '../../../server/terminal/one-shot-spawn.js';
import { initWorkspaceRoot, setWorkspaceRoot } from '../../../server/workspace/root.js';
import { rmTestHome, setTestHome } from '../../config/test-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const FAKE_WORKSPACE = '/Users/dev/Projects/app';

describe('Phase 2: code-exec argv would be wrapped when sandbox applies', () => {
  it('wraps node -e (run_javascript spawn shape) on darwin', () => {
    const resolved = resolveOneShotSpawn({
      command: 'node',
      args: ['-e', 'console.log(1)'],
      shell: false,
      platform: 'darwin',
    });
    assert.equal(resolved.command, 'node');
    assert.deepEqual(resolved.args, ['-e', 'console.log(1)']);

    const wrapped = applyAgentShellSandbox(resolved, {
      source: 'agent',
      sandbox: true,
      cwd: FAKE_WORKSPACE,
      workspaceRoot: FAKE_WORKSPACE,
      platform: 'darwin',
    });

    assert.equal(wrapped.sandbox.applied, true);
    assert.equal(wrapped.command, SANDBOX_EXEC_PATH);
    assert.equal(wrapped.args[0], '-p');
    assert.equal(wrapped.args[2], 'node');
    assert.deepEqual(wrapped.args.slice(3), ['-e', 'console.log(1)']);
  });

  it('wraps python -c (run_python spawn shape) on darwin', () => {
    const resolved = resolveOneShotSpawn({
      command: 'python3',
      args: ['-c', 'print(1)'],
      shell: false,
      platform: 'darwin',
    });

    const wrapped = applyAgentShellSandbox(resolved, {
      source: 'agent',
      sandbox: true,
      cwd: FAKE_WORKSPACE,
      workspaceRoot: FAKE_WORKSPACE,
      platform: 'darwin',
    });

    assert.equal(wrapped.sandbox.applied, true);
    assert.equal(wrapped.command, SANDBOX_EXEC_PATH);
    assert.equal(wrapped.args[2], 'python3');
    assert.deepEqual(wrapped.args.slice(3), ['-c', 'print(1)']);
  });

  it('background one-shot shape is wrapped the same way on darwin', () => {
    const prevShell = process.env.SHELL;
    delete process.env.SHELL;
    try {
      const resolved = resolveOneShotSpawn({
        command: 'sleep 120',
        args: [],
        shell: false,
        platform: 'darwin',
      });
      const wrapped = applyAgentShellSandbox(resolved, {
        source: 'agent',
        sandbox: true,
        cwd: FAKE_WORKSPACE,
        workspaceRoot: FAKE_WORKSPACE,
        platform: 'darwin',
      });

      assert.equal(wrapped.sandbox.applied, true);
      assert.equal(wrapped.command, SANDBOX_EXEC_PATH);
      assert.equal(wrapped.args[2], '/bin/zsh');
      assert.ok(wrapped.args.includes('sleep 120'));
    } finally {
      if (prevShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = prevShell;
    }
  });
});

describe('Phase 2: createBackgroundRun + code-exec use the chokepoint', () => {
  /** @type {string | undefined} */
  let homeDir;

  before(async () => {
    homeDir = setTestHome(process.env, 'minnow-sandbox-phase2');
    await ensureMinnowLayout();
    await initWorkspaceRoot();
    await setWorkspaceRoot(repoRoot);
  });

  after(async () => {
    if (homeDir) await rmTestHome(homeDir);
    homeDir = undefined;
    resetMinnowHomeCache();
  });

  it('createBackgroundRun parents under sandbox-exec when sandbox forced on darwin', async () => {
    if (process.platform === 'win32') {
      // Live WSL+Landlock wrap is covered by wsl-landlock-canary; skip here to
      // avoid duplicating long argv spawns on Windows (CreateProcess limits).
      return;
    }

    const command = 'sleep 60';

    const started = await createBackgroundRun({
      command,
      cwd: repoRoot,
      shell: false,
      source: 'agent',
      // Force wrap attempt regardless of MINNOW_SHELL_SANDBOX (Phase 1 prefer-like).
      sandbox: true,
      logSubdir: 'terminal',
    });

    try {
      let child = null;
      for (let i = 0; i < 50; i++) {
        child = getRun(started.runId)?.child ?? null;
        if (child?.pid) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(child?.pid, 'expected background child pid');

      if (process.platform === 'darwin') {
        // Live proof the background path composed applyAgentShellSandbox.
        assert.equal(child.spawnfile, SANDBOX_EXEC_PATH);
      } else {
        // Win/Linux: wrap is a no-op / stub — child must still be a real process.
        assert.notEqual(child.spawnfile, SANDBOX_EXEC_PATH);
      }
    } finally {
      await stopActiveRun(started.runId);
    }
  });

  it('run_javascript goes through createRun (terminal log + exit formatting)', async () => {
    const { executeServerTool } = await import('../../../server/runtime/tools-middleware.js');
    const logsDir = path.join(homeDir, 'logs', 'terminal');
    await fs.mkdir(logsDir, { recursive: true });
    const before = new Set(await fs.readdir(logsDir));

    const out = await executeServerTool('run_javascript', {
      code: 'console.log("phase2-js")',
    });

    assert.ok(!String(out.result).startsWith('Error'), out.result);
    assert.match(String(out.result), /\(exit 0\)/);
    assert.match(String(out.result), /phase2-js/);

    // Direct runProcess never wrote terminal logs; createRun always does.
    const after = await fs.readdir(logsDir);
    const added = after.filter((name) => !before.has(name) && name.endsWith('.log'));
    assert.ok(added.length >= 1, 'expected a new terminal log from createRun');
  });

  it('run_python goes through createRun when an interpreter is available', async () => {
    const { executeServerTool } = await import('../../../server/runtime/tools-middleware.js');
    const out = await executeServerTool('run_python', {
      code: 'print("phase2-py")',
    });

    // Skip cleanly when no Python is installed (CI images vary).
    if (String(out.result).startsWith('Error: could not run Python')) {
      assert.ok(true, 'no Python interpreter — skip createRun assertion');
      return;
    }

    assert.ok(!String(out.result).startsWith('Error'), out.result);
    assert.match(String(out.result), /\(exit 0\)/);
    assert.match(String(out.result), /phase2-py/);
  });
});
