import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { setLocalServerAvailableForTests } from '../../src/tools/config.ts';
import { workspacePathForDroppedEntry } from '../../src/ui/import-external-files.ts';

function ensureStatusDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.window = window;
}

describe('workspacePathForDroppedEntry', () => {
  test('joins nested drop paths under the destination folder', () => {
    assert.equal(workspacePathForDroppedEntry('src', 'pkg/index.ts'), 'src/pkg/index.ts');
    assert.equal(workspacePathForDroppedEntry('.', 'pkg/index.ts'), 'pkg/index.ts');
    assert.equal(workspacePathForDroppedEntry('', 'readme.md'), 'readme.md');
  });
});

describe('importDroppedEntriesToWorkspace', () => {
  afterEach(() => {
    setLocalServerAvailableForTests(false);
    globalThis.fetch = undefined;
  });

  test('posts nested files and empty directories', async () => {
    ensureStatusDom();
    setLocalServerAvailableForTests(true);
    const calls = [];
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init.body));
      calls.push(body);
      return {
        ok: true,
        json: async () => ({ result: `Imported ${body.args.path}` }),
      };
    };

    const { importDroppedEntriesToWorkspace } = await import(
      '../../src/ui/import-external-files.ts'
    );
    const result = await importDroppedEntriesToWorkspace(
      [
        { kind: 'dir', relativePath: 'pkg', file: null },
        { kind: 'dir', relativePath: 'pkg/empty', file: null },
        { kind: 'dir', relativePath: 'pkg/src', file: null },
        {
          kind: 'file',
          relativePath: 'pkg/src/index.ts',
          file: new File(['export {}\n'], 'index.ts'),
        },
      ],
      'lib',
    );

    assert.equal(result.imported, 1);
    assert.equal(result.directories, 1);
    assert.deepEqual(
      calls.map((row) => `${row.args.kind ?? 'file'}:${row.args.path}`),
      ['dir:lib/pkg/empty', 'file:lib/pkg/src/index.ts'],
    );
    assert.equal(typeof calls[1].args.content, 'string');
    assert.ok(calls[1].args.content.length > 0);
  });

  test('stops when the tool server is unavailable', async () => {
    ensureStatusDom();
    setLocalServerAvailableForTests(false);
    const { importDroppedEntriesToWorkspace } = await import(
      '../../src/ui/import-external-files.ts'
    );
    const result = await importDroppedEntriesToWorkspace(
      [{ kind: 'file', relativePath: 'a.ts', file: new File(['x'], 'a.ts') }],
      '.',
    );
    assert.equal(result.imported, 0);
    assert.deepEqual(result.errors, ['Tool server unavailable']);
  });
});
