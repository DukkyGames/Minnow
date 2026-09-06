/**
 * One-shot shell spawn resolution (MIN-427 macOS agent shell parity).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveOneShotSpawn,
  resolveUnixLoginShell,
} from '../../server/terminal/one-shot-spawn.js';
import { executeCommandBlocking } from '../../server/terminal-runner.js';
import { ensureMinnowLayout } from '../../server/config/home.js';
import { initWorkspaceRoot, setWorkspaceRoot } from '../../server/workspace/root.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmTestHome, setTestHome } from '../config/test-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

describe('resolveOneShotSpawn', () => {
  it('wraps Unix one-shot strings in a login shell', () => {
    const prevShell = process.env.SHELL;
    delete process.env.SHELL;
    try {
      const darwin = resolveOneShotSpawn({
        command: 'which npm 2>&1 || true',
        args: [],
        platform: 'darwin',
      });
      assert.equal(darwin.command, '/bin/zsh');
      assert.deepEqual(darwin.args, ['-l', '-c', 'which npm 2>&1 || true']);
      assert.equal(darwin.shell, false);

      const linux = resolveOneShotSpawn({
        command: 'echo hi',
        args: [],
        platform: 'linux',
      });
      assert.equal(linux.command, '/bin/bash');
      assert.deepEqual(linux.args, ['-l', '-c', 'echo hi']);
      assert.equal(linux.shell, false);
    } finally {
      if (prevShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = prevShell;
    }
  });

  it('uses cmd.exe for Windows one-shot strings', () => {
    const win = resolveOneShotSpawn({
      command: 'echo MINNOW_WIN',
      args: [],
      platform: 'win32',
    });
    assert.equal(win.command, 'cmd.exe');
    assert.deepEqual(win.args, ['/d', '/s', '/c', 'echo MINNOW_WIN']);
    assert.equal(win.shell, false);
  });

  it('routes Windows one-shot strings through WSL when profile is wsl', () => {
    const wsl = resolveOneShotSpawn({
      command: 'echo MINNOW_WSL',
      args: [],
      platform: 'win32',
      shellProfile: {
        id: 'wsl:Ubuntu',
        label: 'WSL Ubuntu',
        shell: 'wsl.exe',
        args: [],
        platform: 'win32',
        runtime: 'wsl',
        distro: 'Ubuntu',
      },
      cwd: 'C:\\repo',
    });
    assert.equal(wsl.command, 'wsl.exe');
    assert.deepEqual(wsl.args, [
      '-d',
      'Ubuntu',
      '--cd',
      '/mnt/c/repo',
      '--',
      'bash',
      '-l',
      '-c',
      'echo MINNOW_WSL',
    ]);
    assert.equal(wsl.shell, false);
  });

  it('routes Windows one-shot strings through Git Bash when runtime is git-bash', () => {
    const gitBash = resolveOneShotSpawn({
      command: 'echo $HOME',
      args: [],
      platform: 'win32',
      shellProfile: {
        id: 'git-bash',
        label: 'Git Bash',
        shell: 'C:\\Git\\bin\\bash.exe',
        args: ['--login', '-i'],
        platform: 'win32',
        runtime: 'git-bash',
      },
      cwd: 'C:\\repo',
    });
    assert.equal(gitBash.command, 'C:\\Git\\bin\\bash.exe');
    assert.deepEqual(gitBash.args, ['--login', '-c', 'echo $HOME']);
    assert.equal(gitBash.shell, false);
    assert.equal(gitBash.cwd, 'C:\\repo');
    assert.equal(gitBash.env?.CHERE_INVOKING, '1');
    assert.equal(gitBash.args[2].includes('\\$'), false);
  });

  it('rewrites node -e one-shot strings to argv spawn', () => {
    const resolved = resolveOneShotSpawn({
      command: 'node -e "console.log(1)"',
      args: [],
      platform: 'win32',
      shell: true,
    });
    assert.equal(resolved.command, 'node');
    assert.deepEqual(resolved.args, ['-e', 'console.log(1)']);
    assert.equal(resolved.shell, false);
  });

  it('keeps PowerShell profile one-shots on cmd.exe', () => {
    const win = resolveOneShotSpawn({
      command: 'echo MINNOW_WIN',
      args: [],
      platform: 'win32',
      shellProfile: {
        id: 'powershell',
        label: 'PowerShell',
        shell: 'powershell.exe',
        args: ['-NoLogo'],
        platform: 'win32',
        runtime: 'native',
      },
    });
    assert.equal(win.command, 'cmd.exe');
    assert.deepEqual(win.args, ['/d', '/s', '/c', 'echo MINNOW_WIN']);
  });

  it('passes argv invocations through unchanged', () => {
    const direct = resolveOneShotSpawn({
      command: 'node',
      args: ['-e', 'console.log(1)'],
      platform: 'linux',
    });
    assert.equal(direct.command, 'node');
    assert.deepEqual(direct.args, ['-e', 'console.log(1)']);
    assert.equal(direct.shell, false);
  });

  it('honors SHELL on macOS when set to zsh', () => {
    const prev = process.env.SHELL;
    process.env.SHELL = '/opt/homebrew/bin/zsh';
    try {
      const resolved = resolveUnixLoginShell('darwin');
      assert.equal(resolved.shell, '/opt/homebrew/bin/zsh');
      assert.deepEqual(resolved.loginArgs, ['-l']);
    } finally {
      if (prev === undefined) delete process.env.SHELL;
      else process.env.SHELL = prev;
    }
  });
});

describe('executeCommandBlocking unix shell strings', () => {
  let homeDir;

  it('runs shell metacharacters via login shell on Unix', async () => {
    if (process.platform === 'win32') return;

    homeDir = setTestHome(process.env, 'minnow-test-unix-shell');
    await ensureMinnowLayout();
    await initWorkspaceRoot();
    await setWorkspaceRoot(repoRoot);

    const marker = `MINNOW_UNIX_SHELL_${Date.now()}`;
    const output = await executeCommandBlocking({
      command: `echo ${marker} 2>&1 || true`,
      cwd: repoRoot,
    });

    assert.match(output, new RegExp(marker));
    assert.doesNotMatch(output, /\(no output\)/);

    await rmTestHome(homeDir);
    homeDir = undefined;
  });
});
