import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveProfiles } from '../../server/terminal/shell-profiles.js';

describe('shell-profiles', () => {
  it('win32 includes powershell and cmd', () => {
    const profiles = resolveProfiles('win32', { wsl: false });
    const ids = profiles.map((p) => p.id);
    assert.ok(ids.includes('powershell'));
    assert.ok(ids.includes('cmd'));
    assert.equal(ids.includes('zsh'), false);
  });

  it('darwin includes zsh and bash', () => {
    const profiles = resolveProfiles('darwin', {});
    const ids = profiles.map((p) => p.id);
    assert.ok(ids.includes('zsh'));
    assert.ok(ids.includes('bash'));
  });

  it('linux includes bash', () => {
    const profiles = resolveProfiles('linux', {});
    assert.equal(profiles[0].id, 'bash');
  });

  it('win32 adds WSL bash when wsl option true', () => {
    const profiles = resolveProfiles('win32', { wsl: true });
    assert.ok(profiles.some((p) => p.id === 'bash' && p.shell === 'wsl.exe'));
  });
});
