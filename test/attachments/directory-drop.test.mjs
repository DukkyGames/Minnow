import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  captureDroppedRootEntries,
  collectDroppedTreeEntries,
  emptyDirectoriesToCreate,
  entriesFromFileList,
  expandFileSystemEntries,
  MAX_DROPPED_TREE_ENTRIES,
  sanitizeRelativeDropPath,
} from '../../src/attachments/directory-drop.ts';

function makeFileEntry(fullPath, contents = 'x') {
  const name = fullPath.split('/').filter(Boolean).pop();
  const file = new File([contents], name);
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath,
    file: (ok) => ok(file),
  };
}

function makeDirEntry(fullPath, children, batches) {
  const name = fullPath.split('/').filter(Boolean).pop() || fullPath;
  const groups = batches ?? [children];
  return {
    isFile: false,
    isDirectory: true,
    name,
    fullPath,
    createReader: () => {
      let index = 0;
      return {
        readEntries: (ok) => {
          if (index >= groups.length) {
            ok([]);
            return;
          }
          const batch = groups[index];
          index += 1;
          ok(batch);
        },
      };
    },
  };
}

describe('sanitizeRelativeDropPath', () => {
  test('strips leading slashes and backslashes', () => {
    assert.equal(sanitizeRelativeDropPath('/MyFolder/a.ts'), 'MyFolder/a.ts');
    assert.equal(sanitizeRelativeDropPath('\\MyFolder\\a.ts'), 'MyFolder/a.ts');
  });

  test('rejects parent-segment traversal', () => {
    assert.equal(sanitizeRelativeDropPath('ok/../secret'), null);
    assert.equal(sanitizeRelativeDropPath('../secret'), null);
  });

  test('drops empty and dot segments', () => {
    assert.equal(sanitizeRelativeDropPath('/./src/./a.ts'), 'src/a.ts');
    assert.equal(sanitizeRelativeDropPath('/'), null);
    assert.equal(sanitizeRelativeDropPath('.'), null);
  });
});

describe('expandFileSystemEntries', () => {
  test('walks a nested folder and keeps empty directories', async () => {
    const empty = makeDirEntry('/pkg/empty', []);
    const nestedFile = makeFileEntry('/pkg/src/index.ts', 'export {}\n');
    const src = makeDirEntry('/pkg/src', [nestedFile]);
    const root = makeDirEntry('/pkg', [src, empty]);

    const { entries, error } = await expandFileSystemEntries([root]);
    assert.equal(error, null);
    assert.deepEqual(
      entries.map((row) => `${row.kind}:${row.relativePath}`).sort(),
      ['dir:pkg', 'dir:pkg/empty', 'dir:pkg/src', 'file:pkg/src/index.ts'].sort(),
    );
    const fileEntry = entries.find((row) => row.kind === 'file');
    assert.equal(fileEntry.file.name, 'index.ts');
  });

  test('reads batched directory listings until empty', async () => {
    const a = makeFileEntry('/folder/a.txt', 'a');
    const b = makeFileEntry('/folder/b.txt', 'b');
    const c = makeFileEntry('/folder/c.txt', 'c');
    const root = makeDirEntry('/folder', [], [[a, b], [c], []]);

    const { entries, error } = await expandFileSystemEntries([root]);
    assert.equal(error, null);
    const files = entries.filter((row) => row.kind === 'file').map((row) => row.relativePath);
    assert.deepEqual(files.sort(), ['folder/a.txt', 'folder/b.txt', 'folder/c.txt']);
  });

  test('refuses a tree larger than the import cap', async () => {
    const files = [];
    for (let i = 0; i < MAX_DROPPED_TREE_ENTRIES; i += 1) {
      files.push(makeFileEntry(`/big/f${i}.txt`, 'x'));
    }
    const root = makeDirEntry('/big', files);
    const { entries, error } = await expandFileSystemEntries([root]);
    assert.equal(entries.length, 0);
    assert.match(error, /too large/i);
  });
});

describe('emptyDirectoriesToCreate', () => {
  test('keeps dirs that have no files underneath', () => {
    const dirs = emptyDirectoriesToCreate([
      { kind: 'dir', relativePath: 'pkg', file: null },
      { kind: 'dir', relativePath: 'pkg/src', file: null },
      { kind: 'dir', relativePath: 'pkg/empty', file: null },
      { kind: 'file', relativePath: 'pkg/src/index.ts', file: new File(['x'], 'index.ts') },
    ]);
    assert.deepEqual(dirs, ['pkg/empty']);
  });
});

describe('entriesFromFileList', () => {
  test('uses webkitRelativePath for directory-picker files', () => {
    const file = new File(['x'], 'index.ts');
    Object.defineProperty(file, 'webkitRelativePath', { value: 'pkg/src/index.ts' });
    const { entries, error } = entriesFromFileList([file]);
    assert.equal(error, null);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].relativePath, 'pkg/src/index.ts');
  });

  test('errors when the only items are unreadable folders', () => {
    const { entries, error } = entriesFromFileList([new File([], 'my-folder')]);
    assert.equal(entries.length, 0);
    assert.match(error, /Could not read this folder/i);
  });
});

describe('captureDroppedRootEntries', () => {
  test('reads webkitGetAsEntry from file items', () => {
    const entry = makeFileEntry('/note.txt');
    const transfer = {
      items: [
        { kind: 'string', type: 'text/plain', webkitGetAsEntry: () => null },
        { kind: 'file', type: '', webkitGetAsEntry: () => entry },
      ],
    };
    const roots = captureDroppedRootEntries(transfer);
    assert.equal(roots.length, 1);
    assert.equal(roots[0].fullPath, '/note.txt');
  });
});

describe('collectDroppedTreeEntries', () => {
  test('prefers FileSystemEntry walk over the File list', async () => {
    const nested = makeFileEntry('/docs/readme.md', '# hi\n');
    const dir = makeDirEntry('/docs', [nested]);
    const folderFile = new File([], 'docs');
    const transfer = {
      items: [{ kind: 'file', type: '', webkitGetAsEntry: () => dir }],
      files: [folderFile],
    };
    const { entries, error } = await collectDroppedTreeEntries(transfer);
    assert.equal(error, null);
    assert.ok(entries.some((row) => row.relativePath === 'docs/readme.md'));
  });
});
