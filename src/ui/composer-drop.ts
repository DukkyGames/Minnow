/**
 * Composer drag-and-drop: file-tree workspace paths → reference chips.
 */

import { addWorkspaceReference, WORKSPACE_FILE_MIME } from '../attachments/workspace-ref';
import { applyOrchestratePlanFromWorkspacePath } from './orchestrate-plan-selector';

const DROP_ACTIVE_CLASS = 'composer-drop-active';

function hasWorkspaceDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  const types = dataTransfer.types;
  if (types.includes(WORKSPACE_FILE_MIME)) return true;
  if (types.includes('text/plain') && dataTransfer.effectAllowed !== 'none') {
    return true;
  }
  return false;
}

function pathFromDataTransfer(dataTransfer: DataTransfer): string | null {
  const typed = dataTransfer.getData(WORKSPACE_FILE_MIME).trim();
  if (typed) return typed;

  const plain = dataTransfer.getData('text/plain').trim();
  if (!plain || plain.includes('\n') || plain.length > 512) return null;
  return plain;
}

function setDropActive(targets: HTMLElement[], active: boolean): void {
  for (const el of targets) {
    if (active) el.classList.add(DROP_ACTIVE_CLASS);
    else el.classList.remove(DROP_ACTIVE_CLASS);
  }
}

function bindDropTarget(
  element: HTMLElement,
  dropTargets: HTMLElement[],
): void {
  let dragDepth = 0;

  element.addEventListener('dragenter', (event) => {
    if (!hasWorkspaceDrag(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth += 1;
    setDropActive(dropTargets, true);
  });

  element.addEventListener('dragover', (event) => {
    if (!hasWorkspaceDrag(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    setDropActive(dropTargets, true);
  });

  element.addEventListener('dragleave', (event) => {
    if (!hasWorkspaceDrag(event.dataTransfer)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      setDropActive(dropTargets, false);
    }
  });

  element.addEventListener('drop', (event) => {
    if (!hasWorkspaceDrag(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth = 0;
    setDropActive(dropTargets, false);

    const path = pathFromDataTransfer(event.dataTransfer!);
    if (path) {
      if (!applyOrchestratePlanFromWorkspacePath(path)) {
        addWorkspaceReference(path);
      }
    }
  });
}

/**
 * Wires dragover/drop on the composer textarea and input bar.
 * Safe to call before markup exists (no-op when elements are missing).
 */
export function initComposerDrop(): void {
  const msgInput = document.getElementById('msgInput');
  const inputBar = document.querySelector('.input-bar');
  const inputBarComposer = document.querySelector('.input-bar-composer');

  const targets: HTMLElement[] = [];
  if (msgInput instanceof HTMLElement) targets.push(msgInput);
  if (inputBar instanceof HTMLElement) targets.push(inputBar);
  if (inputBarComposer instanceof HTMLElement) targets.push(inputBarComposer);

  if (targets.length === 0) return;

  for (const target of targets) {
    bindDropTarget(target, targets);
  }
}
