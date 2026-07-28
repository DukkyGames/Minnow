/**
 * Terminal shell config resolution (global + per-workspace overrides).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeWorkspaceShellProfiles,
  readTerminalShellConfigFromMeta,
  resolveShellProfileId,
} from '../../server/terminal/shell-config.js';
import { normalizeWorkspacePathKey } from '../../server/workspace/root.js';
import { resetWslShellProfileCache, resolveProfiles } from '../../server/terminal/shell-profiles.js';

describe('readTerminalShellConfigFromMeta', () => {
  it('reads default and workspace shell profile overrides', () => {
    const workspacePath = 'C:\\dev\\foo';
    const config = readTerminalShellConfigFromMeta({
      terminal: {
        defaultShellProfileId: 'wsl:Ubuntu',
        workspaceShellProfiles: {
          [workspacePath]: 'powershell',
        },
      },
    });
    assert.equal(config.defaultShellProfileId, 'wsl:Ubuntu');
    assert.equal(
      config.workspaceShellProfiles[normalizeWorkspacePathKey(workspacePath)],
      'powershell',
    );
  });
});

describe('resolveShellProfileId', () => {
  it('prefers workspace override over global default', () => {
    resetWslShellProfileCache();
    const profiles = resolveProfiles('win32', {
      wsl: true,
      wslDistros: ['Ubuntu'],
      wslDefaultDistro: 'Ubuntu',
    });
    assert.ok(profiles.some((p) => p.id === 'wsl:Ubuntu'));

    const config = {
      defaultShellProfileId: 'powershell',
      workspaceShellProfiles: normalizeWorkspaceShellProfiles({
        'C:\\dev\\foo': 'wsl:Ubuntu',
      }),
    };

    const resolved = resolveShellProfileId(config, 'C:\\dev\\foo');
    assert.equal(resolved, 'wsl:Ubuntu');
  });
});
