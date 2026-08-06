/**
 * Windows-only integration: quoted `node -e` via executeCommandBlocking.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { ensureMinnowLayout } from '../../server/config/home.js';
import { initWorkspaceRoot, setWorkspaceRoot } from '../../server/workspace/root.js';
import { executeCommandBlocking } from '../../server/terminal-runner.js';
import { rmTestHome, setTestHome } from '../config/test-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

describe('executeCommandBlocking quoted node -e on Windows', () => {
  let homeDir;

  it('runs node -e with double-quoted script', async () => {
    if (process.platform !== 'win32') return;

    homeDir = setTestHome(process.env, 'minnow-test-win-node-e');
    await ensureMinnowLayout();
    await initWorkspaceRoot();
    await setWorkspaceRoot(repoRoot);

    const output = await executeCommandBlocking({
      command: 'node -e "console.log(\'MINNOW_WIN_QUOTE_OK\')"',
      cwd: repoRoot,
      shell: false,
      timeoutMs: 30_000,
    });

    assert.match(output, /MINNOW_WIN_QUOTE_OK/);

    await rmTestHome(homeDir);
    homeDir = undefined;
  });
});
