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
  globalThis.HTMLDialogElement = window.HTMLDialogElement;
  document.body.innerHTML = `
    <dialog id="fileTreeMoveDialog" class="file-tree-move-dialog">
      <form method="dialog" class="file-tree-move-dialog__card">
        <h2 data-move-title>Move file?</h2>
        <p data-move-body></p>
        <p data-move-paths></p>
        <button type="submit" value="cancel" data-move-cancel>Cancel</button>
        <button type="submit" value="confirm" data-move-confirm>Move</button>
      </form>
    </dialog>
  `;
}

describe('file-tree-move-dialog', () => {
  afterEach(() => {
    resetMoveConfirmDialogForTests();
  });

  test('Cancel resolves false', async () => {
    setupDom();
    const dialog = document.getElementById('fileTreeMoveDialog');
    assert.ok(dialog);

    const promise = showMoveConfirmDialog({
      source: 'a.ts',
      destinationDir: 'src',
      sourceKind: 'file',
    });

    await Promise.resolve();
    dialog.close('cancel');
    const confirmed = await promise;
    assert.equal(confirmed, false);
  });

  test('Move resolves true', async () => {
    setupDom();
    const dialog = document.getElementById('fileTreeMoveDialog');
    assert.ok(dialog);

    const promise = showMoveConfirmDialog({
      source: 'pkg/index.ts',
      destinationDir: 'lib',
      sourceKind: 'file',
    });

    await Promise.resolve();
    dialog.close('confirm');
    const confirmed = await promise;
    assert.equal(confirmed, true);
  });
});
