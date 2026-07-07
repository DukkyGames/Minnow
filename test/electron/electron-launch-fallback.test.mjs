import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const serverJs = fs.readFileSync(path.join(repoRoot, 'server.js'), 'utf8');
const launcherJs = fs.readFileSync(
  path.join(repoRoot, 'scripts', 'launch-electron-after-vite.mjs'),
  'utf8',
);

// MIN-264: detached launcher exit codes are not a reliable Electron success signal.
describe('electron launch fallback (MIN-264)', () => {
  test('server.js does not treat launcher exit code as Electron failure', () => {
    assert.doesNotMatch(
      serverJs,
      /child\.on\('exit'/,
      'server must not listen for detached launcher exit codes',
    );
    assert.doesNotMatch(
      serverJs,
      /Electron launch failed \(exit/,
      'misleading exit-code warning must not appear in server.js',
    );
  });

  test('launcher opens the system browser only on its own failure path', () => {
    assert.match(
      launcherJs,
      /openBrowser\(fallbackUrl\)/,
      'launcher should open the browser when Electron cannot start',
    );
  });
});
