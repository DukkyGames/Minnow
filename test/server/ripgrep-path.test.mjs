/**
 * Ripgrep path resolution for Electron packaging (asar.unpacked).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getRipgrepPath,
  isInsidePackagedAsarArchive,
  remapAsarUnpackPath,
  resolveRipgrepExecutablePath,
} from '../../server/lib/ripgrep-path.js';

describe('ripgrep-path', () => {
  it('remapAsarUnpackPath maps app.asar to app.asar.unpacked', () => {
    const inAsar =
      'C:\\Program Files\\Minnow\\resources\\app.asar\\node_modules\\@vscode\\ripgrep-win32-x64\\bin\\rg.exe';
    const out = remapAsarUnpackPath(inAsar);
    assert.equal(
      out,
      'C:\\Program Files\\Minnow\\resources\\app.asar.unpacked\\node_modules\\@vscode\\ripgrep-win32-x64\\bin\\rg.exe',
    );
  });

  it('remapAsarUnpackPath maps macOS app bundle paths', () => {
    const inAsar =
      '/Applications/Minnow.app/Contents/Resources/app.asar/node_modules/@vscode/ripgrep-darwin-arm64/bin/rg';
    const out = remapAsarUnpackPath(inAsar);
    assert.equal(
      out,
      '/Applications/Minnow.app/Contents/Resources/app.asar.unpacked/node_modules/@vscode/ripgrep-darwin-arm64/bin/rg',
    );
  });

  it('isInsidePackagedAsarArchive detects asar archive paths only', () => {
    assert.equal(
      isInsidePackagedAsarArchive(
        '/Applications/Minnow.app/Contents/Resources/app.asar/node_modules/@vscode/ripgrep-darwin-arm64/bin/rg',
      ),
      true,
    );
    assert.equal(
      isInsidePackagedAsarArchive(
        '/Applications/Minnow.app/Contents/Resources/app.asar.unpacked/node_modules/@vscode/ripgrep-darwin-arm64/bin/rg',
      ),
      false,
    );
    assert.equal(
      isInsidePackagedAsarArchive(
        'C:\\Users\\dev\\minnow\\node_modules\\@vscode\\ripgrep-win32-x64\\bin\\rg.exe',
      ),
      false,
    );
  });

  it('resolveRipgrepExecutablePath does not return app.asar paths when unpacked is missing', () => {
    // Use a fictitious bundle path so a locally installed Minnow.app cannot satisfy existsSync.
    const inAsar =
      '/Nonexistent/Minnow-Fixture.app/Contents/Resources/app.asar/node_modules/@vscode/ripgrep-darwin-arm64/bin/rg';
    const resolved = resolveRipgrepExecutablePath(inAsar);
    assert.notEqual(resolved, inAsar);
    assert.match(resolved, /^(rg|rg\.exe)$/);
  });

  it('remapAsarUnpackPath leaves normal dev paths unchanged', () => {
    const dev =
      'C:\\Users\\dev\\minnow\\node_modules\\@vscode\\ripgrep-win32-x64\\bin\\rg.exe';
    assert.equal(remapAsarUnpackPath(dev), dev);
  });

  it('getRipgrepPath resolves to an existing bundled binary in dev', () => {
    const resolved = getRipgrepPath();
    assert.match(resolved, /rg(\.exe)?$/);
    assert.equal(isInsidePackagedAsarArchive(resolved), false);
  });
});
