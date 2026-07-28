import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resetWslShellProfileCache,
  resolveProfiles,
  resolvePtySpawnForProfile,
  getShellProfileById,
} from '../../server/terminal/shell-profiles.js';

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

  it('win32 adds per-distro WSL profiles when wsl option true', () => {
    resetWslShellProfileCache();
    const profiles = resolveProfiles('win32', {
      wsl: true,
      wslDistros: ['Ubuntu', 'Debian'],
      wslDefaultDistro: 'Ubuntu',
    });
    assert.ok(profiles.some((p) => p.id === 'wsl:Ubuntu' && p.runtime === 'wsl'));
    assert.ok(profiles.some((p) => p.id === 'wsl:Debian'));
    assert.ok(profiles.some((p) => p.id === 'bash' && p.shell === 'wsl.exe'));
  });

  it('resolvePtySpawnForProfile maps cwd into wsl --cd', () => {
    const profile = getShellProfileById('wsl:Ubuntu') ??
      resolveProfiles('win32', {
        wsl: true,
        wslDistros: ['Ubuntu'],
        wslDefaultDistro: 'Ubuntu',
      }).find((p) => p.id === 'wsl:Ubuntu');
    assert.ok(profile);
    const spawn = resolvePtySpawnForProfile(profile, 'C:\\Users\\dev\\repo');
    assert.equal(spawn.shell, 'wsl.exe');
    assert.ok(spawn.args.includes('--cd'));
    assert.ok(spawn.args.includes('/mnt/c/Users/dev/repo'));
  });
});
