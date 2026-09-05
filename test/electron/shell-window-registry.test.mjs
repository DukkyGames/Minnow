import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { ShellWindowRegistry } from '../../electron/shell-window-registry.ts';
import { normalizeWorkspacePathKey } from '../../server/workspace/root.js';

/** The registry always gets the server's normalizer in main.ts. */
function makeRegistry() {
  return new ShellWindowRegistry({ normalizeKey: normalizeWorkspacePathKey });
}

describe('ShellWindowRegistry', () => {
  test('registers, looks up, and unregisters a window', () => {
    const registry = makeRegistry();
    const repo = path.resolve('/tmp/repo-a');

    const record = registry.register(1, repo, registry.nextViewId());
    assert.equal(record.windowId, 1);
    assert.equal(record.workspacePath, repo);
    assert.equal(registry.size, 1);
    assert.equal(registry.get(1)?.workspacePath, repo);

    assert.equal(registry.unregister(1)?.windowId, 1);
    assert.equal(registry.size, 0);
    assert.equal(registry.get(1), undefined);
  });

  test('finds the one window on a folder, whatever spelling the caller uses', () => {
    const registry = makeRegistry();
    const repo = path.resolve('/tmp/repo-a');
    registry.register(7, repo, 'view-1');

    assert.equal(registry.findByWorkspace(repo)?.windowId, 7);
    // A trailing separator and a `.` segment name the same folder.
    assert.equal(registry.findByWorkspace(`${repo}${path.sep}`)?.windowId, 7);
    assert.equal(registry.findByWorkspace(path.join(repo, '.'))?.windowId, 7);
    assert.equal(registry.findByWorkspace(path.resolve('/tmp/repo-b')), undefined);
  });

  test('key normalization matches the server, so the allowlist and the registry agree', () => {
    const registry = makeRegistry();
    const repo = path.resolve('/tmp/Repo-Mixed-Case');
    registry.register(3, repo, 'view-1');

    // Whatever the platform's rule is (Windows case-folds, POSIX does not), the
    // registry must reach the same verdict the server's allowlist does.
    const upper = repo.toUpperCase();
    const serverSaysSame =
      normalizeWorkspacePathKey(upper) === normalizeWorkspacePathKey(repo);
    assert.equal(Boolean(registry.findByWorkspace(upper)), serverSaysSame);
  });

  test('a window with no folder never answers a lookup', () => {
    const registry = makeRegistry();
    registry.register(2, '', 'view-1');
    assert.equal(registry.findByWorkspace(''), undefined);
    assert.equal(registry.findByWorkspace(path.resolve('/tmp/repo-a')), undefined);
    assert.equal(registry.size, 1);
  });

  test('retarget moves a window to another folder without changing its id', () => {
    const registry = makeRegistry();
    const a = path.resolve('/tmp/repo-a');
    const b = path.resolve('/tmp/repo-b');
    registry.register(4, a, 'view-1');

    registry.retarget(4, b);
    assert.equal(registry.findByWorkspace(a), undefined);
    assert.equal(registry.findByWorkspace(b)?.windowId, 4);
    assert.equal(registry.get(4)?.viewId, 'view-1');
  });

  test('lists most recently focused first', () => {
    const registry = makeRegistry();
    registry.register(1, path.resolve('/tmp/a'), 'view-1');
    registry.register(2, path.resolve('/tmp/b'), 'view-2');
    registry.register(3, path.resolve('/tmp/c'), 'view-3');

    assert.deepEqual(
      registry.list().map((r) => r.windowId),
      [3, 2, 1],
    );

    registry.markFocused(1);
    assert.equal(registry.mostRecentlyFocused()?.windowId, 1);
    assert.deepEqual(
      registry.list().map((r) => r.windowId),
      [1, 3, 2],
    );
  });

  test('hands out a distinct view id every time', () => {
    const registry = makeRegistry();
    const ids = new Set([
      registry.nextViewId(),
      registry.nextViewId(),
      registry.nextViewId(),
    ]);
    assert.equal(ids.size, 3);
  });
});
