import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import path from 'node:path';
import {
  commandLineLooksLikeMinnow,
  minnowProcessMatchSubstrings,
} from '../../scripts/kill-minnow-processes.mjs';

const fakeRoot = '/Users/dev/Development/Minnow';

describe('kill-minnow-processes', () => {
  it('does not match Cursor or generic Electron', () => {
    const cursor =
      '/Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Renderer).app/Contents/MacOS/Cursor Helper --type=renderer';
    assert.equal(commandLineLooksLikeMinnow(cursor, fakeRoot), false);

    const electronDevOther =
      '/some/other/project/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .';
    assert.equal(commandLineLooksLikeMinnow(electronDevOther, fakeRoot), false);
  });

  it('matches packaged Minnow and this repo electron main', () => {
    assert.equal(
      commandLineLooksLikeMinnow(
        '/Applications/Minnow.app/Contents/MacOS/Minnow',
        fakeRoot,
      ),
      true,
    );
    assert.equal(
      commandLineLooksLikeMinnow(
        `${fakeRoot}/electron/dist/main.js`,
        fakeRoot,
      ),
      true,
    );
    assert.equal(
      commandLineLooksLikeMinnow(
        `${fakeRoot}/release/pkg/mac-arm64/Minnow.app/Contents/MacOS/Minnow`,
        fakeRoot,
      ),
      true,
    );
  });

  it('does not kill every process whose cwd is the repo', () => {
    const vite =
      'node /Users/dev/Development/Minnow/node_modules/vite/bin/vite.js';
    assert.equal(commandLineLooksLikeMinnow(vite, fakeRoot), false);
  });

  it('exposes stable match fragments for packaging paths', () => {
    const fragments = minnowProcessMatchSubstrings(path.resolve(fakeRoot));
    assert.ok(fragments.some((f) => f.includes('electron/dist/main.js')));
    assert.ok(!fragments.some((f) => f === 'electron'));
  });
});
