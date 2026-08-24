/**
 * File-tree drag-and-drop: internal moves + OS file/folder import into workspace folders.
 */

import { collectDroppedTreeEntries } from '../attachments/directory-drop';
import { classifyFileDrag } from '../attachments/external-file-drop';
import { WORKSPACE_FILE_MIME } from '../attachments/workspace-ref';
import { basename, computeMoveDestination } from './file-tree-path';
import { getLocalServerAvailable } from '../tools/client';
import { expandDir } from './file-tree';
import { importDroppedEntriesToWorkspace } from './import-external-files';
import { movePath } from './file-tree-ops';
import { setStatus } from './status';

const DROP_TARGET_CLASS = 'file-tree-row--drop-target';
const HOST_DROP_CLASS = 'file-tree-host--drop-target';

let hostBound: HTMLElement | null = null;
let moveInFlight = false;
/** Set on dragstart; dragover cannot read DataTransfer.getData in most browsers. */
let activeDragSourcePath: string | null = null;

function hasWorkspaceDrag(dataTransfer: DataTransfer | null): boolean {
  return classifyFileDrag(dataTransfer) === 'workspace';
}

function hasExternalDrag(dataTransfer: DataTransfer | null): boolean {
  return classifyFileDrag(dataTransfer) === 'external';
}

function hasTreeDrag(dataTransfer: DataTransfer | null): boolean {
  return classifyFileDrag(dataTransfer) !== null;
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
  host.classList.remove(HOST_DROP_CLASS);
  for (const row of host.querySelectorAll(`.${DROP_TARGET_CLASS}`)) {
    row.classList.remove(DROP_TARGET_CLASS);
  }
}

async function handleTreeDrop(
  event: DragEvent,
  targetRow: HTMLElement,
): Promise<void> {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) return;

  const source = activeDragSourcePath?.trim() || (dataTransfer ? pathFromDataTransfer(dataTransfer) : null) || '';
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

async function handleExternalTreeDrop(
  event: DragEvent,
  destDir: string,
): Promise<void> {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) return;

  // collectDroppedTreeEntries captures webkitGetAsEntry before its first await.
  const { entries, error } = await collectDroppedTreeEntries(dataTransfer);
  if (!entries.length) {
    setStatus('err', error ?? 'Nothing to import from this drop.');
    return;
  }

  moveInFlight = true;
  try {
    const result = await importDroppedEntriesToWorkspace(entries, destDir);
    if (result.imported > 0 || result.directories > 0) {
      void expandDir(destDir);
    }
  } finally {
    moveInFlight = false;
  }
}

function pathFromDragRow(target: EventTarget | null): string | null {
  if (!(target instanceof HTMLElement)) return null;
  const row = target.closest('.file-tree-row[data-path]');
  if (!(row instanceof HTMLElement)) return null;
  const path = row.dataset.path?.trim();
  return path || null;
}

function bindHost(host: HTMLElement): void {
  host.addEventListener(
    'dragstart',
    (event) => {
      activeDragSourcePath = pathFromDragRow(event.target);
    },
    true,
  );

  host.addEventListener('dragover', (event) => {
    if (moveInFlight || !getLocalServerAvailable()) return;
    if (!hasTreeDrag(event.dataTransfer)) return;

    if (hasExternalDrag(event.dataTransfer)) {
      const row = folderRowFromTarget(event.target);
      const destDir = row?.dataset.path ?? '.';
      if (!destDir) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
      clearDropHighlight(host);
      if (row) {
        row.classList.add(DROP_TARGET_CLASS);
      } else {
        host.classList.add(HOST_DROP_CLASS);
      }
      return;
    }

    if (!hasWorkspaceDrag(event.dataTransfer)) return;

    const row = folderRowFromTarget(event.target);
    if (!row?.dataset.path) return;

    const source = activeDragSourcePath?.trim() ?? '';
    if (!source) return;

    const destination = computeMoveDestination(source, row.dataset.path);
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
    if (row) {
      const related = event.relatedTarget;
      if (related instanceof Node && row.contains(related)) return;
      row.classList.remove(DROP_TARGET_CLASS);
      return;
    }
    if (event.target === host) {
      host.classList.remove(HOST_DROP_CLASS);
    }
  });

  host.addEventListener('drop', (event) => {
    clearDropHighlight(host);
    if (moveInFlight || !getLocalServerAvailable()) return;
    if (!hasTreeDrag(event.dataTransfer)) return;

    event.preventDefault();
    event.stopPropagation();

    if (hasExternalDrag(event.dataTransfer)) {
      const row = folderRowFromTarget(event.target);
      const destDir = row?.dataset.path ?? '.';
      void handleExternalTreeDrop(event, destDir);
      return;
    }

    if (!hasWorkspaceDrag(event.dataTransfer)) return;

    const row = folderRowFromTarget(event.target);
    if (!row?.dataset.path) return;

    void handleTreeDrop(event, row);
  });

  host.addEventListener('dragend', () => {
    activeDragSourcePath = null;
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
  activeDragSourcePath = null;
}
