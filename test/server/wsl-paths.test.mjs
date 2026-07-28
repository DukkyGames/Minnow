/**
 * WSL path mapping and distro list parsing.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildWslOneShotSpawn,
  parseDefaultWslDistro,
  parseWslDistroList,
  windowsPathToWslPath,
  wslPathToWindowsPath,
  listWslDistros,
} from '../../server/terminal/wsl.js';

describe('windowsPathToWslPath', () => {
  it('maps drive-letter paths to /mnt mounts', () => {
    assert.equal(
      windowsPathToWslPath('C:\\Users\\dev\\Minnow'),
      '/mnt/c/Users/dev/Minnow',
    );
    assert.equal(windowsPathToWslPath('D:\\repo'), '/mnt/d/repo');
  });

  it('passes through POSIX paths', () => {
    assert.equal(windowsPathToWslPath('/home/dev'), '/home/dev');
  });
});

describe('wslPathToWindowsPath', () => {
  it('maps /mnt paths back to Windows', () => {
    assert.equal(
      wslPathToWindowsPath('/mnt/c/Users/dev/Minnow'),
      'C:\\Users\\dev\\Minnow',
    );
  });
});

describe('parseWslDistroList', () => {
  it('strips BOM and splits lines', () => {
    const output = '\uFEFFUbuntu\r\nUbuntu-22.04\r\n';
    assert.deepEqual(parseWslDistroList(output), ['Ubuntu', 'Ubuntu-22.04']);
  });
});

describe('parseDefaultWslDistro', () => {
  it('reads the starred default row', () => {
    const table = `  NAME                   STATE           VERSION
* Ubuntu                 Running         2
  Debian                 Stopped         2`;
    assert.equal(parseDefaultWslDistro(table), 'Ubuntu');
  });
});

describe('buildWslOneShotSpawn', () => {
  it('wraps one-shot commands in bash -l -c', () => {
    const spawn = buildWslOneShotSpawn({
      command: 'echo hi',
      distro: 'Ubuntu',
      cwd: 'C:\\repo',
    });
    assert.equal(spawn.command, 'wsl.exe');
    assert.deepEqual(spawn.args, [
      '-d',
      'Ubuntu',
      '--cd',
      '/mnt/c/repo',
      '--',
      'bash',
      '-l',
      '-c',
      'echo hi',
    ]);
    assert.equal(spawn.shell, false);
  });
});

describe('listWslDistros fixtures', () => {
  it('returns parsed distros and default from fixture output', () => {
    const catalog = listWslDistros({
      listOutput: 'Ubuntu\r\nDebian\r\n',
      defaultOutput: `  NAME                   STATE           VERSION
* Debian                 Stopped         2
  Ubuntu                 Running         2`,
    });
    assert.deepEqual(catalog.distros, ['Ubuntu', 'Debian']);
    assert.equal(catalog.defaultDistro, 'Debian');
  });
});
