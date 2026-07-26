/**
 * Unit tests for platform-specific “reveal in system explorer” commands.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  buildRevealCommand,
  revealInSystemExplorer,
} from '../../server/workspace/reveal-in-explorer.js';

describe('buildRevealCommand', () => {
  test('Windows file uses explorer /select', () => {
    const filePath = path.join('C:', 'proj', 'readme.md');
    const cmd = buildRevealCommand('win32', filePath, false);
    assert.equal(cmd.command, 'explorer.exe');
    assert.deepEqual(cmd.args, [`/select,${path.resolve(filePath)}`]);
    assert.equal(cmd.detached, true);
  });

  test('Windows folder opens the folder itself', () => {
    const dirPath = path.join('C:', 'proj', 'src');
    const cmd = buildRevealCommand('win32', dirPath, true);
    assert.equal(cmd.command, 'explorer.exe');
    assert.deepEqual(cmd.args, [path.resolve(dirPath)]);
    assert.equal(cmd.detached, true);
  });

  test('macOS file uses open -R', () => {
    const filePath = '/Users/me/proj/readme.md';
    const cmd = buildRevealCommand('darwin', filePath, false);
    assert.equal(cmd.command, 'open');
    assert.deepEqual(cmd.args, ['-R', path.resolve(filePath)]);
  });

  test('macOS folder uses open on the folder', () => {
    const dirPath = '/Users/me/proj/src';
    const cmd = buildRevealCommand('darwin', dirPath, true);
    assert.equal(cmd.command, 'open');
    assert.deepEqual(cmd.args, [path.resolve(dirPath)]);
  });

  test('Linux file opens the parent directory', () => {
    const filePath = '/home/me/proj/readme.md';
    const cmd = buildRevealCommand('linux', filePath, false);
    assert.equal(cmd.command, 'xdg-open');
    assert.deepEqual(cmd.args, [path.dirname(path.resolve(filePath))]);
    assert.equal(cmd.detached, true);
  });

  test('Linux folder opens the folder itself', () => {
    const dirPath = '/home/me/proj/src';
    const cmd = buildRevealCommand('linux', dirPath, true);
    assert.equal(cmd.command, 'xdg-open');
    assert.deepEqual(cmd.args, [path.resolve(dirPath)]);
  });
});

describe('revealInSystemExplorer', () => {
  test('rejects missing path', async () => {
    await assert.rejects(
      () => revealInSystemExplorer(''),
      /path is required/,
    );
  });

  test('rejects missing filesystem entry', async () => {
    await assert.rejects(
      () =>
        revealInSystemExplorer('/tmp/does-not-exist-minnow-reveal', {
          platform: 'linux',
          statImpl: async () => {
            throw new Error('ENOENT');
          },
        }),
      /Path does not exist/,
    );
  });

  test('spawns reveal command for a file', async () => {
    /** @type {{ command: string, args: string[] }[]} */
    const calls = [];
    const result = await revealInSystemExplorer('/tmp/file.txt', {
      platform: 'linux',
      statImpl: async () => ({
        isDirectory: () => false,
      }),
      spawnImpl: (command, args) => {
        calls.push({ command, args });
        return {
          on() {},
          unref() {},
        };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.kind, 'file');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, 'xdg-open');
  });
});
