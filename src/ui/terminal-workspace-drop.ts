/**
 * Drag workspace file-tree paths into the xterm terminal (insert path at the prompt).
 */

import { hasWorkspaceFileDrag } from '../attachments/external-file-drop';
import { WORKSPACE_FILE_MIME } from '../attachments/workspace-ref';
import { insertTextAtTerminalInput } from './terminal-xterm';

const DROP_ACTIVE_CLASS = 'terminal-xterm-host--drop-active';

function pathFromDataTransfer(dataTransfer: DataTransfer): string | null {
  const typed = dataTransfer.getData(WORKSPACE_FILE_MIME).trim();
  if (typed) return typed;

  const plain = dataTransfer.getData('text/plain').trim();
  if (!plain || plain.includes('\n') || plain.length > 512) return null;
  return plain;
}

/**
 * Wire dragover/drop on the outer xterm host (#terminalXtermHost). Idempotent.
 */
export function initTerminalWorkspaceDrop(host: HTMLElement): void {
  if (host.dataset.terminalWorkspaceDropBound === '1') return;
  host.dataset.terminalWorkspaceDropBound = '1';

  let dragDepth = 0;

  host.addEventListener('dragenter', (event) => {
    if (!hasWorkspaceFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth += 1;
    host.classList.add(DROP_ACTIVE_CLASS);
  });

  host.addEventListener('dragover', (event) => {
    if (!hasWorkspaceFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    host.classList.add(DROP_ACTIVE_CLASS);
  });

  host.addEventListener('dragleave', (event) => {
    if (!hasWorkspaceFileDrag(event.dataTransfer)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      host.classList.remove(DROP_ACTIVE_CLASS);
    }
  });

  host.addEventListener('drop', (event) => {
    if (!hasWorkspaceFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth = 0;
    host.classList.remove(DROP_ACTIVE_CLASS);

    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) return;
    const path = pathFromDataTransfer(dataTransfer);
    if (!path) return;
    insertTextAtTerminalInput(path);
  });
}
