/**
 * Confirmation dialog before an internal file-tree drag-and-drop move.
 */

import { basename, joinTreePath } from './file-tree-path';

export interface MoveConfirmDialogOptions {
  source: string;
  destinationDir: string;
  sourceKind: 'file' | 'dir';
}

let dialogEl: HTMLDialogElement | null = null;
let titleEl: HTMLElement | null = null;
let bodyEl: HTMLElement | null = null;
let pathsEl: HTMLElement | null = null;
let confirmBtn: HTMLButtonElement | null = null;
let cancelBtn: HTMLButtonElement | null = null;

function ensureDialog(): void {
  if (dialogEl) return;

  const existing = document.getElementById('fileTreeMoveDialog');
  if (existing instanceof HTMLDialogElement) {
    dialogEl = existing;
    titleEl = dialogEl.querySelector('[data-move-title]');
    bodyEl = dialogEl.querySelector('[data-move-body]');
    pathsEl = dialogEl.querySelector('[data-move-paths]');
    confirmBtn = dialogEl.querySelector('[data-move-confirm]');
    cancelBtn = dialogEl.querySelector('[data-move-cancel]');
    return;
  }

  dialogEl = document.createElement('dialog');
  dialogEl.id = 'fileTreeMoveDialog';
  dialogEl.className = 'file-tree-move-dialog';
  dialogEl.innerHTML = `
    <form method="dialog" class="file-tree-move-dialog__card">
      <h2 class="file-tree-move-dialog__title" data-move-title>Move file?</h2>
      <p class="file-tree-move-dialog__body" data-move-body></p>
      <p class="file-tree-move-dialog__paths" data-move-paths></p>
      <div class="file-tree-move-dialog__actions">
        <button type="submit" class="file-tree-move-dialog__btn" value="cancel" data-move-cancel>Cancel</button>
        <button type="submit" class="file-tree-move-dialog__btn file-tree-move-dialog__btn--primary" value="confirm" data-move-confirm>Move</button>
      </div>
    </form>
  `;
  document.body.appendChild(dialogEl);

  titleEl = dialogEl.querySelector('[data-move-title]');
  bodyEl = dialogEl.querySelector('[data-move-body]');
  pathsEl = dialogEl.querySelector('[data-move-paths]');
  confirmBtn = dialogEl.querySelector('[data-move-confirm]');
  cancelBtn = dialogEl.querySelector('[data-move-cancel]');
}

/**
 * Ask the user to confirm moving `source` into `destinationDir`.
 * Resolves true when Move is chosen, false on Cancel or Escape.
 */
export function showMoveConfirmDialog(
  opts: MoveConfirmDialogOptions,
): Promise<boolean> {
  ensureDialog();
  if (!dialogEl || !titleEl || !bodyEl || !pathsEl || !confirmBtn || !cancelBtn) {
    return Promise.resolve(false);
  }

  const destDisplay = opts.destinationDir === '.' ? './' : `${opts.destinationDir}/`;
  const destination = joinTreePath(opts.destinationDir, basename(opts.source));

  titleEl.textContent =
    opts.sourceKind === 'dir' ? 'Move folder?' : 'Move file?';
  bodyEl.innerHTML = `Move <strong>${basename(opts.source)}</strong> into <strong>${destDisplay}</strong>?`;
  pathsEl.textContent = `${opts.source} → ${destination}`;

  return new Promise((resolve) => {
    let settled = false;

    const finish = (confirmed: boolean): void => {
      if (settled) return;
      settled = true;
      dialogEl?.removeEventListener('close', onClose);
      dialogEl?.removeEventListener('cancel', onCancel);
      resolve(confirmed);
    };

    const onClose = (): void => {
      finish(dialogEl?.returnValue === 'confirm');
    };

    const onCancel = (event: Event): void => {
      event.preventDefault();
      dialogEl?.close('cancel');
      finish(false);
    };

    dialogEl.addEventListener('close', onClose);
    dialogEl.addEventListener('cancel', onCancel);

    if (typeof dialogEl.showModal === 'function') {
      dialogEl.returnValue = 'cancel';
      dialogEl.showModal();
      confirmBtn?.focus();
    } else {
      finish(window.confirm(`${titleEl.textContent}\n${pathsEl.textContent}`));
    }
  });
}

/** Reset dialog singleton (tests). */
export function resetMoveConfirmDialogForTests(): void {
  if (dialogEl?.open) {
    dialogEl.close('cancel');
  }
  dialogEl = null;
  titleEl = null;
  bodyEl = null;
  pathsEl = null;
  confirmBtn = null;
  cancelBtn = null;
}
