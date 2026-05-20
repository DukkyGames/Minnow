import assert from 'node:assert/strict';
import { register } from 'node:module';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';

register('../test-loader.mjs', import.meta.url);

import { setFileTreeServerAvailable } from '../../src/ui/file-tree-server.ts';

const { renderFileTree, invalidateFileTreeCache } = await import('../../src/ui/file-tree.ts');

function setupFileTreeDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  document.body.innerHTML = '<div id="fileTreeHost"></div>';
  const host = document.getElementById('fileTreeHost');
  assert.ok(host);
  return host;
}

describe('file tree boot', { concurrency: false }, () => {
  test('offline empty state mentions npm start', () => {
    setupFileTreeDom();
    invalidateFileTreeCache();
    setFileTreeServerAvailable(false);
    renderFileTree();
    const host = document.getElementById('fileTreeHost');
    assert.match(host?.textContent ?? '', /npm start/i);
  });

  test('online with empty cache shows Loading project…', () => {
    setupFileTreeDom();
    invalidateFileTreeCache();
    setFileTreeServerAvailable(true);
    renderFileTree();
    const host = document.getElementById('fileTreeHost');
    assert.equal(host?.querySelector('.file-tree-loading')?.textContent, 'Loading project…');
    assert.ok(!(host?.textContent ?? '').includes('Open Files to load tree'));
  });

  test('renderFileTree offline after invalidate cache', () => {
    setupFileTreeDom();
    invalidateFileTreeCache();
    setFileTreeServerAvailable(false);
    renderFileTree();
    const host = document.getElementById('fileTreeHost');
    assert.match(host?.textContent ?? '', /npm start/i);
  });
});
