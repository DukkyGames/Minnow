import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { setLocalServerAvailable } from '../../src/tools/config.ts';

const { renderFileTree, invalidateFileTreeCache } = await import('../../src/ui/file-tree.ts');
const { onFilePanelServerAvailabilityChanged } = await import('../../src/ui/init-file-panel.ts');

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
    setLocalServerAvailable(false);
    renderFileTree();
    const host = document.getElementById('fileTreeHost');
    assert.match(host?.textContent ?? '', /npm start/i);
  });

  test('online with empty cache shows Loading project…', () => {
    setupFileTreeDom();
    invalidateFileTreeCache();
    setLocalServerAvailable(true);
    renderFileTree();
    const host = document.getElementById('fileTreeHost');
    assert.equal(host?.querySelector('.file-tree-loading')?.textContent, 'Loading project…');
    assert.ok(!(host?.textContent ?? '').includes('Open Files to load tree'));
  });

  test('onFilePanelServerAvailabilityChanged is exported', () => {
    assert.equal(typeof onFilePanelServerAvailabilityChanged, 'function');
  });

  test('onFilePanelServerAvailabilityChanged renders offline when server down', () => {
    setupFileTreeDom();
    invalidateFileTreeCache();
    setLocalServerAvailable(false);
    onFilePanelServerAvailabilityChanged();
    const host = document.getElementById('fileTreeHost');
    assert.match(host?.textContent ?? '', /npm start/i);
  });
});
