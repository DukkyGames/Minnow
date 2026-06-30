/**
 * Composer drag-and-drop: workspace file-tree paths and OS files (Explorer) → composer.
 */

import { addAttachments } from '../attachments/store';
import {
  classifyFileDrag,
  filesFromDataTransfer,
  hasWorkspaceFileDrag,
} from '../attachments/external-file-drop';
import { WORKSPACE_FILE_MIME } from '../attachments/workspace-ref';
import { attachWorkspacePathToComposer } from './workspace-composer-link';

const DROP_ACTIVE_CLASS = 'composer-drop-active';

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

function hasComposerDrag(dataTransfer: DataTransfer | null): boolean {
  return classifyFileDrag(dataTransfer) !== null;
}

function bindDropTarget(
  element: HTMLElement,
  dropTargets: HTMLElement[],
): void {
  let dragDepth = 0;

  element.addEventListener('dragenter', (event) => {
    if (!hasComposerDrag(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth += 1;
    setDropActive(dropTargets, true);
  });

  element.addEventListener('dragover', (event) => {
    if (!hasComposerDrag(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    setDropActive(dropTargets, true);
  });

  element.addEventListener('dragleave', (event) => {
    if (!hasComposerDrag(event.dataTransfer)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      setDropActive(dropTargets, false);
    }
  });

  element.addEventListener('drop', (event) => {
    const kind = classifyFileDrag(event.dataTransfer);
    if (!kind) return;
    event.preventDefault();
    dragDepth = 0;
    setDropActive(dropTargets, false);

    if (kind === 'external' && event.dataTransfer) {
      const files = filesFromDataTransfer(event.dataTransfer);
      if (files.length) {
        void addAttachments(files);
      }
      return;
    }

    if (event.dataTransfer && hasWorkspaceFileDrag(event.dataTransfer)) {
      const path = pathFromDataTransfer(event.dataTransfer);
      if (path) {
        attachWorkspacePathToComposer(path);
      }
    }
  });
}

/**
 * Wires dragover/drop on Code, Chat app, and desktop composer surfaces.
 * Safe to call before markup exists (no-op when elements are missing).
 */
export function initComposerDrop(): void {
  const selectors = [
    '#msgInput',
    '.input-bar',
    '.input-bar-composer',
    '#chatAppInput',
    '.chat-app-composer',
    '#desktopInput',
    '.mn-os-desktop-composer',
    '.mn-os-desktop-input-row',
  ];

  const targets: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  for (const selector of selectors) {
    for (const el of document.querySelectorAll(selector)) {
      if (el instanceof HTMLElement && !seen.has(el)) {
        seen.add(el);
        targets.push(el);
      }
    }
  }

  if (targets.length === 0) return;

  for (const target of targets) {
    bindDropTarget(target, targets);
  }
}
