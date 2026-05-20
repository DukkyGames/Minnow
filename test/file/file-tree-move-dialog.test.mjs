import assert from 'node:assert/strict';
import { describe, test, afterEach } from 'node:test';
import { Window } from 'happy-dom';
import {
  resetMoveConfirmDialogForTests,
  showMoveConfirmDialog,
} from '../../src/ui/file-tree-move-dialog.ts';

function setupDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLButtonElement = window.HTMLButtonElement;
  document.body.innerHTML = `
    <aside id="fileSidebar" class="file-sidebar">
      <div id="fileTreeMoveConfirm" class="file-tree-move-confirm hidden" hidden>
        <p data-move-title>Move file?</p>
        <p data-move-body></p>
        <p data-move-paths></p>
        <button type="button" data-move-cancel>Cancel</button>
        <button type="button" data-move-confirm>Move</button>
      </div>
      <div id="fileTreeHost" role="tree"></div>
    </aside>
  `;
}

describe('file-tree-move-dialog', () => {
  afterEach(() => {
    resetMoveConfirmDialogForTests();
  });

  test('Cancel resolves false', async () => {
    setupDom();
    const banner = document.getElementById('fileTreeMoveConfirm');
    assert.ok(banner);

    const promise = showMoveConfirmDialog({
      source: 'a.ts',
      destinationDir: 'src',
      sourceKind: 'file',
    });

    await Promise.resolve();
    assert.equal(banner.hidden, false);
    banner.querySelector('[data-move-cancel]').click();
    const confirmed = await promise;
    assert.equal(confirmed, false);
    assert.equal(banner.hidden, true);
  });

  test('Move resolves true', async () => {
    setupDom();
    const banner = document.getElementById('fileTreeMoveConfirm');
    assert.ok(banner);

    const promise = showMoveConfirmDialog({
      source: 'pkg/index.ts',
      destinationDir: 'lib',
      sourceKind: 'file',
    });

    await Promise.resolve();
    banner.querySelector('[data-move-confirm]').click();
    const confirmed = await promise;
    assert.equal(confirmed, true);
    assert.equal(banner.hidden, true);
  });
});
