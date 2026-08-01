/**
 * File-tree context menu includes Copy path and Open in System Explorer.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { setFileTreeServerAvailable } from '../../src/ui/file-tree-server.ts';

const {
  buildFileMenuItems,
  buildFolderMenuItems,
  buildMenuContext,
} = await import('../../src/ui/file-tree-context-menu.ts');

describe('file-tree Open in System Explorer', () => {
  afterEach(() => {
    setFileTreeServerAvailable(true);
  });

  test('file menu includes Open in System Explorer when server is up', () => {
    setFileTreeServerAvailable(true);
    const items = buildFileMenuItems(buildMenuContext('src/main.ts', 'file'));
    const reveal = items.find((item) => item.label === 'Open in System Explorer');
    assert.ok(reveal);
    assert.equal(reveal.disabled, false);
    assert.equal(typeof reveal.action, 'function');
  });

  test('folder menu includes Open in System Explorer when server is up', () => {
    setFileTreeServerAvailable(true);
    const items = buildFolderMenuItems(buildMenuContext('src', 'dir'));
    const reveal = items.find((item) => item.label === 'Open in System Explorer');
    assert.ok(reveal);
    assert.equal(reveal.disabled, false);
  });

  test('Open in System Explorer is disabled offline', () => {
    setFileTreeServerAvailable(false);
    const items = buildFileMenuItems(buildMenuContext('README.md', 'file'));
    const reveal = items.find((item) => item.label === 'Open in System Explorer');
    assert.ok(reveal);
    assert.equal(reveal.disabled, true);
    assert.match(reveal.title ?? '', /Open Minnow/i);
  });
});

describe('file-tree Copy path', () => {
  afterEach(() => {
    setFileTreeServerAvailable(true);
  });

  test('file menu includes Copy path', () => {
    const items = buildFileMenuItems(buildMenuContext('src/main.ts', 'file'));
    const copyPath = items.find((item) => item.label === 'Copy path');
    assert.ok(copyPath);
    assert.equal(copyPath.disabled ?? false, false);
    assert.equal(typeof copyPath.action, 'function');
  });

  test('folder menu includes Copy path', () => {
    const items = buildFolderMenuItems(buildMenuContext('src', 'dir'));
    const copyPath = items.find((item) => item.label === 'Copy path');
    assert.ok(copyPath);
    assert.equal(copyPath.disabled ?? false, false);
    assert.equal(typeof copyPath.action, 'function');
  });
});
