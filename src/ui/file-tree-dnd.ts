/**
 * Internal file-tree drag-and-drop: drop on folder → confirm → movePath.
 */

import { WORKSPACE_FILE_MIME } from '../attachments/workspace-ref';
import { basename, computeMoveDestination } from './file-tree-path';
import { getLocalServerAvailable } from '../tools/client';
import { expandDir } from './file-tree';
import { movePath } from './file-tree-ops';
import { showMoveConfirmDialog } from './file-tree-move-dialog';
import { setStatus } from './status';

const DROP_TARGET_CLASS = 'file-tree-row--drop-target';

let hostBound: HTMLElement | null = null;
let moveInFlight = false;

function hasWorkspaceDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  if (dataTransfer.types.includes(WORKSPACE_FILE_MIME)) return true;
  const plain = dataTransfer.getData('text/plain');
  if (plain && !plain.includes('\n') && plain.length <= 512) return true;
  return false;
}

function pathFromDataTransfer(dataTransfer: DataTransfer): string | null {
  const typed = dataTransfer.getData(WORKSPACE_FILE_MIME).trim();
  if (typed) return typed;
  const plain = dataTransfer.getData('text/plain').trim();
  if (!plain || plain.includes('\n') || plain.length > 512) return null;
  return plain;
}

function folderRowFromTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  const row = target.closest('.file-tree-row--dir');
  return row instanceof HTMLElement ? row : null;
}

function clearDropHighlight(host: HTMLElement): void {
  for (const row of host.querySelectorAll(`.${DROP_TARGET_CLASS}`)) {
    row.classList.remove(DROP_TARGET_CLASS);
  }
}

function sourceKindFromRow(sourcePath: string): 'file' | 'dir' {
  if (!hostBound) return 'file';
  for (const row of hostBound.querySelectorAll('.file-tree-row')) {
    if (row.getAttribute('data-path') === sourcePath) {
      return row.getAttribute('data-entry-kind') === 'dir' ? 'dir' : 'file';
    }
  }
  return 'file';
}

async function handleTreeDrop(
  event: DragEvent,
  targetRow: HTMLElement,
): Promise<void> {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) return;

  const source = pathFromDataTransfer(dataTransfer);
  const destDir = targetRow.dataset.path;
  if (!source || !destDir) return;

  const destination = computeMoveDestination(source, destDir);
  if (!destination) {
    if (basename(source) && destDir === source) {
      return;
    }
    setStatus('err', 'Cannot move a folder into itself or its subfolder.');
    return;
  }

  const confirmed = await showMoveConfirmDialog({
    source,
    destinationDir: destDir,
    sourceKind: sourceKindFromRow(source),
  });
  if (!confirmed) return;

  moveInFlight = true;
  try {
    const ok = await movePath(source, destination, 'move');
    if (ok) {
      void expandDir(destDir);
    }
  } finally {
    moveInFlight = false;
  }
}

function bindHost(host: HTMLElement): void {
  host.addEventListener('dragover', (event) => {
    if (moveInFlight || !getLocalServerAvailable()) return;
    if (!hasWorkspaceDrag(event.dataTransfer)) return;

    const row = folderRowFromTarget(event.target);
    if (!row?.dataset.path) return;

    const source =
      event.dataTransfer?.getData(WORKSPACE_FILE_MIME) ||
      event.dataTransfer?.getData('text/plain') ||
      '';
    const destination = computeMoveDestination(source.trim(), row.dataset.path);
    if (!destination) return;

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    clearDropHighlight(host);
    row.classList.add(DROP_TARGET_CLASS);
  });

  host.addEventListener('dragleave', (event) => {
    const row = folderRowFromTarget(event.target);
    if (!row) return;
    const related = event.relatedTarget;
    if (related instanceof Node && row.contains(related)) return;
    row.classList.remove(DROP_TARGET_CLASS);
  });

  host.addEventListener('drop', (event) => {
    clearDropHighlight(host);
    if (moveInFlight || !getLocalServerAvailable()) return;
    if (!hasWorkspaceDrag(event.dataTransfer)) return;

    const row = folderRowFromTarget(event.target);
    if (!row?.dataset.path) return;

    event.preventDefault();
    event.stopPropagation();
    void handleTreeDrop(event, row);
  });

  host.addEventListener('dragend', () => {
    clearDropHighlight(host);
  });
}

/**
 * Wire folder drop targets on the file tree host (idempotent).
 */
export function initFileTreeDnD(): void {
  const host = document.getElementById('fileTreeHost');
  if (!host || host === hostBound) return;
  hostBound = host;
  bindHost(host);
}

/** Clear binding state (tests). */
export function resetFileTreeDnDForTests(): void {
  hostBound = null;
  moveInFlight = false;
}
