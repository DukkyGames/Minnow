/**
 * Windows Unix-pipe guard for execute_command.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assessUnixPipeOnWindows } from '../../server/tools/windows-pipe-guard.js';

const isWin32 = process.platform === 'win32';

describe('assessUnixPipeOnWindows', () => {
  it('flags pipe to tail on win32', { skip: !isWin32 }, () => {
    const result = assessUnixPipeOnWindows('echo x | tail -5');
    assert.ok(result);
    assert.match(result, /`tail` isn't available under cmd\.exe/);
  });

  it('flags the same command on a second call (no sticky lastIndex)', { skip: !isWin32 }, () => {
    assert.ok(assessUnixPipeOnWindows('echo x | tail -5'));
    const again = assessUnixPipeOnWindows('echo x | tail -5');
    assert.ok(again);
    assert.match(again, /`tail` isn't available under cmd\.exe/);
  });

  it('allows plain npm test on win32', { skip: !isWin32 }, () => {
    assert.equal(assessUnixPipeOnWindows('npm test'), null);
  });

  it('allows sort on win32 (exists on Windows)', { skip: !isWin32 }, () => {
    assert.equal(assessUnixPipeOnWindows('dir | sort'), null);
  });

  it('returns null on non-Windows platforms', { skip: isWin32 }, () => {
    const result = assessUnixPipeOnWindows('echo x | tail -5');
    assert.equal(result, null);
  });

  it('ignores empty input', () => {
    assert.equal(assessUnixPipeOnWindows(''), null);
    assert.equal(assessUnixPipeOnWindows(undefined), null);
  });
});
