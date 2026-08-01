import assert from 'node:assert/strict';
import { register } from 'node:module';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

register('../test-loader.mjs', import.meta.url);

import { setLocalServerAvailableForTests } from '../../src/tools/config.ts';
import { setFileTreeServerAvailable, isFileTreeServerAvailable } from '../../src/ui/file-tree-server.ts';
import { onFilePanelServerAvailabilityChanged } from '../../src/ui/init-file-panel.ts';
import { renderFileTree } from '../../src/ui/file-tree.ts';

function setupFileTreeDom(): void {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  document.body.innerHTML = '<div id="fileTreeHost"></div>';
}

describe('file tree server availability', { concurrency: false }, () => {
  afterEach(() => {
    setLocalServerAvailableForTests(false);
    setFileTreeServerAvailable(false);
  });

  test('onFilePanelServerAvailabilityChanged syncs flag when server comes online', () => {
    setFileTreeServerAvailable(false);
    setLocalServerAvailableForTests(true);

    onFilePanelServerAvailabilityChanged();

    assert.equal(isFileTreeServerAvailable(), true);
  });

  test('onFilePanelServerAvailabilityChanged renders offline when server is down', () => {
    setupFileTreeDom();
    setFileTreeServerAvailable(true);
    setLocalServerAvailableForTests(false);

    onFilePanelServerAvailabilityChanged();

    assert.equal(isFileTreeServerAvailable(), false);
    const host = document.getElementById('fileTreeHost');
    assert.match(host?.textContent ?? '', /open minnow/i);
  });

  test('renderFileTree reflects latest server flag', () => {
    setupFileTreeDom();
    setFileTreeServerAvailable(true);
    renderFileTree();
    assert.equal(
      document.getElementById('fileTreeHost')?.querySelector('.file-tree-loading')?.textContent,
      'Loading project…',
    );

    setFileTreeServerAvailable(false);
    renderFileTree();
    assert.match(document.getElementById('fileTreeHost')?.textContent ?? '', /npm start/i);
  });
});
