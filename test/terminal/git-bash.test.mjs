/**
 * Git Bash detection and spawn helpers (Windows Git for Windows).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  buildGitBashInteractiveArgs,
  buildGitBashOneShotSpawn,
  detectGitBashPath,
  GIT_BASH_PROFILE_ID,
  gitBashSpawnEnvPatch,
  resetGitBashCacheForTests,
  windowsPathToMsysPath,
} from '../../server/terminal/git-bash.js';

describe('git-bash helpers', () => {
  afterEach(() => {
    resetGitBashCacheForTests();
  });

  it('maps Windows paths to MSYS (/c/foo), not WSL /mnt/c', () => {
    assert.equal(windowsPathToMsysPath('C:\\Users\\dev\\repo'), '/c/Users/dev/repo');
    assert.equal(windowsPathToMsysPath('D:\\'), '/d');
    assert.equal(windowsPathToMsysPath('/already/posix'), '/already/posix');
  });

  it('builds login interactive and one-shot argv', () => {
    assert.deepEqual(buildGitBashInteractiveArgs(), ['--login', '-i']);
    const spawn = buildGitBashOneShotSpawn({
      command: 'echo $HOME',
      cwd: 'C:\\repo',
      bashPath: 'C:\\Git\\bin\\bash.exe',
    });
    assert.equal(spawn.command, 'C:\\Git\\bin\\bash.exe');
    assert.deepEqual(spawn.args, ['--login', '-c', 'echo $HOME']);
    assert.equal(spawn.shell, false);
    assert.equal(spawn.cwd, 'C:\\repo');
    assert.equal(spawn.env.CHERE_INVOKING, '1');
    assert.equal(spawn.env.MSYSTEM, 'MINGW64');
    assert.equal(spawn.env.MSYS, 'enable_pcon');
    assert.equal(spawn.env.MSYS2_PATH_TYPE, 'inherit');
    assert.equal(spawn.args[2].includes('\\$'), false);
  });

  it('returns MSYS env patch keys', () => {
    const patch = gitBashSpawnEnvPatch();
    assert.equal(patch.CHERE_INVOKING, '1');
    assert.equal(GIT_BASH_PROFILE_ID, 'git-bash');
  });

  it('honors gitBashPath fixture and null omit', () => {
    assert.equal(detectGitBashPath({ gitBashPath: 'C:\\Git\\bin\\bash.exe' }), 'C:\\Git\\bin\\bash.exe');
    assert.equal(detectGitBashPath({ gitBashPath: null }), null);
  });

  it('finds well-known ProgramFiles Git\\bin\\bash.exe', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minnow-git-bash-'));
    const programFiles = path.join(root, 'Program Files');
    const bash = path.join(programFiles, 'Git', 'bin', 'bash.exe');
    fs.mkdirSync(path.dirname(bash), { recursive: true });
    fs.writeFileSync(bash, '');
    try {
      const found = detectGitBashPath({
        env: { ProgramFiles: programFiles },
      });
      assert.equal(found, path.resolve(bash));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not use System32\\bash.exe from PATH', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minnow-git-bash-sys32-'));
    const system32 = path.join(root, 'System32');
    fs.mkdirSync(system32, { recursive: true });
    fs.writeFileSync(path.join(system32, 'bash.exe'), '');
    try {
      const found = detectGitBashPath({
        env: {
          PATH: system32,
          ProgramFiles: path.join(root, 'missing-pf'),
        },
      });
      assert.equal(found, null);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolves sibling ..\\bin\\bash.exe from git.exe on PATH', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minnow-git-bash-path-'));
    const cmdDir = path.join(root, 'PortableGit', 'cmd');
    const bash = path.join(root, 'PortableGit', 'bin', 'bash.exe');
    fs.mkdirSync(cmdDir, { recursive: true });
    fs.mkdirSync(path.dirname(bash), { recursive: true });
    fs.writeFileSync(path.join(cmdDir, 'git.exe'), '');
    fs.writeFileSync(bash, '');
    try {
      const found = detectGitBashPath({
        env: {
          PATH: cmdDir,
          ProgramFiles: path.join(root, 'missing-pf'),
        },
      });
      assert.equal(found, path.resolve(bash));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
